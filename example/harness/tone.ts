// EXPO_PUBLIC_AUTORUN=tone: Tone.js on React Native through rn-web-audio-compat/tone. Lines are tagged [TONE].
//
//  1. Setup and a set of Tone instruments and effects, each PASS/FAIL on its own.
//  2. Many reverbs: Tone.Reverb renders its impulse response in a new OfflineAudioContext every time, and on
//     react-native-audio-api 1.0.1 every context permanently takes a block of the event queue the audio clock runs on
//     (docs/FINDINGS.md). After each reverb: does the transport still advance?
//  3. Timing: a STATUS line every 5 s comparing transport events with the wall clock, driven by Tone's own context
//     (and so by the audio clock), for the screen-lock test.
import 'rn-web-audio-compat/tone'; // before 'tone'
import * as Tone from 'tone';
import { getToneSetup, startTone } from 'rn-web-audio-compat/tone';
import { describe, log, setLogTag, sleep, step, check } from './log';

const BPM = 120;
const EVENTS_PER_SECOND = (BPM / 60) * 2; // scheduleRepeat at '8n'
const REVERBS = 12;

const withTimeout = <T>(promise: Promise<T>, ms: number, what: string) =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)),
  ]);

let events = 0;

// Transport events over `ms` of wall-clock time (screen on: setTimeout is fine here).
async function eventRate(ms = 2000): Promise<number> {
  const before = events;
  await sleep(ms);
  return ((events - before) * 1000) / ms;
}

async function run() {
  log(`start ${new Date().toISOString()}`);
  const { context, toneContext } = getToneSetup();
  await step('Tone.getContext() is the one set up by rn-web-audio-compat/tone', () =>
    check(Tone.getContext() === toneContext && toneContext.rawContext === (context as unknown), 'the same contexts')
  );
  await step('startTone()', async () => {
    await startTone({ backgroundPlayback: { title: 'Tone.js harness' }, onError: (e) => log(`FAIL tick: ${describe(e)}`) });
    check(Tone.getContext().state === 'running', `state running, got ${Tone.getContext().state}`);
  });
  await step("Tone's Listener on react-native-audio-api's AudioListener", () =>
    check(Tone.getContext().listener.positionX.value === 0, 'positionX 0')
  );

  const out = await step('Volume -> Destination', () => new Tone.Volume(-8).toDestination());
  if (!out) return;
  const fx = (await step('Compressor', () => new Tone.Compressor(-24, 4).connect(out))) ?? out;
  await step('PingPongDelay (Split / Merge)', () => new Tone.PingPongDelay('8n', 0.3).connect(fx).dispose());
  await step('Chorus (stereo LFO delays)', () => new Tone.Chorus(4, 2.5, 0.5).connect(fx).start().dispose());
  await step('Panner3D (PannerNode)', () => {
    const p = new Tone.Panner3D({ positionX: 1, panningModel: 'equalpower' }).connect(fx);
    check(p.positionX.value === 1, 'positionX 1');
    p.dispose();
  });
  // Expected to fail: Tone loads this worklet's processor from a Blob URL (COVERAGE.md, Tone.js gaps).
  await step('Freeverb (expected FAIL: Blob URL worklet)', () => new Tone.Freeverb().dispose());

  const fm = await step('FMSynth', () =>
    new Tone.FMSynth({
      harmonicity: 3.95,
      modulationIndex: 5.5,
      envelope: { attack: 0.005, decay: 2, sustain: 0, release: 2 },
    }).connect(fx)
  );
  const membrane = await step('MembraneSynth', () =>
    new Tone.MembraneSynth({ pitchDecay: 0.022, octaves: 4, envelope: { decay: 0.2, sustain: 0 } }).connect(fx)
  );
  const poly = await step('PolySynth(Synth)', () => new Tone.PolySynth(Tone.Synth).connect(fx));
  const noiseFilter = await step('Filter + LFO on frequency', () => {
    const f = new Tone.Filter(800, 'lowpass').connect(fx);
    new Tone.LFO({ frequency: 0.25, min: 500, max: 2000 }).connect(f.frequency).start();
    return f;
  });
  const noise = await step('NoiseSynth (brown)', () =>
    new Tone.NoiseSynth({ noise: { type: 'brown' }, envelope: { attack: 0.5, decay: 0.5, sustain: 0.3, release: 1 } })
      .connect(noiseFilter ?? fx)
  );
  const sampler = await step('Sampler (generated C4 buffer, repitched)', async () => {
    const seconds = 1.5;
    const buffer = context.createBuffer(1, Math.round(context.sampleRate * seconds), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / context.sampleRate;
      data[i] = Math.sin(2 * Math.PI * 261.63 * t) * Math.exp(-3 * t) * 0.5;
    }
    const s = new Tone.Sampler({ urls: { C4: buffer as unknown as AudioBuffer } }).connect(fx);
    await withTimeout(Tone.loaded(), 5000, 'Tone.loaded()');
    return s;
  });

  const transport = Tone.getTransport();
  transport.bpm.value = BPM;
  const scale = ['G3', 'A3', 'B3', 'D4', 'E4', 'G4'];
  const ok = await step('Transport.scheduleRepeat + start', () => {
    transport.scheduleRepeat((time: number) => {
      const i = events++;
      if (membrane && i % 8 === 0) membrane.triggerAttackRelease('G2', '16n', time);
      if (sampler && i % 2 === 1) sampler.triggerAttackRelease(scale[(i * 3) % scale.length], '8n', time, 0.6);
      if (fm && i % 16 === 4) fm.triggerAttackRelease('E4', '2n', time, 0.4);
      if (poly && i % 16 === 12) poly.triggerAttackRelease(['B3', 'D4', 'G4'], '4n', time, 0.25);
      if (noise && i % 32 === 0) noise.triggerAttackRelease('2m', time, 0.15);
    }, '8n');
    transport.start('+0.1');
    return true;
  });
  if (!ok) return;
  await step(`transport advances (~${EVENTS_PER_SECOND} events/s)`, async () => {
    const rate = await eventRate();
    check(Math.abs(rate - EVENTS_PER_SECOND) <= 1, `~${EVENTS_PER_SECOND}/s, got ${rate.toFixed(1)}`);
    return rate;
  });

  // 2. Many reverbs, each its own OfflineAudioContext.
  let reverbIn: Tone.ToneAudioNode = fx;
  for (let i = 1; i <= REVERBS; i++) {
    const t0 = Date.now();
    const r = await step(`Reverb #${i}: impulse response rendered offline`, async () => {
      const reverb = new Tone.Reverb({ decay: 1 + i * 0.25, wet: 0.3 });
      await withTimeout(reverb.ready, 8000, 'reverb.ready');
      return reverb;
    });
    const rate = await eventRate(1500);
    log(`after reverb #${i} (${r ? `ready in ${Date.now() - t0} ms` : 'failed'}): transport ${rate.toFixed(1)} events/s`);
    if (Math.abs(rate - EVENTS_PER_SECOND) > 1) {
      log(`FAIL transport stalled after reverb #${i} (${rate.toFixed(1)} events/s)`);
      break;
    }
    if (r) {
      // Keep the latest in the chain (the music's reverb), drop the previous one.
      if (reverbIn !== fx) reverbIn.dispose();
      r.connect(fx);
      reverbIn = r;
      fm?.disconnect().connect(r);
      sampler?.disconnect().connect(r);
    }
  }
  log(`PASS reverbs done: ${REVERBS} offline contexts`);

  // 3. Timing, driven by Tone's context (so by the audio clock): keeps going with the screen locked.
  const tWall = Date.now();
  const e0 = events;
  log('timing: STATUS every 5 s');
  Tone.getContext().setInterval(() => {
    const elapsed = (Date.now() - tWall) / 1000;
    const expected = Math.round(elapsed * EVENTS_PER_SECOND);
    log(
      `STATUS t=${elapsed.toFixed(1)}s events=${events - e0} expected~${expected} ` +
        `ctxTime=${context.currentTime.toFixed(2)} transport=${transport.seconds.toFixed(2)} state=${transport.state}`
    );
  }, 5);
}

let started: Promise<void> | null = null;
export function startToneHarness(): Promise<void> {
  setLogTag('[TONE]');
  started ??= run().catch((err) => log(`FAIL aborted: ${describe(err)}`));
  return started;
}
