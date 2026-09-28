// DynamicsCompressorNode's processor: an original soft-knee feedforward compressor (not a port). State is the envelope
// follower's level in dB, carried across blocks. The spec for the C++ 'compressor' kernel (Kernels.cpp, checked by
// scripts/kernel-parity) and the JS fallback. Used by DynamicsCompressorNode directly, not through AudioWorkletNode.

import type { WorkletProcessorModule } from '../worklet/types';

interface CompressorState {
  envelopeDb: number;
}

function computeGainReductionDb(levelDb: number, threshold: number, knee: number, ratio: number): number {
  if (knee <= 0) {
    return levelDb < threshold ? 0 : threshold - levelDb + (levelDb - threshold) / ratio;
  }

  const kneeStart = threshold - knee / 2;
  const kneeEnd = threshold + knee / 2;

  if (levelDb < kneeStart) {
    return 0;
  }
  if (levelDb <= kneeEnd) {
    const x = levelDb - kneeStart;
    return -((1 / ratio - 1) * x * x) / (2 * knee);
  }
  return threshold - levelDb + (levelDb - threshold) / ratio;
}

export const compressorProcessor: WorkletProcessorModule<CompressorState> = {
  kind: 'effect',
  parameterDescriptors: [
    { name: 'threshold', defaultValue: -24 },
    { name: 'knee', defaultValue: 30 },
    { name: 'ratio', defaultValue: 12 },
    { name: 'attack', defaultValue: 0.003 },
    { name: 'release', defaultValue: 0.25 },
  ],

  createState: () => ({ envelopeDb: -100 }),

  process: (state, input, output, params, framesToProcess, sampleRate) => {
    'worklet';

    const computeGainReductionDb = (levelDb: number, threshold: number, knee: number, ratio: number): number => {
      if (knee <= 0) {
        return levelDb < threshold ? 0 : threshold - levelDb + (levelDb - threshold) / ratio;
      }
      const kneeStart = threshold - knee / 2;
      const kneeEnd = threshold + knee / 2;
      if (levelDb < kneeStart) {
        return 0;
      }
      if (levelDb <= kneeEnd) {
        const x = levelDb - kneeStart;
        return -((1 / ratio - 1) * x * x) / (2 * knee);
      }
      return threshold - levelDb + (levelDb - threshold) / ratio;
    };

    const threshold = params.threshold;
    const knee = Math.max(0, params.knee);
    const ratio = Math.max(1, params.ratio);
    const attack = Math.max(1e-4, params.attack);
    const release = Math.max(1e-4, params.release);

    const attackCoeff = Math.exp(-1 / (sampleRate * attack));
    const releaseCoeff = Math.exp(-1 / (sampleRate * release));

    const channelCount = output.length;

    for (let n = 0; n < framesToProcess; n++) {
      let peak = 0;
      for (let ch = 0; ch < channelCount; ch++) {
        peak = Math.max(peak, Math.abs(input[ch][n]));
      }
      const inputDb = peak > 0 ? 20 * Math.log10(peak) : -100;

      const coeff = inputDb > state.envelopeDb ? attackCoeff : releaseCoeff;
      state.envelopeDb = coeff * state.envelopeDb + (1 - coeff) * inputDb;

      const gainReductionDb = computeGainReductionDb(state.envelopeDb, threshold, knee, ratio);
      const gain = Math.pow(10, gainReductionDb / 20);

      for (let ch = 0; ch < channelCount; ch++) {
        output[ch][n] = input[ch][n] * gain;
      }
    }
  },
};

// Exported for the basic-correctness test only (no upstream to compare
// against, so the test exercises this reference math directly alongside
// the per-block port above).
export { computeGainReductionDb };
