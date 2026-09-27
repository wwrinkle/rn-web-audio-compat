// DynamicsCompressorNode-shaped wrapper over compressorProcessor.ts's
// real-time compressor, matching superdough's actual construction pattern
// (helpers.mjs's getCompressor): `new DynamicsCompressorNode(ac, {})` then
// `node.threshold.value = x` / `.ratio.value = x` / etc — real named
// AudioParam-shaped properties, not the generic `.parameters` Map
// webAudioShim.ts's AudioWorkletNode uses (DynamicsCompressorNode is a
// standard Web Audio node, not something constructed via getWorklet()).
//
// Always effect-style (has input), so — unlike webAudioShim.ts's
// AudioWorkletNode, which has to support both source and effect processors
// — this can just subclass WorkletProcessingNode directly, no constructor-
// returns-different-object trick needed.

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
