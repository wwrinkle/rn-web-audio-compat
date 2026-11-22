// EXPO_PUBLIC_AUTORUN=tone: Tone.js on React Native through rn-web-audio-compat/tone. Lines are tagged [TONE].
//
//  1. Setup and a set of Tone instruments and effects, each PASS/FAIL on its own.
//  2. Many reverbs: Tone.Reverb renders its impulse response in a new OfflineAudioContext every time, and on
//     react-native-audio-api 1.0.1 every context permanently takes a block of the event queue the audio clock runs on
//     (docs/FINDINGS.md). After each reverb: does the transport still advance?
//  3. Tone's AudioWorklet effects: BitCrusher, JCReverb, Freeverb, PluckSynth (C++ kernels under Tone's processor names).
//     Feedback effects (FeedbackDelay, PingPongDelay, Chorus, PitchShift), TimeStretchPlayer and QueuePlayer.
//  4. Sequencing: Sequence, Part, Loop and Pattern (order, sample-clock times, stop/restart, pause, tempo, audible output).
//  5. Timing: a STATUS line every 5 s comparing transport and sequencer events with the wall clock, driven by Tone's own
//     context (and so by the audio clock), for the screen-lock test.
import 'rn-web-audio-compat/tone'; // before 'tone'
import * as Tone from 'tone';
import { getNativeTimings } from 'rn-web-audio-compat';
import { FdnReverb, QueuePlayer, TimeStretchPlayer, getToneSetup, startTone } from 'rn-web-audio-compat/tone';
import { describe, log, setLogTag, sleep, step, check } from './log';

const BPM = 120;
const EVENTS_PER_SECOND = (BPM / 60) * 2; // scheduleRepeat at '8n'
const REVERBS = 12;
const PAUSE_ROUNDS = 20;

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

// Largest distance between callback times (relative to the first) and the expected offsets.
function timingError(times: number[], offsets: number[]) {
  check(times.length >= offsets.length, `${offsets.length} events, got ${times.length}`);
  return Math.max(...offsets.map((offset, i) => Math.abs(times[i] - times[0] - offset)));
}
const TIMING_TOLERANCE = 0.002; // seconds

// A measuring output that the graph keeps rendering, silent on the speakers.
function measuringOutput() {
  const meter = new Tone.Meter({ normalRange: true, smoothing: 0 });
  const sink = new Tone.Gain(0).toDestination();
  meter.connect(sink);
  return { meter, dispose: () => (meter.dispose(), sink.dispose()) };
}

async function peakOver(meter: Tone.Meter, ms: number) {
  let peak = 0;
  for (let t = 0; t < ms; t += 25) {
    await sleep(25);
    peak = Math.max(peak, meter.getValue() as number);
  }
  return peak;
}

// A reverb must ring on after a short burst of noise has ended.
async function reverbTail(effect: Tone.ToneAudioNode, minimum = 0.002) {
  const { meter, dispose } = measuringOutput();
  effect.connect(meter);
  const noise = new Tone.Noise('white').connect(effect);
  await sleep(200); // Tone creates the worklet nodes asynchronously
  const now = Tone.now();
  noise.start(now);
  noise.stop(now + 0.1);
  await sleep(350);
  const tail = await peakOver(meter, 400);
  noise.dispose();
  effect.dispose();
  dispose();
  check(tail >= minimum, `tail level ${tail.toFixed(4)}`);
  return tail;
}

async function workletEffects() {
  await step('BitCrusher quantizes to its bit depth', async () => {
    const crusher = new Tone.BitCrusher(2);
    const waveform = new Tone.Waveform(1024);
    const sink = new Tone.Gain(0).toDestination();
    const oscillator = new Tone.Oscillator(220, 'sine').connect(crusher);
    crusher.connect(waveform);
    waveform.connect(sink);
    oscillator.start();
    await sleep(400);
    const samples = Array.from(waveform.getValue() as Float32Array);
    oscillator.dispose();
    crusher.dispose();
    waveform.dispose();
    sink.dispose();
    const levels = new Set(samples.map((x) => (Math.round(x * 100) / 100 + 0).toFixed(2)));
    const peak = Math.max(...samples.map(Math.abs));
    check(levels.size >= 3 && levels.size <= 5 && peak > 0.9, `${levels.size} levels, peak ${peak.toFixed(3)}`);
    return levels.size;
  });
  await step('JCReverb rings after its input stops', () => reverbTail(new Tone.JCReverb({ roomSize: 0.6, wet: 1 })));
  await step('Freeverb rings after its input stops', () => reverbTail(new Tone.Freeverb({ roomSize: 0.8, wet: 1 })));
  await step('FdnReverb rings after its input stops', () => reverbTail(new FdnReverb({ decay: 3, wet: 1 })));
  await step('FdnReverb: a longer decay rings longer', async () => {
    const short = await reverbTail(new FdnReverb({ decay: 0.15, wet: 1 }), 0);
    const changed = new FdnReverb({ decay: 0.15, wet: 1 });
    changed.decay = 4;
    const long = await reverbTail(changed);
    check(long > short * 5, `short ${short.toFixed(4)}, long ${long.toFixed(4)}`);
  });
  await step('FdnReverb in a chain, wet 0 is dry', async () => {
    const { meter, dispose } = measuringOutput();
    const reverb = new FdnReverb({ decay: 3, wet: 0 });
    const oscillator = new Tone.Oscillator(220, 'sine').chain(reverb, meter);
    oscillator.start();
    await sleep(300);
    const dry = await peakOver(meter, 200);
    oscillator.stop();
    await sleep(300);
    const after = await peakOver(meter, 200);
    oscillator.dispose();
    reverb.dispose();
    dispose();
    check(dry > 0.5 && after < 0.002, `dry ${dry.toFixed(3)}, after ${after.toFixed(4)}`);
  });
  await step('PluckSynth: plucks, and its scheduled release decays', async () => {
    const { meter, dispose } = measuringOutput();
    const pluck = new Tone.PluckSynth({ release: 0.4 }).connect(meter);
    await sleep(200);
    pluck.triggerAttackRelease('C4', 0.3, Tone.now() + 0.05);
    const attack = await peakOver(meter, 300);
    await sleep(900);
    const released = await peakOver(meter, 200);
    pluck.dispose();
    dispose();
    check(attack > 0.01 && released < attack * 0.05, `attack ${attack.toFixed(4)}, after release ${released.toFixed(4)}`);
    return attack;
  });
  await step('Freeverb x20: create, render, dispose', async () => {
    for (let i = 0; i < 20; i++) {
      const reverb = new Tone.Freeverb();
      const noise = new Tone.Noise('pink').connect(reverb);
      reverb.toDestination();
      reverb.wet.value = 0;
      noise.volume.value = -60;
      noise.start();
      await sleep(60);
      noise.dispose();
      reverb.dispose();
    }
  });
  await step('Freeverb cost', async () => {
    const reverb = new Tone.Freeverb({ wet: 1 });
    const { meter, dispose } = measuringOutput();
    reverb.connect(meter);
    const noise = new Tone.Noise('pink').connect(reverb).start();
    await sleep(300);
    const before = getNativeTimings().find((t) => t.name === 'feedback-comb-filter');
    await sleep(2000);
    const after = getNativeTimings().find((t) => t.name === 'feedback-comb-filter');
    noise.dispose();
    reverb.dispose();
    dispose();
    log(`comb filter: avg ${after?.avgUs?.toFixed(2)} us, max ${after?.maxUs?.toFixed(0)} us, blocks ${(after?.count ?? 0) - (before?.count ?? 0)} in 2 s`);
    check(!!after && after.count > (before?.count ?? 0), 'the comb kernel rendered');
  });
}

// Level in a window that only the effect's feedback can reach, after a short burst of noise.
async function levelAfterBurst(effect: Tone.ToneAudioNode, fromMs: number, forMs: number) {
  const { meter, dispose } = measuringOutput();
  effect.connect(meter);
  const noise = new Tone.Noise('white').connect(effect);
  await sleep(150);
  const now = Tone.now();
  noise.start(now);
  noise.stop(now + 0.03);
  await sleep(100 + fromMs); // Tone.now() is 100 ms of lookahead ahead
  const level = await peakOver(meter, forMs);
  noise.dispose();
  effect.dispose();
  dispose();
  return level;
}

async function feedbackCheck(make: (feedback: number) => Tone.ToneAudioNode, fromMs: number, forMs: number) {
  const without = await levelAfterBurst(make(0), fromMs, forMs);
  const repeats = await levelAfterBurst(make(0.75), fromMs, forMs);
  check(repeats > 0.005 && repeats > without * 10, `with feedback ${repeats.toFixed(4)}, without ${without.toFixed(4)}`);
  return repeats;
}

function sineBuffer(context: { createBuffer: (c: number, l: number, r: number) => any; sampleRate: number }, hz: number, seconds: number, startFrame = 0) {
  const length = Math.round(seconds * context.sampleRate);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = 0.8 * Math.sin((2 * Math.PI * hz * (i + startFrame)) / context.sampleRate);
  return buffer;
}

function frequencyOf(samples: Float32Array, sampleRate: number) {
  let first = -1;
  let last = -1;
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] < 0 && samples[i] >= 0) {
      const at = i - samples[i] / (samples[i] - samples[i - 1]);
      if (first < 0) first = at;
      last = at;
      crossings++;
    }
  }
  return crossings > 1 ? ((crossings - 1) * sampleRate) / (last - first) : 0;
}

async function playedFrequency(player: Tone.Player, rate: number) {
  const waveform = new Tone.Waveform(4096);
  const sink = new Tone.Gain(0).toDestination();
  player.connect(waveform);
  waveform.connect(sink);
  player.playbackRate = rate;
  player.start();
  await sleep(800);
  const hz = frequencyOf(waveform.getValue() as Float32Array, Tone.getContext().sampleRate);
  player.dispose();
  waveform.dispose();
  sink.dispose();
  return hz;
}

async function nativeExtensions(context: ReturnType<typeof getToneSetup>['context']) {
  await step('FeedbackDelay repeats', () =>
    feedbackCheck((feedback) => new Tone.FeedbackDelay({ delayTime: 0.15, feedback, wet: 1 }), 380, 250));
  await step('PingPongDelay repeats', () =>
    feedbackCheck((feedback) => new Tone.PingPongDelay({ delayTime: 0.15, feedback, wet: 1 }), 520, 300));
  await step('Chorus feedback rings', () =>
    feedbackCheck((feedback) => new Tone.Chorus({ frequency: 1, delayTime: 8, depth: 0.1, feedback, wet: 1 }).start(), 90, 60));
  await step('PitchShift feedback repeats', () =>
    feedbackCheck((feedback) => new Tone.PitchShift({ pitch: 0, delayTime: 0.1, windowSize: 0.05, feedback, wet: 1 }), 380, 200));
  await step('Feedback effects x40: create, render, dispose', async () => {
    const makers = [
      () => new Tone.FeedbackDelay({ delayTime: 0.02, feedback: 0.7 }),
      () => new Tone.PingPongDelay({ delayTime: 0.02, feedback: 0.7 }),
      () => new Tone.Chorus({ frequency: 2, delayTime: 4, depth: 0.5, feedback: 0.5 }).start(),
      () => new Tone.PitchShift({ pitch: 3, feedback: 0.3 }),
    ];
    const sink = new Tone.Gain(0).toDestination();
    for (let i = 0; i < 40; i++) {
      const effect = makers[i % makers.length]().connect(sink);
      const noise = new Tone.Noise('pink').connect(effect).start();
      await sleep(50);
      noise.dispose();
      effect.dispose();
    }
    sink.dispose();
  });
  await step('TimeStretchPlayer keeps pitch at 1.5x (a Player does not)', async () => {
    const plain = await playedFrequency(new Tone.Player(sineBuffer(context, 440, 4) as unknown as AudioBuffer), 1.5);
    const stretched = await playedFrequency(new TimeStretchPlayer(sineBuffer(context, 440, 4) as unknown as AudioBuffer), 1.5);
    log(`playback at 1.5x: Player ${plain.toFixed(1)} Hz, TimeStretchPlayer ${stretched.toFixed(1)} Hz`);
    check(Math.abs(plain - 660) < 15 && Math.abs(stretched - 440) < 15, `Player ${plain.toFixed(1)}, stretched ${stretched.toFixed(1)}`);
  });
  await step('QueuePlayer: gapless chunks, then onended', async () => {
    const chunkSeconds = 0.25;
    const chunks = 8;
    const hz = 330;
    const frames = Math.round(chunkSeconds * context.sampleRate);
    let loads = 0;
    let endedAt = 0;
    const waveform = new Tone.Waveform(2048);
    const sink = new Tone.Gain(0).toDestination();
    waveform.connect(sink);
    const player = new QueuePlayer({
      load: async (index) => {
        if (index >= chunks) return null;
        loads++;
        await sleep(5);
        return sineBuffer(context, hz, chunkSeconds, index * frames);
      },
      onended: () => (endedAt = Date.now()),
    });
    player.connect(waveform);
    const t0 = Date.now();
    await player.start();
    await sleep(350);
    // A gap lowers the level of a 43 ms window; a discontinuity makes one sample-to-sample step too large.
    let lowestRms = 1;
    let largestStep = 0;
    while (Date.now() - t0 < 1700) {
      await sleep(20);
      const samples = waveform.getValue() as Float32Array;
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
        if (i > 0) largestStep = Math.max(largestStep, Math.abs(samples[i] - samples[i - 1]));
      }
      lowestRms = Math.min(lowestRms, Math.sqrt(sum / samples.length));
    }
    for (let i = 0; i < 80 && !endedAt; i++) await sleep(25);
    const seconds = (endedAt - t0) / 1000;
    player.dispose();
    waveform.dispose();
    sink.dispose();
    const expectedStep = (0.8 * 2 * Math.PI * hz) / context.sampleRate;
    log(`queue: ${loads} chunks, lowest rms ${lowestRms.toFixed(3)}, largest step ${largestStep.toFixed(4)} (sine ${expectedStep.toFixed(4)}), ended after ${seconds.toFixed(2)} s`);
    check(
      loads === chunks && lowestRms > 0.5 && largestStep < expectedStep * 1.2 && Math.abs(seconds - chunks * chunkSeconds) < 0.4,
      `${loads} chunks, rms ${lowestRms.toFixed(3)}, step ${largestStep.toFixed(4)}, ${seconds.toFixed(2)} s`
    );
  });
}

async function sequencing(fx: Tone.ToneAudioNode) {
  const transport = Tone.getTransport();
  await step('Sequence: nested subdivisions, rests, loop', async () => {
    const times: number[] = [];
    const notes: string[] = [];
    const seq = new Tone.Sequence<string | null>(
      (time, note) => {
        times.push(time);
        notes.push(String(note));
      },
      ['C4', ['E4', 'G4'], null, 'B4'],
      '4n'
    ).start('+0.1');
    await sleep(4400);
    seq.dispose();
    check(notes.slice(0, 8).join() === 'C4,E4,G4,B4,C4,E4,G4,B4', `order ${notes.slice(0, 8).join()}`);
    const error = timingError(times, [0, 0.5, 0.75, 1.5, 2, 2.5, 2.75, 3.5]);
    check(error < TIMING_TOLERANCE, `timing error ${(error * 1000).toFixed(2)} ms`);
    return error;
  });
  await step('Part: bars:beats:sixteenths, loop', async () => {
    const times: number[] = [];
    const notes: string[] = [];
    const part = new Tone.Part<[string, string]>(
      (time, note) => {
        times.push(time);
        notes.push(String(note));
      },
      [['0:0:0', 'C4'], ['0:1:0', 'E4'], ['0:2:2', 'G4']]
    );
    part.loop = true;
    part.loopEnd = '1m';
    part.start('+0.1');
    await sleep(4400);
    part.dispose();
    check(notes.slice(0, 6).join() === 'C4,E4,G4,C4,E4,G4', `order ${notes.slice(0, 6).join()}`);
    const error = timingError(times, [0, 0.5, 1.25, 2, 2.5, 3.25]);
    check(error < TIMING_TOLERANCE, `timing error ${(error * 1000).toFixed(2)} ms`);
  });
  await step('Pattern: upDown', async () => {
    const notes: string[] = [];
    const pattern = new Tone.Pattern<string>((_time, note) => notes.push(String(note)), ['a', 'b', 'c'], 'upDown');
    pattern.interval = '8n';
    pattern.start('+0.1');
    await sleep(1700);
    pattern.dispose();
    check(notes.slice(0, 5).join() === 'a,b,c,b,a', `order ${notes.slice(0, 5).join()}`);
  });
  await step('Loop: stop silences it, start resumes it', async () => {
    let count = 0;
    const loop = new Tone.Loop(() => count++, '8n').start('+0.1');
    await sleep(1200);
    const running = count;
    loop.stop();
    await sleep(300); // events already inside the lookahead window
    const stopped = count;
    await sleep(1000);
    check(running >= 3 && count === stopped, `ran ${running}, ${count - stopped} after stop`);
    loop.start('+0.1');
    await sleep(1000);
    check(count > stopped, 'resumed');
    loop.dispose();
    const disposed = count;
    await sleep(600);
    check(count <= disposed + 1, `${count - disposed} events after dispose`);
  });
  await step(`Transport: pause and resume x${PAUSE_ROUNDS}`, async () => {
    let failures = 0;
    for (let round = 1; round <= PAUSE_ROUNDS; round++) {
      let count = 0;
      let firstAt = 0;
      const loop = new Tone.Loop(() => {
        count++;
        firstAt ||= Date.now();
      }, '8n').start('+0.1');
      await sleep(800);
      const before = count;
      const pausedAtSeconds = transport.seconds;
      transport.pause();
      await sleep(300);
      const paused = count;
      await sleep(500);
      const whilePaused = count - paused;
      const mainBefore = events;
      firstAt = 0;
      const resumedAt = Date.now();
      transport.start();
      await sleep(800);
      const after = count - paused;
      // A silent loop: does it come back late, or never?
      if (after === 0) await sleep(2500);
      const ok = whilePaused === 0 && after > 0;
      if (!ok) failures++;
      log(
        `pause round ${round}: ${ok ? 'ok' : 'BAD'} before=${before} whilePaused=${whilePaused} after=${after} ` +
          `lateTotal=${count - paused} firstMs=${firstAt ? firstAt - resumedAt : 'none'} main=${events - mainBefore} ` +
          `pausedAt=${pausedAtSeconds.toFixed(3)} now=${transport.seconds.toFixed(3)} ` +
          `transport=${transport.state} loop=${loop.state} ctx=${Tone.getContext().currentTime.toFixed(3)}`
      );
      loop.dispose();
      await sleep(150);
    }
    check(failures === 0, `${failures}/${PAUSE_ROUNDS} rounds failed`);
  });
  // Last of the transport checks: after a tempo change, transport.seconds and ticks disagree, so a later '+0.1' start
  // lands late (Tone.js behaves the same in a browser).
  await step('Transport: tempo change respaces a Loop', async () => {
    const times: number[] = [];
    const loop = new Tone.Loop((time) => times.push(time), '8n').start('+0.1');
    transport.bpm.value = BPM / 2;
    await sleep(2600);
    loop.dispose();
    transport.bpm.value = BPM;
    const error = timingError(times, [0, 0.5, 1, 1.5]);
    check(error < TIMING_TOLERANCE, `timing error ${(error * 1000).toFixed(2)} ms`);
  });
  await step('Sequence drives audible output (Meter)', async () => {
    const meter = new Tone.Meter({ normalRange: true, smoothing: 0 });
    const synth = new Tone.Synth().connect(fx);
    synth.connect(meter);
    const seq = new Tone.Sequence((time, note) => synth.triggerAttackRelease(note as string, '16n', time, 0.5), ['A4', 'E5'], '8n').start('+0.1');
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      await sleep(50);
      peak = Math.max(peak, meter.getValue() as number);
    }
    seq.dispose();
    synth.dispose();
    meter.dispose();
    check(peak > 0.01, `level ${peak.toFixed(4)}`);
    return peak;
  });
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

  await workletEffects();
  await nativeExtensions(context);
  await sequencing(fx);

  // 2. Many reverbs, each its own OfflineAudioContext.
  let reverbIn: Tone.ToneAudioNode = fx;
  let stalled = false;
  let lastBeat = Date.now();
  let maxJsGap = 0;
  const heartbeat = setInterval(() => {
    const now = Date.now();
    maxJsGap = Math.max(maxJsGap, now - lastBeat);
    lastBeat = now;
  }, 20);
  for (let i = 1; i <= REVERBS; i++) {
    const t0 = Date.now();
    maxJsGap = 0;
    const r = await step(`Reverb #${i}: impulse response rendered offline`, async () => {
      const reverb = new Tone.Reverb({ decay: 1 + i * 0.25, wet: 0.3 });
      await withTimeout(reverb.ready, 8000, 'reverb.ready');
      return reverb;
    });
    const rate = await eventRate(1500);
    log(`after reverb #${i} (${r ? `ready in ${Date.now() - t0} ms` : 'failed'}): transport ${rate.toFixed(1)} events/s, longest JS stall ${maxJsGap} ms`);
    if (Math.abs(rate - EVENTS_PER_SECOND) > 1) {
      log(`FAIL transport stalled after reverb #${i} (${rate.toFixed(1)} events/s)`);
      stalled = true;
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
  clearInterval(heartbeat);
  if (!stalled) log(`PASS reverbs done: ${REVERBS} offline contexts`);

  // 4. Timing, driven by Tone's context (so by the audio clock): keeps going with the screen locked.
  let sequenceEvents = 0;
  let partEvents = 0;
  let loopEvents = 0;
  new Tone.Sequence(() => sequenceEvents++, [0, 1, 2, 3], '8n').start(0); // 4/s
  const livePart = new Tone.Part(() => partEvents++, [['0:0:0', 0], ['0:2:0', 1]]); // 1/s
  livePart.loop = true;
  livePart.loopEnd = '1m';
  livePart.start(0);
  new Tone.Loop(() => loopEvents++, '4n').start(0); // 2/s
  const tWall = Date.now();
  const e0 = events;
  log('timing: STATUS every 5 s');
  Tone.getContext().setInterval(() => {
    const elapsed = (Date.now() - tWall) / 1000;
    const expected = Math.round(elapsed * EVENTS_PER_SECOND);
    log(
      `STATUS t=${elapsed.toFixed(1)}s events=${events - e0} expected~${expected} ` +
        `seq=${sequenceEvents}/${Math.round(elapsed * 4)} part=${partEvents}/${Math.round(elapsed)} ` +
        `loop=${loopEvents}/${Math.round(elapsed * 2)} ` +
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
