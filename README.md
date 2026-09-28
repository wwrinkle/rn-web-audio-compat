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

It was built to run [Strudel](https://strudel.cc) (see [rn-strudel](https://github.com/wwrinkle/rn-strudel)), but
nothing here is Strudel-specific.

- **[COVERAGE.md](COVERAGE.md):** the Web Audio API member by member: covered or not, how, where, and a self-test for
  each. 71% of the whole API, 92% of what Strudel uses.
- **[docs/FINDINGS.md](docs/FINDINGS.md):** everything that behaves differently from a browser, and why. Worth reading
  if you run Web Audio code on React Native, with or without this library.
- **[native/README.md](native/README.md):** the patch this library applies to react-native-audio-api, and how to add
  your own C++ DSP kernels.

## Status

- **Android:** 109/109 conformance tests pass on a Pixel 10 and the emulator, the same as in Chrome.
- **iOS:** 109/109 on an iPhone 13 (iOS 26.5), built by this repo's `iOS example build` workflow.
- **Distribution:** not published to npm. Install from GitHub.
- **react-native-audio-api version:** requires **0.13.5** exactly, because the native patch is version-specific.

## Install

```sh
npm install github:wwrinkle/rn-web-audio-compat react-native-audio-api@0.13.5 react-native-worklets
```

This needs a development build; Expo Go won't work. The `postinstall` step patches `node_modules/react-native-audio-api`
(see [native/README.md](native/README.md)). Also add it to your app's own `postinstall`, so it re-runs after any install:

```json
"scripts": { "postinstall": "rn-web-audio-compat-apply" }
```

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

### Also included

| Export | What it is |
| --- | --- |
| `createFdnReverbNode(ctx, { decayTime, lpFreqStart, lpFreqEnd })` | Algorithmic reverb (C++). Its cost doesn't grow with length. On a Pixel 10: ~41% audio-thread load where a 0.6 s convolution reverb used 78% |
| `FeedbackDelayNode` | Delay with feedback in one node (C++). The graph rejects the usual `DelayNode` cycle |
| `createAudioClock(ctx)` | `setInterval` / `clearInterval` clocked by the audio thread. On Android, JS timers stop when the screen locks |
| `startBackgroundPlayback()` / `stopBackgroundPlayback()` | The Android playback notification and permission that keep audio running under screen lock |
| `measureAudioLoad(ctx, seconds, sleep)`, `assertNativeKernels(ctx, names)` | Audio-thread load measurement; a startup check that the native patch is built in |
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
