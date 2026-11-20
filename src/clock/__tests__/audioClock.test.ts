// createAudioClock's timer loop, with a fake context whose buffer source's onpositionchanged the test fires by hand.
jest.mock('react-native-worklets', () => ({ createSynchronizable: jest.fn(), scheduleOnRN: jest.fn() }), { virtual: true });
jest.mock('../../native/nativeModule', () => ({ createWorkletSourceNode: jest.fn() }));

import { createAudioClock } from '../audioClock';

function fakeContext() {
  const source: any = { connect: jest.fn(), start: jest.fn(), stop: jest.fn(), disconnect: jest.fn() };
  const context: any = {
    sampleRate: 48000,
    destination: {},
    createBuffer: () => ({}),
    createBufferSource: () => source,
  };
  return { context, tick: () => source.onpositionchanged() };
}

describe('createAudioClock', () => {
  let now = 0;
  beforeEach(() => {
    now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it('runs every due timer even when an earlier one throws, and reports the error', () => {
    const { context, tick } = fakeContext();
    const errors: unknown[] = [];
    const clock = createAudioClock(context, { onError: (e) => errors.push(e) });
    const boom = new Error('boom');
    let later = 0;
    clock.setInterval(() => {
      throw boom;
    }, 10);
    clock.setInterval(() => later++, 10);

    now += 10;
    tick();
    now += 10;
    tick();

    expect(later).toBe(2);
    expect(errors).toEqual([boom, boom]);
  });

  it('fires a timer once per interval and stops after clearInterval', () => {
    const { context, tick } = fakeContext();
    const clock = createAudioClock(context);
    let n = 0;
    const id = clock.setInterval(() => n++, 25);
    for (let i = 0; i < 10; i++) {
      now += 10;
      tick();
    }
    expect(n).toBe(4); // due at +25, +50, +75, +100
    clock.clearInterval(id);
    now += 100;
    tick();
    expect(n).toBe(4);
  });
});
