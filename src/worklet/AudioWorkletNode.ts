// AudioWorkletNode for React Native, on top of react-native-audio-api's real-time WorkletProcessingNode /
// WorkletSourceNode. Matches the call contract Web Audio code uses: `new AudioWorkletNode(ctx, processorName,
// { processorOptions })`, then `node.parameters.get(name)` (a LiveAudioParam with value and automation) and
// `node.port.postMessage(...)` (JS -> processor only).
//
// There is no AudioWorkletGlobalScope and no module loading: a processor is registered from JS instead, either as
//   - a JS processor (registerWorkletProcessor): a WorkletProcessorModule whose `process()` runs as a worklet on the
//     audio thread, or
//   - a native factory (registerNativeProcessor): builds the node from native pieces instead (a C++ kernel via
//     createNativeKernelNode, or built-in nodes); used when native processors are enabled (the default).
// `audioWorklet.addModule()` (installWebAudioCompat) is a no-op that resolves, so code that loads its modules first
// still works once the matching processors are registered.
//
// Rules for JS processors (docs/FINDINGS.md, "Worklet rules"): `process()` carries its own 'worklet' directive and must be
// self-contained (no references to other module-level bindings); any helper called from it needs its own 'worklet'
// directive too; never touch a Reanimated SharedValue from it (use react-native-worklets' Synchronizable). An exception
// escaping a worklet callback aborts the whole app, so every callback here is wrapped in try/catch (the block is
// silenced instead).
//
// SOURCE vs EFFECT: Web Audio's AudioWorkletNode covers both. react-native-audio-api splits them into
// WorkletProcessingNode (effect, has input) and WorkletSourceNode (source, needs .start()); the module's `kind` picks one
// and sources are started automatically. The constructor returns the real underlying node (not `this`), so connect() etc.
// are the library's own; `static [Symbol.hasInstance]` keeps `node instanceof AudioWorkletNode` working.

import {
  BiquadFilterNode,
  DelayNode,
  GainNode,
  StereoPannerNode,
  WaveShaperNode,
  type AudioNode,
  type BaseAudioContext,
} from 'react-native-audio-api';
import { createSynchronizable, type Synchronizable } from 'react-native-worklets';
import type { ParamValues, WorkletProcessorModule } from './types';
import {
  LiveAudioParam,
  ParamVersion,
  readCachedParams as readCachedParamsImport,
  computeAutomatedValue as computeAutomatedValueImport,
  type ParamCache,
} from './liveAudioParam';
// The registries are intentionally heterogeneous (each module's State type differs and is only known where it's
// registered); `any` here is the type-erasure boundary, not a leak into calling code.
const registry = new Map<string, WorkletProcessorModule<any>>();

export type NativeProcessorFactory = (
  context: BaseAudioContext,
  processorOptions: Record<string, unknown> | undefined
) => AudioNode;
const nativeFactories = new Map<string, NativeProcessorFactory>();
let nativeProcessorsEnabled = true;

// Registers a JS processor under `name` (what `new AudioWorkletNode(ctx, name)` asks for).
export function registerWorkletProcessor<State>(name: string, module: WorkletProcessorModule<State>): void {
  registry.set(name, module);
}

// Registers a native implementation for `name`; it is used instead of the JS processor while native processors are
// enabled. The returned node should expose `parameters` (and `port` if the processor uses messages).
export function registerNativeProcessor(name: string, factory: NativeProcessorFactory): void {
  nativeFactories.set(name, factory);
}

// A/B switch: false runs the registered JS processors even where a native factory exists.
export function setNativeProcessorsEnabled(enabled: boolean): void {
  nativeProcessorsEnabled = enabled;
}

export function areNativeProcessorsEnabled(): boolean {
  return nativeProcessorsEnabled;
}

export function hasWorkletProcessor(name: string): boolean {
  return registry.has(name) || nativeFactories.has(name);
}

export interface AudioWorkletNodeOptions {
  processorOptions?: Record<string, unknown>;
}

// `node.port`, JS -> processor only: postMessage JSON-stringifies the payload into a Synchronizable mailbox and bumps
// a generation counter; the audio callback checks the counter each block and calls the module's onMessage when it
// changes. Processor -> JS isn't implemented (`onmessage` is never called).
class WorkletPort {
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(
    private readonly outbox: Synchronizable<string>,
    private readonly generation: Synchronizable<number>
  ) {}

  postMessage(data: unknown): void {
    this.outbox.setBlocking(JSON.stringify(data));
    this.generation.setBlocking(this.generation.getBlocking() + 1);
  }
}

const constructedNodes = new WeakSet<object>();



// Declaration merging: the constructor below returns a real AudioNode
// subclass instance, not `this` (see the file header comment on why), so
// TypeScript's normal inference from the class body alone wouldn't know
// `.connect()` etc. exist on it. This interface + the class of the same
// name merge into one type that includes both.
export interface AudioWorkletNode extends AudioNode {
  readonly parameters: Map<string, LiveAudioParam>;
  readonly port: WorkletPort;
}

export class AudioWorkletNode {
  static [Symbol.hasInstance](instance: unknown): boolean {
    return typeof instance === 'object' && instance !== null && constructedNodes.has(instance);
  }

  constructor(context: BaseAudioContext, processorName: string, options?: AudioWorkletNodeOptions) {
    const nativeFactory = nativeFactories.get(processorName);
    const module = registry.get(processorName);
    if (nativeFactory && (nativeProcessorsEnabled || !module)) {
      const nativeNode = nativeFactory(context, options?.processorOptions);
      constructedNodes.add(nativeNode);
      return nativeNode as unknown as AudioWorkletNode;
    }
    if (!module) {
      throw new Error(`No worklet processor registered for "${processorName}"`);
    }

    // Plain objects and arrays, not Maps: they are captured into the worklet closure below. The Synchronizables in them
    // cross into the worklet runtime by reference.
    const sharedParams: Record<string, Synchronizable<number>> = {};
    const scheduleParams: Record<string, Synchronizable<string>> = {};
    const paramNames: string[] = [];
    for (const descriptor of module.parameterDescriptors) {
      sharedParams[descriptor.name] = createSynchronizable(descriptor.defaultValue);
      scheduleParams[descriptor.name] = createSynchronizable('[]');
      paramNames.push(descriptor.name);
    }

    const state = module.createState(context.sampleRate, options?.processorOptions);
    const process = module.process;
    const onMessage = module.onMessage;
    const sampleRate = context.sampleRate;
    const portOutbox = createSynchronizable('');
    const portGeneration = createSynchronizable(0);
    // Captured through local consts: a worklet callback can't reference other module-level bindings.
    const computeAutomatedValue = computeAutomatedValueImport;
    const readCachedParams = readCachedParamsImport;
    const versionSync = createSynchronizable(0);
    const paramVersion = new ParamVersion(versionSync);
    const paramCache: ParamCache = { v: -1, base: {}, sched: {} };
    // Ordinary worklet-local buffers: reading/writing the library's own per-block typed arrays from JS is
    // 1.5-3x slower than plain local Float32Arrays (measured on-device), so copy in/out around process().
    const localIn = [new Float32Array(128), new Float32Array(128)];
    const localOut = [new Float32Array(128), new Float32Array(128)];

    let node: AudioNode;

    if (module.kind === 'source') {
      const sourceNode = context.createWorkletSourceNode((audioData, framesToProcess, currentTime) => {
        'worklet';

        // The whole callback is inside the try: an exception escaping it aborts the app (docs/FINDINGS.md, "Worklet
        // rules"). A failing block is silenced instead.
        try {
          const params: ParamValues = readCachedParams(
            versionSync,
            paramCache,
            paramNames,
            sharedParams,
            scheduleParams,
            currentTime,
            computeAutomatedValue
          );

          if (onMessage) {
            const generation = portGeneration.getBlocking();
            if (generation !== 0) {
              onMessage(state, JSON.parse(portOutbox.getBlocking()));
              portGeneration.setBlocking(0);
            }
          }
          if (audioData.length === 2 && framesToProcess === 128) {
            process(state, [], localOut, params, framesToProcess, sampleRate, currentTime);
            audioData[0].set(localOut[0]);
            audioData[1].set(localOut[1]);
          } else {
            process(state, [], audioData, params, framesToProcess, sampleRate, currentTime);
          }
        } catch {
          for (let ch = 0; ch < audioData.length; ch++) {
            audioData[ch].fill(0);
          }
        }
      }, 'AudioRuntime');
      sourceNode.start();
      node = sourceNode;
    } else {
      node = context.createWorkletProcessingNode((inputData, outputData, framesToProcess, currentTime) => {
        'worklet';

        try {
          const params: ParamValues = readCachedParams(
            versionSync,
            paramCache,
            paramNames,
            sharedParams,
            scheduleParams,
            currentTime,
            computeAutomatedValue
          );

          if (onMessage) {
            const generation = portGeneration.getBlocking();
            if (generation !== 0) {
              onMessage(state, JSON.parse(portOutbox.getBlocking()));
              portGeneration.setBlocking(0);
            }
          }
          if (inputData.length === 2 && outputData.length === 2 && framesToProcess === 128) {
            localIn[0].set(inputData[0]);
            localIn[1].set(inputData[1]);
            process(state, localIn, localOut, params, framesToProcess, sampleRate, currentTime);
            outputData[0].set(localOut[0]);
            outputData[1].set(localOut[1]);
          } else {
            process(state, inputData, outputData, params, framesToProcess, sampleRate, currentTime);
          }
        } catch {
          for (let ch = 0; ch < outputData.length; ch++) {
            outputData[ch].fill(0);
          }
        }
      }, 'AudioRuntime');
    }

    const parameters = new Map<string, LiveAudioParam>();
    for (const name of paramNames) {
      parameters.set(name, new LiveAudioParam(sharedParams[name], scheduleParams[name], paramVersion));
    }

    const port = new WorkletPort(portOutbox, portGeneration);

    Object.assign(node, { parameters, port });
    constructedNodes.add(node);

    // Deliberate: see the file header comment on why this constructor
    // returns the real underlying node instead of `this`.
    return node as unknown as AudioWorkletNode;
  }
}

// Makes a context behave like a browser AudioContext for code written against Web Audio:
//  - global AudioWorkletNode (this class) and a no-op `audioWorklet.addModule()`;
//  - createGain/createBiquadFilter/createStereoPanner/createWaveShaper/createDelay return explicit-stereo nodes.
//    react-native-audio-api nodes otherwise process IN PLACE on their input's buffer, and a node's "already processed
//    this quantum" cache hands a second consumer its own never-written buffer, so fan-out (one node feeding two others)
//    corrupts or silences the signal. Explicit channel-count mode makes a node mix into its own buffer. The bare
//    constructors (`new GainNode(...)`) get the same treatment in globals.ts.
export function installWebAudioCompat(context: BaseAudioContext): void {
  (globalThis as Record<string, unknown>).AudioWorkletNode = AudioWorkletNode;
  const explicit = { channelCount: 2, channelCountMode: 'explicit' } as const;
  Object.assign(context, {
    audioWorklet: {
      addModule: async () => {},
    },
    createGain: () => new GainNode(context, explicit),
    createBiquadFilter: () => new BiquadFilterNode(context, explicit),
    createStereoPanner: () => new StereoPannerNode(context, explicit),
    createWaveShaper: () => new WaveShaperNode(context, explicit),
    createDelay: (maxDelayTime?: number) =>
      new DelayNode(context, maxDelayTime === undefined ? explicit : { ...explicit, maxDelayTime }),
  });
}
