// Standard feedforward dynamics-range compressor, matching the parameter set
// of the Web Audio DynamicsCompressorNode (threshold/knee/ratio/attack/
// release) that superdough's helpers.mjs (getCompressor) expects — this node
// type isn't a superdough worklet, it's a built-in the browser normally
// provides, but react-native-audio-api's stable release doesn't implement it
// (confirmed: not in its own Web Audio API coverage table). Not a port of
// existing code; a standard soft-knee feedforward design (envelope follower
// with separate attack/release time constants, quadratic knee).
//
// Detection is stereo-linked (the envelope is computed once from the loudest
// channel and the same gain reduction applied to every channel), matching
// how DynamicsCompressorNode behaves in practice.

import type { DspRenderer } from './types';

export const compressor: DspRenderer = (input, params, sampleRate) => {
  const threshold = params.threshold ?? -24;
  const knee = Math.max(0, params.knee ?? 30);
  const ratio = Math.max(1, params.ratio ?? 12);
  const attack = Math.max(1e-4, params.attack ?? 0.003);
  const release = Math.max(1e-4, params.release ?? 0.25);

  const attackCoeff = Math.exp(-1 / (sampleRate * attack));
  const releaseCoeff = Math.exp(-1 / (sampleRate * release));

  const length = input[0]?.length ?? 0;
  const gainReductionDb = new Float32Array(length);

  let envelopeDb = -100;
  for (let n = 0; n < length; n++) {
    let peak = 0;
    for (let ch = 0; ch < input.length; ch++) {
      peak = Math.max(peak, Math.abs(input[ch][n]));
    }
    const inputDb = peak > 0 ? 20 * Math.log10(peak) : -100;

    const coeff = inputDb > envelopeDb ? attackCoeff : releaseCoeff;
    envelopeDb = coeff * envelopeDb + (1 - coeff) * inputDb;

    gainReductionDb[n] = computeGainReductionDb(envelopeDb, threshold, knee, ratio);
  }

  return input.map((channel) => {
    const out = new Float32Array(channel.length);
    for (let n = 0; n < channel.length; n++) {
      out[n] = channel[n] * Math.pow(10, gainReductionDb[n] / 20);
    }
    return out;
  });
};

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
