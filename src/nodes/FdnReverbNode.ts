// Algorithmic reverb node: rn-web-audio-compat's C++ feedback-delay-network kernel ('fdn-reverb', spec:
// processors/fdnReverbProcessor.ts). Cost per block is independent of the reverb length (unlike ConvolverNode), and its
// output level is calibrated to a browser's normalized ConvolverNode with a noise impulse response of the same decay.
// Measured on a Pixel 10: ~155-190 us per 128-frame block for any length; a 0.6 s convolution reverb used ~78% of the
// audio thread there.
//
// Wet signal only (like a ConvolverNode): mix it with the dry path yourself.
//
// No tail-time on react-native-audio-api: once every upstream source of a node stops, the node stops being processed and
// the reverb tail is cut off. The node therefore keeps a silent ConstantSourceNode connected; disconnect() stops it.

import type { BaseAudioContext } from 'react-native-audio-api';
import { createNativeKernelNode, type KernelParam } from '../kernels/nativeKernels';

export interface FdnReverbParams {
  decayTime?: number; // -60 dB time in seconds (default 2)
  fadeInTime?: number; // accepted for compatibility with noise-IR reverbs; not modelled
  lpFreqStart?: number; // input lowpass cutoff in Hz; 0 = no filtering (default 15000)
  lpFreqEnd?: number; // cutoff the tail has decayed to after decayTime, in Hz (default 1000)
}

export interface FdnReverbNode {
  parameters: Map<string, KernelParam>;
  connect: (...args: unknown[]) => unknown;
  disconnect: (...args: unknown[]) => void;
  setParams: (params: FdnReverbParams) => void;
}

export function createFdnReverbNode(context: BaseAudioContext, params: FdnReverbParams = {}): FdnReverbNode {
  const node = createNativeKernelNode(context, 'fdn-reverb') as FdnReverbNode & Record<string, unknown>;
  const set = (name: string, value: number | undefined): void => {
    const param = node.parameters.get(name);
    if (param && value !== undefined) param.value = value;
  };
  node.setParams = (p: FdnReverbParams) => {
    set('decayTime', p.decayTime);
    set('fadeInTime', p.fadeInTime);
    set('lpFreqStart', p.lpFreqStart);
    set('lpFreqEnd', p.lpFreqEnd);
  };
  node.setParams(params);

  const keepAlive = context.createConstantSource();
  keepAlive.offset.value = 0;
  keepAlive.connect(node as unknown as Parameters<typeof keepAlive.connect>[0]);
  keepAlive.start();
  node.keepAlive = keepAlive;
  const disconnect = node.disconnect.bind(node);
  node.disconnect = (...a: unknown[]) => {
    try {
      keepAlive.stop();
    } catch {
      // already stopped
    }
    disconnect(...a);
  };
  return node;
}
