// Matches the shape superdough's `node.parameters.get(key).value = value`
// (and, for DynamicsCompressorNode, `node.threshold.value = value` etc.)
// needs, but — unlike a real (per-hap-fixed) AudioParam as superdough
// currently uses it — this stays live: writing `.value` after construction
// updates the next render block, not just the initial one. A strict
// superset of what superdough does today (params set once), not a
// regression. See CLAUDE.md's live-modulation section for why this needs a
// SharedValue (a JSI HostObject, crosses into the worklet runtime by
// reference) rather than a plain captured number (deep-copied once, dead on
// arrival for live updates).
//
// AUTOMATION (added 2026-09-24): confirmed by reading superdough's real
// source that this is not optional — `helpers.mjs`'s `getParamADSR` (used
// for e.g. the ladder filter's cutoff envelope) calls `.setValueAtTime()` /
// `.exponentialRampToValueAtTime()` / `.linearRampToValueAtTime()` directly
// on a worklet node's `parameters.get('frequency')`, and `nodePools.mjs`
// calls `.cancelScheduledValues()` on every param it finds when releasing a
// pooled node. A plain `.value`-only param throws the moment any of that
// runs. Real Web Audio automates at a-rate (per-sample); this instead
// resolves the schedule to a single value once per render block (k-rate
// approximation) — correct enough for envelope-speed automations (the
// actual use case), not sample-accurate for fast modulation within one
// block. `computeAutomatedValue` is exported so worklet call sites can
// capture it as a local binding (the confirmed-safe way to reference a
// function from inside a 'worklet'-tagged callback — see CLAUDE.md's
// crash section) rather than duplicating this logic per file.

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
// DEVICE-VERIFIED CRASH FIX (2026-09-24): this needs its own 'worklet'
// directive, same as every processor's `process` function has. Without it,
// this is just an ordinary JS function — calling it from inside an
// already-worklet-tagged callback (even via the confirmed-safe "local
// rebind" capture pattern) crashed the app on every processor that has at
// least one parameter (i.e. every processor except transient-processor,
// which has zero params and so never executes the call site at all — the
// one processor that kept working). `process` never had this problem
// because it's marked 'worklet' at its own definition site in every
// processors/*.ts file; a captured function value apparently needs that
// same treatment to serialize/call correctly across the worklet runtime
// boundary, not just to be captured as an ordinary closure value the way a
// number or SharedValue is.
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
  // DEVICE-VERIFIED BUG FIX (2026-09-24): the schedule used to be
  // read-modify-written straight through `schedule.value` on every call
  // (read the SharedValue, push an event, write it back). On a real device,
  // three back-to-back calls (setValueAtTime + two
  // exponentialRampToValueAtTime, in a single synchronous burst, matching
  // superdough's real getParamADSR usage) resulted in a schedule containing
  // only the LAST event — each read-back was seeing stale data, as if the
  // previous write in the same tick hadn't landed yet, even though the
  // final write does land (confirmed via `[LADDERENV]` device logs: schedule
  // showed just the third call's event from the very first worklet block).
  // Root cause not fully pinned down (Reanimated SharedValue read-after-
  // write semantics within one synchronous JS-thread burst, is the leading
  // suspect, unconfirmed), but the fix is robust regardless: `events` here
  // is a plain JS array, the actual source of truth, never read back from
  // `schedule`. `schedule` (the SharedValue<string>) is now write-only from
  // the JS thread's perspective — published after every mutation purely for
  // the worklet side to read, never round-tripped back through itself.
  private readonly events: AutomationEvent[] = [];

  // `schedule` must be the SAME SharedValue instance the worklet closure
  // that reads this param was built with (via computeAutomatedValue) —
  // constructing one internally here would leave it invisible to the
  // worklet. Callers create it up front alongside the base value SharedValue
  // (see webAudioShim.ts/compressorNode.ts/feedbackDelay.ts) and pass it in.
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
