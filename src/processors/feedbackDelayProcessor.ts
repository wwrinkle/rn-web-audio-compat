// Feedback delay line, original (not a port). Browser code usually builds a feedback delay as a graph cycle
// (delay -> gain -> delay), which react-native-audio-api silently refuses to connect (docs/FINDINGS.md, "The native
// graph rejects cycles"): one echo, no repeats. This keeps its own circular buffer and mixes the feedback in, so there
// is no cycle. The spec for the C++ 'feedback-delay' kernel (Kernels.cpp, checked by scripts/kernel-parity) and the JS
// fallback; used by FeedbackDelayNode.
//
// Buffers are allocated in createState() (JS thread), never inside process(): a version that allocated inside the
// worklet was silent on a device. Stereo at most.

import type { WorkletProcessorModule } from '../worklet/types';

interface FeedbackDelayState {
  buffers: Float32Array[];
  writeIndex: number;
  maxDelaySamples: number;
}

const MAX_CHANNELS = 2;

export const feedbackDelayProcessor: WorkletProcessorModule<FeedbackDelayState> = {
  kind: 'effect',
  parameterDescriptors: [
    { name: 'delayTime', defaultValue: 0.25 },
    { name: 'feedback', defaultValue: 0.5 },
    { name: 'wet', defaultValue: 0.5 },
  ],

  // maxDelayTime (seconds) is our own chosen cap, not an upstream value —
  // 2s comfortably covers typical delay-pedal-style use.
  createState: (sampleRate, processorOptions) => {
    const maxDelaySeconds = (processorOptions?.maxDelayTime as number | undefined) ?? 2;
    const maxDelaySamples = Math.max(2, Math.ceil(maxDelaySeconds * sampleRate));
    const buffers: Float32Array[] = [];
    for (let ch = 0; ch < MAX_CHANNELS; ch++) {
      buffers.push(new Float32Array(maxDelaySamples));
    }
    return {
      buffers,
      writeIndex: 0,
      maxDelaySamples,
    };
  },

  process: (state, input, output, params, framesToProcess, sampleRate) => {
    'worklet';

    const channelCount = Math.min(output.length, state.buffers.length);
    const maxDelaySamples = state.maxDelaySamples;

    let delaySamples = Math.floor(params.delayTime * sampleRate);
    if (delaySamples < 1) delaySamples = 1;
    if (delaySamples > maxDelaySamples - 1) delaySamples = maxDelaySamples - 1;

    const feedback = Math.min(Math.max(params.feedback, 0), 0.995);
    const wet = params.wet;

    let writeIndex = state.writeIndex;

    for (let i = 0; i < framesToProcess; i++) {
      let readIndex = writeIndex - delaySamples;
      if (readIndex < 0) readIndex += maxDelaySamples;

      for (let ch = 0; ch < channelCount; ch++) {
        const buf = state.buffers[ch];
        const delayed = buf[readIndex];
        const inSample = input[ch] ? input[ch][i] : 0;
        buf[writeIndex] = inSample + delayed * feedback;
        output[ch][i] = delayed * wet;
      }

      writeIndex += 1;
      if (writeIndex >= maxDelaySamples) writeIndex = 0;
    }

    state.writeIndex = writeIndex;

    // Beyond MAX_CHANNELS (shouldn't happen in practice — nothing here
    // exceeds stereo) there's no delay buffer to read from; leave silence
    // rather than reading past state.buffers.
    for (let ch = channelCount; ch < output.length; ch++) {
      output[ch].fill(0);
    }
  },
};
