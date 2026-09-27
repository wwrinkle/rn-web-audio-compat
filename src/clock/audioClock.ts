// React Native Android drives JS timers (setInterval/setTimeout) from the
// display's Choreographer frame callback, which stops when the screen locks
// or the app leaves the foreground. A setInterval-driven music scheduler (e.g.
// Strudel's) therefore silently stops on lock: audio keeps rendering, nothing
// new gets scheduled. createAudioClock gives such code a replacement
// setInterval/clearInterval clocked by the audio render thread instead, which
// keeps running with the screen off (verified on a Pixel 10, 2026-09-27).
//
// Two tick sources, switchable live (`native` option / setNative()):
// - native (default): a looping silent AudioBufferSourceNode whose native
//   onPositionChanged event fires every ~10ms. The event is raised on the
//   audio thread and delivered to the JS thread through the library's event
//   dispatcher (CallInvoker::invokeAsync, the same mechanism scheduleOnRN
//   uses), so no JS runs on the audio thread at all.
// - worklet (the original): a silent JS WorkletSourceNode, i.e. Hermes on the
//   audio thread every render block plus a Synchronizable read.

import type { AudioContext } from 'react-native-audio-api';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';

const TICK_SECONDS = 0.01;
const TICK_MS = 10;

interface TickSource {
  stop: () => void;
}

interface ClockTimer {
  fn: () => void;
  ms: number;
  next: number;
}

export interface AudioClock {
  setInterval: (fn: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  // Switch tick source live (true = native buffer-source events, false = JS worklet).
  setNative: (native: boolean) => void;
  isNative: () => boolean;
}

export interface AudioClockOptions {
  native?: boolean; // default true
}

export function createAudioClock(context: AudioContext, options: AudioClockOptions = {}): AudioClock {
  const timers = new Map<number, ClockTimer>();
  let nextId = 1;

  const onTick = (): void => {
    const now = Date.now();
    timers.forEach((timer) => {
      if (now >= timer.next) {
        timer.next = now - timer.next > timer.ms * 4 ? now + timer.ms : timer.next + timer.ms;
        timer.fn();
      }
    });
  };

  const startWorkletTicks = (): TickSource => {
    const lastBucket = createSynchronizable(-1);
    const tickSeconds = TICK_SECONDS;
    const notify = onTick;
    const schedule = scheduleOnRN;

    const source = context.createWorkletSourceNode((_audioData, _frames, currentTime) => {
      'worklet';
      try {
        const bucket = Math.floor(currentTime / tickSeconds);
        if (bucket !== lastBucket.getBlocking()) {
          lastBucket.setBlocking(bucket);
          schedule(notify);
        }
      } catch {
        // never let an exception escape the audio callback
      }
    }, 'AudioRuntime');
    source.connect(context.destination);
    source.start();
    return {
      stop: () => {
        source.stop();
        source.disconnect();
      },
    };
  };

  const startNativeTicks = (): TickSource => {
    const silence = context.createBuffer(1, Math.round(context.sampleRate), context.sampleRate);
    const source = context.createBufferSource();
    source.buffer = silence;
    source.loop = true;
    source.onPositionChangedInterval = TICK_MS;
    source.onPositionChanged = onTick;
    source.connect(context.destination);
    source.start();
    return {
      stop: () => {
        source.onPositionChanged = null;
        source.stop();
        source.disconnect();
      },
    };
  };

  const start = (native: boolean): TickSource => (native ? startNativeTicks() : startWorkletTicks());
  let native = options.native ?? true;
  let ticks = start(native);

  return {
    setInterval: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, ms, next: Date.now() + ms });
      return id;
    },
    clearInterval: (id) => {
      timers.delete(id);
    },
    // Start the new source before stopping the old one so no tick is missed (a doubled tick is harmless: onTick only
    // fires timers that are due).
    setNative: (next) => {
      if (next === native) return;
      native = next;
      const previous = ticks;
      ticks = start(next);
      previous.stop();
    },
    isNative: () => native,
  };
}
