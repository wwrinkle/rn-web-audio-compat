// Shared by the library's dedicated effect nodes (FeedbackDelayNode, DynamicsCompressorNode): builds the native node
// either as this library's C++ kernel node (native processors enabled, the default) or as a react-native-audio-worklets
// WorkletProcessingNode running the JS processor, and returns its native handle for `super(context, handle)` plus live
// params by name.

import type { BaseAudioContext } from 'react-native-audio-api';
import { createSynchronizable, type Synchronizable } from 'react-native-worklets';
import type { ParamValues, WorkletProcessorModule } from '../worklet/types';
import { areNativeKernelsEnabled, createKernelNode, type KernelParam } from '../kernels/nativeKernels';
import { createWorkletProcessingNode } from '../native/nativeModule';
import {
  LiveAudioParam,
  ParamVersion,
  readCachedParams as readCachedParamsImport,
  computeAutomatedValue as computeAutomatedValueImport,
  type ParamCache,
} from '../worklet/liveAudioParam';

export interface DualModeNode {
  handle: unknown; // react-native-audio-api's native node object (a JS AudioNode wrapper's `.node`)
  params: Record<string, LiveAudioParam | KernelParam>;
  native: boolean;
}

const handleOf = (node: unknown): unknown => (node as { node: unknown }).node;

export function buildDualModeNode(
  context: BaseAudioContext,
  processor: WorkletProcessorModule<any>,
  kernelName: string,
  initial: ParamValues
): DualModeNode {
  if (areNativeKernelsEnabled()) {
    // C++ kernel mode: no JS runs on the audio thread (see nativeKernels.ts).
    const { node, parameters } = createKernelNode(context, kernelName, initial);
    return { handle: handleOf(node), params: Object.fromEntries(parameters), native: true };
  }

  const sharedParams: Record<string, Synchronizable<number>> = {};
  const scheduleParams: Record<string, Synchronizable<string>> = {};
  const paramNames: string[] = [];
  for (const descriptor of processor.parameterDescriptors) {
    sharedParams[descriptor.name] = createSynchronizable(initial[descriptor.name] ?? descriptor.defaultValue);
    scheduleParams[descriptor.name] = createSynchronizable('[]');
    paramNames.push(descriptor.name);
  }

  // Captured through local consts: a worklet callback can't reference other module-level bindings.
  const state = processor.createState(context.sampleRate, undefined);
  const process = processor.process;
  const sampleRate = context.sampleRate;
  const computeAutomatedValue = computeAutomatedValueImport;
  const readCachedParams = readCachedParamsImport;
  const versionSync = createSynchronizable(0);
  const paramVersion = new ParamVersion(versionSync);
  const paramCache: ParamCache = { v: -1, base: {}, sched: {} };

  const node = createWorkletProcessingNode(context, (inputData, outputData, _inCh, _outCh, framesToProcess, currentTime) => {
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
  });

  const params: Record<string, LiveAudioParam> = {};
  for (const name of paramNames) {
    params[name] = new LiveAudioParam(sharedParams[name], scheduleParams[name], paramVersion);
  }
  return { handle: handleOf(node), params, native: false };
}

// JS-worklet mode only: react-native-audio-worklets' nodes have no tail-time, so once every upstream source stops the
// node stops being processed and an echo/reverb tail is cut off. A silent source keeps it running; stop() it on
// disconnect. (The C++ kernel nodes declare their tail instead.)
export function startKeepAlive(context: BaseAudioContext, target: unknown): { stop: () => void } {
  const keepAlive = context.createConstantSource();
  keepAlive.offset.value = 0;
  keepAlive.connect(target as Parameters<typeof keepAlive.connect>[0]);
  keepAlive.start();
  return keepAlive;
}
