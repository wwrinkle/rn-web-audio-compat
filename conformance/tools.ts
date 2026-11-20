import type { ConformanceTest, CoverageRow, TestContext, TestEnv, TestResult } from './types';

export async function runRow(row: CoverageRow, env: TestEnv): Promise<TestResult> {
  const started = Date.now();
  if (!row.test) return { ok: false, detail: 'not implemented', ms: 0 };
  let ctx: any = null;
  try {
    ctx = row.needsEvents ? await env.eventContext() : await env.createContext();
    const t = makeTestContext(ctx, env);
    const detail = await row.test(t);
    return { ok: true, detail, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, detail: String((err as Error)?.message ?? err), ms: Date.now() - started };
  } finally {
    if (ctx && !row.needsEvents) {
      try {
        await env.closeContext(ctx);
      } catch {
        // ignore
      }
    }
  }
}

// Fires one `onended` on `ctx` and reports whether it arrived within 400 ms.
async function firesOnended(ctx: any, env: TestEnv): Promise<boolean> {
  let ended = false;
  const c = ctx.createConstantSource();
  c.onended = () => {
    ended = true;
  };
  c.start();
  c.stop(ctx.currentTime + 0.05);
  await env.sleep(400);
  return ended;
}

// The context behind TestEnv.eventContext(). On react-native-audio-api 1.0.1 a context's event producer claims a block
// of the event queue on its first audio-thread event, never before, and blocks are never given back (docs/FINDINGS.md).
// Firing an event right away claims one while blocks are left; the producer then reuses it for good.
export async function createEventContext(env: TestEnv): Promise<any> {
  const ctx = await env.createContext();
  await firesOnended(ctx, env);
  return ctx;
}

// Upstream canary for that exhaustion. Run it after the whole suite, which has made far more contexts than the queue
// has blocks: a fresh context's `onended` still firing means upstream fixed it, and `needsEvents` can go.
export async function probeFreshContextEvents(env: TestEnv): Promise<boolean> {
  const ctx = await env.createContext();
  try {
    return await firesOnended(ctx, env);
  } finally {
    try {
      await env.closeContext(ctx);
    } catch {
      // ignore
    }
  }
}

export const EVENT_CANARY =
  'upstream: a fresh context after the suite gets onended (react-native-audio-api never recycles event-queue blocks; docs/FINDINGS.md)';

export function makeTestContext(ctx: any, env: TestEnv): TestContext {
  const expect = (condition: unknown, message: string): void => {
    if (!condition) throw new Error(message);
  };
  const measure = async (node: any, ms = 250): Promise<{ rms: number; peak: number }> => {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const out = ctx.createGain();
    out.gain.value = env.audible ? 0.25 : 0;
    node.connect(analyser);
    analyser.connect(out);
    out.connect(ctx.destination);
    await env.sleep(ms);
    const buf = new Float32Array(analyser.fftSize);
    let sum = 0;
    let peak = 0;
    // Average a few reads so one quiet window doesn't decide the result.
    for (let k = 0; k < 3; k++) {
      analyser.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) {
        sum += buf[i] * buf[i];
        peak = Math.max(peak, Math.abs(buf[i]));
      }
      await env.sleep(20);
    }
    try {
      node.disconnect(analyser);
    } catch {
      // some nodes only support disconnect()
    }
    analyser.disconnect();
    out.disconnect();
    return { rms: Math.sqrt(sum / (3 * buf.length)), peak };
  };
  const constant = (offset: number): any => {
    const c = ctx.createConstantSource();
    c.offset.value = offset;
    c.start();
    return c;
  };
  const sine = (frequency: number): any => {
    const o = ctx.createOscillator();
    o.frequency.value = frequency;
    o.start();
    return o;
  };
  return { ctx, env, expect, measure, constant, sine };
}

export const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
export const fmt = (x: number, digits = 3): string => x.toFixed(digits);

export function summarize(results: Map<string, TestResult>, rows: CoverageRow[]): string {
  const tested = rows.filter((r) => r.test);
  const passed = tested.filter((r) => results.get(r.id)?.ok).length;
  return `${passed}/${tested.length} passed (${rows.length - tested.length} not implemented)`;
}

export type { ConformanceTest };
