// Types for JS AudioWorklet processors (registerWorkletProcessor). A WorkletProcessorModule is the React Native
// equivalent of an AudioWorkletProcessor subclass: the same parameterDescriptors shape and a per-block process(), with
// exactly one input and one output. The rules its functions must follow are in docs/FINDINGS.md, "Worklet rules".

export interface ParamDescriptor {
  name: string;
  defaultValue: number;
}

export type ParamValues = { [name: string]: number };

// 'effect': has an audio input (runs on a WorkletProcessingNode). 'source': generates audio from nothing (runs on a
// WorkletSourceNode, which react-native-audio-api only runs after .start(); AudioWorkletNode starts it for you, since a
// browser AudioWorkletNode needs no start()).
export type ProcessorKind = 'effect' | 'source';

// Per-node state, created by createState() and passed to every process() call. State is passed in rather than closed
// over: a worklet function whose own closure holds mutable per-node state crashed on a device.
export type ProcessorState = unknown;

// Called once per render block on the audio thread. Use framesToProcess (usually 128, not guaranteed). currentTime is
// the time of the block's first frame, like AudioWorkletGlobalScope's `currentTime`. For 'source' modules `input` is [].
// Must carry a 'worklet' directive and be self-contained (no references to other module-level bindings).
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
  // Called once per node, on the JS thread (not a worklet), like an AudioWorkletProcessor's constructor. Allocate
  // buffers here, not in process(). processorOptions is AudioWorkletNodeOptions.processorOptions.
  createState: (sampleRate: number, processorOptions: Record<string, unknown> | undefined) => State;
  process: ProcessBlock<State>;
  // Optional: receives `node.port.postMessage(data)` on the audio thread before the next block. `data` travels as JSON,
  // so it must be JSON-serializable. Same rules as process() ('worklet', self-contained).
  onMessage?: (state: State, data: unknown) => void;
}
