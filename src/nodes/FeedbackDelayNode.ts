// FeedbackDelayNode: a delay with feedback in one node, `new FeedbackDelayNode(context, wet, time, feedback)`, with
// live `delayTime` / `feedback` / `wet` params. Its output is the wet signal only: connect the dry path separately.
// It exists because the usual graph-cycle feedback delay doesn't work on react-native-audio-api (docs/FINDINGS.md, "The
// native graph rejects cycles"). Runs the C++ 'feedback-delay' kernel while native processors are enabled, otherwise
// feedbackDelayProcessor.ts as a JS worklet.
//
// It keeps a silent source connected so the echo tail keeps ringing after its input stops (docs/FINDINGS.md, "No
// tail-time"); disconnect() stops it.

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

    // No tail-time on this engine: once every upstream source is gone, this node stops being processed and the echo
    // tail cuts off (e.g. when the sends feeding it are disconnected note by note). A silent source keeps it running.
    const keepAlive = context.createConstantSource();
    // Held on the instance so it can't be garbage collected.
    (this as unknown as { keepAlive: unknown }).keepAlive = keepAlive;
    keepAlive.offset.value = 0;
    keepAlive.connect(this);
    keepAlive.start();
  }

  // Stop the keep-alive too, so a discarded delay line stops processing.
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
