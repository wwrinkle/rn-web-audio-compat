# rn-web-audio-compat

The Web Audio API on React Native, close enough that browser audio code runs unmodified.

[react-native-audio-api](https://github.com/software-mansion/react-native-audio-api) implements most of Web Audio's
nodes natively. This library fills in what it doesn't have, and fixes what behaves differently from a browser:

- **What's missing:**
  - `AudioWorkletNode`
  - `DynamicsCompressorNode`
  - `ChannelMergerNode` / `ChannelSplitterNode`
  - browser-style globals
  - `onended`
  - `OfflineAudioContext.oncomplete`
- **What behaves differently:** graph cycles, fan-out, tail-time, several crashes.

It was built to run [Strudel](https://strudel.cc) (see [rn-strudel](https://github.com/wwrinkle/rn-strudel)), and
runs [Tone.js](https://tonejs.github.io) too (see [Tone.js](#tonejs) below). Nothing in it depends on either.

- **[COVERAGE.md](COVERAGE.md):** the Web Audio API member by member: covered or not, how, where, and a self-test for
  each. 81% of the whole API, 93% of what Strudel uses, 95% of what Tone.js's core and everyday classes use.
- **[docs/FINDINGS.md](docs/FINDINGS.md):** everything that behaves differently from a browser, and why. Worth reading
  if you run Web Audio code on React Native, with or without this library.
- **[native/README.md](native/README.md):** this library's native module (C++ kernel nodes on react-native-audio-api's
  stable extension API; no patches), and how to add your own C++ DSP kernels.

## Status

- **Android:** 122/122 conformance tests pass on a Pixel 10 with react-native-audio-api 1.0.1, the same as in Chrome.
- **iOS:** 122/122 on an iPhone 13 (iOS 26.5) with react-native-audio-api 1.0.1, the same as in Chrome.
- **Tone.js:** all 52 device checks pass on the Pixel 10 and the iPhone 13, including the worklet effects, native delay
  and feedback, `FdnReverb`, `TimeStretchPlayer` and `QueuePlayer`.
- **Known upstream issue:** on 1.0.1, audio-thread events stop after a few contexts
  ([#1487](https://github.com/software-mansion/react-native-audio-api/issues/1487), fix in review).
- **Distribution:** not published to npm. Install from GitHub.
- **react-native-audio-api version:** 1.0.1 or later 1.x. Nothing in it is patched: this library's native module uses
  its stable C++ extension API.

## Install

```sh
npm install github:wwrinkle/rn-web-audio-compat react-native-audio-api@^1.0.1 react-native-audio-worklets react-native-worklets
```

This needs a development build with the New Architecture; Expo Go won't work. The library is an autolinked native
module, so rebuild the native app after installing it. react-native-audio-worklets provides the audio-thread JS worklet
nodes that JS processors run on.

Then rebuild the native app.

## Use

```ts
import 'rn-web-audio-compat/globals'; // FIRST, before any Web Audio library: browser-style globals
import { AudioContext } from 'react-native-audio-api';
import { installWebAudioCompat } from 'rn-web-audio-compat';

const ctx = new AudioContext();
installWebAudioCompat(ctx); // audioWorklet + fan-out-safe create*() methods on this context
await ctx.resume();

// From here on, standard Web Audio:
const osc = new OscillatorNode(ctx, { frequency: 220 });
const comp = new DynamicsCompressorNode(ctx, { threshold: -24, ratio: 8 });
osc.connect(comp).connect(ctx.destination);
osc.start();
```

The globals import has to come first. Libraries touch Web Audio names at module-evaluation time, and imports are
evaluated before the importing file's own code runs.

### AudioWorklet processors

There's no `AudioWorkletGlobalScope` and no code loading. `audioWorklet.addModule()` resolves but loads nothing.
Instead, register processors from JS under the names your code asks for:

```ts
import { registerWorkletProcessor } from 'rn-web-audio-compat';

registerWorkletProcessor('gain-processor', {
  kind: 'effect', // or 'source' (no input)
  parameterDescriptors: [{ name: 'gain', defaultValue: 1 }],
  createState: (sampleRate, processorOptions) => ({}),
  process: (state, input, output, params, frames, sampleRate, currentTime) => {
    'worklet';
    for (let ch = 0; ch < output.length; ch++)
      for (let i = 0; i < frames; i++) output[ch][i] = (input[ch] ?? input[0])[i] * params.gain;
  },
});

const node = new AudioWorkletNode(ctx, 'gain-processor');
node.parameters.get('gain').value = 0.5;
```

`process()` runs on the audio thread, in react-native-worklets' runtime. It must be self-contained, with no references
to other module-level bindings. The rules are in [docs/FINDINGS.md](docs/FINDINGS.md#worklet-rules).

JS on the audio thread is expensive on phones. For anything heavy, write the processor as a C++ kernel and register it
with `registerNativeProcessor`; the JS version stays as the fallback and the spec. See
[native/README.md](native/README.md#native-kernels).

### Tone.js

```ts
import 'rn-web-audio-compat/globals'; // first
import 'rn-web-audio-compat/tone';    // second: before anything imports 'tone'
import * as Tone from 'tone';
import { startTone } from 'rn-web-audio-compat/tone';

await startTone(); // in place of Tone.start(), from a user action

const synth = new Tone.Synth().toDestination();
Tone.getTransport().scheduleRepeat((time) => synth.triggerAttackRelease('C4', '8n', time), '4n');
Tone.getTransport().start();
```

`rn-web-audio-compat/tone` makes the app's one `AudioContext` and gives it to Tone before Tone's own module loads (Tone
would otherwise make a second one). `startTone()` resumes it, drives Tone's clock from the audio thread, so the
transport keeps time with the screen locked, and shows the Android playback notification (`backgroundPlayback: false`
to skip it). Its web build is stock Tone.js with the same exports, so shared code needs no platform checks. Install
`tone` (15.1.22 or later 15.x) yourself.

Tone itself stays unpatched. On React Native this entry point runs Tone's AudioWorklet classes (`Freeverb`, `JCReverb`,
`PluckSynth`, `BitCrusher`) on C++ kernels, and gives `FeedbackDelay`, `PingPongDelay`, `Chorus` and `PitchShift` a
native delay and working feedback. `Panner3D`'s `'HRTF'` still renders as equal-power. Details are in
[docs/FINDINGS.md](docs/FINDINGS.md#tonejs).

It also exports three Tone-style classes, with web versions behind the same API:

| Export | What it is |
| --- | --- |
| `FdnReverb` | A Tone effect on the C++ FDN reverb, much cheaper than `Tone.Reverb`. On web the same algorithm runs as an AudioWorklet (from its TypeScript spec), and joins the signal once `ready` resolves |
| `TimeStretchPlayer` | A `Player` whose `playbackRate` changes speed without changing pitch. On web it extends `GrainPlayer` |
| `QueuePlayer` | Gapless playback of buffers loaded on demand through `load(index)` |

### Also included

| Export | What it is |
| --- | --- |
| `createFdnReverbNode(ctx, { decayTime, lpFreqStart, lpFreqEnd })` | Algorithmic reverb (C++). Its cost doesn't grow with length. On a Pixel 10: ~41% audio-thread load where a 0.6 s convolution reverb used 78% |
| `FeedbackDelayNode` | Delay with feedback in one node (C++). The graph rejects the usual `DelayNode` cycle |
| `rn-web-audio-compat/tone` (`startTone()`, `getToneSetup()`) | Tone.js set up on the app's one context, with a clock that survives the screen lock (see [Tone.js](#tonejs)) |
| `createAudioClock(ctx)` | `setInterval` / `clearInterval` clocked by the audio thread. On Android, JS timers stop when the screen locks |
| `startBackgroundPlayback()` / `stopBackgroundPlayback()` | The Android playback notification and permission that keep audio running under screen lock |
| `measureAudioLoad(ctx, seconds, sleep)`, `assertNativeKernels(ctx, names)` | Audio-thread load measurement; a startup check that the native module and kernels are built in |
| `setNativeProcessorsEnabled(false)` | A/B switch: run the JS processors instead of the native ones |

## Demos and tests

Both demo apps render one row per [COVERAGE.md](COVERAGE.md) entry, from the same source (`conformance/rows.ts`). Each
row has a button that runs its self-test; rows that aren't implemented have a disabled button.

- **`example/`:** Expo app. Run `cd example && npm install && npx expo run:android`. Building with
  `EXPO_PUBLIC_AUTORUN=1` runs every test on launch and logs `[CONFORMANCE]` lines.
- **`web-demo/`:** the same tests in a browser, which is the reference. Run `cd web-demo && npm install && npm run dev`;
  opening `#run` runs everything.

Other checks:

- `npm test`: unit tests.
- `npm run parity`: checks the C++ kernels against their JS specs, sample by sample, on the desktop.
- `npm run coverage`: regenerates COVERAGE.md.

## Credits

Written by **Willie Wrinkle** and **Claude** (Anthropic's AI model, via Claude Code) as co-authors. Claude designed and
wrote most of the code: the compat layer, the native kernels and patch, the conformance suite and these docs. It also
tracked down most of the device bugs in [docs/FINDINGS.md](docs/FINDINGS.md) from crash dumps and logs. Willie directed
the work, made the design decisions and tested everything by ear on real devices.

Built on [react-native-audio-api](https://github.com/software-mansion/react-native-audio-api) by Software Mansion (MIT)
and [react-native-worklets](https://github.com/software-mansion/react-native-reanimated).

## License

MIT, see [LICENSE](LICENSE).
