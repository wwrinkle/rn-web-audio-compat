// No upstream AudioWorkletProcessor to compare against — this is a
// from-scratch software delay line (see feedbackDelayProcessor.ts's header
// for why: superdough's own feedbackdelay.mjs relies on a native graph
// cycle react-native-audio-api silently refuses to wire up). Verified
// instead with an impulse response: feeding a single 1.0 sample and
// silence afterward should produce repeats at every multiple of the delay
// length, each attenuated by an extra factor of `feedback`, scaled by
// `wet` — exactly what a textbook feedback delay line produces.

import { feedbackDelayProcessor } from '../feedbackDelayProcessor';

const sampleRate = 44100;

function runImpulse(
  totalLength: number,
  params: { delayTime: number; feedback: number; wet: number }
): Float32Array {
  const blockSize = 128;
  const input = new Float32Array(totalLength);
  input[0] = 1;

  const state = feedbackDelayProcessor.createState(sampleRate, undefined);
  const output = new Float32Array(totalLength);

  for (let offset = 0; offset < totalLength; offset += blockSize) {
    const len = Math.min(blockSize, totalLength - offset);
    const inBlock = input.subarray(offset, offset + len);
    const outBlock = new Float32Array(len);
    feedbackDelayProcessor.process(state, [inBlock], [outBlock], params, len, sampleRate, 0);
    output.set(outBlock, offset);
  }

  return output;
}

describe('feedbackDelayProcessor', () => {
  test('impulse produces repeats at each multiple of the delay length, decaying by feedback each time', () => {
    const delayTime = 0.01; // 441 samples at 44100Hz
    const delaySamples = Math.floor(delayTime * sampleRate);
    const feedback = 0.5;
    const wet = 1;

    const output = runImpulse(delaySamples * 5, { delayTime, feedback, wet });

    for (let k = 1; k <= 4; k++) {
      expect(output[k * delaySamples]).toBeCloseTo(wet * feedback ** (k - 1), 5);
    }

    // Nothing in between taps.
    expect(output[Math.floor(delaySamples * 1.5)]).toBeCloseTo(0, 10);
  });

  test('wet scales the whole output uniformly', () => {
    const delayTime = 0.01;
    const delaySamples = Math.floor(delayTime * sampleRate);
    const full = runImpulse(delaySamples * 2, { delayTime, feedback: 0.5, wet: 1 });
    const half = runImpulse(delaySamples * 2, { delayTime, feedback: 0.5, wet: 0.3 });

    expect(half[delaySamples]).toBeCloseTo(full[delaySamples] * 0.3, 5);
  });

  test('zero feedback produces exactly one echo and then silence', () => {
    const delayTime = 0.01;
    const delaySamples = Math.floor(delayTime * sampleRate);
    const output = runImpulse(delaySamples * 4, { delayTime, feedback: 0, wet: 1 });

    expect(output[delaySamples]).toBeCloseTo(1, 5);
    expect(output[delaySamples * 2]).toBeCloseTo(0, 10);
    expect(output[delaySamples * 3]).toBeCloseTo(0, 10);
  });

  test('no graph connections involved — pure function of its own state, safe to call repeatedly', () => {
    const state = feedbackDelayProcessor.createState(sampleRate, undefined);
    const input = new Float32Array(128).fill(0.1);
    const output = new Float32Array(128);
    expect(() => {
      for (let i = 0; i < 50; i++) {
        feedbackDelayProcessor.process(state, [input], [output], { delayTime: 0.1, feedback: 0.7, wet: 0.5 }, 128, sampleRate, 0);
      }
    }).not.toThrow();
  });
});
