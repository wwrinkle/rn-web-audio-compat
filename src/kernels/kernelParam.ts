// No imports beyond a constant: globals.ts imports this (for `instanceof AudioParam`), and must not load the native module.
import { FLT_MAX } from '../worklet/liveAudioParam';

// One param of a C++ kernel node. The kernel reads a plain number per block, so automation calls are applied at the call,
// not at their scheduled time (fine for params set once per note, or held). It has the members code that wraps
// AudioParams reads (Tone.js's Param: defaultValue / minValue / maxValue, setTargetAtTime, cancelAndHoldAtTime), and
// `instanceof AudioParam` is true for it (globals.ts).
export class KernelParam {
  readonly minValue = -FLT_MAX;
  readonly maxValue = FLT_MAX;

  constructor(
    private readonly set: (v: number) => void,
    private readonly get: () => number,
    readonly defaultValue: number
  ) {}

  get value(): number {
    return this.get();
  }

  set value(v: number) {
    this.set(v);
  }

  setValueAtTime(v: number, _t?: number): this {
    this.set(v);
    return this;
  }

  linearRampToValueAtTime(v: number, _t?: number): this {
    this.set(v);
    return this;
  }

  exponentialRampToValueAtTime(v: number, _t?: number): this {
    this.set(v);
    return this;
  }

  setTargetAtTime(target: number, _t?: number, _timeConstant?: number): this {
    this.set(target);
    return this;
  }

  setValueCurveAtTime(values: ArrayLike<number>, _t?: number, _duration?: number): this {
    if (values.length > 0) this.set(values[values.length - 1]);
    return this;
  }

  cancelScheduledValues(_t?: number): this {
    return this;
  }

  cancelAndHoldAtTime(_t?: number): this {
    return this;
  }
}
