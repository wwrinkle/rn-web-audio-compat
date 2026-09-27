// Shared types for the real-time worklet shim (see webAudioShim.ts). Each
// registered processor module is the real-time equivalent of one of
// superdough's AudioWorkletProcessor subclasses (worklets.mjs) — same
// parameterDescriptors shape, same per-block process signature (minus the
// multi-input-bus generality superdough's own processors never use: always
// exactly one input bus, one output bus).

export interface ParamDescriptor {
  name: string;
  defaultValue: number;
}

export type ParamValues = { [name: string]: number };

// 'effect' = has an audio input (crush, ladder, distort, ...) — backed by
// WorkletProcessingNode. 'source' = no audio input, generates from nothing
// (lfo, envelope, oscillators, ...) — backed by WorkletSourceNode, which
// react-native-audio-api requires an explicit .start() on (unlike a real
// AudioWorkletNode source, which needs none) — webAudioShim.ts calls
// .start() automatically at construction so callers never see that
// difference. See CLAUDE.md's "source vs effect" section.
export type ProcessorKind = 'effect' | 'source';

// State is threaded through explicitly rather than closed over inside the
// per-block function — see webAudioShim.ts's header comment for why: a
// worklet-tagged function whose OWN closure holds mutable per-instance state
// crashed the app on-device (see CLAUDE.md's device-verified finding). A
// stateless function plus state-as-argument avoids nesting one worklet
// closure inside another.
export type ProcessorState = unknown;

// Called once per render block (~128 frames, matching superdough's own
// `blockSize` — though react-native-audio-api doesn't guarantee that exact
// number, so use framesToProcess, don't hardcode 128). sampleRate and
// currentTime are passed explicitly rather than closed over, for the same
// reason state is: keeps `process` a plain, stateless, already-existing
// module-level function with no per-node closure of its own. currentTime
// matches AudioWorkletGlobalScope's `currentTime` global that superdough's
// own processors reference directly — needed by anything with begin/end
// lifecycle gating (most of the source-style processors).
//
// For 'source' modules, `input` is always `[]` (no upstream signal) —
// matches what superdough's own source processors already do (ignore/
// underscore-prefix their own `inputs` parameter).
export type ProcessBlock<State = ProcessorState> = (
  state: State,
  input: Float32Array[],
  output: Float32Array[],
  params: ParamValues,
  framesToProcess: number,
  sampleRate: number,
  currentTime: number
) => void;

export interface WorkletProcessorModule<State = ProcessorState> {
  kind: ProcessorKind;
  parameterDescriptors: ParamDescriptor[];
  // Called once per constructed node (on the JS thread, at setup time, NOT
  // itself a worklet) — matches AudioWorkletProcessor's own constructor()
  // running once per `new AudioWorkletNode(...)`, so state is per-hap, not
  // shared across notes. superdough gets a brand new node per hap (except a
  // few pooled source-style ones — see `onMessage`).
  // processorOptions mirrors real Web Audio's AudioWorkletNodeOptions.
  // processorOptions (construction-time config, e.g. distort's algorithm
  // name) — read once here, on the JS thread, not inside the worklet.
  createState: (sampleRate: number, processorOptions: Record<string, unknown> | undefined) => State;
  process: ProcessBlock<State>;
  // Optional: matches superdough's `node.port.postMessage(data)` usage
  // (e.g. supersaw-oscillator's pooled-node reset). Delivered via a
  // SharedValue-backed mailbox (see webAudioShim.ts), so `data` must be
  // JSON-serializable — not an arbitrary live object graph. Runs on the
  // worklet runtime, so it must follow the same self-containment rule as
  // `process` (mark 'worklet', no references to sibling module-level
  // bindings from inside it).
  onMessage?: (state: State, data: unknown) => void;
}
