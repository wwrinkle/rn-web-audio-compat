// rn-web-audio-compat: the Web Audio API on React Native, on top of react-native-audio-api.
//
// Usage (the order matters):
//   import 'rn-web-audio-compat/globals';            // first: browser-style Web Audio globals
//   import { installWebAudioCompat } from 'rn-web-audio-compat';
//   const ctx = new AudioContext();
//   installWebAudioCompat(ctx);                        // AudioWorklet + fan-out-safe create*() on this context
//
// See README.md for what is covered (COVERAGE.md has the member-by-member table) and native/README.md for the
// react-native-audio-api patch this library applies.

export { installWebAudioCompat, AudioWorkletNode, registerWorkletProcessor, registerNativeProcessor, setNativeProcessorsEnabled, areNativeProcessorsEnabled, hasWorkletProcessor } from './worklet/AudioWorkletNode';
export type { AudioWorkletNodeOptions, NativeProcessorFactory } from './worklet/AudioWorkletNode';
export type { WorkletProcessorModule, ParamDescriptor, ParamValues, ProcessBlock, ProcessorKind } from './worklet/types';
export { LiveAudioParam } from './worklet/liveAudioParam';

export { registerKernel, getKernelEntry, kernelEntries, buildKernelParams, createNativeKernelNode, attachKernel } from './kernels/nativeKernels';
export type { KernelEntry, KernelParam } from './kernels/nativeKernels';

export { DynamicsCompressorNode } from './nodes/DynamicsCompressorNode';
export { FeedbackDelayNode } from './nodes/FeedbackDelayNode';
export { ChannelMergerNode, ChannelSplitterNode } from './nodes/channelRoutingNodes';
export { createFdnReverbNode } from './nodes/FdnReverbNode';
export type { FdnReverbNode, FdnReverbParams } from './nodes/FdnReverbNode';

export { compressorProcessor } from './processors/compressorProcessor';
export { feedbackDelayProcessor } from './processors/feedbackDelayProcessor';
export { fdnReverbProcessor } from './processors/fdnReverbProcessor';

export { createAudioClock } from './clock/audioClock';
export type { AudioClock, AudioClockOptions } from './clock/audioClock';
export { startBackgroundPlayback, stopBackgroundPlayback } from './playback/backgroundPlayback';
export type { PlaybackNotificationInfo } from './playback/backgroundPlayback';

export {
  isNativePatchInstalled,
  getNativeTimings,
  resetNativeTimings,
  registeredNativeKernels,
  assertNativeKernels,
  measureAudioLoad,
} from './diagnostics/nativeStatus';
export type { TimingEntry, AudioLoad } from './diagnostics/nativeStatus';
