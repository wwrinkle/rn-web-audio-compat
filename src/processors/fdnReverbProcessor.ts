// Algorithmic reverb for .room() (optimizations.ts 'fdnReverb'): an alternative to superdough's convolution reverb
// whose cost doesn't grow with the reverb length. Original design (not a port): stereo input -> one-pole input lowpass ->
// 4 Schroeder allpass diffusers per channel -> 8-line feedback delay network (Hadamard mixing, per-line one-pole damping,
// per-line gain for the requested -60 dB decay time) -> two orthogonal output tap sums.
//
// Mapping from superdough's reverb parameters (reverb.mjs / reverbGen.mjs generate a noise IR that decays by 60 dB over
// `decayTime`, fades in over `fadeInTime`, and is lowpassed with a cutoff sweeping linearly from `lpFreqStart` to
// `lpFreqEnd` over `decayTime`; the browser's ConvolverNode then normalizes it):
//   decayTime   -> per-line feedback gain (RT60)
//   lpFreqStart -> input lowpass cutoff (0 = no filtering at all, like reverbGen)
//   lpFreqEnd   -> loop damping, chosen so that after decayTime of recirculation the accumulated lowpass is about lpFreqEnd
//   fadeInTime  -> not modelled (the network's own ~35 ms build-up plays a similar role)
//   level       -> output gain so that the impulse response energy matches the browser's normalized convolver (Web Audio
//                  spec normalization: RMS 0.00125 * 44100 / sampleRate over 1.5 * decayTime), estimated analytically
//                  from the loop's per-frequency gain.
//
// This TS version is the spec for the C++ kernel (SoundWalkKernels.cpp fdnReverb, checked sample-by-sample by
// scripts/kernel-parity) and must stay in sync with it. `process` must stay self-contained (worklet rules, see CLAUDE.md).

import type { WorkletProcessorModule } from '../worklet/types';

const LINE_LENGTHS_48K = [1601, 1867, 2053, 2251, 2399, 2617, 2797, 3011];
const ALLPASS_LENGTHS_48K = [142, 107, 379, 277, 151, 113, 389, 263]; // first 4: left, last 4: right

interface FdnState {
  lines: Float32Array[];
  lineIdx: number[];
  allpasses: Float32Array[];
  allpassIdx: number[];
  damp: number[];
  inLp: number[];
  lineGain: number[];
  config: number[]; // [decayTime, lpStart, lpEnd] the coefficients were computed for; NaN = not yet
  aIn: number;
  aDamp: number;
  outGain: number;
}

export const fdnReverbProcessor: WorkletProcessorModule<FdnState> = {
  kind: 'effect',
  parameterDescriptors: [
    { name: 'decayTime', defaultValue: 2 },
    { name: 'fadeInTime', defaultValue: 0.1 },
    { name: 'lpFreqStart', defaultValue: 15000 },
    { name: 'lpFreqEnd', defaultValue: 1000 },
  ],

  createState: (sampleRate) => {
    const scale = sampleRate / 48000;
    const lines = LINE_LENGTHS_48K.map((n) => new Float32Array(Math.max(1, Math.round(n * scale))));
    const allpasses = ALLPASS_LENGTHS_48K.map((n) => new Float32Array(Math.max(1, Math.round(n * scale))));
    return {
      lines,
      lineIdx: lines.map(() => 0),
      allpasses,
      allpassIdx: allpasses.map(() => 0),
      damp: lines.map(() => 0),
      inLp: [0, 0],
      lineGain: lines.map(() => 0),
      config: [NaN, NaN, NaN],
      aIn: 1,
      aDamp: 1,
      outGain: 0,
    };
  },

  process: (state, input, output, params, framesToProcess, sampleRate) => {
    'worklet';
    const s = state;
    const nLines = s.lines.length;
    const decayTime = Math.max(0.05, params.decayTime);
    const lpStart = params.lpFreqStart;
    const lpEnd = params.lpFreqEnd;

    if (decayTime !== s.config[0] || lpStart !== s.config[1] || lpEnd !== s.config[2]) {
      s.config[0] = decayTime;
      s.config[1] = lpStart;
      s.config[2] = lpEnd;
      const nyquistish = 0.45 * sampleRate;
      let meanLen = 0;
      for (let i = 0; i < nLines; i++) meanLen += s.lines[i].length;
      meanLen /= nLines;
      for (let i = 0; i < nLines; i++) {
        s.lineGain[i] = Math.pow(10, (-3 * s.lines[i].length) / (decayTime * sampleRate));
      }
      if (lpStart > 0) {
        s.aIn = 1 - Math.exp((-2 * Math.PI * Math.min(lpStart, nyquistish)) / sampleRate);
        const passes = Math.max(1, (decayTime * sampleRate) / meanLen);
        let fcLoop = lpEnd > 0 ? lpEnd / Math.sqrt(Math.pow(2, 1 / passes) - 1) : nyquistish;
        fcLoop = Math.min(Math.max(fcLoop, Math.max(lpEnd, 20)), nyquistish);
        s.aDamp = 1 - Math.exp((-2 * Math.PI * fcLoop) / sampleRate);
      } else {
        s.aIn = 1;
        s.aDamp = 1;
      }
      // Energy of the network's impulse response per unit input (see header), averaged over frequency.
      const onePolePower = (a: number, w: number): number => (a * a) / (1 - 2 * (1 - a) * Math.cos(w) + (1 - a) * (1 - a));
      const meanGain = Math.pow(10, (-3 * meanLen) / (decayTime * sampleRate));
      const bins = 64;
      let estimate = 0;
      for (let m = 0; m < bins; m++) {
        const w = (Math.PI * (m + 0.5)) / bins;
        const loop = meanGain * meanGain * onePolePower(s.aDamp, w);
        estimate += onePolePower(s.aIn, w) / (1 - loop);
      }
      estimate /= bins;
      const calibration = (0.00125 * 44100) / sampleRate;
      const target = calibration * calibration * Math.round(1.5 * decayTime * sampleRate);
      s.outGain = Math.sqrt(target / estimate);
    }

    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : null;
    const aIn = s.aIn;
    const aDamp = s.aDamp;
    const g = 0.6;
    const tap = s.outGain * 0.35355339059327373; // outGain / sqrt(8)
    const w = [0, 0, 0, 0, 0, 0, 0, 0];
    const d = [0, 0, 0, 0, 0, 0, 0, 0];

    for (let n = 0; n < framesToProcess; n++) {
      // Input lowpass + diffusion, per channel.
      s.inLp[0] += aIn * ((inL ? inL[n] : 0) - s.inLp[0]);
      s.inLp[1] += aIn * ((inR ? inR[n] : 0) - s.inLp[1]);
      let uL = s.inLp[0];
      let uR = s.inLp[1];
      for (let k = 0; k < 8; k++) {
        const buf = s.allpasses[k];
        const idx = s.allpassIdx[k];
        const delayed = buf[idx];
        const x = k < 4 ? uL : uR;
        const y = -g * x + delayed;
        const v = x + g * y;
        buf[idx] = v > -1e-15 && v < 1e-15 ? 0 : v;
        s.allpassIdx[k] = idx + 1 >= buf.length ? 0 : idx + 1;
        if (k < 4) uL = y;
        else uR = y;
      }

      // Network: read, damp, attenuate.
      for (let i = 0; i < 8; i++) {
        const di = s.lines[i][s.lineIdx[i]];
        d[i] = di;
        const z = s.damp[i] + aDamp * (di - s.damp[i]);
        s.damp[i] = z > -1e-15 && z < 1e-15 ? 0 : z;
        w[i] = s.lineGain[i] * s.damp[i];
      }
      // Normalized 8-point Hadamard (fast Walsh-Hadamard butterflies).
      for (let h = 1; h < 8; h *= 2) {
        for (let i = 0; i < 8; i += 2 * h) {
          for (let j = i; j < i + h; j++) {
            const a = w[j];
            const b = w[j + h];
            w[j] = a + b;
            w[j + h] = a - b;
          }
        }
      }
      for (let i = 0; i < 8; i++) {
        const buf = s.lines[i];
        const idx = s.lineIdx[i];
        const v = w[i] * 0.35355339059327373 + ((i & 1) === 0 ? uL : uR);
        buf[idx] = v > -1e-15 && v < 1e-15 ? 0 : v;
        s.lineIdx[i] = idx + 1 >= buf.length ? 0 : idx + 1;
      }

      // Orthogonal output taps: L = [+ + + + - - - -], R = [+ + - - + + - -].
      const l = d[0] + d[1] + d[2] + d[3] - d[4] - d[5] - d[6] - d[7];
      const r = d[0] + d[1] - d[2] - d[3] + d[4] + d[5] - d[6] - d[7];
      outL[n] = l * tap;
      if (outR) outR[n] = r * tap;
    }
  },
};
