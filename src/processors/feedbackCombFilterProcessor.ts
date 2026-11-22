// Feedback comb filter: the spec for the C++ 'feedback-comb-filter' kernel (Kernels.cpp, checked by
// scripts/kernel-parity). Port of the 'feedback-comb-filter' AudioWorklet processor in Tone.js (MIT,
// https://github.com/Tonejs/Tone.js), which JCReverb, Freeverb and PluckSynth are built on. Its feedback runs inside the
// processor, so delays can be shorter than a render quantum.

import type { WorkletProcessorModule } from '../worklet/types';

interface CombState {
  buffers: Float32Array[];
  write: number;
}

export const feedbackCombFilterProcessor: WorkletProcessorModule<CombState> = {
  kind: 'effect',
  parameterDescriptors: [
    { name: 'delayTime', defaultValue: 0.1 },
    { name: 'feedback', defaultValue: 0.5 },
  ],
  createState: (sampleRate) => {
    const size = Math.max(2, Math.ceil(sampleRate));
    return { buffers: [new Float32Array(size), new Float32Array(size)], write: 0 };
  },

  process: (state, input, output, params, framesToProcess, sampleRate) => {
    'worklet';

    const size = state.buffers[0].length;
    const delay = Math.min(Math.floor(Math.min(Math.max(params.delayTime, 0), 1) * sampleRate), size - 1);
    const feedback = Math.min(Math.max(params.feedback, 0), 0.9999);
    const channels = Math.min(output.length, state.buffers.length);
    let write = state.write;
    for (let i = 0; i < framesToProcess; i++) {
      let read = write - delay;
      if (read < 0) read += size;
      const next = write + 1 >= size ? 0 : write + 1;
      for (let ch = 0; ch < channels; ch++) {
        const buffer = state.buffers[ch];
        const delayed = buffer[read];
        buffer[next] = (input[ch] ? input[ch][i] : 0) + delayed * feedback;
        output[ch][i] = delayed;
      }
      write = next;
    }
    state.write = write;
  },
};
