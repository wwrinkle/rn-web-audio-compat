// Writes parity reference data for this library's C++ kernels; `npm run parity` compares them (scripts/kernel-parity).
import { writeParityRefs, type ParityCase } from '../../scripts/kernel-parity/writeRefs';
import { compressorProcessor } from '../processors/compressorProcessor';
import { feedbackDelayProcessor } from '../processors/feedbackDelayProcessor';
import { fdnReverbProcessor } from '../processors/fdnReverbProcessor';
import { bitCrusherProcessor } from '../processors/bitCrusherProcessor';
import { feedbackCombFilterProcessor } from '../processors/feedbackCombFilterProcessor';
import { modulatedDelayProcessor } from '../processors/modulatedDelayProcessor';

// Kernel ids: rnwac::BuiltinKernelId (common/cpp/rnwac/Kernels.h).
const cases: ParityCase[] = [
  { name: 'delay_a', kernelId: 1, module: feedbackDelayProcessor, values: { delayTime: 0.02, feedback: 0.6, wet: 1 }, extraParams: [2] },
  { name: 'compressor_a', kernelId: 2, module: compressorProcessor, values: { threshold: -30, knee: 10, ratio: 8 } },
  { name: 'compressor_b', kernelId: 2, module: compressorProcessor, values: { threshold: -12, knee: 0, ratio: 20, attack: 0.001, release: 0.05 } },
  { name: 'fdn_default', kernelId: 3, module: fdnReverbProcessor, blocks: 400 },
  { name: 'fdn_short_dark', kernelId: 3, module: fdnReverbProcessor, values: { decayTime: 0.4, lpFreqStart: 5000, lpFreqEnd: 400 }, blocks: 400 },
  { name: 'fdn_no_lowpass', kernelId: 3, module: fdnReverbProcessor, values: { decayTime: 4, lpFreqStart: 0 }, blocks: 400 },
  { name: 'crusher_4', kernelId: 4, module: bitCrusherProcessor, values: { bits: 4 } },
  { name: 'crusher_fractional', kernelId: 4, module: bitCrusherProcessor, values: { bits: 2.5 } },
  { name: 'comb_short', kernelId: 5, module: feedbackCombFilterProcessor, values: { delayTime: 0.00068, feedback: 0.8 }, blocks: 200 },
  { name: 'comb_long', kernelId: 5, module: feedbackCombFilterProcessor, values: { delayTime: 0.0297, feedback: 0.84 }, blocks: 500 },
  { name: 'comb_zero_delay', kernelId: 5, module: feedbackCombFilterProcessor, values: { delayTime: 0, feedback: 0.5 } },
  { name: 'mod_delay_zero', kernelId: 6, module: modulatedDelayProcessor, values: { delayTime: 0 }, options: { maxDelayTime: 1 }, extraParams: [1] },
  { name: 'mod_delay_fraction', kernelId: 6, module: modulatedDelayProcessor, values: { delayTime: 0.0123456 }, options: { maxDelayTime: 0.5 }, extraParams: [0.5], blocks: 300 },
  { name: 'mod_delay_max', kernelId: 6, module: modulatedDelayProcessor, values: { delayTime: 0.05 }, options: { maxDelayTime: 0.05 }, extraParams: [0.05], blocks: 120 },
];

test('write kernel parity references', () => {
  writeParityRefs(cases);
});
