// JS side of the native (C++) effect kernels. This library's own native module (common/cpp/rnwac) provides
// KernelEffectNode (effects) and KernelSourceNode (sources): react-native-audio-api AudioNodes, built on its stable
// extension API, that run a registered C++ kernel by id, so nothing runs in Hermes on the audio thread. See
// native/README.md.
//
// A kernel is described to JS by a KernelEntry: its numeric id (must match the id the C++ side registers), whether it is
// an effect or a source, and the JS processor module it mirrors (the spec, whose parameterDescriptors define the param
// layout, and the fallback when native processors are disabled). Built-ins: 'compressor', 'feedback-delay',
// 'fdn-reverb' (ids 1-3). Other libraries register theirs (ids 100-255) with registerKernel().

import type { AudioNode, BaseAudioContext } from 'react-native-audio-api';
import { compressorProcessor } from '../processors/compressorProcessor';
import { fdnReverbProcessor } from '../processors/fdnReverbProcessor';
import { feedbackDelayProcessor } from '../processors/feedbackDelayProcessor';
import type { WorkletProcessorModule } from '../worklet/types';
import { KernelParam } from './kernelParam';
import { areNativeProcessorsEnabled } from '../worklet/AudioWorkletNode';
import { createKernelEffectNode, createKernelSourceNode, type KernelHostObject } from '../native/nativeModule';

export interface KernelEntry {
  id: number; // must match the id registered on the C++ side (rnwac::registerKernel)
  kind: 'effect' | 'source';
  module: WorkletProcessorModule<any>;
  // Params appended after the descriptor params (must match the layout documented for the C++ kernel).
  extraParams?: (options: Record<string, unknown> | undefined) => number[];
  // Adds anything else the node needs (e.g. a `port`), given a way to set extra params; merged into the node.
  configure?: (setExtraParam: (extraIndex: number, value: number) => void) => Record<string, unknown>;
  // Effects only: how long (seconds) the node keeps rendering after its input goes silent (delay/reverb tails).
  tailSeconds?: (options: Record<string, unknown> | undefined) => number;
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);

const KERNELS = new Map<string, KernelEntry>([
  ['compressor', { id: 2, kind: 'effect', module: compressorProcessor }],
  [
    'feedback-delay',
    {
      id: 1,
      kind: 'effect',
      module: feedbackDelayProcessor,
      extraParams: (o) => [num(o?.maxDelayTime, 2)],
      // Feedback is capped at 0.995: ~1400 repeats to -60 dB at worst; 30 s covers any musical setting.
      tailSeconds: () => 30,
    },
  ],
  ['fdn-reverb', { id: 3, kind: 'effect', module: fdnReverbProcessor, tailSeconds: () => 30 }],
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

export { KernelParam };

// A `parameters` map over a kernel node's flat params. Automation calls are applied immediately (scheduled changes take
// effect at the call, not at their scheduled time; fine for params set once per note).
export function kernelParameters(
  node: Pick<KernelHostObject, 'setKernelParam'>,
  entry: KernelEntry,
  initial: number[]
): { parameters: Map<string, KernelParam>; setExtraParam: (extraIndex: number, value: number) => void } {
  const descriptors = entry.module.parameterDescriptors;
  const current = initial.slice();
  const parameters = new Map<string, KernelParam>();
  descriptors.forEach((descriptor, index) => {
    const set = (v: number): void => {
      current[index] = v;
      node.setKernelParam(index, v);
    };
    parameters.set(descriptor.name, new KernelParam(set, () => current[index], descriptor.defaultValue));
  });

  return {
    parameters,
    setExtraParam: (extraIndex, value) => node.setKernelParam(descriptors.length + extraIndex, value),
  };
}

// Creates the native node for a registered kernel with its initial params (descriptor defaults overridden by `values`,
// then the entry's extra params) and returns it with its `parameters` map.
export function createKernelNode(
  context: BaseAudioContext,
  entryName: string,
  values?: Record<string, number>,
  options?: Record<string, unknown>
): { node: AudioNode & KernelHostObject; entry: KernelEntry; parameters: Map<string, KernelParam>; setExtraParam: (extraIndex: number, value: number) => void } {
  const entry = KERNELS.get(entryName);
  if (!entry) throw new Error(`No native kernel registered for "${entryName}"`);
  const initial = buildKernelParams(entry, values, options);
  const node =
    entry.kind === 'source'
      ? createKernelSourceNode(context, entry.id, initial)
      : createKernelEffectNode(context, entry.id, initial, entry.tailSeconds ? entry.tailSeconds(options) : 0);
  return { node, entry, ...kernelParameters(node, entry, initial) };
}

// Returns an object shaped like an AudioWorkletNode: a real AudioNode with a `parameters` map (plus whatever the entry's
// `configure` adds, e.g. a `port`). Source kernels are started right away, like the JS shim does.
export function createNativeKernelNode(
  context: BaseAudioContext,
  processorName: string,
  options?: Record<string, unknown>
): unknown {
  const { node, entry, parameters, setExtraParam } = createKernelNode(context, processorName, undefined, options);
  const extras = entry.configure ? entry.configure(setExtraParam) : {};
  if (entry.kind === 'source') (node as unknown as { start: () => void }).start();
  return Object.assign(node, { parameters }, extras);
}
