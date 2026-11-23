// FdnReverb in a browser: the same algorithm as on a device. The C++ kernel's spec, processors/fdnReverbProcessor.ts, runs
// here as an AudioWorklet, so `decay`, `lowpass` and `damping` mean the same on both. `process` is self-contained (the
// worklet rules, docs/FINDINGS.md), so its own source goes into the worklet module, and there is no second copy to keep
// in sync. Its state is made on the main thread and passed in through processorOptions.
//
// A browser loads worklet modules asynchronously, so the wet path joins once `ready` resolves. Needs a secure context
// (https or localhost), as every AudioWorklet does.

import { fdnReverbProcessor } from '../processors/fdnReverbProcessor';
import { Effect, optionsFromArguments } from './toneWebInternals';
import type { EffectOptions } from './toneWebInternals';

export interface FdnReverbOptions extends EffectOptions {
  decay: number;
  lowpass: number;
  damping: number;
}

const PROCESSOR_NAME = 'rnwac-fdn-reverb';

// Tone's addAudioWorkletModule() keeps a single module per context (its own), so this one is added to the raw context.
const loaded = new WeakMap<object, Promise<void>>();
let moduleUrl: string | null = null;

function workletModuleSource(): string {
  const descriptors = fdnReverbProcessor.parameterDescriptors.map((p) => ({ ...p, automationRate: 'k-rate' }));
  return `
const processBlock = ${fdnReverbProcessor.process.toString()};
class FdnReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return ${JSON.stringify(descriptors)}; }
  constructor(options) {
    super();
    this.state = options.processorOptions.state;
    this.values = {};
    this.alive = true;
    this.port.onmessage = () => { this.alive = false; };
  }
  process(inputs, outputs, parameters) {
    if (!this.alive) return false;
    for (const name in parameters) this.values[name] = parameters[name][0];
    const output = outputs[0];
    processBlock(this.state, inputs[0], output, this.values, output[0].length, sampleRate, currentTime);
    return true;
  }
}
registerProcessor(${JSON.stringify(PROCESSOR_NAME)}, FdnReverbProcessor);
`;
}

function loadProcessor(rawContext: any): Promise<void> {
  let loading = loaded.get(rawContext);
  if (!loading) {
    if (!moduleUrl) {
      const { Blob: BlobClass, URL: URLClass } = globalThis as any;
      moduleUrl = URLClass.createObjectURL(new BlobClass([workletModuleSource()], { type: 'text/javascript' })) as string;
    }
    loading = rawContext.audioWorklet.addModule(moduleUrl) as Promise<void>;
    loaded.set(rawContext, loading);
  }
  return loading;
}

export class FdnReverb extends Effect<FdnReverbOptions> {
  readonly name: string = 'FdnReverb';
  readonly ready: Promise<void>;
  private _node: any = null;
  private _decay: number;
  private _lowpass: number;
  private _damping: number;

  constructor(options?: Partial<FdnReverbOptions>);
  constructor(decay?: number);
  constructor(...args: unknown[]) {
    const options = optionsFromArguments(FdnReverb.getDefaults(), args as IArguments & unknown[], ['decay']);
    super(options);
    this._decay = options.decay;
    this._lowpass = options.lowpass;
    this._damping = options.damping;
    this.ready = loadProcessor(this.context.rawContext).then(() => {
      if (this.disposed) return;
      const sampleRate = this.context.sampleRate;
      this._node = this.context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        // Set here rather than from the options: a setter may have run while the module loaded.
        parameterData: { decayTime: this._decay, lpFreqStart: this._lowpass, lpFreqEnd: this._damping },
        processorOptions: { state: fdnReverbProcessor.createState(sampleRate, undefined) },
      });
      this.connectEffect(this._node);
    });
    // `ready` still rejects for whoever awaits it; a reverb that failed to load shouldn't fail silently for those who don't.
    this.ready.catch((error: unknown) => console.error('[FdnReverb] could not load its AudioWorklet', error));
  }

  static getDefaults(): FdnReverbOptions {
    return Object.assign(Effect.getDefaults(), { decay: 2, lowpass: 15000, damping: 1000 });
  }

  private _setParam(name: string, value: number): void {
    const param = this._node?.parameters.get(name);
    if (param) param.value = value;
  }

  get decay(): number {
    return this._decay;
  }
  set decay(seconds: number) {
    this._decay = seconds;
    this._setParam('decayTime', seconds);
  }

  get lowpass(): number {
    return this._lowpass;
  }
  set lowpass(hz: number) {
    this._lowpass = hz;
    this._setParam('lpFreqStart', hz);
  }

  get damping(): number {
    return this._damping;
  }
  set damping(hz: number) {
    this._damping = hz;
    this._setParam('lpFreqEnd', hz);
  }

  dispose(): this {
    super.dispose();
    if (this._node) {
      // A processor that returns true runs for as long as the context does, so tell it to stop.
      this._node.port.postMessage('dispose');
      this._node.disconnect();
      this._node = null;
    }
    return this;
  }
}
