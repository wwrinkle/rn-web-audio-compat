// Native-side diagnostics exposed by the react-native-audio-api patch (BaseAudioContext.getKernelTimings /
// resetKernelTimings): whole-graph render cost ("audio load") and per-kernel cost, and which C++ kernels exist.

export interface TimingEntry {
  id: number;
  name: string;
  count: number;
  avgUs: number;
  maxUs: number;
  // Only on entry id 0 (the whole render callback).
  frames?: number;
  loadPct?: number;
  maxLoadPct?: number;
  overBudget?: number;
}

interface TimingContext {
  getKernelTimings?: () => TimingEntry[];
  resetKernelTimings?: () => void;
}

export function isNativePatchInstalled(context: unknown): boolean {
  return typeof (context as TimingContext).getKernelTimings === 'function';
}

export function getNativeTimings(context: unknown): TimingEntry[] {
  const fn = (context as TimingContext).getKernelTimings;
  return fn ? fn.call(context) : [];
}

export function resetNativeTimings(context: unknown): void {
  (context as TimingContext).resetKernelTimings?.call(context);
}

// Names of the C++ kernels compiled into this build (built-ins plus any extension library's).
export function registeredNativeKernels(context: unknown): string[] {
  return getNativeTimings(context)
    .filter((e) => e.id !== 0)
    .map((e) => e.name);
}

// Throws a clear error if the native patch or any of the named kernels is missing (instead of silently producing
// silence later). Call once at startup.
export function assertNativeKernels(context: unknown, names: string[], owner = 'rn-web-audio-compat'): void {
  if (!isNativePatchInstalled(context)) {
    throw new Error(
      `${owner}: react-native-audio-api is not patched (getKernelTimings missing). Run the apply-native step ` +
        '(npx rn-web-audio-compat-apply) and rebuild the native app.'
    );
  }
  const have = new Set(registeredNativeKernels(context));
  const missing = names.filter((n) => !have.has(n));
  if (missing.length) {
    throw new Error(`${owner}: native kernels missing from this build: ${missing.join(', ')}. Re-run the apply step and rebuild.`);
  }
}

export interface AudioLoad {
  loadPct: number; // average render time / real time of the rendered audio
  maxLoadPct: number; // worst single callback
  overBudget: number; // callbacks that took longer than the audio they produced
  usPer128Frames: number;
  callbacks: number;
  kernels: TimingEntry[]; // kernels that ran in the window
}

// Measures the audio thread over a window. `sleep` must keep working with the screen off if you measure then (use an
// AudioClock-based sleep on Android, not setTimeout).
export async function measureAudioLoad(
  context: unknown,
  seconds: number,
  sleep: (ms: number) => Promise<void>
): Promise<AudioLoad | null> {
  resetNativeTimings(context);
  await sleep(seconds * 1000);
  const entries = getNativeTimings(context);
  const render = entries.find((e) => e.id === 0);
  if (!render || !render.frames) return null;
  return {
    loadPct: render.loadPct ?? 0,
    maxLoadPct: render.maxLoadPct ?? 0,
    overBudget: render.overBudget ?? 0,
    usPer128Frames: ((render.avgUs * render.count) / render.frames) * 128,
    callbacks: render.count,
    kernels: entries.filter((e) => e.id !== 0 && e.count > 0),
  };
}
