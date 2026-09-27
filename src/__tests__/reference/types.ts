// Shared shape for a pre-render DSP function used by webAudioShim.ts to stand
// in for a real-time AudioWorkletProcessor. Strudel/superdough always knows a
// hap's full duration up front (begin/end are fixed at trigger time), so
// instead of processing live in a real-time render callback, each renderer
// runs once over the hap's full sample count and returns the complete result.
// See ../../../../.claude/plans/rustling-watching-pelican.md for why.

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
