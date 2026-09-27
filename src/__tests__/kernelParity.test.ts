// Writes parity reference data for this library's C++ kernels; `npm run parity` compares them (scripts/kernel-parity).
import { writeParityRefs, type ParityCase } from '../../scripts/kernel-parity/writeRefs';
import { compressorProcessor } from '../processors/compressorProcessor';
import { feedbackDelayProcessor } from '../processors/feedbackDelayProcessor';
import { fdnReverbProcessor } from '../processors/fdnReverbProcessor';

// Kernel ids: rnwac::BuiltinKernelId (native/rnaa-0.13.5/files/.../dsp/rnwac/Kernels.h).
const cases: ParityCase[] = [
  { name: 'delay_a', kernelId: 1, module: feedbackDelayProcessor, values: { delayTime: 0.02, feedback: 0.6, wet: 1 }, extraParams: [2] },
  { name: 'compressor_a', kernelId: 2, module: compressorProcessor, values: { threshold: -30, knee: 10, ratio: 8 } },
  { name: 'compressor_b', kernelId: 2, module: compressorProcessor, values: { threshold: -12, knee: 0, ratio: 20, attack: 0.001, release: 0.05 } },
  { name: 'fdn_default', kernelId: 3, module: fdnReverbProcessor, blocks: 400 },
  { name: 'fdn_short_dark', kernelId: 3, module: fdnReverbProcessor, values: { decayTime: 0.4, lpFreqStart: 5000, lpFreqEnd: 400 }, blocks: 400 },
  { name: 'fdn_no_lowpass', kernelId: 3, module: fdnReverbProcessor, values: { decayTime: 4, lpFreqStart: 0 }, blocks: 400 },
];

test('write kernel parity references', () => {
  writeParityRefs(cases);
});
