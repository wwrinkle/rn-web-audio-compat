// rn-web-audio-compat/tone: Tone.js (https://tonejs.github.io) on React Native.
//
//   import 'rn-web-audio-compat/globals'; // first
//   import 'rn-web-audio-compat/tone';    // second: before anything imports 'tone'
//   import * as Tone from 'tone';
//   import { startTone } from 'rn-web-audio-compat/tone';
//
//   await startTone(); // in place of Tone.start(); from a user action, as in a browser
//
// Five things Tone.js can't do on its own here (both found on a Pixel 10; docs/FINDINGS.md "Tone.js"):
//  - Its index module makes a context as it loads (`export const Transport = getContext().transport`). Left alone, that
//    is a second native AudioContext, wrapped by standardized-audio-context, and on react-native-audio-api 1.0.1 every
//    context permanently uses up one of the app's few event-queue slots. So this module, loaded first, makes the app's
//    one context and hands it to Tone through core/Global.js, which `tone`'s index then uses.
//  - Its clock is a Worker or setTimeout, and React Native's JS timers stop with the screen locked (Android). With
//    clockSource 'offline' Tone starts no timer of its own; startTone() emits its 'tick' from createAudioClock, which the
//    audio thread drives.
//  - Its AudioWorklet effects load their processors from a Blob URL. installToneWorklets() registers C++ versions under
//    the same names, so BitCrusher, FeedbackCombFilter, JCReverb, Freeverb and PluckSynth work unchanged.
//  - Its feedback effects build a graph cycle, which react-native-audio-api silently drops. installToneFeedback() closes
//    those loops through a native bridge, so FeedbackDelay, PingPongDelay, Chorus and PitchShift repeat.
//  - react-native-audio-api's DelayNode ignores signals on delayTime. installToneDelay() gives Tone a C++ delay that
//    follows them.
//
// The web build of this module (index.web.ts) has the same exports on stock Tone.js, so app code needs no platform
// checks.

import { AudioContext } from 'react-native-audio-api';
import { setContext } from 'tone/build/esm/core/Global.js';
import { Context } from 'tone/build/esm/core/context/Context.js';
import { createAudioClock, type AudioClock } from '../clock/audioClock';
import { startBackgroundPlayback, type PlaybackNotificationInfo } from '../playback/backgroundPlayback';
import { installWebAudioCompat } from '../worklet/AudioWorkletNode';
import { installToneDelay } from './toneDelay';
import { installToneFeedback } from './toneFeedback';
import { installToneWorklets } from './toneWorklets';

export { FdnReverb, type FdnReverbOptions } from './FdnReverb';
export { QueuePlayer, type QueuePlayerOptions, type QueueChunkLoader } from './QueuePlayer';
export { TimeStretchPlayer } from './TimeStretchPlayer';

export interface StartToneOptions {
  // Android: show the playback notification that keeps audio running with the screen locked (default true). An object
  // sets the notification's text.
  backgroundPlayback?: boolean | PlaybackNotificationInfo;
  // Called with what a scheduled Tone callback throws (default: console.error). Playback carries on.
  onError?: (error: unknown) => void;
}

export interface ToneSetup {
  // The app's one react-native-audio-api AudioContext (with installWebAudioCompat applied).
  context: AudioContext;
  // Tone's context around it: what Tone.getContext() returns.
  toneContext: Context;
}

installToneWorklets();
installToneFeedback();
installToneDelay();
const context = new AudioContext();
installWebAudioCompat(context);
const toneContext = new Context({ context: context as any, clockSource: 'offline', lookAhead: 0.1 });
setContext(toneContext);

// The audio clock's resolution: Tone gets a tick whenever its updateInterval has passed, checked this often.
const CHECK_MS = 10;

let clock: AudioClock | null = null;

export function getToneSetup(): ToneSetup {
  return { context, toneContext };
}

// Resumes the context and starts Tone's clock. Idempotent: later calls only resume the context again (e.g. after the
// app suspended it). Call it from a user action, as Tone.start() in a browser.
export async function startTone(options: StartToneOptions = {}): Promise<ToneSetup> {
  await context.resume();
  if (!clock) {
    clock = createAudioClock(context, { onError: options.onError });
    let last = 0;
    clock.setInterval(() => {
      const now = Date.now();
      if (now - last < toneContext.updateInterval * 1000 - CHECK_MS / 2) return;
      last = now;
      toneContext.emit('tick');
    }, CHECK_MS);
    const background = options.backgroundPlayback ?? true;
    if (background) void startBackgroundPlayback(background === true ? {} : background);
  }
  return { context, toneContext };
}
