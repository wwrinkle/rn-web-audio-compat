// DynamicsCompressorNode (react-native-audio-api has none): `new DynamicsCompressorNode(ctx, options)` with
// threshold / knee / ratio / attack / release as AudioParam-like properties. Runs the C++ 'compressor' kernel while
// native processors are enabled, otherwise compressorProcessor.ts as a JS worklet. Not implemented: `reduction`.

import { AudioNode, type BaseAudioContext } from 'react-native-audio-api';
import type { LiveAudioParam } from '../worklet/liveAudioParam';
import { compressorProcessor } from '../processors/compressorProcessor';
import { buildDualModeNode } from './dualModeNode';

export interface DynamicsCompressorOptions {
  threshold?: number;
  knee?: number;
  ratio?: number;
  attack?: number;
  release?: number;
}

export class DynamicsCompressorNode extends AudioNode {
  readonly threshold: LiveAudioParam;
  readonly knee: LiveAudioParam;
  readonly ratio: LiveAudioParam;
  readonly attack: LiveAudioParam;
  readonly release: LiveAudioParam;

  constructor(context: BaseAudioContext, options?: DynamicsCompressorOptions) {
    const initial: Record<string, number> = {};
    for (const [name, value] of Object.entries(options ?? {})) {
      if (typeof value === 'number') initial[name] = value;
    }
    const built = buildDualModeNode(context, compressorProcessor, 'compressor', initial);
    super(context, built.handle as ConstructorParameters<typeof AudioNode>[1]);
    // Kernel params implement the same value/automation surface callers use.
    this.threshold = built.params.threshold as LiveAudioParam;
    this.knee = built.params.knee as LiveAudioParam;
    this.ratio = built.params.ratio as LiveAudioParam;
    this.attack = built.params.attack as LiveAudioParam;
    this.release = built.params.release as LiveAudioParam;
  }
}
