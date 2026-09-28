// DynamicsCompressorNode (react-native-audio-api has none): `new DynamicsCompressorNode(ctx, options)` with
// threshold / knee / ratio / attack / release as AudioParam-like properties. Runs the C++ 'compressor' kernel while
// native processors are enabled, otherwise compressorProcessor.ts as a JS worklet. Not implemented: `reduction`.

import { WorkletProcessingNode, type BaseAudioContext } from 'react-native-audio-api';
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
import { compressorProcessor } from '../processors/compressorProcessor';

export interface DynamicsCompressorOptions {
  threshold?: number;
  knee?: number;
  ratio?: number;
  attack?: number;
  release?: number;
}

export class DynamicsCompressorNode extends WorkletProcessingNode {
  readonly threshold: LiveAudioParam;
  readonly knee: LiveAudioParam;
  readonly ratio: LiveAudioParam;
  readonly attack: LiveAudioParam;
  readonly release: LiveAudioParam;

  constructor(context: BaseAudioContext, options?: DynamicsCompressorOptions) {
    const sharedParams: Record<string, Synchronizable<number>> = {};
    const scheduleParams: Record<string, Synchronizable<string>> = {};
    const paramNames: string[] = [];
    for (const descriptor of compressorProcessor.parameterDescriptors) {
      const initial = (options as Record<string, number> | undefined)?.[descriptor.name] ?? descriptor.defaultValue;
      sharedParams[descriptor.name] = createSynchronizable(initial);
      scheduleParams[descriptor.name] = createSynchronizable('[]');
      paramNames.push(descriptor.name);
    }

    const state = compressorProcessor.createState(context.sampleRate, undefined);
    const process = compressorProcessor.process;
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
      const { parameters } = attachKernel(this as unknown as Parameters<typeof attachKernel>[0], 'compressor', options as Record<string, number> | undefined);
      this.threshold = parameters.get('threshold') as unknown as LiveAudioParam;
      this.knee = parameters.get('knee') as unknown as LiveAudioParam;
      this.ratio = parameters.get('ratio') as unknown as LiveAudioParam;
      this.attack = parameters.get('attack') as unknown as LiveAudioParam;
      this.release = parameters.get('release') as unknown as LiveAudioParam;
    } else {
      this.threshold = new LiveAudioParam(sharedParams.threshold, scheduleParams.threshold, paramVersion);
      this.knee = new LiveAudioParam(sharedParams.knee, scheduleParams.knee, paramVersion);
      this.ratio = new LiveAudioParam(sharedParams.ratio, scheduleParams.ratio, paramVersion);
      this.attack = new LiveAudioParam(sharedParams.attack, scheduleParams.attack, paramVersion);
      this.release = new LiveAudioParam(sharedParams.release, scheduleParams.release, paramVersion);
    }
  }
}
