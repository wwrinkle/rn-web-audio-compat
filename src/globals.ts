// Side-effect module: makes the Web Audio API look like a browser's to code that assumes browser globals.
//
// Import it FIRST (before any Web Audio library that touches these names at module-evaluation time): ES module imports
// fully evaluate, including everything they import, before the importing module's own statements run, so a global set
// later in the same file is already too late. Idempotent; it never overwrites an existing global.
//
// What it does, and why (each item was found on a real device; see docs/FINDINGS.md):
//  - Exposes react-native-audio-api's classes as globals (AudioContext, BaseAudioContext, OfflineAudioContext, AudioNode,
//    AudioParam, AudioScheduledSourceNode, ConstantSourceNode). Browser code constructs nodes and does `instanceof`
//    checks and `X.prototype.y = ...` patches on bare global names, which throw ReferenceError when they're missing.
//  - GainNode / StereoPannerNode / WaveShaperNode globals are explicit-stereo subclasses: react-native-audio-api nodes
//    otherwise process IN PLACE on their input's buffer, and a node's "already processed this quantum" cache hands a
//    second consumer its own never-written buffer, so fan-out silences or corrupts the signal. installWebAudioCompat
//    does the same for the context's create*() methods.
//  - Adds the missing node types: ChannelMergerNode / ChannelSplitterNode (stereo pass-through only) and
//    DynamicsCompressorNode.
//  - OfflineAudioContext fires `oncomplete` (react-native-audio-api only resolves the startRendering() promise).
//  - `node.onended = fn` works (react-native-audio-api only has camelCase `onEnded`; without the alias, cleanup code
//    registered the browser way never runs and every node leaks).
//  - `x instanceof AudioParam` is also true for this library's LiveAudioParam (automatable params of JS worklet and
//    kernel nodes), so code that walks a node's params finds them.

import {
  OfflineAudioContext,
  BaseAudioContext,
  AudioContext,
  AudioNode,
  AudioParam,
  AudioScheduledSourceNode,
  GainNode,
  ConstantSourceNode,
  StereoPannerNode,
  WaveShaperNode,
} from 'react-native-audio-api';
import { ChannelMergerNode, ChannelSplitterNode } from './nodes/channelRoutingNodes';
import { DynamicsCompressorNode } from './nodes/DynamicsCompressorNode';
import { LiveAudioParam } from './worklet/liveAudioParam';

function setGlobalIfMissing(name: string, value: unknown): void {
  if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
    (globalThis as Record<string, unknown>)[name] = value;
  }
}

class CompatOfflineAudioContext extends OfflineAudioContext {
  oncomplete: ((event: { renderedBuffer: unknown }) => void) | null = null;

  async startRendering() {
    const renderedBuffer = await super.startRendering();
    this.oncomplete?.({ renderedBuffer });
    return renderedBuffer;
  }
}

const explicitStereo = { channelCount: 2, channelCountMode: 'explicit' } as const;

class ExplicitStereoGainNode extends GainNode {
  constructor(context: ConstructorParameters<typeof GainNode>[0], options?: ConstructorParameters<typeof GainNode>[1]) {
    super(context, { ...explicitStereo, ...options });
  }
}

class ExplicitStereoPannerNode extends StereoPannerNode {
  constructor(
    context: ConstructorParameters<typeof StereoPannerNode>[0],
    options?: ConstructorParameters<typeof StereoPannerNode>[1]
  ) {
    super(context, { ...explicitStereo, ...options });
  }
}

class ExplicitWaveShaperNode extends WaveShaperNode {
  constructor(
    context: ConstructorParameters<typeof WaveShaperNode>[0],
    options?: ConstructorParameters<typeof WaveShaperNode>[1]
  ) {
    super(context, { ...explicitStereo, ...options });
  }
}

setGlobalIfMissing('AudioContext', AudioContext);
setGlobalIfMissing('BaseAudioContext', BaseAudioContext);
setGlobalIfMissing('OfflineAudioContext', CompatOfflineAudioContext);
setGlobalIfMissing('AudioNode', AudioNode);
setGlobalIfMissing('AudioParam', AudioParam);
setGlobalIfMissing('AudioScheduledSourceNode', AudioScheduledSourceNode);
setGlobalIfMissing('ConstantSourceNode', ConstantSourceNode);
setGlobalIfMissing('GainNode', ExplicitStereoGainNode);
setGlobalIfMissing('StereoPannerNode', ExplicitStereoPannerNode);
setGlobalIfMissing('WaveShaperNode', ExplicitWaveShaperNode);
setGlobalIfMissing('ChannelMergerNode', ChannelMergerNode);
setGlobalIfMissing('ChannelSplitterNode', ChannelSplitterNode);
setGlobalIfMissing('DynamicsCompressorNode', DynamicsCompressorNode);

// Keep the default prototype-chain behaviour for native AudioParams, and also accept LiveAudioParam.
Object.defineProperty(AudioParam, Symbol.hasInstance, {
  value: (instance: unknown): boolean =>
    instance instanceof LiveAudioParam ||
    (typeof instance === 'object' && instance !== null && AudioParam.prototype.isPrototypeOf(instance)),
  configurable: true,
});

// Browser-style `onended`, calling back with the node as `this` like the DOM does.
Object.defineProperty(AudioScheduledSourceNode.prototype, 'onended', {
  configurable: true,
  get(this: { __onended?: unknown }) {
    return this.__onended ?? null;
  },
  set(this: { __onended?: ((ev: unknown) => void) | null; onEnded: unknown }, fn: ((ev: unknown) => void) | null) {
    this.__onended = fn;
    this.onEnded = fn ? (ev: unknown) => fn.call(this, ev) : null;
  },
});
