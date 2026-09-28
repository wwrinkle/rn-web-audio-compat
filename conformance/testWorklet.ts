// The processor the AudioWorklet rows test: output = input * gain (a param) * processorOptions.scale * the last
// port message's `scale`. The same behaviour as a native JS module (rn-web-audio-compat's WorkletProcessorModule) and as
// a real browser AudioWorkletProcessor (loaded from a Blob URL on web).

export const TEST_PROCESSOR = 'rnwac-test-gain';

interface State {
  scale: number;
  message: number;
}

export const testGainModule = {
  kind: 'effect' as const,
  parameterDescriptors: [{ name: 'gain', defaultValue: 1 }],
  createState: (_sampleRate: number, options?: Record<string, unknown>): State => ({
    scale: typeof options?.scale === 'number' ? options.scale : 1,
    message: 1,
  }),
  onMessage: (state: State, data: unknown): void => {
    'worklet';
    const m = data as { scale?: number } | null;
    if (m && typeof m.scale === 'number') state.message = m.scale;
  },
  process: (
    state: State,
    input: Float32Array[],
    output: Float32Array[],
    params: Record<string, number>,
    frames: number
  ): void => {
    'worklet';
    const k = params.gain * state.scale * state.message;
    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch] ?? input[0];
      for (let i = 0; i < frames; i++) output[ch][i] = inp ? inp[i] * k : 0;
    }
  },
};

export const TEST_PROCESSOR_SOURCE = `
class RnwacTestGain extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'gain', defaultValue: 1 }]; }
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.scale = typeof o.scale === 'number' ? o.scale : 1;
    this.message = 1;
    this.port.onmessage = (e) => { if (e.data && typeof e.data.scale === 'number') this.message = e.data.scale; };
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0], output = outputs[0], g = parameters.gain;
    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch] || input[0];
      for (let i = 0; i < output[ch].length; i++) {
        const k = (g.length > 1 ? g[i] : g[0]) * this.scale * this.message;
        output[ch][i] = inp ? inp[i] * k : 0;
      }
    }
    return true;
  }
}
registerProcessor('${'rnwac-test-gain'}', RnwacTestGain);
`;
