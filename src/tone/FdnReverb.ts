// FdnReverb: this library's C++ feedback-delay-network reverb (createFdnReverbNode) as a Tone.js effect, with Tone's
// `wet`, `connect()` and `chain()`. Its cost doesn't grow with `decay`, unlike Tone.Reverb. Imports Tone's modules directly:
// importing 'tone' here would make Tone's index load before rn-web-audio-compat/tone has set up the context.

import { Effect, type EffectOptions } from 'tone/build/esm/effect/Effect.js';
import { optionsFromArguments } from 'tone/build/esm/core/util/Defaults.js';
import type { BaseAudioContext } from 'react-native-audio-api';
import { createFdnReverbNode, type FdnReverbNode } from '../nodes/FdnReverbNode';

export interface FdnReverbOptions extends EffectOptions {
  decay: number; // seconds to fall by 60 dB
  lowpass: number; // input lowpass cutoff in Hz; 0 = no filtering
  damping: number; // cutoff the tail has darkened to by the end of `decay`, in Hz
}

export class FdnReverb extends Effect<FdnReverbOptions> {
  readonly name: string = 'FdnReverb';
  readonly ready: Promise<void> = Promise.resolve(); // as Tone.Reverb; nothing to render here
  private readonly _fdn: FdnReverbNode;
  private _decay: number;
  private _lowpass: number;
  private _damping: number;

  constructor(options?: Partial<FdnReverbOptions>);
  constructor(decay?: number);
  constructor(...args: unknown[]) {
    const options = optionsFromArguments(FdnReverb.getDefaults(), args as IArguments & unknown[], ['decay']);
    super(options);
    this._decay = options.decay;
    this._lowpass = options.lowpass;
    this._damping = options.damping;
    this._fdn = createFdnReverbNode(this.context.rawContext as unknown as BaseAudioContext, {
      decayTime: options.decay,
      lpFreqStart: options.lowpass,
      lpFreqEnd: options.damping,
    });
    this.connectEffect(this._fdn as never);
  }

  static getDefaults(): FdnReverbOptions {
    return Object.assign(Effect.getDefaults(), { decay: 2, lowpass: 15000, damping: 1000 });
  }

  get decay(): number {
    return this._decay;
  }
  set decay(seconds: number) {
    this._decay = seconds;
    this._fdn.setParams({ decayTime: seconds });
  }

  get lowpass(): number {
    return this._lowpass;
  }
  set lowpass(hz: number) {
    this._lowpass = hz;
    this._fdn.setParams({ lpFreqStart: hz });
  }

  get damping(): number {
    return this._damping;
  }
  set damping(hz: number) {
    this._damping = hz;
    this._fdn.setParams({ lpFreqEnd: hz });
  }

  dispose(): this {
    super.dispose();
    this._fdn.disconnect();
    return this;
  }
}
