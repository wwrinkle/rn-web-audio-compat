// The Web Audio API, one row per piece: whether React Native has it through rn-web-audio-compat, how, where, whether
// Strudel/superdough and Tone.js use it, and a self-test. COVERAGE.md is generated from this file (npm run coverage), and the
// example app and the web demo render one button per row from it, so the three can't drift apart.
//
// Tests only use the standard Web Audio API, so the web demo runs them unchanged against the browser (the reference).

import type { CoverageRow, TestContext } from './types';
import { fmt, near } from './tools';
import { TEST_PROCESSOR } from './testWorklet';
import { createTestWavArrayBuffer } from './wav';

// `tone` / `toneVia` record whether Tone.js 15.1.22 uses each piece, and through which Tone classes.
//
// Web Audio classes through globalThis: React Native's TS config has no DOM types, the web demo's does.
const W = globalThis as any;

const RNAA = 'react-native-audio-api';
const G = (name: string) => `[globals.ts](src/globals.ts) (\`${name}\`)`;
const INSTALL = '[AudioWorkletNode.ts](src/worklet/AudioWorkletNode.ts) (`installWebAudioCompat`)';

// Level of `node` driven by a constant 1.0 through `insert` (a node with an input), i.e. its gain.
async function gainOf(t: TestContext, insert: any, ms = 250): Promise<number> {
  const src = t.constant(1);
  src.connect(insert);
  const { rms } = await t.measure(insert, ms);
  src.stop();
  return rms;
}

// Level of a constant source feeding a GainNode whose `gain` param the callback automates.
async function automated(t: TestContext, automate: (param: any, now: number) => void, waitMs: number): Promise<number> {
  const g = t.ctx.createGain();
  g.gain.value = 0;
  const src = t.constant(1);
  src.connect(g);
  automate(g.gain, t.ctx.currentTime);
  const { rms } = await t.measure(g, waitMs);
  src.stop();
  return rms;
}

// Renders a constant 1.0 (mono) through the panner `build` makes, on a fresh stereo OfflineAudioContext, and returns
// each output channel's level over the second half (past any parameter smoothing at the start). Equal-power panning of
// a mono source at azimuth a: L = cos(x * pi/2), R = sin(x * pi/2), x = (a + 90) / 180, times the distance and cone gain.
async function renderPanner(build: (o: any) => any, setup?: (o: any) => void): Promise<[number, number]> {
  const frames = 4800;
  const o = new W.OfflineAudioContext(2, frames, 48000);
  setup?.(o);
  const src = o.createConstantSource();
  const p = build(o);
  src.connect(p);
  p.connect(o.destination);
  src.start();
  const buf = await o.startRendering();
  const level = (ch: number) => {
    const d = buf.getChannelData(ch);
    let sum = 0;
    for (let i = frames / 2; i < frames; i++) sum += d[i];
    return sum / (frames / 2);
  };
  return [level(0), level(1)];
}

const equalpower = (o: any, options: Record<string, unknown> = {}) =>
  new W.PannerNode(o, { panningModel: 'equalpower', ...options });

const notImplemented = (
  group: string,
  name: string,
  how = '—',
  strudel: CoverageRow['strudel'] = 'no',
  tone: CoverageRow['tone'] = 'no',
  toneVia?: string
): CoverageRow => ({
  id: `${group}:${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  group,
  name,
  covered: 'no',
  how,
  strudel,
  tone,
  toneVia,
});

function row(r: Omit<CoverageRow, 'id'> & { id?: string }): CoverageRow {
  return { ...r, id: r.id ?? `${r.group}:${r.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-') };
}

// ------------------------------------------------------------------------------------------------------------------
const BAC = 'BaseAudioContext';
const baseAudioContext: CoverageRow[] = [
  row({
    group: BAC,
    name: '`BaseAudioContext` (global class)',
    covered: 'yes',
    how: `${RNAA}, exposed as a global`,
    source: G('BaseAudioContext'),
    strudel: 'yes',
    tone: 'yes',
    toneVia: 'standardized-audio-context\'s type checks on every `connect()`',
    test: (t) => {
      t.expect(typeof W.BaseAudioContext === 'function', 'no global BaseAudioContext');
      t.expect(t.ctx instanceof W.BaseAudioContext, 'context is not instanceof BaseAudioContext');
      return 'global, instanceof works';
    },
  }),
  row({
    group: BAC,
    name: '`destination`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: (t) => {
      t.expect(t.ctx.destination instanceof W.AudioNode, 'destination is not an AudioNode');
      return `destination, channelCount ${t.ctx.destination.channelCount}`;
    },
  }),
  row({
    group: BAC,
    name: '`sampleRate`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: (t) => {
      t.expect(t.ctx.sampleRate > 0, 'no sample rate');
      return `${t.ctx.sampleRate} Hz`;
    },
  }),
  row({
    group: BAC,
    name: '`currentTime`',
    covered: 'yes',
    how: `${RNAA}; like a browser, a new context starts on resume() (or its first source start)`,
    strudel: 'yes',
    tone: 'yes',
    test: async (t) => {
      const a = t.ctx.currentTime;
      await t.env.sleep(300);
      const b = t.ctx.currentTime;
      t.expect(b - a > 0.01, `currentTime advanced only ${fmt(b - a)} s in 300 ms`);
      return `advanced ${fmt(b - a)} s in 300 ms`;
    },
  }),
  row({
    group: BAC,
    name: '`state`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'yes',
    test: (t) => {
      t.expect(['running', 'suspended', 'closed'].includes(t.ctx.state), `unexpected state ${t.ctx.state}`);
      return t.ctx.state;
    },
  }),
  row({
    group: BAC,
    name: '`onstatechange`',
    covered: 'partial',
    how: `rn-web-audio-compat: fired when \`resume()\` / \`suspend()\` / \`close()\` change the state (${RNAA} has no state events, so a change the system makes on its own, e.g. an audio interruption, isn't reported)`,
    source: G('onstatechange'),
    strudel: 'no',
    tone: 'yes',
    toneVia: '`Context` sets it and re-emits `statechange`',
    test: async (t) => {
      const seen: string[] = [];
      t.ctx.onstatechange = () => seen.push(t.ctx.state);
      await t.ctx.suspend();
      await t.ctx.resume();
      await t.env.sleep(50);
      t.ctx.onstatechange = null;
      // Browsers may report a state more than once (Chrome: suspended, suspended, running).
      t.expect(seen.includes('suspended') && seen[seen.length - 1] === 'running', `events: ${seen.join(',') || 'none'}`);
      return `events: ${seen.join(', ')}`;
    },
  }),
  row({
    group: BAC,
    name: '`listener` (`AudioListener`)',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'yes',
    toneVia: "`Listener`, created on every context's initialization, wraps its nine params",
    test: (t) => {
      const l = t.ctx.listener;
      t.expect(l instanceof W.AudioListener, 'not an AudioListener');
      const params = ['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'];
      const values = params.map((name) => l[name]?.value);
      t.expect(params.every((name) => l[name] instanceof W.AudioParam), 'missing params');
      t.expect(values.join() === '0,0,0,0,0,-1,0,1,0', `defaults ${values.join()}`);
      return 'nine params, spec defaults';
    },
  }),
  row({
    group: BAC,
    name: '`audioWorklet`',
    covered: 'partial',
    how: '`addModule()` resolves but loads no code: processors are registered from JS instead (`registerWorkletProcessor` / `registerNativeProcessor`)',
    source: INSTALL,
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`ToneAudioWorklet`: `FeedbackCombFilter` (`Freeverb`, `JCReverb`, `PluckSynth`), `BitCrusher`',
    test: async (t) => {
      t.expect(typeof t.ctx.audioWorklet?.addModule === 'function', 'no audioWorklet.addModule');
      await t.env.prepareTestWorklet(t.ctx);
      return 'addModule resolves';
    },
  }),
  row({
    group: BAC,
    name: '`createAnalyser()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'opt-in',
    tone: 'opt-in',
    toneVia: '`Analyser` (`Meter`, `FFT`, `Waveform`, `DCMeter`)',
    test: (t) => {
      const a = t.ctx.createAnalyser();
      t.expect(a instanceof W.AnalyserNode, 'not an AnalyserNode');
      return `fftSize ${a.fftSize}`;
    },
  }),
  row({
    group: BAC,
    name: '`createBiquadFilter()`',
    covered: 'yes',
    how: `${RNAA}; returns an explicit-stereo node (fan-out safe)`,
    source: INSTALL,
    strudel: 'yes',
    tone: 'yes',
    toneVia: '`Filter`, `MonoSynth`, `AutoFilter`, `Phaser`',
    test: async (t) => {
      const f = t.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 200;
      const osc = t.sine(5000);
      osc.connect(f);
      const { rms } = await t.measure(f);
      osc.stop();
      t.expect(rms < 0.1, `5 kHz through a 200 Hz lowpass still at rms ${fmt(rms)}`);
      return `5 kHz sine through 200 Hz lowpass: rms ${fmt(rms)} (unfiltered ~0.707)`;
    },
  }),
  row({
    group: BAC,
    name: '`createBuffer()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    toneVia: '`ToneAudioBuffer`, `Noise`',
    test: (t) => {
      const b = t.ctx.createBuffer(2, 1000, t.ctx.sampleRate);
      t.expect(b.numberOfChannels === 2 && b.length === 1000, 'wrong shape');
      return '2 ch x 1000 frames';
    },
  }),
  row({
    group: BAC,
    name: '`createBufferSource()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    toneVia: '`Player`, `Sampler`, `Noise`',
    test: async (t) => {
      const b = t.ctx.createBuffer(1, t.ctx.sampleRate, t.ctx.sampleRate);
      b.getChannelData(0).fill(0.5);
      const s = t.ctx.createBufferSource();
      s.buffer = b;
      s.start();
      const { rms } = await t.measure(s);
      t.expect(near(rms, 0.5, 0.05), `rms ${fmt(rms)}, expected 0.5`);
      return `constant 0.5 buffer plays at rms ${fmt(rms)}`;
    },
  }),
  row({
    group: BAC,
    name: '`createChannelMerger()`',
    covered: 'partial',
    how: RNAA,
    strudel: 'no',
    tone: 'opt-in',
    toneVia: '`Merge`: stereo effects (`Chorus`, `PingPongDelay`, `StereoWidener`...)',
    test: async (t) => {
      const m = t.ctx.createChannelMerger(2);
      t.expect(m instanceof W.ChannelMergerNode, 'not a ChannelMergerNode');
      const rms = await gainOf(t, m);
      t.expect(rms > 0.4, `rms ${fmt(rms)}`);
      return `passes signal (${fmt(rms)})`;
    },
  }),
  row({
    group: BAC,
    name: '`createChannelSplitter()`',
    covered: 'partial',
    how: RNAA,
    strudel: 'no',
    tone: 'opt-in',
    toneVia: '`Split`, `CrossFade`: stereo effects',
    test: async (t) => {
      const s = t.ctx.createChannelSplitter(2);
      t.expect(s instanceof W.ChannelSplitterNode, 'not a ChannelSplitterNode');
      const rms = await gainOf(t, s);
      t.expect(rms > 0.5, `rms ${fmt(rms)}`);
      return 'passes signal';
    },
  }),
  row({
    group: BAC,
    name: '`createConstantSource()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'yes',
    toneVia: '`Signal` (every envelope and signal)',
    test: async (t) => {
      const c = t.constant(0.5);
      const { rms } = await t.measure(c);
      c.stop();
      t.expect(near(rms, 0.5, 0.02), `rms ${fmt(rms)}`);
      return `offset 0.5 -> rms ${fmt(rms)}`;
    },
  }),
  row({
    group: BAC,
    name: '`createConvolver()`',
    covered: 'yes',
    how: `${RNAA} (fixed upstream in 1.0; up to 0.13.6 this was a patch hunk); see ConvolverNode`,
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`Convolver`, `Reverb`',
    savings: 'Done: see ConvolverNode',
    test: (t) => {
      const c = t.ctx.createConvolver();
      t.expect(c instanceof W.ConvolverNode, 'not a ConvolverNode');
      return 'created';
    },
  }),
  row({
    group: BAC,
    name: '`createDelay()`',
    covered: 'yes',
    how: `${RNAA}; explicit-stereo`,
    source: INSTALL,
    strudel: 'no',
    tone: 'opt-in',
    toneVia: '`Delay`: `FeedbackDelay`, `PingPongDelay`, `Chorus`, `Vibrato`',
    test: async (t) => {
      const d = t.ctx.createDelay(1);
      d.delayTime.value = 0.1;
      const { rms } = await (async () => {
        const src = t.constant(1);
        src.connect(d);
        const r = await t.measure(d, 300);
        src.stop();
        return r;
      })();
      t.expect(rms > 0.5, `delayed signal rms ${fmt(rms)}`);
      return `0.1 s delay passes signal (rms ${fmt(rms)})`;
    },
  }),
  row({
    group: BAC,
    name: '`createDynamicsCompressor()`',
    covered: 'yes',
    how: 'rn-web-audio-compat; see DynamicsCompressorNode',
    source: G('createDynamicsCompressor'),
    strudel: 'no',
    tone: 'opt-in',
    toneVia: '`Compressor`, `Limiter`, `MultibandCompressor`',
    test: async (t) => {
      const c = t.ctx.createDynamicsCompressor();
      t.expect(c instanceof W.DynamicsCompressorNode, 'not a DynamicsCompressorNode');
      c.threshold.value = -40;
      c.ratio.value = 20;
      c.knee.value = 0;
      const o = t.sine(220);
      o.connect(c);
      const { rms } = await t.measure(c, 350);
      o.stop();
      t.expect(rms < 0.3, `a full-scale sine came out at rms ${fmt(rms)}`);
      return `full-scale sine compressed to rms ${fmt(rms)}`;
    },
  }),
  row({
    group: BAC,
    name: '`createGain()`',
    covered: 'yes',
    how: `${RNAA}; explicit-stereo`,
    source: INSTALL,
    strudel: 'yes',
    tone: 'yes',
    test: async (t) => {
      const g = t.ctx.createGain();
      g.gain.value = 0.5;
      const rms = await gainOf(t, g);
      t.expect(near(rms, 0.5, 0.03), `rms ${fmt(rms)}`);
      return `gain 0.5 -> ${fmt(rms)}`;
    },
  }),
  row({
    group: BAC,
    name: '`createIIRFilter()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'opt-in',
    toneVia: '`OnePoleFilter` (`Freeverb`, `PluckSynth`), `PhaseShiftAllpass` (`FrequencyShifter`)',
    test: async (t) => {
      const f = t.ctx.createIIRFilter([0.5], [1]);
      const rms = await gainOf(t, f);
      t.expect(near(rms, 0.5, 0.05), `rms ${fmt(rms)}`);
      return `feedforward [0.5] -> ${fmt(rms)}`;
    },
  }),
  row({
    group: BAC,
    name: '`createOscillator()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: async (t) => {
      const o = t.sine(440);
      const { rms } = await t.measure(o);
      o.stop();
      t.expect(near(rms, Math.SQRT1_2, 0.05), `rms ${fmt(rms)}`);
      return `440 Hz sine rms ${fmt(rms)}`;
    },
  }),
  row({
    group: BAC,
    name: '`createPanner()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'opt-in',
    toneVia: '`Panner3D`',
    test: async (t) => {
      const [l, r] = await renderPanner((o) => {
        const p = o.createPanner();
        p.panningModel = 'equalpower';
        p.positionZ.value = -1;
        return p;
      });
      t.expect(near(l, Math.SQRT1_2, 0.02) && near(r, Math.SQRT1_2, 0.02), `L ${fmt(l)} R ${fmt(r)}`);
      return `source ahead: L ${fmt(l)} R ${fmt(r)}`;
    },
  }),
  row({
    group: BAC,
    name: '`createPeriodicWave()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`Oscillator` types other than plain sine/square/sawtooth/triangle (`sine4`, `custom` partials, a nonzero `phase`; `FatOscillator`)',
    test: async (t) => {
      const w = t.ctx.createPeriodicWave(new Float32Array([0, 0, 1]), new Float32Array([0, 1, 0]));
      const o = t.ctx.createOscillator();
      o.setPeriodicWave(w);
      o.start();
      const { rms } = await t.measure(o);
      o.stop();
      t.expect(rms > 0.3, `rms ${fmt(rms)}`);
      return `custom wave rms ${fmt(rms)}`;
    },
  }),
  notImplemented(BAC, '`createScriptProcessor()` (deprecated)'),
  row({
    group: BAC,
    name: '`createStereoPanner()`',
    covered: 'yes',
    how: `${RNAA}; explicit-stereo`,
    source: INSTALL,
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`Panner`: `Channel`, `PanVol`, `AutoPanner`, `CrossFade`',
    test: async (t) => {
      const p = t.ctx.createStereoPanner();
      p.pan.value = 0;
      const rms = await gainOf(t, p);
      t.expect(rms > 0.3, `rms ${fmt(rms)}`);
      return `centre pan passes signal (rms ${fmt(rms)})`;
    },
  }),
  row({
    group: BAC,
    name: '`createWaveShaper()`',
    covered: 'yes',
    how: `${RNAA}; explicit-stereo`,
    source: INSTALL,
    strudel: 'no',
    tone: 'yes',
    toneVia: '`WaveShaper` signal math: `LFO`, `AMSynth`, `PulseOscillator`, `Pow`, `Abs`',
    test: async (t) => {
      const w = t.ctx.createWaveShaper();
      w.curve = new Float32Array([-0.25, 0, 0.25]);
      const rms = await gainOf(t, w);
      t.expect(near(rms, 0.25, 0.05), `rms ${fmt(rms)}`);
      return `curve maps 1.0 -> ${fmt(rms)}`;
    },
  }),
  row({
    group: BAC,
    name: '`decodeAudioData()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    toneVia: '`ToneAudioBuffer` loading from URLs (`Player`, `Sampler`)',
    test: async (t) => {
      const wav = createTestWavArrayBuffer(t.ctx.sampleRate, 0.25);
      const buffer = await t.ctx.decodeAudioData(wav);
      t.expect(buffer.length > 0 && buffer.numberOfChannels >= 1, 'empty buffer');
      return `decoded ${buffer.length} frames, ${buffer.numberOfChannels} ch`;
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const AC = 'AudioContext';
const audioContext: CoverageRow[] = [
  row({
    group: AC,
    name: '`AudioContext` constructor',
    covered: 'partial',
    how: `${RNAA}; only the \`sampleRate\` option (no \`latencyHint\`, no \`sinkId\`). Global.`,
    source: G('AudioContext'),
    strudel: 'yes',
    tone: 'yes',
    toneVia: 'only when not handed a context: Tone then builds one through standardized-audio-context with `latencyHint`',
    test: async (t) => {
      const other = await t.env.createContext({ sampleRate: 44100 });
      const sr = other.sampleRate;
      await t.env.closeContext(other);
      t.expect(sr === 44100, `asked for 44100 Hz, got ${sr}`);
      return 'sampleRate option honoured';
    },
  }),
  notImplemented(AC, '`baseLatency`'),
  notImplemented(AC, '`outputLatency`'),
  notImplemented(AC, '`getOutputTimestamp()`'),
  row({
    group: AC,
    name: '`resume()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    toneVia: '`Tone.start()`',
    test: async (t) => {
      await t.ctx.suspend();
      await t.ctx.resume();
      t.expect(t.ctx.state === 'running', `state ${t.ctx.state}`);
      return 'running after resume()';
    },
  }),
  row({
    group: AC,
    name: '`suspend()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'no',
    test: async (t) => {
      await t.ctx.suspend();
      t.expect(t.ctx.state === 'suspended', `state ${t.ctx.state}`);
      return 'suspended';
    },
  }),
  row({
    group: AC,
    name: '`close()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'opt-in',
    tone: 'opt-in',
    toneVia: '`Context.close()`',
    test: async (t) => {
      const other = await t.env.createContext();
      await other.close();
      t.expect(other.state === 'closed', `state ${other.state}`);
      return 'closed';
    },
  }),
  notImplemented(AC, '`sinkId`', '—', 'opt-in'),
  notImplemented(AC, '`setSinkId()`', '—', 'opt-in'),
  notImplemented(AC, '`onsinkchange`'),
  row({
    group: AC,
    name: '`createMediaElementSource()`',
    covered: 'partial',
    how: `${RNAA}, but it takes ${RNAA}'s own \`Audio\` element, not an HTML \`<audio>\``,
    strudel: 'no',
    tone: 'no',
    test: (t) => {
      t.expect(typeof t.ctx.createMediaElementSource === 'function', 'missing');
      return 'method present';
    },
  }),
  notImplemented(AC, '`createMediaStreamSource()`', `— (${RNAA} has \`AudioRecorder\` / \`RecorderAdapterNode\` instead)`, 'no', 'opt-in', '`UserMedia`'),
  notImplemented(AC, '`createMediaStreamTrackSource()`'),
  notImplemented(AC, '`createMediaStreamDestination()`', '—', 'no', 'opt-in', '`Recorder`'),
];

// ------------------------------------------------------------------------------------------------------------------
const OAC = 'OfflineAudioContext';
const offline: CoverageRow[] = [
  row({
    group: OAC,
    name: '`OfflineAudioContext` constructor',
    covered: 'yes',
    how: `${RNAA}; global (a subclass that also fires \`oncomplete\`)`,
    source: G('OfflineAudioContext'),
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`OfflineContext`: `Reverb` (renders its impulse response), `Tone.Offline()`, `Oscillator.asArray()`',
    test: (t) => {
      const o = new W.OfflineAudioContext(1, 4410, 44100);
      t.expect(o.sampleRate === 44100, `sampleRate ${o.sampleRate}`);
      return '1 ch, 4410 frames, 44100 Hz';
    },
  }),
  row({
    group: OAC,
    name: '`startRendering()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`OfflineContext`: `Reverb` (renders its impulse response), `Tone.Offline()`, `Oscillator.asArray()`',
    test: async (t) => {
      const o = new W.OfflineAudioContext(1, 4410, 44100);
      const c = o.createConstantSource();
      c.offset.value = 0.5;
      c.connect(o.destination);
      c.start();
      const buffer = await o.startRendering();
      const v = buffer.getChannelData(0)[2000];
      t.expect(near(v, 0.5, 0.01), `rendered ${fmt(v)}`);
      return `rendered constant 0.5 (${fmt(v)})`;
    },
  }),
  row({
    group: OAC,
    name: '`oncomplete` / `OfflineAudioCompletionEvent`',
    covered: 'yes',
    how: `rn-web-audio-compat (${RNAA} only resolves the promise)`,
    source: G('OfflineAudioContext'),
    strudel: 'yes',
    tone: 'no',
    test: async (t) => {
      const o = new W.OfflineAudioContext(1, 441, 44100);
      let got: any = null;
      o.oncomplete = (e: any) => {
        got = e.renderedBuffer;
      };
      await o.startRendering();
      await t.env.sleep(50);
      t.expect(got && got.length === 441, 'oncomplete not called with renderedBuffer');
      return 'oncomplete fired with renderedBuffer';
    },
  }),
  row({
    group: OAC,
    name: '`length`',
    covered: 'yes',
    how: 'rn-web-audio-compat (the global subclass records it)',
    source: G('OfflineAudioContext'),
    strudel: 'no',
    tone: 'no',
    test: (t) => {
      const a = new W.OfflineAudioContext(1, 4410, 44100);
      const b = new W.OfflineAudioContext({ numberOfChannels: 2, length: 22050, sampleRate: 44100 });
      t.expect(a.length === 4410 && b.length === 22050, `lengths ${a.length}, ${b.length}`);
      return 'both constructor forms';
    },
  }),
  row({
    group: OAC,
    name: '`suspend()` / `resume()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'no',
    test: (t) => {
      const o = new W.OfflineAudioContext(1, 441, 44100);
      t.expect(typeof o.suspend === 'function' && typeof o.resume === 'function', 'missing');
      return 'methods present';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const AN = 'AudioNode';
const audioNode: CoverageRow[] = [
  row({
    group: AN,
    name: '`AudioNode` (global class, `instanceof`)',
    covered: 'yes',
    how: `${RNAA}, global`,
    source: G('AudioNode'),
    strudel: 'yes',
    tone: 'yes',
    toneVia: 'standardized-audio-context\'s `isAnyAudioNode`',
    test: (t) => {
      t.expect(t.ctx.createGain() instanceof W.AudioNode, 'gain is not instanceof W.AudioNode');
      return 'instanceof works';
    },
  }),
  row({
    group: AN,
    name: '`context`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'no',
    test: (t) => {
      t.expect(t.ctx.createGain().context === t.ctx, 'node.context is not the context');
      return 'node.context === ctx';
    },
  }),
  row({
    group: AN,
    name: '`numberOfInputs` / `numberOfOutputs`',
    covered: 'yes',
    how: `${RNAA} (read-only)`,
    strudel: 'yes',
    tone: 'yes',
    test: (t) => {
      const g = t.ctx.createGain();
      t.expect(g.numberOfInputs === 1 && g.numberOfOutputs === 1, `${g.numberOfInputs}/${g.numberOfOutputs}`);
      return 'gain: 1 in, 1 out';
    },
  }),
  row({
    group: AN,
    name: '`channelCount`',
    covered: 'partial',
    how: `${RNAA}; read-only after construction (set it with constructor options)`,
    strudel: 'yes',
    tone: 'yes',
    test: (t) => {
      const g = new W.GainNode(t.ctx, { channelCount: 1, channelCountMode: 'explicit' });
      t.expect(g.channelCount === 1, `channelCount ${g.channelCount}`);
      return 'constructor option honoured';
    },
  }),
  row({
    group: AN,
    name: '`channelCountMode`',
    covered: 'partial',
    how: `${RNAA}; read-only after construction. rn-web-audio-compat makes the common nodes \`explicit\` (fan-out fix)`,
    source: G('GainNode'),
    strudel: 'yes',
    tone: 'yes',
    test: (t) => {
      const m = t.ctx.createGain().channelCountMode;
      t.expect(['max', 'clamped-max', 'explicit'].includes(m), `mode ${m}`);
      return m;
    },
  }),
  row({
    group: AN,
    name: '`channelInterpretation`',
    covered: 'partial',
    how: `${RNAA}; read-only after construction`,
    strudel: 'no',
    tone: 'opt-in',
    toneVia: 'only when a Tone node is given the option',
    test: (t) => {
      const i = t.ctx.createGain().channelInterpretation;
      t.expect(['speakers', 'discrete'].includes(i), `interpretation ${i}`);
      return i;
    },
  }),
  row({
    group: AN,
    name: '`connect(node)`',
    covered: 'yes',
    how: `${RNAA}; a connection that would create a cycle, or a duplicate, is silently ignored (no error)`,
    strudel: 'yes',
    tone: 'yes',
    test: (t) => {
      const a = t.ctx.createGain();
      const b = t.ctx.createGain();
      t.expect(a.connect(b) === b, 'connect() does not return its destination (chaining breaks)');
      return 'returns the destination';
    },
  }),
  row({
    group: AN,
    name: '`connect(node, output, input)`',
    covered: 'partial',
    how: `${RNAA} ignores the index arguments (fine for stereo routing)`,
    strudel: 'yes',
    tone: 'yes',
    toneVia: 'every Tone `connect()` passes both',
    test: async (t) => {
      const g = t.ctx.createGain();
      const src = t.constant(1);
      src.connect(g, 0, 0);
      const { rms } = await t.measure(g);
      src.stop();
      t.expect(rms > 0.9, `rms ${fmt(rms)}`);
      return 'accepted, signal passes';
    },
  }),
  row({
    group: AN,
    name: '`connect(audioParam)`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    toneVia: '`LFO`, signals into params',
    test: async (t) => {
      const g = t.ctx.createGain();
      g.gain.value = 0;
      const mod = t.constant(0.5);
      mod.connect(g.gain);
      const rms = await gainOf(t, g);
      mod.stop();
      t.expect(near(rms, 0.5, 0.05), `rms ${fmt(rms)}`);
      return `constant 0.5 into gain.gain -> ${fmt(rms)}`;
    },
  }),
  row({
    group: AN,
    name: '`disconnect()` (all forms)',
    covered: 'yes',
    how: `${RNAA} (releases AudioParam inputs; 1.0 rewrote the graph code that left a dangling pointer, which was a patch hunk up to 0.13.6)`,
    strudel: 'yes',
    tone: 'yes',
    test: async (t) => {
      const g = t.ctx.createGain();
      const src = t.constant(1);
      src.connect(g);
      src.disconnect();
      const { rms } = await t.measure(g);
      src.stop();
      t.expect(rms < 0.01, `still ${fmt(rms)} after disconnect`);
      return 'silent after disconnect()';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const AP = 'AudioParam';
const audioParam: CoverageRow[] = [
  row({
    group: AP,
    name: '`AudioParam` (global class, `instanceof`)',
    covered: 'yes',
    how: `${RNAA}, global; \`instanceof\` also accepts rn-web-audio-compat's LiveAudioParam`,
    source: G('AudioParam'),
    strudel: 'yes',
    tone: 'yes',
    toneVia: 'standardized-audio-context\'s `isAnyAudioParam`',
    test: (t) => {
      t.expect(t.ctx.createGain().gain instanceof W.AudioParam, 'gain.gain is not instanceof W.AudioParam');
      return 'instanceof works';
    },
  }),
  row({
    group: AP,
    name: '`value`',
    covered: 'yes',
    how: `${RNAA}; reading back a value just written is rn-web-audio-compat's (the library returns the old value until the audio thread applies it)`,
    source: G('AudioParam.value'),
    strudel: 'yes',
    tone: 'yes',
    test: (t) => {
      const g = t.ctx.createGain();
      g.gain.value = 0.3;
      t.expect(near(g.gain.value, 0.3, 1e-6), `read back ${g.gain.value}`);
      return 'set / read back';
    },
  }),
  row({
    group: AP,
    name: '`defaultValue` / `minValue` / `maxValue`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'yes',
    toneVia: '`Param` reads them',
    test: (t) => {
      const p = t.ctx.createGain().gain;
      t.expect(p.defaultValue === 1, `defaultValue ${p.defaultValue}`);
      return `default ${p.defaultValue}, range ${p.minValue}..${p.maxValue}`;
    },
  }),
  notImplemented(AP, '`automationRate`', '— (native params are a-rate, AudioWorkletNode params k-rate)'),
  row({
    group: AP,
    name: '`setValueAtTime()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: async (t) => {
      const rms = await automated(t, (p, now) => p.setValueAtTime(0.5, now + 0.05), 300);
      t.expect(near(rms, 0.5, 0.05), `rms ${fmt(rms)}`);
      return `0.5 at +50 ms -> ${fmt(rms)}`;
    },
  }),
  row({
    group: AP,
    name: '`linearRampToValueAtTime()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: async (t) => {
      const rms = await automated(
        t,
        (p, now) => {
          p.setValueAtTime(0, now);
          p.linearRampToValueAtTime(0.8, now + 0.1);
        },
        350
      );
      t.expect(near(rms, 0.8, 0.06), `rms ${fmt(rms)}`);
      return `ramp to 0.8 -> ${fmt(rms)}`;
    },
  }),
  row({
    group: AP,
    name: '`exponentialRampToValueAtTime()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: async (t) => {
      const rms = await automated(
        t,
        (p, now) => {
          p.setValueAtTime(0.01, now);
          p.exponentialRampToValueAtTime(0.6, now + 0.1);
        },
        350
      );
      t.expect(near(rms, 0.6, 0.06), `rms ${fmt(rms)}`);
      return `exp ramp to 0.6 -> ${fmt(rms)}`;
    },
  }),
  row({
    group: AP,
    name: '`setTargetAtTime()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'yes',
    test: async (t) => {
      const rms = await automated(t, (p, now) => p.setTargetAtTime(0.7, now, 0.02), 350);
      t.expect(near(rms, 0.7, 0.06), `rms ${fmt(rms)}`);
      return `target 0.7 -> ${fmt(rms)}`;
    },
  }),
  row({
    group: AP,
    name: '`setValueCurveAtTime()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'no',
    toneVia: '`Param` draws curves with linear ramps',
    test: async (t) => {
      const rms = await automated(t, (p, now) => p.setValueCurveAtTime(new Float32Array([0, 0.2, 0.4]), now, 0.1), 350);
      t.expect(near(rms, 0.4, 0.06), `rms ${fmt(rms)}`);
      return `curve ending at 0.4 -> ${fmt(rms)}`;
    },
  }),
  row({
    group: AP,
    name: '`cancelScheduledValues()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: async (t) => {
      const rms = await automated(
        t,
        (p, now) => {
          p.setValueAtTime(0.3, now);
          p.setValueAtTime(0.9, now + 0.1);
          p.cancelScheduledValues(now + 0.05);
        },
        350
      );
      t.expect(near(rms, 0.3, 0.06), `rms ${fmt(rms)} (the cancelled 0.9 still happened?)`);
      return `later event cancelled -> ${fmt(rms)}`;
    },
  }),
  row({
    group: AP,
    name: '`cancelAndHoldAtTime()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'yes',
    toneVia: '`Param.cancelAndHoldAtTime()`: envelope releases, `Signal`',
    test: (t) => {
      const p = t.ctx.createGain().gain;
      t.expect(typeof p.cancelAndHoldAtTime === 'function', 'missing');
      p.cancelAndHoldAtTime(t.ctx.currentTime);
      return 'callable';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const ASN = 'AudioScheduledSourceNode';
const scheduled: CoverageRow[] = [
  row({
    group: ASN,
    name: '`AudioScheduledSourceNode` (global class)',
    covered: 'yes',
    how: `${RNAA}, global`,
    source: G('AudioScheduledSourceNode'),
    strudel: 'yes',
    tone: 'no',
    test: (t) => {
      t.expect(t.ctx.createOscillator() instanceof W.AudioScheduledSourceNode, 'oscillator not instanceof');
      return 'instanceof works';
    },
  }),
  row({
    group: ASN,
    name: '`start()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: async (t) => {
      const c = t.ctx.createConstantSource();
      c.start(t.ctx.currentTime + 0.05);
      const { rms } = await t.measure(c);
      c.stop();
      t.expect(rms > 0.5, `rms ${fmt(rms)}`);
      return 'plays after start(when)';
    },
  }),
  row({
    group: ASN,
    name: '`stop()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: async (t) => {
      const c = t.constant(1);
      c.stop(t.ctx.currentTime + 0.02);
      await t.env.sleep(100);
      const { rms } = await t.measure(c);
      t.expect(rms < 0.01, `rms ${fmt(rms)} after stop`);
      return 'silent after stop(when)';
    },
  }),
  row({
    group: ASN,
    name: '`onended`',
    covered: 'yes',
    how: `${RNAA}. On 1.0.1 only the first few contexts to fire an audio-thread event ever get any (the event queue's blocks are never given back): keep one context for the app's lifetime; see [FINDINGS.md](docs/FINDINGS.md#audio-thread-events-stop-after-about-six-contexts-101)`,
    strudel: 'yes',
    tone: 'yes',
    needsEvents: true,
    test: async (t) => {
      const c = t.ctx.createConstantSource();
      c.connect(t.ctx.destination);
      let ended = false;
      c.onended = () => {
        ended = true;
      };
      c.start();
      c.stop(t.ctx.currentTime + 0.05);
      await t.env.sleep(400);
      t.expect(ended, 'onended never fired');
      return 'fired';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const AB = 'AudioBuffer';
const audioBuffer: CoverageRow[] = [
  row({
    group: AB,
    name: '`AudioBuffer` constructor',
    covered: 'yes',
    how: `${RNAA}, global`,
    source: G('AudioBuffer'),
    strudel: 'no',
    tone: 'no',
    test: (t) => {
      const b = new W.AudioBuffer({ length: 100, numberOfChannels: 2, sampleRate: 44100 });
      t.expect(b.length === 100 && b.numberOfChannels === 2, 'wrong shape');
      return '2 x 100 @ 44100';
    },
  }),
  row({
    group: AB,
    name: '`sampleRate` / `length` / `duration` / `numberOfChannels`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: (t) => {
      const b = t.ctx.createBuffer(1, 22050, 44100);
      t.expect(near(b.duration, 0.5, 1e-6) && b.sampleRate === 44100, `duration ${b.duration}`);
      return 'duration 0.5 s';
    },
  }),
  row({
    group: AB,
    name: '`getChannelData()`',
    covered: 'yes',
    how: `${RNAA} (live shared memory, no copy)`,
    strudel: 'yes',
    tone: 'yes',
    test: (t) => {
      const b = t.ctx.createBuffer(1, 10, t.ctx.sampleRate);
      b.getChannelData(0)[3] = 0.25;
      t.expect(b.getChannelData(0)[3] === 0.25, 'write not visible on a second getChannelData()');
      return 'writes persist';
    },
  }),
  row({
    group: AB,
    name: '`copyFromChannel()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'no',
    test: (t) => {
      const b = t.ctx.createBuffer(1, 10, t.ctx.sampleRate);
      b.getChannelData(0)[2] = 0.5;
      const out = new Float32Array(10);
      b.copyFromChannel(out, 0);
      t.expect(out[2] === 0.5, 'not copied');
      return 'copied';
    },
  }),
  row({
    group: AB,
    name: '`copyToChannel()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    toneVia: '`ToneAudioBuffer.fromArray()`: `Noise`',
    test: (t) => {
      const b = t.ctx.createBuffer(1, 10, t.ctx.sampleRate);
      b.copyToChannel(new Float32Array([0, 0.75]), 0);
      t.expect(b.getChannelData(0)[1] === 0.75, 'not copied');
      return 'copied';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const ABS = 'AudioBufferSourceNode';
function oneSecond(t: TestContext, value = 0.5): any {
  const b = t.ctx.createBuffer(1, t.ctx.sampleRate, t.ctx.sampleRate);
  b.getChannelData(0).fill(value);
  return b;
}
const bufferSource: CoverageRow[] = [
  row({
    group: ABS,
    name: '`buffer`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: (t) => {
      const s = t.ctx.createBufferSource();
      const b = oneSecond(t);
      s.buffer = b;
      t.expect(s.buffer && s.buffer.length === b.length, 'buffer not set');
      return 'set / read back';
    },
  }),
  row({
    group: ABS,
    name: '`playbackRate`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    needsEvents: true,
    test: async (t) => {
      const s = t.ctx.createBufferSource();
      const b = t.ctx.createBuffer(1, Math.round(t.ctx.sampleRate * 0.4), t.ctx.sampleRate);
      b.getChannelData(0).fill(0.5);
      s.buffer = b;
      s.playbackRate.value = 4;
      s.connect(t.ctx.destination);
      let ended = false;
      s.onended = () => {
        ended = true;
      };
      s.start();
      await t.env.sleep(300);
      t.expect(ended, '0.4 s buffer at 4x still playing after 300 ms');
      return '0.4 s buffer at 4x ended within 300 ms';
    },
  }),
  row({
    group: ABS,
    name: '`detune`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'no',
    test: (t) => {
      const s = t.ctx.createBufferSource();
      s.detune.value = 100;
      t.expect(s.detune.value === 100, `detune ${s.detune.value}`);
      return 'set / read back';
    },
  }),
  row({
    group: ABS,
    name: '`loop` / `loopStart` / `loopEnd`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: async (t) => {
      const s = t.ctx.createBufferSource();
      const b = t.ctx.createBuffer(1, Math.round(t.ctx.sampleRate * 0.1), t.ctx.sampleRate);
      b.getChannelData(0).fill(0.5);
      s.buffer = b;
      s.loop = true;
      s.loopStart = 0;
      s.loopEnd = 0.05;
      s.start();
      await t.env.sleep(200);
      const { rms } = await t.measure(s);
      s.stop();
      t.expect(rms > 0.4, `rms ${fmt(rms)} after the buffer's length`);
      return 'still playing after 2x the buffer length';
    },
  }),
  row({
    group: ABS,
    name: '`start(when, offset, duration)`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    needsEvents: true,
    test: async (t) => {
      const s = t.ctx.createBufferSource();
      s.buffer = oneSecond(t);
      s.connect(t.ctx.destination);
      let ended = false;
      s.onended = () => {
        ended = true;
      };
      s.start(t.ctx.currentTime, 0.2, 0.1);
      await t.env.sleep(400);
      t.expect(ended, '1 s buffer with duration 0.1 still playing after 400 ms');
      return 'duration argument honoured';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const OSC = 'OscillatorNode and PeriodicWave';
const oscillator: CoverageRow[] = [
  row({
    group: OSC,
    name: '`OscillatorNode.frequency`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: async (t) => {
      const o = t.sine(1000);
      const a = t.ctx.createAnalyser();
      a.fftSize = 2048;
      o.connect(a);
      await t.measure(a, 250);
      const bins = new Float32Array(a.frequencyBinCount);
      a.getFloatFrequencyData(bins);
      let best = 0;
      for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
      o.stop();
      const hz = (best * t.ctx.sampleRate) / a.fftSize;
      t.expect(near(hz, 1000, 50), `peak at ${fmt(hz, 0)} Hz`);
      return `spectrum peak ${fmt(hz, 0)} Hz`;
    },
  }),
  row({
    group: OSC,
    name: '`OscillatorNode.detune`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: (t) => {
      const o = t.ctx.createOscillator();
      o.detune.value = 1200;
      t.expect(o.detune.value === 1200, 'not set');
      return 'set / read back';
    },
  }),
  row({
    group: OSC,
    name: '`OscillatorNode.type`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: async (t) => {
      const o = t.ctx.createOscillator();
      o.type = 'square';
      o.start();
      const { rms } = await t.measure(o);
      o.stop();
      t.expect(rms > 0.78, `square rms ${fmt(rms)} (a sine would be 0.707; a band-limited square is ~0.84-1)`);
      return `square rms ${fmt(rms)}`;
    },
  }),
  row({
    group: OSC,
    name: '`OscillatorNode.setPeriodicWave()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`Oscillator` types other than plain sine/square/sawtooth/triangle (`sine4`, `custom` partials, a nonzero `phase`; `FatOscillator`)',
    test: (t) => {
      const o = t.ctx.createOscillator();
      o.setPeriodicWave(t.ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0])));
      return `type ${o.type}`;
    },
  }),
  row({
    group: OSC,
    name: '`PeriodicWave` (constructor / `disableNormalization`)',
    covered: 'yes',
    how: `${RNAA} (plain number arrays, as the spec allows) (fixed upstream in 1.0; up to 0.13.6 this was a patch hunk); global`,
    source: G('PeriodicWave'),
    strudel: 'yes',
    tone: 'no',
    test: (t) => {
      const w = new W.PeriodicWave(t.ctx, { real: [0, 1], imag: [0, 0], disableNormalization: true });
      t.expect(w, 'not constructed');
      return 'constructed';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const MISC = 'GainNode, StereoPannerNode, ConstantSourceNode, DelayNode';
const misc: CoverageRow[] = [
  row({
    group: MISC,
    name: '`GainNode` constructor (`new W.GainNode`)',
    covered: 'yes',
    how: `${RNAA}; the global is an explicit-stereo subclass`,
    source: G('GainNode'),
    strudel: 'yes',
    tone: 'no',
    test: async (t) => {
      const g = new W.GainNode(t.ctx, { gain: 0.25 });
      t.expect(t.ctx.createGain() instanceof W.GainNode, 'createGain() result not instanceof W.GainNode');
      const rms = await gainOf(t, g);
      t.expect(near(rms, 0.25, 0.03), `rms ${fmt(rms)}`);
      return `options honoured (${fmt(rms)}), instanceof works`;
    },
  }),
  row({
    group: MISC,
    name: '`GainNode.gain`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: (t) => {
      const g = t.ctx.createGain();
      t.expect(g.gain.value === 1, `default ${g.gain.value}`);
      return 'default 1';
    },
  }),
  row({
    group: MISC,
    name: '`StereoPannerNode` constructor',
    covered: 'yes',
    how: `${RNAA}; the global is an explicit-stereo subclass`,
    source: G('StereoPannerNode'),
    strudel: 'yes',
    tone: 'no',
    test: (t) => {
      const p = new W.StereoPannerNode(t.ctx, { pan: -0.5 });
      t.expect(near(p.pan.value, -0.5, 1e-6), `pan ${p.pan.value}`);
      return 'options honoured';
    },
  }),
  row({
    group: MISC,
    name: '`StereoPannerNode.pan`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`Panner`',
    test: (t) => {
      const p = t.ctx.createStereoPanner();
      p.pan.value = 1;
      t.expect(p.pan.value === 1, 'not set');
      return 'set / read back';
    },
  }),
  row({
    group: MISC,
    name: '`ConstantSourceNode` constructor',
    covered: 'yes',
    how: `${RNAA}, global`,
    source: G('ConstantSourceNode'),
    strudel: 'yes',
    tone: 'no',
    test: async (t) => {
      const c = new W.ConstantSourceNode(t.ctx, { offset: 0.25 });
      c.start();
      const { rms } = await t.measure(c);
      c.stop();
      t.expect(near(rms, 0.25, 0.02), `rms ${fmt(rms)}`);
      return `offset 0.25 -> ${fmt(rms)}`;
    },
  }),
  row({
    group: MISC,
    name: '`ConstantSourceNode.offset`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    toneVia: '`Signal`',
    test: (t) => {
      const c = t.ctx.createConstantSource();
      t.expect(c.offset.value === 1, `default ${c.offset.value}`);
      return 'default 1';
    },
  }),
  row({
    group: MISC,
    name: '`DelayNode` constructor / `delayTime`',
    covered: 'yes',
    how: `${RNAA}; the global is an explicit-stereo subclass. A feedback loop built from a DelayNode graph cycle does NOT work (the library drops cycle edges): use \`FeedbackDelayNode\``,
    source: G('DelayNode'),
    strudel: 'no',
    tone: 'opt-in',
    toneVia: '`Delay` (through `createDelay()`)',
    test: (t) => {
      const d = new W.DelayNode(t.ctx, { delayTime: 0.2, maxDelayTime: 1 });
      t.expect(near(d.delayTime.value, 0.2, 1e-6), `delayTime ${d.delayTime.value}`);
      return 'options honoured';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const BQ = 'BiquadFilterNode and IIRFilterNode';
const filters: CoverageRow[] = [
  row({
    group: BQ,
    name: '`BiquadFilterNode.type`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
    tone: 'yes',
    test: (t) => {
      const f = t.ctx.createBiquadFilter();
      f.type = 'highpass';
      t.expect(f.type === 'highpass', `type ${f.type}`);
      return 'set / read back';
    },
  }),
  ...(['frequency', 'Q', 'detune', 'gain'] as const).map((param) =>
    row({
      group: BQ,
      name: `\`BiquadFilterNode.${param}\``,
      covered: 'yes',
      how: RNAA,
      strudel: param === 'frequency' || param === 'Q' ? 'yes' : 'no',
      tone: 'yes',
      toneVia: '`Filter`',
      test: (t: TestContext) => {
        const f = t.ctx.createBiquadFilter();
        f[param].value = 3;
        t.expect(near(f[param].value, 3, 1e-6), `${param} ${f[param].value}`);
        return 'set / read back';
      },
    })
  ),
  row({
    group: BQ,
    name: '`BiquadFilterNode.getFrequencyResponse()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'opt-in',
    toneVia: '`Filter.getFrequencyResponse()`',
    test: (t) => {
      const f = new W.BiquadFilterNode(t.ctx, { type: 'lowpass', frequency: 1000 });
      const hz = new Float32Array([100, 10000]);
      const mag = new Float32Array(2);
      const phase = new Float32Array(2);
      f.getFrequencyResponse(hz, mag, phase);
      t.expect(mag[0] > 0.9 && mag[1] < 0.1, `magnitudes ${fmt(mag[0])} / ${fmt(mag[1])}`);
      return `lowpass 1 kHz: |H(100)| ${fmt(mag[0])}, |H(10k)| ${fmt(mag[1])}`;
    },
  }),
  row({
    group: BQ,
    name: '`IIRFilterNode` (constructor, `getFrequencyResponse()`)',
    covered: 'yes',
    how: `${RNAA}, global`,
    source: G('IIRFilterNode'),
    strudel: 'no',
    tone: 'opt-in',
    toneVia: '`OnePoleFilter` (through `createIIRFilter()`)',
    test: (t) => {
      const f = new W.IIRFilterNode(t.ctx, { feedforward: [1], feedback: [1] });
      const mag = new Float32Array(1);
      f.getFrequencyResponse(new Float32Array([440]), mag, new Float32Array(1));
      t.expect(near(mag[0], 1, 0.01), `|H| ${mag[0]}`);
      return 'identity filter |H| = 1';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const CONV = 'ConvolverNode';
const convolver: CoverageRow[] = [
  row({
    group: CONV,
    name: '`ConvolverNode.buffer`',
    covered: 'partial',
    how: `${RNAA}. 1.0 redesigned the convolver: processing before a buffer is set no longer crashes (it did up to 0.13.6, which this library patched). Cost grows with the impulse response length: for reverb, prefer \`createFdnReverbNode\``,
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`Convolver`, `Reverb` (set after connecting)',
    savings: 'Done: `createFdnReverbNode` (C++ FDN reverb, cost independent of length; 41% vs 78% audio load for a 0.6 s reverb on a Pixel 10)',
    test: async (t) => {
      const c = t.ctx.createConvolver();
      c.normalize = false;
      const ir = t.ctx.createBuffer(2, 128, t.ctx.sampleRate);
      ir.getChannelData(0)[0] = 0.5;
      ir.getChannelData(1)[0] = 0.5;
      c.buffer = ir;
      const rms = await gainOf(t, c, 350);
      t.expect(near(rms, 0.5, 0.08), `rms ${fmt(rms)}`);
      return `impulse 0.5 -> ${fmt(rms)}`;
    },
  }),
  row({
    group: CONV,
    name: '`ConvolverNode.normalize`',
    covered: 'yes',
    how: `${RNAA}; its normalization matches the Web Audio spec formula within about 1 dB`,
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`Convolver`',
    test: (t) => {
      const c = t.ctx.createConvolver();
      c.normalize = false;
      t.expect(c.normalize === false, 'not set');
      return 'set / read back';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const WS = 'WaveShaperNode';
const waveshaper: CoverageRow[] = [
  row({
    group: WS,
    name: '`WaveShaperNode` constructor',
    covered: 'yes',
    how: `${RNAA} (a \`curve\` in the constructor options) (fixed upstream in 1.0; up to 0.13.6 this was a patch hunk); the global is an explicit-stereo subclass`,
    source: G('WaveShaperNode'),
    strudel: 'yes',
    tone: 'no',
    test: async (t) => {
      const w = new W.WaveShaperNode(t.ctx, { curve: new Float32Array([-0.25, 0, 0.25]) });
      t.expect(w instanceof W.WaveShaperNode, 'not instanceof');
      const rms = await gainOf(t, w);
      t.expect(near(rms, 0.25, 0.05), `curve from the options not applied (rms ${fmt(rms)})`);
      return `curve option applied (1.0 -> ${fmt(rms)})`;
    },
  }),
  row({
    group: WS,
    name: '`WaveShaperNode.curve`',
    covered: 'partial',
    how: `${RNAA} (the getter) (fixed upstream in 1.0; up to 0.13.6 this was a patch hunk); can only be set once per node; input is clamped to [-1, 1]`,
    strudel: 'yes',
    tone: 'yes',
    toneVia: '`WaveShaper` (see `createWaveShaper()`)',
    test: (t) => {
      const w = t.ctx.createWaveShaper();
      w.curve = new Float32Array([-1, 0, 1]);
      t.expect(w.curve && w.curve.length === 3, 'curve not set');
      return 'set once, read back';
    },
  }),
  row({
    group: WS,
    name: '`WaveShaperNode.oversample`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'opt-in',
    toneVia: '`Distortion`, `Chebyshev`',
    test: (t) => {
      const w = t.ctx.createWaveShaper();
      w.oversample = '2x';
      t.expect(w.oversample === '2x', `oversample ${w.oversample}`);
      return 'set / read back';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const AZ = 'AnalyserNode';
const analyser: CoverageRow[] = [
  row({
    group: AZ,
    name: '`fftSize` / `frequencyBinCount`',
    covered: 'yes',
    how: RNAA,
    strudel: 'opt-in',
    tone: 'opt-in',
    toneVia: '`Analyser` (`Meter`, `FFT`, `Waveform`, `DCMeter`)',
    test: (t) => {
      const a = t.ctx.createAnalyser();
      a.fftSize = 1024;
      t.expect(a.frequencyBinCount === 512, `bins ${a.frequencyBinCount}`);
      return '1024 -> 512 bins';
    },
  }),
  row({
    group: AZ,
    name: '`smoothingTimeConstant`',
    covered: 'yes',
    how: RNAA,
    strudel: 'opt-in',
    tone: 'opt-in',
    toneVia: '`Analyser` (`Meter`, `FFT`, `Waveform`, `DCMeter`)',
    test: (t) => {
      const a = t.ctx.createAnalyser();
      a.smoothingTimeConstant = 0.5;
      t.expect(near(a.smoothingTimeConstant, 0.5, 1e-6), 'not set');
      return 'set / read back';
    },
  }),
  row({
    group: AZ,
    name: '`minDecibels` / `maxDecibels`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'no',
    test: (t) => {
      const a = t.ctx.createAnalyser();
      a.minDecibels = -90;
      t.expect(a.minDecibels === -90, 'not set');
      return `range ${a.minDecibels}..${a.maxDecibels} dB`;
    },
  }),
  row({
    group: AZ,
    name: '`getFloatTimeDomainData()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'opt-in',
    tone: 'opt-in',
    toneVia: '`Analyser` (`Meter`, `FFT`, `Waveform`, `DCMeter`)',
    test: async (t) => {
      const c = t.constant(0.5);
      const { peak } = await t.measure(c);
      c.stop();
      t.expect(near(peak, 0.5, 0.02), `peak ${fmt(peak)}`);
      return `reads ${fmt(peak)}`;
    },
  }),
  row({
    group: AZ,
    name: '`getFloatFrequencyData()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'opt-in',
    tone: 'opt-in',
    toneVia: '`Analyser` (`Meter`, `FFT`, `Waveform`, `DCMeter`)',
    test: async (t) => {
      const o = t.sine(2000);
      const a = t.ctx.createAnalyser();
      o.connect(a);
      await t.measure(a, 250);
      const bins = new Float32Array(a.frequencyBinCount);
      a.getFloatFrequencyData(bins);
      o.stop();
      const max = Math.max(...Array.from(bins));
      t.expect(max > -30, `max ${fmt(max, 1)} dB`);
      return `peak ${fmt(max, 1)} dB`;
    },
  }),
  row({
    group: AZ,
    name: '`getByteTimeDomainData()` / `getByteFrequencyData()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'no',
    tone: 'no',
    test: async (t) => {
      const o = t.sine(1000);
      const a = t.ctx.createAnalyser();
      o.connect(a);
      await t.measure(a, 200);
      const td = new Uint8Array(a.fftSize);
      const fd = new Uint8Array(a.frequencyBinCount);
      a.getByteTimeDomainData(td);
      a.getByteFrequencyData(fd);
      o.stop();
      t.expect(Math.max(...Array.from(td)) > 200 && Math.max(...Array.from(fd)) > 100, 'byte data flat');
      return 'time and frequency bytes populated';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const DC = 'DynamicsCompressorNode';
const compressor: CoverageRow[] = [
  row({
    group: DC,
    name: '`DynamicsCompressorNode` constructor',
    covered: 'yes',
    how: "rn-web-audio-compat: a C++ kernel in this library's own native node (JS worklet fallback); global",
    source: '[DynamicsCompressorNode.ts](src/nodes/DynamicsCompressorNode.ts), [Kernels.cpp](common/cpp/rnwac/Kernels.cpp)',
    strudel: 'yes',
    tone: 'no',
    test: async (t) => {
      const c = new W.DynamicsCompressorNode(t.ctx, { threshold: -40, ratio: 20, knee: 0, attack: 0.001, release: 0.05 });
      const o = t.sine(220);
      o.connect(c);
      const { rms } = await t.measure(c, 350);
      o.stop();
      t.expect(rms < 0.3, `a full-scale sine came out at rms ${fmt(rms)}`);
      return `full-scale sine compressed to rms ${fmt(rms)} (in: 0.707)`;
    },
  }),
  row({
    group: DC,
    name: '`threshold` / `knee` / `ratio` / `attack` / `release`',
    covered: 'partial',
    how: 'rn-web-audio-compat: params read by the kernel once per block, which pass `instanceof AudioParam`; automation takes effect at the call, not at its scheduled time',
    source: '[DynamicsCompressorNode.ts](src/nodes/DynamicsCompressorNode.ts), [kernelParam.ts](src/kernels/kernelParam.ts)',
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`Compressor`, `Limiter` (wrap each in a `Param`, which asserts `instanceof AudioParam`)',
    test: (t) => {
      const c = new W.DynamicsCompressorNode(t.ctx);
      const names = ['threshold', 'knee', 'ratio', 'attack', 'release'];
      t.expect(names.every((n) => c[n] instanceof W.AudioParam), 'not AudioParams');
      const defaults = names.map((n) => fmt(c[n].defaultValue, 3)).join();
      t.expect(defaults === '-24.000,30.000,12.000,0.003,0.250', `defaultValue ${defaults}`);
      c.threshold.value = -12;
      c.ratio.value = 4;
      t.expect(c.threshold.value === -12 && c.ratio.value === 4, 'not set');
      return 'AudioParams with the spec defaults; set / read back';
    },
  }),
  notImplemented(DC, '`reduction`', '—', 'no', 'opt-in', '`Compressor.reduction`'),
];

// ------------------------------------------------------------------------------------------------------------------
const CH = 'ChannelMergerNode and ChannelSplitterNode';
const channels: CoverageRow[] = [
  row({
    group: CH,
    name: '`ChannelMergerNode` constructor',
    covered: 'yes',
    how: `${RNAA} (native since 1.0; up to 0.13.6 this library had a stereo pass-through stand-in); global`,
    source: G('ChannelMergerNode'),
    strudel: 'yes',
    tone: 'no',
    test: async (t) => {
      const m = new W.ChannelMergerNode(t.ctx, { numberOfInputs: 2 });
      // A second consumer first, so the measurement is a fan-out branch (it read silence before the merger was
      // explicit-stereo).
      const other = t.ctx.createGain();
      other.gain.value = 0;
      m.connect(other);
      other.connect(t.ctx.destination);
      const rms = await gainOf(t, m);
      other.disconnect();
      // A real merger puts a mono input on one channel (0.5 after the analyser's downmix).
      t.expect(rms > 0.4, `rms ${fmt(rms)}`);
      return `passes signal (${fmt(rms)})`;
    },
  }),
  row({
    group: CH,
    name: '`ChannelSplitterNode` constructor',
    covered: 'yes',
    how: `${RNAA} (native since 1.0; up to 0.13.6 this library had a stereo pass-through stand-in); global`,
    source: G('ChannelSplitterNode'),
    strudel: 'yes',
    tone: 'no',
    test: async (t) => {
      const s = new W.ChannelSplitterNode(t.ctx, { numberOfOutputs: 2 });
      const other = t.ctx.createGain();
      other.gain.value = 0;
      s.connect(other);
      other.connect(t.ctx.destination);
      const rms = await gainOf(t, s);
      other.disconnect();
      t.expect(rms > 0.5, `rms ${fmt(rms)}`);
      return 'passes signal';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const PAN = 'PannerNode and AudioListener (3D spatialization)';
const H = Math.SQRT1_2; // each channel's gain for a source straight ahead
const panTone = { strudel: 'no', tone: 'opt-in', toneVia: '`Panner3D`' } as const;
const listenerTone = { strudel: 'no', tone: 'yes', toneVia: '`Listener` (see `listener`)' } as const;
const panner: CoverageRow[] = [
  row({
    group: PAN,
    name: '`PannerNode` constructor',
    covered: 'yes',
    how: `${RNAA}. Global`,
    ...panTone,
    test: async (t) => {
      let made: any;
      const [l, r] = await renderPanner((o) => (made = equalpower(o, { positionX: 1 })));
      t.expect(made instanceof W.PannerNode, 'not a PannerNode');
      t.expect(near(l, 0, 0.02) && near(r, 1, 0.02), `L ${fmt(l)} R ${fmt(r)}`);
      return `{ positionX: 1 } -> hard right (L ${fmt(l)} R ${fmt(r)})`;
    },
  }),
  row({
    group: PAN,
    name: '`PannerNode.panningModel`',
    covered: 'partial',
    how: `${RNAA}; \`'HRTF'\` is accepted but renders as \`'equalpower'\``,
    ...panTone,
    toneVia: "`Panner3D` (default `'HRTF'`)",
    test: async (t) => {
      const p = t.ctx.createPanner();
      p.panningModel = 'HRTF';
      t.expect(p.panningModel === 'HRTF', `read back ${p.panningModel}`);
      p.panningModel = 'equalpower';
      t.expect(p.panningModel === 'equalpower', `read back ${p.panningModel}`);
      const [l, r] = await renderPanner((o) => equalpower(o, { positionX: -1 }));
      t.expect(near(l, 1, 0.02) && near(r, 0, 0.02), `L ${fmt(l)} R ${fmt(r)}`);
      return `reads back; equalpower hard left (L ${fmt(l)} R ${fmt(r)})`;
    },
  }),
  row({
    group: PAN,
    name: '`PannerNode.distanceModel`',
    covered: 'yes',
    how: RNAA,
    ...panTone,
    test: async (t) => {
      // Source straight ahead at distance d, refDistance 1, rolloffFactor 1, maxDistance 10.
      const at = async (distanceModel: string, d: number) =>
        (await renderPanner((o) => equalpower(o, { distanceModel, maxDistance: 10, positionZ: -d })))[0] / H;
      const inverse = await at('inverse', 10); // 1 / (1 + (d - 1)) = 0.1
      const linear = await at('linear', 5.5); // 1 - (d - 1) / (10 - 1) = 0.5
      const exponential = await at('exponential', 4); // d^-1 = 0.25
      t.expect(near(inverse, 0.1, 0.01), `inverse ${fmt(inverse)}`);
      t.expect(near(linear, 0.5, 0.02), `linear ${fmt(linear)}`);
      t.expect(near(exponential, 0.25, 0.02), `exponential ${fmt(exponential)}`);
      return `gains: inverse ${fmt(inverse)}, linear ${fmt(linear)}, exponential ${fmt(exponential)}`;
    },
  }),
  row({
    group: PAN,
    name: '`PannerNode.refDistance` / `maxDistance` / `rolloffFactor`',
    covered: 'yes',
    how: RNAA,
    ...panTone,
    test: async (t) => {
      const options = { distanceModel: 'linear', refDistance: 2, maxDistance: 6, rolloffFactor: 0.5 };
      const p = equalpower(t.ctx, options);
      const read = [p.refDistance, p.maxDistance, p.rolloffFactor].join();
      t.expect(read === '2,6,0.5', `read back ${read}`);
      // 1 - 0.5 * (4 - 2) / (6 - 2) = 0.75
      const g = (await renderPanner((o) => equalpower(o, { ...options, positionZ: -4 })))[0] / H;
      t.expect(near(g, 0.75, 0.02), `gain ${fmt(g)}`);
      return `linear, ref 2, max 6, rolloff 0.5, d 4: gain ${fmt(g)}`;
    },
  }),
  row({
    group: PAN,
    name: '`PannerNode.coneInnerAngle` / `coneOuterAngle` / `coneOuterGain`',
    covered: 'yes',
    how: RNAA,
    ...panTone,
    test: async (t) => {
      const cone = { coneInnerAngle: 60, coneOuterAngle: 120, coneOuterGain: 0.1 };
      const p = equalpower(t.ctx, cone);
      const read = [p.coneInnerAngle, p.coneOuterAngle, p.coneOuterGain].map((x: number) => fmt(x, 2)).join();
      t.expect(read === '60.00,120.00,0.10', `read back ${read}`);
      // Pointing sideways (the default orientation, +x) at a listener 90 degrees off its axis: outside the outer cone.
      const g = (await renderPanner((o) => equalpower(o, { ...cone, positionZ: -1 })))[0] / H;
      t.expect(near(g, 0.1, 0.01), `gain ${fmt(g)}`);
      return `listener outside the cone: gain ${fmt(g)}`;
    },
  }),
  row({
    group: PAN,
    name: '`PannerNode.positionX/Y/Z`',
    covered: 'yes',
    how: RNAA,
    ...panTone,
    test: async (t) => {
      const p = t.ctx.createPanner();
      t.expect([p.positionX, p.positionY, p.positionZ].every((x: any) => x instanceof W.AudioParam), 'not AudioParams');
      const [l, r] = await renderPanner((o) => {
        const q = equalpower(o);
        q.positionX.value = -2; // inverse distance: gain 1 / 2
        return q;
      });
      t.expect(near(l, 0.5, 0.02) && near(r, 0, 0.02), `L ${fmt(l)} R ${fmt(r)}`);
      return `x = -2: L ${fmt(l)} R ${fmt(r)}`;
    },
  }),
  row({
    group: PAN,
    name: '`PannerNode.orientationX/Y/Z`',
    covered: 'yes',
    how: RNAA,
    ...panTone,
    test: async (t) => {
      const p = t.ctx.createPanner();
      const d = [p.orientationX.value, p.orientationY.value, p.orientationZ.value].join();
      t.expect(d === '1,0,0', `defaults ${d}`);
      // The cone row's setup, but facing the listener: inside the inner cone, full gain.
      const g =
        (
          await renderPanner((o) => {
            const q = equalpower(o, { coneInnerAngle: 60, coneOuterAngle: 120, coneOuterGain: 0.1, positionZ: -1 });
            q.orientationX.value = 0;
            q.orientationZ.value = 1;
            return q;
          })
        )[0] / H;
      t.expect(near(g, 1, 0.02), `gain ${fmt(g)}`);
      return `facing the listener: gain ${fmt(g)}`;
    },
  }),
  row({
    group: PAN,
    name: '`PannerNode.setPosition()` / `setOrientation()`',
    covered: 'yes',
    how: 'Sets the six params (deprecated in the spec; react-native-audio-api lacks them)',
    source: G('PannerNode.prototype.setPosition'),
    strudel: 'no',
    tone: 'no',
    test: async (t) => {
      // Checked by what renders: Chrome doesn't update the params' `value` from these deprecated setters.
      const [l, r] = await renderPanner((o) => {
        const q = equalpower(o);
        q.setPosition(2, 0, 0);
        return q;
      });
      t.expect(near(l, 0, 0.02) && near(r, 0.5, 0.02), `L ${fmt(l)} R ${fmt(r)}`);
      // The cone row's setup turned to face the listener: full gain instead of the outer cone's 0.1.
      const g =
        (
          await renderPanner((o) => {
            const q = equalpower(o, { coneInnerAngle: 60, coneOuterAngle: 120, coneOuterGain: 0.1 });
            q.setPosition(0, 0, -1);
            q.setOrientation(0, 0, 1);
            return q;
          })
        )[0] / H;
      t.expect(near(g, 1, 0.02), `facing gain ${fmt(g)}`);
      return `setPosition(2, 0, 0): L ${fmt(l)} R ${fmt(r)}; setOrientation facing: gain ${fmt(g)}`;
    },
  }),
  row({
    group: PAN,
    name: '`AudioListener.positionX/Y/Z`',
    covered: 'yes',
    how: RNAA,
    ...listenerTone,
    test: async (t) => {
      // A listener 1 to the left of the source hears it hard right.
      const [l, r] = await renderPanner(
        (o) => equalpower(o),
        (o) => (o.listener.positionX.value = -1)
      );
      t.expect(near(l, 0, 0.02) && near(r, 1, 0.02), `L ${fmt(l)} R ${fmt(r)}`);
      return `listener at x = -1: L ${fmt(l)} R ${fmt(r)}`;
    },
  }),
  row({
    group: PAN,
    name: '`AudioListener.forwardX/Y/Z` / `upX/Y/Z`',
    covered: 'yes',
    how: RNAA,
    ...listenerTone,
    test: async (t) => {
      // Facing +x, a source at -z is on the listener's left.
      const [l, r] = await renderPanner(
        (o) => equalpower(o, { positionZ: -1 }),
        (o) => {
          o.listener.forwardX.value = 1;
          o.listener.forwardZ.value = 0;
        }
      );
      t.expect(near(l, 1, 0.02) && near(r, 0, 0.02), `L ${fmt(l)} R ${fmt(r)}`);
      return `facing +x, source at -z: L ${fmt(l)} R ${fmt(r)}`;
    },
  }),
  row({
    group: PAN,
    name: '`AudioListener.setPosition()` / `setOrientation()`',
    covered: 'yes',
    how: `${RNAA} (deprecated in the spec)`,
    strudel: 'no',
    tone: 'no',
    test: async (t) => {
      const [l, r] = await renderPanner(
        (o) => equalpower(o, { positionZ: -1 }),
        (o) => {
          o.listener.setPosition(0, 0, 0);
          o.listener.setOrientation(-1, 0, 0, 0, 1, 0);
        }
      );
      t.expect(near(l, 0, 0.02) && near(r, 1, 0.02), `L ${fmt(l)} R ${fmt(r)}`);
      return `facing -x, source at -z: L ${fmt(l)} R ${fmt(r)}`;
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const MS = 'Media stream / element nodes';
const media: CoverageRow[] = [
  row({
    group: MS,
    name: '`MediaElementAudioSourceNode.mediaElement`',
    covered: 'partial',
    how: `${RNAA} (with its own \`Audio\` element)`,
    strudel: 'no',
    tone: 'no',
    test: (t) => {
      t.expect(typeof t.ctx.createMediaElementSource === 'function', 'missing');
      return 'factory present';
    },
  }),
  notImplemented(MS, '`MediaStreamAudioSourceNode.mediaStream`'),
  notImplemented(MS, '`MediaStreamTrackAudioSourceNode`'),
  notImplemented(MS, '`MediaStreamAudioDestinationNode.stream`', '—', 'no', 'opt-in', '`Recorder`'),
];

// ------------------------------------------------------------------------------------------------------------------
const SP = 'ScriptProcessorNode (deprecated)';
const scriptProcessor: CoverageRow[] = [
  notImplemented(SP, '`ScriptProcessorNode.bufferSize`'),
  notImplemented(SP, '`ScriptProcessorNode.onaudioprocess` / `AudioProcessingEvent`'),
];

// ------------------------------------------------------------------------------------------------------------------
const AW = 'AudioWorklet';
async function testNode(t: TestContext, options?: Record<string, unknown>): Promise<any> {
  await t.env.prepareTestWorklet(t.ctx);
  return new W.AudioWorkletNode(t.ctx, TEST_PROCESSOR, options);
}
const worklet: CoverageRow[] = [
  row({
    group: AW,
    name: '`AudioWorklet.addModule()`',
    covered: 'partial',
    how: 'rn-web-audio-compat: resolves without loading code; processors are registered from JS',
    source: INSTALL,
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`ToneAudioWorklet`: `FeedbackCombFilter` (`Freeverb`, `JCReverb`, `PluckSynth`), `BitCrusher`; loads the processor source from a Blob URL',
    test: async (t) => {
      await t.env.prepareTestWorklet(t.ctx);
      return 'resolves';
    },
  }),
  row({
    group: AW,
    name: '`AudioWorkletNode` constructor (+ `processorOptions`)',
    covered: 'yes',
    how: 'rn-web-audio-compat: runs the registered processor as a JS worklet on the audio thread, or a registered native implementation (C++ kernel / built-in nodes)',
    source: '[AudioWorkletNode.ts](src/worklet/AudioWorkletNode.ts)',
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`ToneAudioWorklet`: `FeedbackCombFilter` (`Freeverb`, `JCReverb`, `PluckSynth`), `BitCrusher`',
    test: async (t) => {
      const n = await testNode(t, { processorOptions: { scale: 0.5 } });
      const rms = await gainOf(t, n, 350);
      t.expect(near(rms, 0.5, 0.05), `rms ${fmt(rms)}`);
      return `processorOptions.scale 0.5 -> ${fmt(rms)}`;
    },
  }),
  row({
    group: AW,
    name: '`AudioWorkletNode.parameters`',
    covered: 'yes',
    how: 'rn-web-audio-compat: LiveAudioParam map (value + automation; k-rate, not sample-accurate)',
    source: '[liveAudioParam.ts](src/worklet/liveAudioParam.ts)',
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`ToneAudioWorklet`: `FeedbackCombFilter` (`Freeverb`, `JCReverb`, `PluckSynth`), `BitCrusher`',
    test: async (t) => {
      const n = await testNode(t);
      n.parameters.get('gain').value = 0.25;
      const rms = await gainOf(t, n, 350);
      t.expect(near(rms, 0.25, 0.04), `rms ${fmt(rms)}`);
      return `gain param 0.25 -> ${fmt(rms)}`;
    },
  }),
  row({
    group: AW,
    name: '`AudioWorkletNode.port` / `postMessage()`',
    covered: 'partial',
    how: 'rn-web-audio-compat: JS -> processor only (a mailbox the processor reads each block)',
    source: '[AudioWorkletNode.ts](src/worklet/AudioWorkletNode.ts)',
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`ToneAudioWorklet`: `FeedbackCombFilter` (`Freeverb`, `JCReverb`, `PluckSynth`), `BitCrusher` (a `dispose` message)',
    test: async (t) => {
      const n = await testNode(t);
      n.port.postMessage({ scale: 0.2 });
      const rms = await gainOf(t, n, 350);
      t.expect(near(rms, 0.2, 0.04), `rms ${fmt(rms)}`);
      return `message scale 0.2 -> ${fmt(rms)}`;
    },
  }),
  notImplemented(AW, '`AudioWorkletNode.onprocessorerror`', '— (a processor exception silences that block instead)'),
  row({
    group: AW,
    name: '`AudioWorkletProcessor` / `registerProcessor()` / global scope',
    covered: 'partial',
    how: 'rn-web-audio-compat: processors are TS modules registered from JS (`registerWorkletProcessor`), not classes loaded into a worklet scope',
    source: '[types.ts](src/worklet/types.ts)',
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`ToneAudioWorklet`: `FeedbackCombFilter` (`Freeverb`, `JCReverb`, `PluckSynth`), `BitCrusher`',
    test: async (t) => {
      const n = await testNode(t);
      const rms = await gainOf(t, n, 350);
      t.expect(near(rms, 1, 0.05), `rms ${fmt(rms)}`);
      return `registered processor runs (${fmt(rms)})`;
    },
  }),
  row({
    group: AW,
    name: '`AudioParamDescriptor` (`parameterDescriptors`)',
    covered: 'yes',
    how: 'rn-web-audio-compat: read from the processor module',
    source: '[types.ts](src/worklet/types.ts)',
    strudel: 'yes',
    tone: 'opt-in',
    toneVia: '`ToneAudioWorklet`: `FeedbackCombFilter` (`Freeverb`, `JCReverb`, `PluckSynth`), `BitCrusher`',
    test: async (t) => {
      const n = await testNode(t);
      t.expect(n.parameters.has('gain'), 'no gain param');
      return 'declared param exposed';
    },
  }),
];

export const ROWS: CoverageRow[] = [
  ...baseAudioContext,
  ...audioContext,
  ...offline,
  ...audioNode,
  ...audioParam,
  ...scheduled,
  ...audioBuffer,
  ...bufferSource,
  ...oscillator,
  ...misc,
  ...filters,
  ...convolver,
  ...waveshaper,
  ...analyser,
  ...compressor,
  ...channels,
  ...panner,
  ...media,
  ...scriptProcessor,
  ...worklet,
];

export const GROUPS: string[] = Array.from(new Set(ROWS.map((r) => r.group)));
