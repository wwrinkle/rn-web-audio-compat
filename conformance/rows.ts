// The Web Audio API, one row per piece: whether React Native has it through rn-web-audio-compat, how, where, whether
// Strudel/superdough uses it, and a self-test. COVERAGE.md is generated from this file (npm run coverage), and the
// example app and the web demo render one button per row from it, so the three can't drift apart.
//
// Tests only use the standard Web Audio API, so the web demo runs them unchanged against the browser (the reference).

import type { CoverageRow, TestContext } from './types';
import { fmt, near } from './tools';
import { TEST_PROCESSOR } from './testWorklet';
import { createTestWavArrayBuffer } from './wav';

// Web Audio classes through globalThis: React Native's TS config has no DOM types, the web demo's does.
const W = globalThis as any;

const RNAA = 'react-native-audio-api';
const G = (name: string) => `[globals.ts](src/globals.ts) (\`${name}\`)`;
const PATCH = '[rnaa.patch](native/rnaa-0.13.5/rnaa.patch)';
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

const notImplemented = (group: string, name: string, how = '—', strudel: CoverageRow['strudel'] = 'no'): CoverageRow => ({
  id: `${group}:${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  group,
  name,
  covered: 'no',
  how,
  strudel,
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
  notImplemented(BAC, '`listener` (`AudioListener`)'),
  row({
    group: BAC,
    name: '`audioWorklet`',
    covered: 'partial',
    how: '`addModule()` resolves but loads no code: processors are registered from JS instead (`registerWorkletProcessor` / `registerNativeProcessor`)',
    source: INSTALL,
    strudel: 'yes',
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
    how: 'rn-web-audio-compat; see ChannelMergerNode',
    source: G('createChannelMerger'),
    strudel: 'no',
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
    how: 'rn-web-audio-compat; see ChannelSplitterNode',
    source: G('createChannelSplitter'),
    strudel: 'no',
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
    how: `${RNAA} (patched against a render-thread crash); see ConvolverNode`,
    source: PATCH,
    strudel: 'yes',
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
    test: async (t) => {
      const o = t.sine(440);
      const { rms } = await t.measure(o);
      o.stop();
      t.expect(near(rms, Math.SQRT1_2, 0.05), `rms ${fmt(rms)}`);
      return `440 Hz sine rms ${fmt(rms)}`;
    },
  }),
  notImplemented(BAC, '`createPanner()`'),
  row({
    group: BAC,
    name: '`createPeriodicWave()`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
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
    test: (t) => {
      t.expect(typeof t.ctx.createMediaElementSource === 'function', 'missing');
      return 'method present';
    },
  }),
  notImplemented(AC, '`createMediaStreamSource()`', `— (${RNAA} has \`AudioRecorder\` / \`RecorderAdapterNode\` instead)`),
  notImplemented(AC, '`createMediaStreamTrackSource()`'),
  notImplemented(AC, '`createMediaStreamDestination()`'),
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
    how: `${RNAA} (patched: also releases AudioParam inputs; the unpatched library left a dangling pointer)`,
    source: PATCH,
    strudel: 'yes',
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
    test: (t) => {
      t.expect(t.ctx.createGain().gain instanceof W.AudioParam, 'gain.gain is not instanceof W.AudioParam');
      return 'instanceof works';
    },
  }),
  row({
    group: AP,
    name: '`value`',
    covered: 'yes',
    how: RNAA,
    strudel: 'yes',
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
    how: `rn-web-audio-compat alias to ${RNAA}'s \`onEnded\` (without it, browser-style cleanup never runs)`,
    source: G('onended'),
    strudel: 'yes',
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
    how: `${RNAA} (patched: plain number arrays, as the spec allows, used to throw); global`,
    source: `${G('PeriodicWave')}, ${PATCH}`,
    strudel: 'yes',
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
    how: `${RNAA} (patched). Set \`buffer\` BEFORE connecting the node's output: an unpatched convolver processed without an impulse response crashes on the audio thread, and replacing the buffer of a running convolver can still race inside the library. Cost grows with the impulse response length: for reverb, prefer \`createFdnReverbNode\``,
    source: PATCH,
    strudel: 'yes',
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
    how: `${RNAA} (patched: a \`curve\` in the constructor options used to be ignored); the global is an explicit-stereo subclass`,
    source: `${G('WaveShaperNode')}, ${PATCH}`,
    strudel: 'yes',
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
    how: `${RNAA} (patched: the getter always returned null); can only be set once per node; input is clamped to [-1, 1]`,
    source: PATCH,
    strudel: 'yes',
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
    how: 'rn-web-audio-compat: a C++ kernel on a patched WorkletProcessingNode (JS worklet fallback); global',
    source: '[DynamicsCompressorNode.ts](src/nodes/DynamicsCompressorNode.ts), [Kernels.cpp](native/rnaa-0.13.5/files/common/cpp/audioapi/dsp/rnwac/Kernels.cpp)',
    strudel: 'yes',
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
    covered: 'yes',
    how: 'rn-web-audio-compat: AudioParam-like params read by the kernel',
    source: '[DynamicsCompressorNode.ts](src/nodes/DynamicsCompressorNode.ts)',
    strudel: 'yes',
    test: (t) => {
      const c = new W.DynamicsCompressorNode(t.ctx);
      c.threshold.value = -12;
      c.ratio.value = 4;
      t.expect(c.threshold.value === -12 && c.ratio.value === 4, 'not set');
      return 'set / read back';
    },
  }),
  notImplemented(DC, '`reduction`'),
];

// ------------------------------------------------------------------------------------------------------------------
const CH = 'ChannelMergerNode and ChannelSplitterNode';
const channels: CoverageRow[] = [
  row({
    group: CH,
    name: '`ChannelMergerNode` constructor',
    covered: 'partial',
    how: 'rn-web-audio-compat: a stereo pass-through GainNode (no per-channel routing; the library ignores connect() indices); global',
    source: '[channelRoutingNodes.ts](src/nodes/channelRoutingNodes.ts)',
    strudel: 'yes',
    test: async (t) => {
      const m = new W.ChannelMergerNode(t.ctx, { numberOfInputs: 2 });
      const rms = await gainOf(t, m);
      // A real merger puts a mono input on one channel (0.5 after the analyser's downmix); the stereo pass-through
      // passes it on both (1.0).
      t.expect(rms > 0.4, `rms ${fmt(rms)}`);
      return `passes signal (${fmt(rms)})`;
    },
  }),
  row({
    group: CH,
    name: '`ChannelSplitterNode` constructor',
    covered: 'partial',
    how: 'rn-web-audio-compat: a stereo pass-through GainNode; global',
    source: '[channelRoutingNodes.ts](src/nodes/channelRoutingNodes.ts)',
    strudel: 'yes',
    test: async (t) => {
      const s = new W.ChannelSplitterNode(t.ctx, { numberOfOutputs: 2 });
      const rms = await gainOf(t, s);
      t.expect(rms > 0.5, `rms ${fmt(rms)}`);
      return 'passes signal';
    },
  }),
];

// ------------------------------------------------------------------------------------------------------------------
const PAN = 'PannerNode and AudioListener (3D spatialization)';
const panner: CoverageRow[] = [
  '`PannerNode` constructor',
  '`PannerNode.panningModel`',
  '`PannerNode.distanceModel`',
  '`PannerNode.refDistance` / `maxDistance` / `rolloffFactor`',
  '`PannerNode.coneInnerAngle` / `coneOuterAngle` / `coneOuterGain`',
  '`PannerNode.positionX/Y/Z`',
  '`PannerNode.orientationX/Y/Z`',
  '`PannerNode.setPosition()` / `setOrientation()`',
  '`AudioListener.positionX/Y/Z`',
  '`AudioListener.forwardX/Y/Z` / `upX/Y/Z`',
  '`AudioListener.setPosition()` / `setOrientation()`',
].map((name) => notImplemented(PAN, name));

// ------------------------------------------------------------------------------------------------------------------
const MS = 'Media stream / element nodes';
const media: CoverageRow[] = [
  row({
    group: MS,
    name: '`MediaElementAudioSourceNode.mediaElement`',
    covered: 'partial',
    how: `${RNAA} (with its own \`Audio\` element)`,
    strudel: 'no',
    test: (t) => {
      t.expect(typeof t.ctx.createMediaElementSource === 'function', 'missing');
      return 'factory present';
    },
  }),
  notImplemented(MS, '`MediaStreamAudioSourceNode.mediaStream`'),
  notImplemented(MS, '`MediaStreamTrackAudioSourceNode`'),
  notImplemented(MS, '`MediaStreamAudioDestinationNode.stream`'),
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
