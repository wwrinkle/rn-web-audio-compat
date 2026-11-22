// Delay whose time can be modulated smoothly: the spec for the C++ 'modulated-delay' kernel (Kernels.cpp, checked by
// scripts/kernel-parity). Original. The delay time glides linearly across each block and the read is interpolated, so
// LFO-driven effects (Chorus, PitchShift) don't step. Used for Tone's Delay: react-native-audio-api's DelayNode ignores
// signals connected to delayTime.

import type { WorkletProcessorModule } from '../worklet/types';

interface DelayState {
  buffers: Float32Array[];
  write: number;
  previous: number; // delay in frames at the end of the last block; -1 before the first
  maxSeconds: number;
}

export const modulatedDelayProcessor: WorkletProcessorModule<DelayState> = {
  kind: 'effect',
  parameterDescriptors: [{ name: 'delayTime', defaultValue: 0 }],
  createState: (sampleRate, processorOptions) => {
    const maxSeconds = (processorOptions?.maxDelayTime as number | undefined) ?? 1;
    const size = Math.ceil(maxSeconds * sampleRate) + 2;
    return { buffers: [new Float32Array(size), new Float32Array(size)], write: 0, previous: -1, maxSeconds };
  },

  process: (state, input, output, params, framesToProcess, sampleRate) => {
    'worklet';

    const size = state.buffers[0].length;
    const target = Math.min(Math.max(params.delayTime, 0), state.maxSeconds) * sampleRate;
    const start = state.previous < 0 ? target : state.previous;
    const channels = Math.min(output.length, state.buffers.length);
    let write = state.write;
    for (let i = 0; i < framesToProcess; i++) {
      const delay = start + ((target - start) * (i + 1)) / framesToProcess;
      let position = write - delay;
      if (position < 0) position += size;
      const index = Math.floor(position);
      const fraction = position - index;
      const nextIndex = index + 1 >= size ? 0 : index + 1;
      for (let ch = 0; ch < channels; ch++) {
        const buffer = state.buffers[ch];
        buffer[write] = input[ch] ? input[ch][i] : 0;
        output[ch][i] = buffer[index] + (buffer[nextIndex] - buffer[index]) * fraction;
      }
      write = write + 1 >= size ? 0 : write + 1;
    }
    state.write = write;
    state.previous = target;
  },
};
