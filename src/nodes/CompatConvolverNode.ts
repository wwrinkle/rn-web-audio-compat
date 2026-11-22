// A ConvolverNode without a buffer outputs silence (Web Audio spec). react-native-audio-api 1.0.1 passes its input
// through instead, and ignores setBuffer(null), which would put dry signal on Tone.Reverb's wet path until its impulse
// response has rendered. Here the native node holds a silent impulse response whenever the JS `buffer` is null.
import { ConvolverNode } from 'react-native-audio-api';

type ConvolverOptions = ConstructorParameters<typeof ConvolverNode>[1];
type NativeConvolver = { setBuffer(buffer: unknown): void };
const SILENT_FRAMES = 128; // one render quantum

export class CompatConvolverNode extends ConvolverNode {
  constructor(context: ConstructorParameters<typeof ConvolverNode>[0], options?: ConvolverOptions) {
    super(context, options);
    if (!options?.buffer) this.holdSilence();
  }

  private holdSilence() {
    const silent = this.context.createBuffer(2, SILENT_FRAMES, this.context.sampleRate);
    (this as unknown as { node: NativeConvolver }).node.setBuffer((silent as unknown as { buffer: unknown }).buffer);
  }

  override get buffer() {
    return super.buffer;
  }

  override set buffer(buffer) {
    super.buffer = buffer;
    if (!buffer) this.holdSilence();
  }
}
