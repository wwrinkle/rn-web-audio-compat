// rn-web-audio-compat/tone in a browser: the same exports as index.ts, on stock Tone.js and the browser's own Web Audio
// API, so app code that runs on both needs no platform checks. Nothing to set up: Tone makes its own context.

import { getContext, start } from 'tone';
import type { Context } from 'tone';

export interface StartToneOptions {
  backgroundPlayback?: unknown; // React Native only
  onError?: (error: unknown) => void; // React Native only: in a browser, Tone's own clock reports errors
}

export interface ToneSetup {
  context: any; // the browser's AudioContext (typed loosely: React Native's TS config, which checks this file, has no DOM)
  toneContext: Context;
}

export function getToneSetup(): ToneSetup {
  const toneContext = getContext() as Context;
  return { context: toneContext.rawContext, toneContext };
}

export async function startTone(_options: StartToneOptions = {}): Promise<ToneSetup> {
  await start();
  return getToneSetup();
}
