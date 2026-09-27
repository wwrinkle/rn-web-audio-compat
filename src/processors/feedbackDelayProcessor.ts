// A from-scratch real-time feedback delay line — NOT a port of superdough's
// feedbackdelay.mjs. That file gets its repeats from a literal graph cycle
// (`this.connect(feedbackGain); feedbackGain.connect(this)`), which works in
// real Web Audio (a DelayNode in the loop guarantees at least one render
// quantum of latency, so cycles are spec-legal) but is unconditionally
// rejected by react-native-audio-api's native graph: confirmed by reading
// `node_modules/react-native-audio-api/common/cpp/audioapi/core/utils/graph/
// HostGraph.hpp`'s `addEdge()` — it does a flat DFS reachability check with
// no special case for a delay-broken cycle, and returns CYCLE_DETECTED for
// *any* cycle. Worse, `AudioNodeHostObject.cpp`'s `connect()` JSI binding
// discards that error entirely, so `.connect()` "succeeds" from JS with no
// exception — the edge is just silently never added. Net effect: the first
// delayed tap plays, but the repeat loop never wires up. See CLAUDE.md for
// the full finding.
//
// This processor sidesteps the problem by keeping its own circular buffer
// and mixing feedback in software, one block at a time — no graph cycle
// involved at all, same pattern as every other stateful processor here
// (crush/ladder/etc.). Registered as its own dedicated node
// (feedbackDelayNode.ts), matching compressorProcessor.ts's approach for
// the same reason: not something superdough constructs via getWorklet().
//
// Buffers are pre-allocated in createState() (JS thread, setup time), NOT
// lazily inside process() the way an earlier version of this file did.
// That earlier version device-tested as silent (only the dry signal
// audible, no wet tap at all) despite passing Jest parity tests — this is
// the only processor in this directory that ever called `new
// Float32Array(...)` from inside a 'worklet'-tagged function; every other
// processor only reads/writes typed arrays handed in from outside, or
// grows plain-object arrays via .push() (ladder). Root cause not fully
// confirmed (no console/crash-log signal from this call path either — see
// CLAUDE.md's "uncaught exception" section), but constructing a new typed
// array from inside the worklet runtime is the one thing this file did
// that nothing else here had ever exercised, so it's the leading
// suspect. Pre-allocating up front avoids the question entirely. If a
// future processor needs to allocate per-channel buffers and the channel
// count truly isn't knowable until process() sees real input, that's a
// case worth device-testing in isolation before trusting it.
//
// Channel count also isn't known until the first process() call, so
// maxChannels here is a fixed, generous guess (2 — nothing in this
// project uses more than stereo) rather than something discovered lazily.

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
