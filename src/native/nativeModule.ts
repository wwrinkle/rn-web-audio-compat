// rn-web-audio-compat's own native module (common/cpp/rnwac): C++ kernel nodes on react-native-audio-api's stable
// extension API. install() puts the __rnwac* JSI globals on this runtime; ensureNativeModule() does that once, on first
// use, so importing the library has no native side effects (and works under Jest and on web).
//
// The JS worklet nodes come from react-native-audio-worklets (react-native-audio-api 1.0 moved them out of the core
// package). Its module throws on import when its native side is missing, so it is required lazily too.

import type { AudioScheduledSourceNode, AudioNode, BaseAudioContext } from 'react-native-audio-api';
import NativeWebAudioCompatModule from '../specs/NativeWebAudioCompatModule';

export interface KernelHostObject {
  setKernelParam: (index: number, value: number) => void;
  readonly kernelId: number;
}

export interface NativeKernelTiming {
  id: number;
  name: string;
  count: number;
  avgUs: number;
  maxUs: number;
}

interface RnwacGlobals {
  __rnwacCreateKernelEffectNode?: (context: unknown, kernelId: number, params: number[], tailSeconds: number) => KernelHostObject;
  __rnwacCreateKernelControlNode?: (context: unknown, kernelNode: unknown, paramIndex: number) => unknown;
  __rnwacCreateFeedbackBridge?: (context: unknown) => { send: unknown; ret: unknown };
  __rnwacCreateKernelSourceNode?: (context: unknown, kernelId: number, params: number[]) => KernelHostObject;
  __rnwacKernelTimings?: () => NativeKernelTiming[];
  __rnwacResetKernelTimings?: () => void;
}

const g = globalThis as unknown as RnwacGlobals;

export function isNativeModuleInstalled(): boolean {
  return typeof g.__rnwacCreateKernelEffectNode === 'function';
}

// Installs the JSI globals if they aren't there yet. Returns false when the native module isn't in this build (web,
// Jest, or an app that wasn't rebuilt after adding the library).
export function ensureNativeModule(): boolean {
  if (isNativeModuleInstalled()) return true;
  if (!NativeWebAudioCompatModule) return false;
  NativeWebAudioCompatModule.install();
  return isNativeModuleInstalled();
}

function requireNativeModule(): Required<RnwacGlobals> {
  if (!ensureNativeModule()) {
    throw new Error(
      'rn-web-audio-compat: its native module is not in this build. It needs the React Native New Architecture; ' +
        'rebuild the native app after installing the library.'
    );
  }
  return g as Required<RnwacGlobals>;
}

// react-native-audio-api's JS node wrappers take the native host object as their second constructor argument.
type NodeClass<T> = new (context: BaseAudioContext, node: unknown) => T;

function audioApi(): { AudioNode: NodeClass<AudioNode>; AudioScheduledSourceNode: NodeClass<AudioScheduledSourceNode> } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-audio-api');
}

const nativeContext = (context: BaseAudioContext): unknown => (context as unknown as { context: unknown }).context;

export function createKernelEffectNode(
  context: BaseAudioContext,
  kernelId: number,
  params: number[],
  tailSeconds: number
): AudioNode & KernelHostObject {
  const host = requireNativeModule().__rnwacCreateKernelEffectNode(nativeContext(context), kernelId, params, tailSeconds);
  const node = new (audioApi().AudioNode)(context, host);
  return Object.assign(node, { setKernelParam: host.setKernelParam.bind(host), kernelId });
}

// A node that drives param `paramIndex` of a kernel effect node from its audio input (KernelNodes.h).
export function createKernelControlNode(context: BaseAudioContext, kernelNode: AudioNode, paramIndex: number): AudioNode {
  const kernelHost = (kernelNode as unknown as { node: unknown }).node;
  const host = requireNativeModule().__rnwacCreateKernelControlNode(nativeContext(context), kernelHost, paramIndex);
  return new (audioApi().AudioNode)(context, host);
}

// A feedback path with a one-quantum delay that the graph can't reject as a cycle (KernelNodes.h). `send` is rendered
// through the destination, silently; `ret` is a started source.
export function createFeedbackBridge(context: BaseAudioContext): { send: AudioNode; ret: AudioScheduledSourceNode; dispose: () => void } {
  const hosts = requireNativeModule().__rnwacCreateFeedbackBridge(nativeContext(context));
  const api = audioApi();
  const send = new api.AudioNode(context, hosts.send);
  const ret = new api.AudioScheduledSourceNode(context, hosts.ret);
  send.connect(context.destination);
  ret.start();
  return {
    send,
    ret,
    dispose: () => {
      ret.stop();
      ret.disconnect();
      send.disconnect();
    },
  };
}

export function createKernelSourceNode(
  context: BaseAudioContext,
  kernelId: number,
  params: number[]
): AudioScheduledSourceNode & KernelHostObject {
  const host = requireNativeModule().__rnwacCreateKernelSourceNode(nativeContext(context), kernelId, params);
  const node = new (audioApi().AudioScheduledSourceNode)(context, host);
  return Object.assign(node, { setKernelParam: host.setKernelParam.bind(host), kernelId });
}

export function nativeKernelTimings(): NativeKernelTiming[] {
  return ensureNativeModule() ? (g.__rnwacKernelTimings?.() ?? []) : [];
}

export function resetNativeKernelTimings(): void {
  if (ensureNativeModule()) g.__rnwacResetKernelTimings?.();
}

// react-native-audio-worklets' node classes (callbacks run as worklets on its shared audio runtime).
export type WorkletProcessingCallback = (
  inputData: Float32Array[],
  outputData: Float32Array[],
  inputChannelCount: number,
  outputChannelCount: number,
  framesToProcess: number,
  currentTime: number
) => void;

export type WorkletSourceCallback = (
  audioData: Float32Array[],
  outputChannelCount: number,
  framesToProcess: number,
  currentTime: number,
  startOffset: number
) => void;

interface AudioWorkletsModule {
  WorkletProcessingNode: new (context: BaseAudioContext, callback: WorkletProcessingCallback) => AudioNode;
  WorkletSourceNode: new (context: BaseAudioContext, callback: WorkletSourceCallback) => AudioScheduledSourceNode;
}

function audioWorklets(): AudioWorkletsModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-audio-worklets');
  } catch (err) {
    throw new Error(
      `rn-web-audio-compat: JS worklet processors need react-native-audio-worklets (a peer dependency): ${(err as Error).message}`
    );
  }
}

export function createWorkletProcessingNode(context: BaseAudioContext, callback: WorkletProcessingCallback): AudioNode {
  return new (audioWorklets().WorkletProcessingNode)(context, callback);
}

export function createWorkletSourceNode(context: BaseAudioContext, callback: WorkletSourceCallback): AudioScheduledSourceNode {
  return new (audioWorklets().WorkletSourceNode)(context, callback);
}
