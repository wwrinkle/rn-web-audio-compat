// Bit crusher: the spec for the C++ 'bit-crusher' kernel (Kernels.cpp, checked by scripts/kernel-parity). Port of the
// 'bit-crusher' AudioWorklet processor in Tone.js (MIT, https://github.com/Tonejs/Tone.js).

import type { WorkletProcessorModule } from '../worklet/types';

export const bitCrusherProcessor: WorkletProcessorModule<Record<string, never>> = {
  kind: 'effect',
  parameterDescriptors: [{ name: 'bits', defaultValue: 12 }],
  createState: () => ({}),

  process: (_state, input, output, params, framesToProcess) => {
    'worklet';

    const bits = Math.min(Math.max(params.bits, 1), 16);
    const step = Math.pow(0.5, bits - 1);
    for (let ch = 0; ch < output.length; ch++) {
      for (let i = 0; i < framesToProcess; i++) {
        const sample = input[ch] ? input[ch][i] : 0;
        output[ch][i] = step * Math.floor(sample / step + 0.5);
      }
    }
  },
};
