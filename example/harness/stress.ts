// EXPO_PUBLIC_AUTORUN=stress: the stress tests for two native crashes fixed by the react-native-audio-api patch up to
// 0.13.6, whose code 1.0 rewrote (docs/FINDINGS.md "Crashes fixed in the native patch"). Passing means the app is still
// alive and rendering at the end; a crash shows as the log stopping (read `adb logcat -b crash`). Lines are tagged
// [STRESS].
//
// 1. Context cycles with worklet nodes: create a context hosting a JS worklet node and a C++ kernel node, play briefly,
//    close it, drop it; churn garbage so Hermes collects the closed ones. Up to 0.13.6 this crashed in worklets'
//    SerializableJSRef / jsi::Value::~Value (cycle 15 in one run, 155 in another), and creating nodes while the audio
//    thread ran worklet jobs on an unlocked runtime crashed Hermes.
// 2. Releasing LFO-modulated filters: oscillator -> gain -> filter.frequency on one long-lived context, then release
//    the modulator, the filter, or both, in every order, while other filters keep rendering. Up to 0.13.6 the render
//    thread dereferenced a freed modulator (SIGSEGV in AudioParam::processInputs).
import { AudioContext } from 'react-native-audio-api';
import {
  AudioWorkletNode,
  createFdnReverbNode,
  FeedbackDelayNode,
  installWebAudioCompat,
  registerWorkletProcessor,
} from 'rn-web-audio-compat';
import { TEST_PROCESSOR, testGainModule } from '../../conformance/testWorklet';
import { describe, log, setLogTag, sleep, step, check } from './log';

const CONTEXT_CYCLES = 300;
const RELEASE_ROUNDS = 400;

registerWorkletProcessor(TEST_PROCESSOR, testGainModule);

// Garbage for Hermes to collect: enough short-lived objects to trigger a collection every few cycles.
let sink = 0;
function churn() {
  for (let i = 0; i < 2000; i++) sink += [i, { i }, `s${i}`].length;
}
const gc = (globalThis as { gc?: () => void }).gc;

async function rms(ctx: AudioContext, node: { connect: (n: any) => unknown; disconnect: (n?: any) => void }) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(analyser);
  analyser.connect(mute);
  mute.connect(ctx.destination);
  await sleep(200);
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  node.disconnect(analyser);
  analyser.disconnect();
  mute.disconnect();
  let sum = 0;
  for (const x of buf) sum += x * x;
  return Math.sqrt(sum / buf.length);
}

async function contextCycles() {
  log(`context cycles: ${CONTEXT_CYCLES}, gc() ${gc ? 'available' : 'not exposed (churning garbage instead)'}`);
  const t0 = Date.now();
  for (let i = 1; i <= CONTEXT_CYCLES; i++) {
    const ctx = new AudioContext();
    installWebAudioCompat(ctx);
    await ctx.resume();
    await (ctx as any).audioWorklet.addModule(TEST_PROCESSOR); // resolves; the processor is registered above
    const osc = ctx.createOscillator();
    const worklet = new AudioWorkletNode(ctx, TEST_PROCESSOR);
    worklet.parameters.get('gain')!.value = 0.5;
    // Kernel nodes are typed loosely (they aren't react-native-audio-api AudioNodes); they connect like any node.
    const reverb: any = createFdnReverbNode(ctx, { decayTime: 1 });
    const delay = new FeedbackDelayNode(ctx, 0.3, 0.05, 0.4);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    osc.connect(worklet);
    worklet.connect(reverb);
    reverb.connect(delay);
    delay.connect(mute);
    mute.connect(ctx.destination);
    osc.start();
    // Create more worklet nodes while the audio thread is already running the first one (the unlocked-runtime crash).
    for (let k = 0; k < 3; k++) new AudioWorkletNode(ctx, TEST_PROCESSOR).connect(mute);
    await sleep(30);
    osc.stop();
    await ctx.close();
    churn();
    if (i % 10 === 0) gc?.();
    if (i % 25 === 0) log(`context cycle ${i}/${CONTEXT_CYCLES} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
}

async function releaseModulatedFilters() {
  const ctx = new AudioContext();
  installWebAudioCompat(ctx);
  await ctx.resume();
  const mute = ctx.createGain();
  mute.gain.value = 0;
  mute.connect(ctx.destination);
  const source = ctx.createOscillator();
  source.type = 'sawtooth';
  source.start();

  // A few filters that stay up the whole time, modulated by LFOs that also stay, so the render thread keeps walking
  // param inputs while others are released around it.
  for (let k = 0; k < 3; k++) {
    const f = ctx.createBiquadFilter();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 2 + k;
    const depth = ctx.createGain();
    depth.gain.value = 400;
    lfo.connect(depth);
    depth.connect(f.frequency);
    lfo.start();
    source.connect(f);
    f.connect(mute);
  }

  const modes = ['modulator first', 'filter first', 'both at once', 'stop only (no disconnect)'] as const;
  log(`release rounds: ${RELEASE_ROUNDS} (${modes.join(', ')})`);
  for (let i = 1; i <= RELEASE_ROUNDS; i++) {
    const live = [];
    for (let k = 0; k < 4; k++) {
      const f = ctx.createBiquadFilter();
      f.frequency.value = 800;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5 + k;
      const depth = ctx.createGain();
      depth.gain.value = 600;
      lfo.connect(depth);
      depth.connect(f.frequency);
      // A second modulator on Q, so a param has more than one input.
      const lfo2 = ctx.createOscillator();
      lfo2.frequency.value = 0.5;
      lfo2.connect(f.Q);
      lfo.start();
      lfo2.start();
      source.connect(f);
      f.connect(mute);
      live.push({ f, lfo, depth, lfo2 });
    }
    await sleep(15);
    const mode = modes[i % modes.length];
    for (const { f, lfo, depth, lfo2 } of live) {
      if (mode === 'modulator first') {
        depth.disconnect();
        lfo.stop();
        lfo2.disconnect();
        await sleep(2);
        source.disconnect(f);
        f.disconnect();
      } else if (mode === 'filter first') {
        source.disconnect(f);
        f.disconnect();
        await sleep(2);
        depth.disconnect();
        lfo.stop();
        lfo2.stop();
      } else if (mode === 'both at once') {
        source.disconnect(f);
        f.disconnect();
        depth.disconnect();
        lfo2.disconnect();
        lfo.stop();
      } else {
        lfo.stop();
        lfo2.stop();
        source.disconnect(f);
      }
    }
    churn();
    if (i % 10 === 0) gc?.();
    if (i % 50 === 0) log(`release round ${i}/${RELEASE_ROUNDS}`);
  }

  // Still rendering afterwards: a fresh tone through the same context.
  const probe = ctx.createOscillator();
  probe.start();
  const level = await rms(ctx, probe);
  probe.stop();
  check(level > 0.3, `the context still renders (rms ${level.toFixed(3)})`);
  log(`after the release rounds: probe rms ${level.toFixed(3)}`);
}

let started: Promise<void> | null = null;
export function startStress(): Promise<void> {
  setLogTag('[STRESS]');
  started ??= (async () => {
    log(`start ${new Date().toISOString()}`);
    // The release test first: it uses one long-lived context, the app's first, so it isn't affected by the
    // event-queue limit the context cycles run into (it doesn't need events anyway).
    await step(`release LFO-modulated filters x${RELEASE_ROUNDS}`, releaseModulatedFilters);
    await step(`context cycles with worklet + kernel nodes x${CONTEXT_CYCLES}`, contextCycles);
    log('DONE');
  })().catch((err) => log(`FAIL aborted: ${describe(err)}`));
  return started;
}
