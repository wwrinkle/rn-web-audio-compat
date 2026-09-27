// Basic correctness test for compressorProcessor.ts — no upstream
// AudioWorkletProcessor to compare against (DynamicsCompressorNode isn't a
// superdough worklet, see that file's header), so this instead verifies
// the real-time per-block port is mathematically identical to
// ../../dsp/compressor.ts's whole-buffer version it was re-expressed from
// (same envelope-follower recurrence, just called per-block instead of
// over the whole signal at once — should produce bit-identical output),
// plus sanity checks that threshold/ratio/knee behave as expected.

import { compressorProcessor } from '../compressorProcessor';
import { compressor as wholeBufferCompressor } from '../../__tests__/reference/compressor';

const sampleRate = 44100;

const makeSignal = (length: number, amplitude: number): Float32Array => {
  const signal = new Float32Array(length);
  for (let n = 0; n < length; n++) {
    signal[n] = Math.sin((n / length) * Math.PI * 8) * amplitude;
  }
  return signal;
};

describe('compressorProcessor matches dsp/compressor.ts (same math, per-block vs whole-buffer)', () => {
  test('identical output when fed the same signal across several blocks', () => {
    const blockSize = 128;
    const blockCount = 8;
    const fullLength = blockSize * blockCount;
    const fullSignal = makeSignal(fullLength, 0.9);

    const params = { threshold: -18, knee: 12, ratio: 6, attack: 0.005, release: 0.08 };

    const wholeBufferOutput = wholeBufferCompressor([fullSignal], params, sampleRate)[0];

    const state = compressorProcessor.createState(sampleRate, undefined);
    const perBlockOutput = new Float32Array(fullLength);
    for (let b = 0; b < blockCount; b++) {
      const inBlock = fullSignal.subarray(b * blockSize, (b + 1) * blockSize);
      const outBlock = new Float32Array(blockSize);
      compressorProcessor.process(state, [inBlock], [outBlock], params, blockSize, sampleRate, 0);
      perBlockOutput.set(outBlock, b * blockSize);
    }

    // Math.log10/exp/pow are transcendental — the spec permits (and engines
    // exhibit) tiny ULP-level variance between syntactically different call
    // sites for the identical formula (module-level function here vs. the
    // nested-in-process copy), so this isn't bit-exact like crush's pure
    // round/multiply was. Same tolerance class as the AudioParam float32
    // gap elsewhere (see ladderProcessor.test.ts).
    for (let n = 0; n < fullLength; n++) {
      expect(perBlockOutput[n]).toBeCloseTo(wholeBufferOutput[n], 6);
    }
  });

  test('leaves a quiet signal (below threshold) essentially untouched', () => {
    const blockSize = 128;
    const input = makeSignal(blockSize, 0.05); // well below -18dB-ish threshold
    const params = { threshold: -6, knee: 6, ratio: 8, attack: 0.005, release: 0.08 };

    const state = compressorProcessor.createState(sampleRate, undefined);
    const output = new Float32Array(blockSize);
    compressorProcessor.process(state, [input], [output], params, blockSize, sampleRate, 0);

    for (let n = 0; n < blockSize; n++) {
      expect(output[n]).toBeCloseTo(input[n], 2);
    }
  });

  test('reduces gain on a loud signal (above threshold)', () => {
    const blockSize = 128;
    const blockCount = 20; // let the envelope follower settle
    const params = { threshold: -12, knee: 3, ratio: 10, attack: 0.001, release: 0.05 };

    const state = compressorProcessor.createState(sampleRate, undefined);
    let lastOutput: Float32Array = new Float32Array(blockSize);
    let lastInput: Float32Array = new Float32Array(blockSize);
    for (let b = 0; b < blockCount; b++) {
      const input = makeSignal(blockSize, 0.9);
      const output = new Float32Array(blockSize);
      compressorProcessor.process(state, [input], [output], params, blockSize, sampleRate, 0);
      lastInput = input;
      lastOutput = output;
    }

    const inputPeak = Math.max(...Array.from(lastInput, Math.abs));
    const outputPeak = Math.max(...Array.from(lastOutput, Math.abs));
    expect(outputPeak).toBeLessThan(inputPeak);
  });
});
