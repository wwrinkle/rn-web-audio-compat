// Native-side diagnostics from this library's native module (common/cpp/rnwac): which C++ kernels exist in this build,
// and per-kernel cost on the audio thread.
//
// Whole-graph render cost (the old "audio load", entry id 0) is gone: measuring it meant patching react-native-audio-
// api's AudioDestinationNode, and since 1.0 this library uses its stable extension API instead of patches. AudioLoad
// keeps those fields as null and adds kernelLoadPct (time spent in this library's kernels / real time).

import {
  ensureNativeModule,
  nativeKernelTimings,
  resetNativeKernelTimings,
  type NativeKernelTiming,
} from '../native/nativeModule';

export type TimingEntry = NativeKernelTiming;

// The `context` arguments below are kept for API compatibility; timings are process-wide.

export function isNativeModuleInstalled(_context?: unknown): boolean {
  return ensureNativeModule();
}

/** @deprecated Since react-native-audio-api 1.0 there is no patch; use isNativeModuleInstalled. */
export const isNativePatchInstalled = isNativeModuleInstalled;

export function getNativeTimings(_context?: unknown): TimingEntry[] {
  return nativeKernelTimings();
}

export function resetNativeTimings(_context?: unknown): void {
  resetNativeKernelTimings();
}

// Names of the C++ kernels compiled into this build (built-ins plus any extension library's).
export function registeredNativeKernels(_context?: unknown): string[] {
  return nativeKernelTimings().map((e) => e.name);
}

// Throws a clear error if the native module or any of the named kernels is missing (instead of silently producing
// silence later). Call once at startup.
export function assertNativeKernels(_context: unknown, names: string[], owner = 'rn-web-audio-compat'): void {
  if (!ensureNativeModule()) {
    throw new Error(
      `${owner}: rn-web-audio-compat's native module is not in this build (it needs the New Architecture). ` +
        'Rebuild the native app.'
    );
  }
  const have = new Set(registeredNativeKernels());
  const missing = names.filter((n) => !have.has(n));
  if (missing.length) {
    throw new Error(
      `${owner}: native kernels missing from this build: ${missing.join(', ')}. Re-run the extension's install step ` +
        '(npm install) and rebuild.'
    );
  }
}

export interface AudioLoad {
  kernelLoadPct: number; // time in this library's kernels / real time of the window
  // Whole-graph figures; no longer measurable without patching react-native-audio-api (see the header comment).
  loadPct: null;
  maxLoadPct: null;
  overBudget: null;
  usPer128Frames: null;
  callbacks: null;
  kernels: TimingEntry[]; // kernels that ran in the window
}

// Measures kernel cost over a window. `sleep` must keep working with the screen off if you measure then (use an
// AudioClock-based sleep on Android, not setTimeout).
export async function measureAudioLoad(
  _context: unknown,
  seconds: number,
  sleep: (ms: number) => Promise<void>
): Promise<AudioLoad | null> {
  if (!ensureNativeModule()) return null;
  resetNativeKernelTimings();
  const start = Date.now();
  await sleep(seconds * 1000);
  const elapsedUs = (Date.now() - start) * 1000;
  const kernels = nativeKernelTimings().filter((e) => e.count > 0);
  const kernelUs = kernels.reduce((sum, e) => sum + e.avgUs * e.count, 0);
  return {
    kernelLoadPct: elapsedUs > 0 ? (kernelUs / elapsedUs) * 100 : 0,
    loadPct: null,
    maxLoadPct: null,
    overBudget: null,
    usPer128Frames: null,
    callbacks: null,
    kernels,
  };
}
