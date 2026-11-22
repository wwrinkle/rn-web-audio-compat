// FdnReverb in a browser: the same API on Tone.Reverb, which the C++ reverb's level is calibrated to, after a lowpass.
// `damping` is stored but not modelled here, so the tail is brighter than on a device.

import { Filter, Reverb, Effect, optionsFromArguments } from './toneWebInternals';
import type { EffectOptions } from './toneWebInternals';

export interface FdnReverbOptions extends EffectOptions {
  decay: number;
  lowpass: number;
  damping: number;
}

export class FdnReverb extends Effect<FdnReverbOptions> {
  readonly name: string = 'FdnReverb';
  readonly ready: Promise<void>;
  private readonly _filter: Filter;
  private readonly _reverb: Reverb;
  private _lowpass: number;
  private _damping: number;

  constructor(options?: Partial<FdnReverbOptions>);
  constructor(decay?: number);
  constructor(...args: unknown[]) {
    const options = optionsFromArguments(FdnReverb.getDefaults(), args as IArguments & unknown[], ['decay']);
    super(options);
    this._lowpass = options.lowpass;
    this._damping = options.damping;
    this._filter = new Filter({ context: this.context, type: 'lowpass', frequency: options.lowpass || 20000 });
    this._reverb = new Reverb({ context: this.context, decay: options.decay, wet: 1 });
    this.ready = this._reverb.ready;
    this.effectSend.chain(this._filter, this._reverb, this.effectReturn);
  }

  static getDefaults(): FdnReverbOptions {
    return Object.assign(Effect.getDefaults(), { decay: 2, lowpass: 15000, damping: 1000 });
  }

  get decay(): number {
    return this._reverb.decay as number;
  }
  set decay(seconds: number) {
    this._reverb.decay = seconds;
  }

  get lowpass(): number {
    return this._lowpass;
  }
  set lowpass(hz: number) {
    this._lowpass = hz;
    this._filter.frequency.value = hz || 20000;
  }

  get damping(): number {
    return this._damping;
  }
  set damping(hz: number) {
    this._damping = hz;
  }

  dispose(): this {
    super.dispose();
    this._filter.dispose();
    this._reverb.dispose();
    return this;
  }
}
