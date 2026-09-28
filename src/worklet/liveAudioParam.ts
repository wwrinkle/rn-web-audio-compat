// AudioParam for JS worklet and kernel nodes (AudioWorkletNode.parameters, DynamicsCompressorNode.threshold, ...).
// `.value` stays live: a write reaches the next render block, not just the first one. The value and the automation
// schedule are react-native-worklets Synchronizables, which the audio thread can read (a plain captured number would be
// copied into the worklet once).
//
// Automation (setValueAtTime, linear/exponential ramps, cancelScheduledValues) is resolved once per render block: a
// k-rate approximation, fine for envelopes that span many blocks, not sample-accurate for fast modulation within one.
// computeAutomatedValue is exported so worklet callbacks can capture it through a local const (see docs/FINDINGS.md,
// "Worklet rules").

import type { Synchronizable } from 'react-native-worklets';

type AutomationEventType = 'set' | 'linear' | 'exponential';

interface AutomationEvent {
  t: number;
  v: number;
  type: AutomationEventType;
}

const EMPTY_SCHEDULE = '[]';

// Pure, self-contained (only params/locals + JSON/Math globals) — safe to
// call from inside a worklet as long as it's captured via a local const,
// not referenced by this top-level export name directly (see call sites).
//
// Needs its own 'worklet' directive: without it, calling it from a worklet callback crashed the app.
export function computeAutomatedValue(scheduleJson: string, baseValue: number, currentTime: number): number {
  'worklet';

  if (scheduleJson === EMPTY_SCHEDULE) {
    return baseValue;
  }

  const events = JSON.parse(scheduleJson) as AutomationEvent[];
  if (events.length === 0) {
    return baseValue;
  }

  let fromValue = baseValue;
  let fromTime = -Infinity;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (currentTime < event.t) {
      if (event.type === 'set') {
        // Holds at the prior value until this scheduled time arrives.
        return fromValue;
      }

      const span = event.t - fromTime;
      if (span <= 0) {
        return event.v;
      }

      const frac = Math.min(1, Math.max(0, (currentTime - fromTime) / span));

      if (event.type === 'linear') {
        return fromValue + (event.v - fromValue) * frac;
      }

      // exponential — real Web Audio requires both endpoints to be
      // strictly nonzero; superdough's own getParamADSR already avoids 0
      // for exponential curves (see helpers.mjs), but guard anyway rather
      // than propagate a NaN/Infinity into the audio graph.
      const safeFrom = fromValue === 0 ? 0.00001 : fromValue;
      const safeTo = event.v === 0 ? 0.00001 : event.v;
      return safeFrom * Math.pow(safeTo / safeFrom, frac);
    }

    fromValue = event.v;
    fromTime = event.t;
  }

  // Past every scheduled event — holds at the last one.
  return fromValue;
}

// Audio-thread reads of a Synchronizable cost ~10-20us each on Android, so the
// worklet reads ONE per-node version counter per block and only re-reads the
// per-param values/schedules when it changed (see readCachedParams).
export class ParamVersion {
  private n = 0;

  constructor(readonly sync: Synchronizable<number>) {}

  bump(): void {
    this.n += 1;
    this.sync.setBlocking(this.n);
  }
}

export interface ParamCache {
  v: number;
  base: Record<string, number>;
  sched: Record<string, string>;
}

// Runs on the audio thread: cached-parameter read. `compute` is
// computeAutomatedValue, passed in (not referenced) so this stays a
// self-contained worklet function.
export function readCachedParams(
  versionSync: Synchronizable<number>,
  cache: ParamCache,
  paramNames: string[],
  sharedParams: Record<string, Synchronizable<number>>,
  scheduleParams: Record<string, Synchronizable<string>>,
  currentTime: number,
  compute: (scheduleJson: string, baseValue: number, currentTime: number) => number
): Record<string, number> {
  'worklet';

  const v = versionSync.getBlocking();
  if (v !== cache.v) {
    for (let i = 0; i < paramNames.length; i++) {
      const name = paramNames[i];
      cache.base[name] = sharedParams[name].getBlocking();
      cache.sched[name] = scheduleParams[name].getBlocking();
    }
    cache.v = v;
  }
  const params: Record<string, number> = {};
  for (let i = 0; i < paramNames.length; i++) {
    const name = paramNames[i];
    params[name] = compute(cache.sched[name], cache.base[name], currentTime);
  }
  return params;
}

export class LiveAudioParam {
  // The source of truth for the schedule, on the JS thread. `schedule` is only written (published for the audio
  // thread), never read back: read-modify-writing shared state in one synchronous burst (setValueAtTime followed by
  // two ramps) lost all but the last event on a device.
  private readonly events: AutomationEvent[] = [];

  // `base` and `schedule` must be the same Synchronizables the node's worklet callback captured, so the node creates
  // them and passes them in (AudioWorkletNode.ts, DynamicsCompressorNode.ts, FeedbackDelayNode.ts).
  constructor(
    private readonly base: Synchronizable<number>,
    readonly schedule: Synchronizable<string>,
    private readonly version: ParamVersion
  ) {}

  get value(): number {
    return this.base.getBlocking();
  }

  set value(next: number) {
    this.base.setBlocking(next);
    // A direct .value assignment is a hard reset in real Web Audio too —
    // clears any pending automation rather than letting it resume later.
    this.events.length = 0;
    this.schedule.setBlocking(EMPTY_SCHEDULE);
    this.version.bump();
  }

  setValueAtTime(value: number, startTime: number): this {
    this.pushEvent({ t: startTime, v: value, type: 'set' });
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): this {
    this.pushEvent({ t: endTime, v: value, type: 'linear' });
    return this;
  }

  exponentialRampToValueAtTime(value: number, endTime: number): this {
    this.pushEvent({ t: endTime, v: value, type: 'exponential' });
    return this;
  }

  cancelScheduledValues(cancelTime: number): this {
    const kept = this.events.filter((event) => event.t < cancelTime);
    this.events.length = 0;
    this.events.push(...kept);
    this.publish();
    return this;
  }

  private pushEvent(event: AutomationEvent): void {
    this.events.push(event);
    this.events.sort((a, b) => a.t - b.t);
    this.publish();
  }

  private publish(): void {
    this.schedule.setBlocking(this.events.length === 0 ? EMPTY_SCHEDULE : JSON.stringify(this.events));
    this.version.bump();
  }
}
