// FeedbackDelayNode — real-time worklet version, NOT the graph-cycle trick
// superdough's own feedbackdelay.mjs uses. See feedbackDelayProcessor.ts's
// header for the full finding: react-native-audio-api's native graph
// unconditionally rejects cycles (no special case for a delay-broken one,
// unlike real Web Audio), and silently drops the `.connect()` call that
// would create one rather than throwing — so the original subclass-over-
// DelayNode port here compiled and ran, but never actually produced repeat
// echoes on-device. This file now wraps feedbackDelayProcessor.ts's
// software delay line instead (own circular buffer, feedback mixed
// in-process, no graph cycle at all) — same pattern as DynamicsCompressorNode.ts.
//
// Public shape kept close to the original for existing call sites:
// `new FeedbackDelayNode(context, wet, time, feedback)`, then plain
// `.connect()`/`.disconnect()` (inherited from WorkletProcessingNode, no
// override needed anymore — the node's own output *is* the wet signal,
// same as before, so callers still connect the dry path separately and
// this node's output alongside it). `.delayTime`/`.feedback`/`.wet` are
// live AudioParam-shaped properties if you need to modulate them.
//
// CONFIRMED WORKING ON-DEVICE (2026-09-24), full repeating decay, matching
// the real Web Audio reference in web-demo. Getting here needed two fixes
// beyond the graph-cycle rewrite itself — both are load-bearing, not
// incidental, if this pattern gets reused elsewhere:
//   1. feedbackDelayProcessor.ts's circular buffers are pre-allocated in
//      createState() (JS thread), not lazily inside process() — see that
//      file's header for why.
//   2. The caller must keep some upstream source actively scheduled (not
//      `.stop()`'d) for as long as this node's tail needs to ring out —
//      react-native-audio-api stops invoking a WorkletProcessingNode's
//      callback shortly after its upstream source stops, with no
//      tail-time/keep-alive mechanism at all. See CLAUDE.md's "No
//      tail-time" section — this applies to any effect with decay/release
//      behavior, not just this one, and is easy to rediscover the hard
//      way if forgotten.

import { WorkletProcessingNode, BaseAudioContext } from 'react-native-audio-api';
import { createSynchronizable, type Synchronizable } from 'react-native-worklets';
import type { ParamValues } from '../worklet/types';
import { attachKernel, areNativeKernelsEnabled, noopWorklet } from '../kernels/nativeKernels';
import {
  LiveAudioParam,
  ParamVersion,
  readCachedParams as readCachedParamsImport,
  computeAutomatedValue as computeAutomatedValueImport,
  type ParamCache,
} from '../worklet/liveAudioParam';
import { feedbackDelayProcessor } from '../processors/feedbackDelayProcessor';

export class FeedbackDelayNode extends WorkletProcessingNode {
  readonly delayTime: LiveAudioParam;
  readonly feedback: LiveAudioParam;
  readonly wet: LiveAudioParam;

  constructor(context: BaseAudioContext, wet: number, time: number, feedback: number) {
    const initial: ParamValues = {
      delayTime: time,
      feedback: Math.min(Math.abs(feedback), 0.995),
      wet: Math.abs(wet),
    };

    const sharedParams: Record<string, Synchronizable<number>> = {};
    const scheduleParams: Record<string, Synchronizable<string>> = {};
    const paramNames: string[] = [];
    for (const descriptor of feedbackDelayProcessor.parameterDescriptors) {
      sharedParams[descriptor.name] = createSynchronizable(initial[descriptor.name] ?? descriptor.defaultValue);
      scheduleParams[descriptor.name] = createSynchronizable('[]');
      paramNames.push(descriptor.name);
    }

    const state = feedbackDelayProcessor.createState(context.sampleRate, undefined);
    const process = feedbackDelayProcessor.process;
    const sampleRate = context.sampleRate;
    const computeAutomatedValue = computeAutomatedValueImport;
    const readCachedParams = readCachedParamsImport;
    const versionSync = createSynchronizable(0);
    const paramVersion = new ParamVersion(versionSync);
    const paramCache: ParamCache = { v: -1, base: {}, sched: {} };

    const useKernel = areNativeKernelsEnabled();
    const workletCallback = (inputData: Float32Array[], outputData: Float32Array[], framesToProcess: number, currentTime: number): void => {
      'worklet';

      try {
        const params: ParamValues = readCachedParams(
          versionSync,
          paramCache,
          paramNames,
          sharedParams,
          scheduleParams,
          currentTime,
          computeAutomatedValue
        );
        process(state, inputData, outputData, params, framesToProcess, sampleRate, currentTime);
      } catch {
        for (let ch = 0; ch < outputData.length; ch++) {
          outputData[ch].fill(0);
        }
      }
    };

    super(context, 'AudioRuntime', useKernel ? noopWorklet : workletCallback);

    if (useKernel) {
      // C++ kernel mode: no JS runs on the audio thread (see nativeKernels.ts).
      const { parameters } = attachKernel(this as unknown as Parameters<typeof attachKernel>[0], 'feedback-delay', initial);
      this.delayTime = parameters.get('delayTime') as unknown as LiveAudioParam;
      this.feedback = parameters.get('feedback') as unknown as LiveAudioParam;
      this.wet = parameters.get('wet') as unknown as LiveAudioParam;
    } else {
      this.delayTime = new LiveAudioParam(sharedParams.delayTime, scheduleParams.delayTime, paramVersion);
      this.feedback = new LiveAudioParam(sharedParams.feedback, scheduleParams.feedback, paramVersion);
      this.wet = new LiveAudioParam(sharedParams.wet, scheduleParams.wet, paramVersion);
    }

    // No tail-time on this engine (see CLAUDE.md): once every upstream
    // source is gone, this node stops being processed and the echo tail
    // cuts off. superdough's orbit delay is fed by a per-hap send gain that
    // gets disconnected when the hap ends, so keep a permanent silent
    // source connected to keep the delay line running.
    const keepAlive = context.createConstantSource();
    // Held on the instance so it can't be garbage collected.
    (this as unknown as { keepAlive: unknown }).keepAlive = keepAlive;
    keepAlive.offset.value = 0;
    keepAlive.connect(this);
    keepAlive.start();
  }

  // superdough's orbit reset disconnects the delay; stop the keep-alive so a discarded delay line stops processing.
  disconnect(...args: unknown[]): void {
    const keepAlive = (this as unknown as { keepAlive?: { stop: () => void } }).keepAlive;
    try {
      keepAlive?.stop();
    } catch {
      // already stopped
    }
    (super.disconnect as (...a: unknown[]) => void)(...args);
  }
}
