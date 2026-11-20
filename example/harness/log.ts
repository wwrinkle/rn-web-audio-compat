// The device harnesses' log (EXPO_PUBLIC_AUTORUN=stress / tone): each line goes to the device log with a tag, for
// `adb logcat ReactNativeJS:V`, and to the screen (LogScreen subscribes with useSyncExternalStore).
let lines: readonly string[] = [];
const listeners = new Set<() => void>();
let tag = '[HARNESS]';

export function setLogTag(next: string) {
  tag = next;
}

export function log(message: string) {
  console.log(`${tag} ${message}`);
  lines = [...lines.slice(-300), message];
  for (const listener of [...listeners]) listener();
}

export const logLines = {
  getSnapshot: () => lines,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const describe = (err: unknown) => {
  const e = err as Error;
  return e?.stack ? `${e.message}\n${e.stack.split('\n').slice(0, 6).join('\n')}` : String(err);
};

// Runs one named check: PASS, or FAIL with the error. Returns the result, or undefined on failure.
export async function step<T>(name: string, fn: () => T | Promise<T>): Promise<T | undefined> {
  try {
    const result = await fn();
    log(`PASS ${name}`);
    return result;
  } catch (err) {
    log(`FAIL ${name}: ${describe(err)}`);
    return undefined;
  }
}

export function check(condition: unknown, what: string) {
  if (!condition) throw new Error(`expected ${what}`);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
