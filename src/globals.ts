// Side-effect module: makes the Web Audio API look like a browser's to code that assumes browser globals.
//
// Import it FIRST (before any Web Audio library that touches these names at module-evaluation time): ES module imports
// fully evaluate, including everything they import, before the importing module's own statements run, so a global set
// later in the same file is already too late. Idempotent; it never overwrites an existing global.
//
// What it does, and why (each item was found on a real device; see docs/FINDINGS.md):
//  - Exposes react-native-audio-api's classes as globals (AudioContext, BaseAudioContext, OfflineAudioContext, AudioNode,
//    AudioParam, AudioScheduledSourceNode, AudioBuffer, PeriodicWave and every node class it has). Browser code constructs nodes and does `instanceof`
//    checks and `X.prototype.y = ...` patches on bare global names, which throw ReferenceError when they're missing.
//  - GainNode / StereoPannerNode / WaveShaperNode / BiquadFilterNode / DelayNode globals are explicit-stereo subclasses
//    (which still answer `instanceof` for nodes made by the context's create*() methods): react-native-audio-api nodes
//    otherwise process IN PLACE on their input's buffer, and a node's "already processed this quantum" cache hands a
//    second consumer its own never-written buffer, so fan-out silences or corrupts the signal. installWebAudioCompat
//    does the same for the context's create*() methods.
//  - Adds the missing node types: DynamicsCompressorNode, and an IIRFilterNode constructor (react-native-audio-api only
//    has createIIRFilter()). ChannelMergerNode / ChannelSplitterNode / PannerNode / AudioListener are its own since 1.0.
//  - Adds createDynamicsCompressor() and `onstatechange` to contexts, and the deprecated PannerNode.setPosition() /
//    setOrientation().
//  - OfflineAudioContext fires `oncomplete` (react-native-audio-api only resolves the startRendering() promise) and has
//    `length`.
//  - `param.value` reads back what was just written (react-native-audio-api returns the old value until the audio
//    thread has applied the change, so `p.value = 3; p.value` gave the previous value).
//  - `x instanceof AudioParam` is also true for this library's LiveAudioParam and KernelParam (the params of JS worklet
//    and C++ kernel nodes), so code that walks or wraps a node's params accepts them.

import {
  OfflineAudioContext,
  BaseAudioContext,
  AudioContext,
  AudioNode,
  AudioParam,
  AudioScheduledSourceNode,
  AudioBuffer,
  AudioBufferSourceNode,
  AudioListener,
  AnalyserNode,
  BiquadFilterNode,
  ChannelMergerNode,
  ChannelSplitterNode,
  ConstantSourceNode,
  DelayNode,
  GainNode,
  OscillatorNode,
  PannerNode,
  PeriodicWave,
  StereoPannerNode,
  WaveShaperNode,
} from 'react-native-audio-api';
import { DynamicsCompressorNode } from './nodes/DynamicsCompressorNode';
import { LiveAudioParam } from './worklet/liveAudioParam';
import { KernelParam } from './kernels/kernelParam';
import { CompatConvolverNode } from './nodes/CompatConvolverNode';

function setGlobalIfMissing(name: string, value: unknown): void {
  if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
    (globalThis as Record<string, unknown>)[name] = value;
  }
}

class CompatOfflineAudioContext extends OfflineAudioContext {
  oncomplete: ((event: { renderedBuffer: unknown }) => void) | null = null;
  readonly length: number;

  constructor(...args: [{ length: number }] | [number, number, number]) {
    super(...(args as [any]));
    this.length = typeof args[0] === 'object' ? args[0].length : (args[1] as number);
  }

  async startRendering() {
    const renderedBuffer = await super.startRendering();
    this.oncomplete?.({ renderedBuffer });
    return renderedBuffer;
  }
}

const explicitStereoOptions = { channelCount: 2, channelCountMode: 'explicit' } as const;

// Explicit-stereo subclass of a node class, keeping `instanceof` true for instances of the base class (nodes made by
// the context's create*() methods, or by react-native-audio-api itself).
function explicitStereo<T extends new (context: any, options?: any) => object>(Base: T): T {
  const Sub = class extends (Base as new (context: any, options?: any) => object) {
    constructor(context: unknown, options?: Record<string, unknown>) {
      super(context, { ...explicitStereoOptions, ...options });
    }

    static [Symbol.hasInstance](instance: unknown): boolean {
      return typeof instance === 'object' && instance !== null && Base.prototype.isPrototypeOf(instance);
    }
  };
  Object.defineProperty(Sub, 'name', { value: Base.name });
  return Sub as unknown as T;
}

// react-native-audio-api doesn't export its IIRFilterNode class, only ctx.createIIRFilter(feedforward, feedback). This
// constructor delegates to it; `instanceof` uses the real prototype, learned from the first node created.
let iirPrototype: object | null = null;
function IIRFilterNode(context: { createIIRFilter: (ff: number[], fb: number[]) => object }, options: { feedforward: number[]; feedback: number[] }) {
  const node = context.createIIRFilter(Array.from(options.feedforward), Array.from(options.feedback));
  iirPrototype = iirPrototype ?? Object.getPrototypeOf(node);
  return node;
}
Object.defineProperty(IIRFilterNode, Symbol.hasInstance, {
  value: (instance: unknown) =>
    iirPrototype !== null && typeof instance === 'object' && instance !== null && iirPrototype.isPrototypeOf(instance),
});

setGlobalIfMissing('AudioContext', AudioContext);
setGlobalIfMissing('BaseAudioContext', BaseAudioContext);
setGlobalIfMissing('OfflineAudioContext', CompatOfflineAudioContext);
setGlobalIfMissing('AudioNode', AudioNode);
setGlobalIfMissing('AudioParam', AudioParam);
setGlobalIfMissing('AudioScheduledSourceNode', AudioScheduledSourceNode);
setGlobalIfMissing('AudioBuffer', AudioBuffer);
setGlobalIfMissing('PeriodicWave', PeriodicWave);
setGlobalIfMissing('AudioBufferSourceNode', AudioBufferSourceNode);
setGlobalIfMissing('AnalyserNode', AnalyserNode);
setGlobalIfMissing('ConstantSourceNode', ConstantSourceNode);
setGlobalIfMissing('ConvolverNode', CompatConvolverNode);
setGlobalIfMissing('IIRFilterNode', IIRFilterNode);
setGlobalIfMissing('OscillatorNode', OscillatorNode);
setGlobalIfMissing('PannerNode', PannerNode);
setGlobalIfMissing('AudioListener', AudioListener);
setGlobalIfMissing('GainNode', explicitStereo(GainNode));
setGlobalIfMissing('StereoPannerNode', explicitStereo(StereoPannerNode));
setGlobalIfMissing('WaveShaperNode', explicitStereo(WaveShaperNode));
setGlobalIfMissing('BiquadFilterNode', explicitStereo(BiquadFilterNode));
setGlobalIfMissing('DelayNode', explicitStereo(DelayNode));
setGlobalIfMissing('ChannelMergerNode', ChannelMergerNode);
setGlobalIfMissing('ChannelSplitterNode', ChannelSplitterNode);
setGlobalIfMissing('DynamicsCompressorNode', DynamicsCompressorNode);

BaseAudioContext.prototype.createConvolver = function (this: BaseAudioContext) {
  return new CompatConvolverNode(this);
};

// Factory methods react-native-audio-api lacks, on every context (offline ones too).
function defineIfMissing(target: object, name: string, value: unknown): void {
  if (!(name in target)) Object.defineProperty(target, name, { value, writable: true, configurable: true });
}
defineIfMissing(BaseAudioContext.prototype, 'createDynamicsCompressor', function (this: BaseAudioContext) {
  return new DynamicsCompressorNode(this);
});

// PannerNode.setPosition() / setOrientation(): deprecated in the spec, still in every browser, missing from
// react-native-audio-api (its AudioListener has them).
defineIfMissing(PannerNode.prototype, 'setPosition', function (this: PannerNode, x: number, y: number, z: number) {
  this.positionX.value = x;
  this.positionY.value = y;
  this.positionZ.value = z;
});
defineIfMissing(PannerNode.prototype, 'setOrientation', function (this: PannerNode, x: number, y: number, z: number) {
  this.orientationX.value = x;
  this.orientationY.value = y;
  this.orientationZ.value = z;
});

// `onstatechange`, fired when resume() / suspend() / close() change the state (react-native-audio-api has no state
// events, so a state change the native side makes on its own, e.g. an audio interruption, isn't reported).
type StateHandler = ((event: { type: string; target: unknown }) => void) | null;
defineIfMissing(BaseAudioContext.prototype, 'onstatechange', null);
const wrapped = Symbol.for('rn-web-audio-compat.statechange');
const acProto = AudioContext.prototype as unknown as Record<PropertyKey, unknown>;
if (!acProto[wrapped]) {
  acProto[wrapped] = true;
  for (const method of ['resume', 'suspend', 'close'] as const) {
    const original = acProto[method] as (this: AudioContext, ...args: unknown[]) => Promise<unknown>;
    acProto[method] = async function (this: AudioContext & { onstatechange: StateHandler }, ...args: unknown[]) {
      const before = this.state;
      const result = await original.apply(this, args);
      if (this.state !== before) this.onstatechange?.call(this, { type: 'statechange', target: this });
      return result;
    };
  }
}

// Keep the default prototype-chain behaviour for native AudioParams, and also accept this library's params of JS worklet
// nodes (LiveAudioParam) and C++ kernel nodes (KernelParam). Libraries check params this way (Tone.js, through
// standardized-audio-context, asserts it for every param it wraps).
Object.defineProperty(AudioParam, Symbol.hasInstance, {
  value: (instance: unknown): boolean =>
    instance instanceof LiveAudioParam ||
    instance instanceof KernelParam ||
    (typeof instance === 'object' && instance !== null && AudioParam.prototype.isPrototypeOf(instance)),
  configurable: true,
});

// Read-after-write for `AudioParam.value`, as in a browser: react-native-audio-api's getter reads the native param,
// which only changes once the audio thread has applied the write, so `p.value = 3; p.value` returned the old value
// (this was a react-native-audio-api patch hunk up to 0.13.6). The setter remembers the value it was given; any
// automation call forgets it, so the getter falls back to the native (automated) value.
const lastSet = new WeakMap<object, number>();
const paramProto = AudioParam.prototype as unknown as Record<string, unknown>;
const paramWrapped = Symbol.for('rn-web-audio-compat.paramReadAfterWrite');
if (!paramProto[paramWrapped as unknown as string]) {
  paramProto[paramWrapped as unknown as string] = true;
  const valueDescriptor = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
  if (valueDescriptor?.get && valueDescriptor.set) {
    const nativeGet = valueDescriptor.get;
    const nativeSet = valueDescriptor.set;
    Object.defineProperty(AudioParam.prototype, 'value', {
      configurable: true,
      get(this: object) {
        return lastSet.has(this) ? lastSet.get(this) : nativeGet.call(this);
      },
      set(this: object, v: number) {
        nativeSet.call(this, v); // also schedules setValueAtTime(v, now), which clears lastSet below
        lastSet.set(this, Number(v));
      },
    });
    for (const method of [
      'setValueAtTime',
      'linearRampToValueAtTime',
      'exponentialRampToValueAtTime',
      'setTargetAtTime',
      'setValueCurveAtTime',
      'cancelScheduledValues',
      'cancelAndHoldAtTime',
    ]) {
      const original = paramProto[method] as ((...args: unknown[]) => unknown) | undefined;
      if (typeof original !== 'function') continue;
      paramProto[method] = function (this: object, ...args: unknown[]) {
        lastSet.delete(this);
        return original.apply(this, args);
      };
    }
  }
}
