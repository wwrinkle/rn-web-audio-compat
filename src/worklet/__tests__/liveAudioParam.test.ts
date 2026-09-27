import { LiveAudioParam, ParamVersion, computeAutomatedValue } from '../liveAudioParam';
import type { Synchronizable } from 'react-native-worklets';

// A plain {value} object satisfies everything LiveAudioParam/
// computeAutomatedValue actually need from a Synchronizable in this test —
// no reanimated runtime required to exercise the pure scheduling logic.
function mockShared<T>(initial: T): Synchronizable<T> {
  let value = initial;
  return {
    getBlocking: () => value,
    setBlocking: (next: T) => {
      value = next;
    },
  } as unknown as Synchronizable<T>;
}

describe('computeAutomatedValue', () => {
  test('returns the base value when nothing is scheduled', () => {
    expect(computeAutomatedValue('[]', 42, 10)).toBe(42);
  });

  test('holds at the previous value before a setValueAtTime fires', () => {
    const schedule = JSON.stringify([{ t: 5, v: 100, type: 'set' }]);
    expect(computeAutomatedValue(schedule, 1, 0)).toBe(1);
    expect(computeAutomatedValue(schedule, 1, 4.999)).toBe(1);
  });

  test('jumps to the set value once its time is reached, and holds after', () => {
    const schedule = JSON.stringify([{ t: 5, v: 100, type: 'set' }]);
    expect(computeAutomatedValue(schedule, 1, 5)).toBe(100);
    expect(computeAutomatedValue(schedule, 1, 50)).toBe(100);
  });

  test('linear ramp interpolates correctly between two points', () => {
    const schedule = JSON.stringify([
      { t: 0, v: 0, type: 'set' },
      { t: 10, v: 100, type: 'linear' },
    ]);
    expect(computeAutomatedValue(schedule, 0, 0)).toBe(0);
    expect(computeAutomatedValue(schedule, 0, 5)).toBeCloseTo(50, 5);
    expect(computeAutomatedValue(schedule, 0, 10)).toBe(100);
  });

  test('exponential ramp interpolates multiplicatively, matching real Web Audio math', () => {
    const schedule = JSON.stringify([
      { t: 0, v: 100, type: 'set' },
      { t: 1, v: 1000, type: 'exponential' },
    ]);
    // At the midpoint, an exponential ramp from 100 to 1000 should sit at
    // 100 * (1000/100)^0.5 = 100 * sqrt(10).
    expect(computeAutomatedValue(schedule, 100, 0.5)).toBeCloseTo(100 * Math.sqrt(10), 5);
  });

  test('a whole ADSR-shaped schedule (matching getParamADSR usage) resolves sensibly at each stage', () => {
    // Mirrors superdough's helpers.mjs getParamADSR shape: setValueAtTime
    // at begin, ramp through attack/decay to sustain, ramp down at release.
    const schedule = JSON.stringify([
      { t: 0, v: 200, type: 'set' }, // min, at begin
      { t: 0.01, v: 2000, type: 'exponential' }, // attack -> max
      { t: 0.15, v: 800, type: 'exponential' }, // decay -> sustain level
      { t: 1, v: 800, type: 'set' }, // hold sustain until end
      { t: 1.1, v: 200, type: 'exponential' }, // release -> min
    ]);
    expect(computeAutomatedValue(schedule, 200, 0)).toBe(200);
    expect(computeAutomatedValue(schedule, 200, 0.01)).toBeCloseTo(2000, 5);
    expect(computeAutomatedValue(schedule, 200, 0.15)).toBeCloseTo(800, 5);
    expect(computeAutomatedValue(schedule, 200, 0.5)).toBeCloseTo(800, 5);
    expect(computeAutomatedValue(schedule, 200, 1.1)).toBeCloseTo(200, 5);
  });
});

describe('LiveAudioParam', () => {
  test('.value reads/writes the base Synchronizable directly and clears any pending schedule', () => {
    const base = mockShared(1);
    const schedule = mockShared('[]');
    const param = new LiveAudioParam(base, schedule, new ParamVersion(mockShared(0)));

    param.setValueAtTime(5, 1);
    expect(schedule.getBlocking()).not.toBe('[]');

    param.value = 99;
    expect(base.getBlocking()).toBe(99);
    expect(schedule.getBlocking()).toBe('[]');
  });

  test('setValueAtTime/linearRampToValueAtTime/exponentialRampToValueAtTime chain and are readable via computeAutomatedValue', () => {
    const base = mockShared(0);
    const schedule = mockShared('[]');
    const param = new LiveAudioParam(base, schedule, new ParamVersion(mockShared(0)));

    param.setValueAtTime(0, 0).linearRampToValueAtTime(10, 1).exponentialRampToValueAtTime(1, 2);

    expect(computeAutomatedValue(schedule.getBlocking(), base.getBlocking(), 0.5)).toBeCloseTo(5, 5);
    expect(computeAutomatedValue(schedule.getBlocking(), base.getBlocking(), 1.5)).toBeCloseTo(10 * Math.pow(0.1, 0.5), 5);
  });

  test('cancelScheduledValues drops future events but keeps past ones', () => {
    const base = mockShared(0);
    const schedule = mockShared('[]');
    const param = new LiveAudioParam(base, schedule, new ParamVersion(mockShared(0)));

    param.setValueAtTime(1, 0);
    param.linearRampToValueAtTime(2, 1);
    param.linearRampToValueAtTime(3, 2);

    param.cancelScheduledValues(1.5);

    const events = JSON.parse(schedule.getBlocking()) as { t: number }[];
    expect(events.map((e) => e.t)).toEqual([0, 1]);
  });

  test('events pushed out of chronological order are still resolved correctly (sorted internally)', () => {
    const base = mockShared(0);
    const schedule = mockShared('[]');
    const param = new LiveAudioParam(base, schedule, new ParamVersion(mockShared(0)));

    param.linearRampToValueAtTime(10, 1);
    param.setValueAtTime(0, 0);

    expect(computeAutomatedValue(schedule.getBlocking(), base.getBlocking(), 0.5)).toBeCloseTo(5, 5);
  });
});
