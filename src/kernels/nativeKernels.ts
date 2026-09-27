// JS side of the native (C++) effect kernels. The react-native-audio-api patch this library applies
// (native/rnaa-0.13.5) lets a WorkletProcessingNode (effects) or WorkletSourceNode (sources) run a registered C++ kernel
// by id instead of a JS worklet, so nothing runs in Hermes on the audio thread. See native/README.md.
//
// A kernel is described to JS by a KernelEntry: its numeric id (must match the id the C++ side registers), whether it is
// an effect or a source, and the JS processor module it mirrors (the spec, whose parameterDescriptors define the param
// layout, and the fallback when native processors are disabled). Built-ins: 'compressor', 'feedback-delay',
// 'fdn-reverb' (ids 1-3). Other libraries register theirs (ids 100-255) with registerKernel().

import type { BaseAudioContext } from 'react-native-audio-api';
import { compressorProcessor } from '../processors/compressorProcessor';
import { fdnReverbProcessor } from '../processors/fdnReverbProcessor';
import { feedbackDelayProcessor } from '../processors/feedbackDelayProcessor';
import type { WorkletProcessorModule } from '../worklet/types';
import { areNativeProcessorsEnabled } from '../worklet/AudioWorkletNode';

export interface KernelEntry {
  id: number; // must match the id registered on the C++ side (rnwac::registerKernel)
  kind: 'effect' | 'source';
  module: WorkletProcessorModule<any>;
  // Params appended after the descriptor params (must match the layout documented for the C++ kernel).
  extraParams?: (options: Record<string, unknown> | undefined) => number[];
  // Adds anything else the node needs (e.g. a `port`), given a way to set extra params; merged into the node.
  configure?: (setExtraParam: (extraIndex: number, value: number) => void) => Record<string, unknown>;
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);

const KERNELS = new Map<string, KernelEntry>([
  ['compressor', { id: 2, kind: 'effect', module: compressorProcessor }],
  ['feedback-delay', { id: 1, kind: 'effect', module: feedbackDelayProcessor, extraParams: (o) => [num(o?.maxDelayTime, 2)] }],
  ['fdn-reverb', { id: 3, kind: 'effect', module: fdnReverbProcessor }],
]);

export function registerKernel(name: string, entry: KernelEntry): void {
  KERNELS.set(name, entry);
}

export function getKernelEntry(name: string): KernelEntry | undefined {
  return KERNELS.get(name);
}

export function kernelEntries(): [string, KernelEntry][] {
  return Array.from(KERNELS.entries());
}

// Flat params for the C++ kernel: descriptor defaults, overridden by `values`, then the entry's extra params.
export function buildKernelParams(
  entry: KernelEntry,
  values?: Record<string, number>,
  options?: Record<string, unknown>
): number[] {
  const params = entry.module.parameterDescriptors.map((d) => values?.[d.name] ?? d.defaultValue);
  return params.concat(entry.extraParams ? entry.extraParams(options) : []);
}

// Kernel mode for the dedicated node classes (DynamicsCompressorNode, FeedbackDelayNode) follows the native switch.
export const areNativeKernelsEnabled = areNativeProcessorsEnabled;

interface KernelNodeApi {
  setKernel: (id: number) => void;
  setKernelParam: (index: number, value: number) => void;
  start?: (when?: number) => void;
}

export interface KernelParam {
  value: number;
  setValueAtTime: (v: number, t?: number) => KernelParam;
  linearRampToValueAtTime: (v: number, t?: number) => KernelParam;
  exponentialRampToValueAtTime: (v: number, t?: number) => KernelParam;
  cancelScheduledValues: (t?: number) => KernelParam;
}

// Selects the kernel on an existing library node and returns a `parameters` map. Parameter automation calls are applied
// immediately (scheduled changes take effect at the call, not at their scheduled time; fine for params set once per note).
export function attachKernel(
  node: KernelNodeApi,
  entryName: string,
  values?: Record<string, number>,
  options?: Record<string, unknown>
): { parameters: Map<string, KernelParam>; setExtraParam: (extraIndex: number, value: number) => void } {
  const entry = KERNELS.get(entryName);
  if (!entry) throw new Error(`No native kernel registered for "${entryName}"`);
  const initial = buildKernelParams(entry, values, options);
  node.setKernel(entry.id);
  initial.forEach((value, index) => node.setKernelParam(index, value));

  const descriptors = entry.module.parameterDescriptors;
  const current = initial.slice();
  const parameters = new Map<string, KernelParam>();
  descriptors.forEach((descriptor, index) => {
    const set = (v: number): void => {
      current[index] = v;
      node.setKernelParam(index, v);
    };
    const param: KernelParam = {
      get value() {
        return current[index];
      },
      set value(v: number) {
        set(v);
      },
      setValueAtTime(v) {
        set(v);
        return param;
      },
      linearRampToValueAtTime(v) {
        set(v);
        return param;
      },
      exponentialRampToValueAtTime(v) {
        set(v);
        return param;
      },
      cancelScheduledValues() {
        return param;
      },
    };
    parameters.set(descriptor.name, param);
  });

  return {
    parameters,
    setExtraParam: (extraIndex, value) => node.setKernelParam(descriptors.length + extraIndex, value),
  };
}

export const noopWorklet = (): void => {
  'worklet';
};

// Returns an object shaped like an AudioWorkletNode: a real AudioNode with a `parameters` map (plus whatever the entry's
// `configure` adds, e.g. a `port`). Effect kernels run on a WorkletProcessingNode, source kernels
// on a WorkletSourceNode (auto-started, like the JS shim does).
export function createNativeKernelNode(
  context: BaseAudioContext,
  processorName: string,
  options?: Record<string, unknown>
): unknown {
  const entry = KERNELS.get(processorName);
  if (!entry) throw new Error(`No native kernel registered for "${processorName}"`);
  const ctx = context as unknown as {
    createWorkletProcessingNode: (cb: () => void, runtime: string) => KernelNodeApi;
    createWorkletSourceNode: (cb: () => void, runtime: string) => KernelNodeApi;
  };
  const node =
    entry.kind === 'source'
      ? ctx.createWorkletSourceNode(noopWorklet, 'AudioRuntime')
      : ctx.createWorkletProcessingNode(noopWorklet, 'AudioRuntime');
  const { parameters, setExtraParam } = attachKernel(node, processorName, undefined, options);

  const extras = entry.configure ? entry.configure(setExtraParam) : {};
  if (entry.kind === 'source') node.start?.();
  return Object.assign(node, { parameters }, extras);
}
