// Shared by the Expo example app (React Native, through rn-web-audio-compat) and the web demo (the browser's own Web
// Audio API): one row per piece of the Web Audio API, with a self-test written against the standard API only, so the
// same test runs on both and the web result is the reference.

export type Coverage = 'yes' | 'partial' | 'no';
export type StrudelUse = 'yes' | 'opt-in' | 'no';
export type ToneUse = 'yes' | 'opt-in' | 'no';

export interface TestEnv {
  platform: 'native' | 'web';
  // A running context (on native, already given installWebAudioCompat()).
  createContext(options?: { sampleRate?: number }): Promise<any>;
  closeContext(ctx: any): Promise<void>;
  // One running context kept for the app's lifetime and never closed, made with createEventContext() before any other
  // context emits an event (the app makes it at launch; Run all awaits it first). Rows with `needsEvents` run on it: on
  // react-native-audio-api 1.0.1 only the first few contexts to emit an event ever get any (docs/FINDINGS.md), so a
  // fresh context per row would see none.
  eventContext(): Promise<any>;
  sleep(ms: number): Promise<void>;
  // Makes the 'rnwac-test-gain' processor available on ctx (native: registered JS module; web: addModule of a Blob URL).
  prepareTestWorklet(ctx: any): Promise<void>;
  // Play measured signals through the speakers (quietly) instead of silently.
  audible: boolean;
}

export interface TestContext {
  ctx: any;
  env: TestEnv;
  // Throws with `message` unless `condition`.
  expect(condition: unknown, message: string): void;
  // RMS / peak of `node`'s output over roughly `ms` milliseconds, measured with an AnalyserNode.
  measure(node: any, ms?: number): Promise<{ rms: number; peak: number }>;
  // A running ConstantSourceNode with the given offset.
  constant(offset: number): any;
  // A running sine OscillatorNode.
  sine(frequency: number): any;
}

// Returns a short human-readable result; throws on failure.
export type ConformanceTest = (t: TestContext) => Promise<string> | string;

export interface CoverageRow {
  id: string;
  group: string;
  name: string; // markdown, e.g. "`createGain()`"
  covered: Coverage;
  how: string; // how React Native gets it (markdown)
  source?: string; // where it is implemented (markdown links, relative to the repo root)
  strudel: StrudelUse; // used by Strudel/superdough
  tone: ToneUse; // used by Tone.js (15.1.22)
  toneVia?: string; // which Tone.js classes use it (markdown)
  savings?: string;
  // The test waits for an audio-thread event (e.g. `onended`): run it on env.eventContext() instead of a fresh context.
  // Such a test must leave that context running and nothing playing on it.
  needsEvents?: boolean;
  test?: ConformanceTest; // absent for rows that aren't implemented (their demo buttons are disabled)
}

export interface TestResult {
  ok: boolean;
  detail: string;
  ms: number;
}
