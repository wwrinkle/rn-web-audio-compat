// Shape of a whole-buffer DSP renderer (reference implementations the tests compare the per-block processors with):
// runs once over the full input and returns the complete output.

export interface DspRenderParams {
  [paramName: string]: number;
}

// input: one Float32Array per channel, already rendered upstream (via
// OfflineAudioContext) for the hap's full duration. Source-style renderers
// (no upstream signal, e.g. oscillators) receive channel arrays of the
// correct length filled with zeros.
export type DspRenderer = (
  input: Float32Array[],
  params: DspRenderParams,
  sampleRate: number,
) => Float32Array[];
