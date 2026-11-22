// A Tone.Player whose `playbackRate` changes speed without changing pitch, using react-native-audio-api's native pitch
// correction. Cheaper than Tone.GrainPlayer, whose grains are scheduled from JS.

import { Player } from 'tone/build/esm/source/buffer/Player.js';

type ContextWithSource = { createBufferSource?: () => unknown; rawContext: { createBufferSource: (o: unknown) => unknown } };

export class TimeStretchPlayer extends Player {
  readonly name: string = 'TimeStretchPlayer';

  protected _start(...args: unknown[]): void {
    const context = this.context as unknown as ContextWithSource;
    // ToneBufferSource makes its node through the context, synchronously inside Player._start.
    context.createBufferSource = () => context.rawContext.createBufferSource({ pitchCorrection: true });
    try {
      (Player.prototype as unknown as { _start: (...a: unknown[]) => void })._start.apply(this, args);
    } finally {
      delete context.createBufferSource;
    }
  }
}
