# rn-web-audio-compat's native module

rn-web-audio-compat runs C++ DSP kernels inside react-native-audio-api's audio graph, so effects like the feedback
delay, compressor and FDN reverb cost no JS on the audio thread. Since react-native-audio-api 1.0 this is a native
module of its own, built on react-native-audio-api's **stable C++ extension API**
(`<audioapi/compatibility/StableAPI.h>`). Nothing in react-native-audio-api is patched.

Up to 0.13.6 the same kernels ran through a patch (`native/rnaa-0.13.6/rnaa.patch`, 21 files) that taught
react-native-audio-api's worklet nodes a `setKernel()` mode, plus crash and API fixes. 1.0 broke 20 of those 21 files,
which is why the library moved off patching entirely. The patch is in git history (last commit on 0.13.6: 2632765).

**Rule: keep it that way.** If something can't be done from outside react-native-audio-api, first try this module (our
own nodes and host objects), then our JS. Report upstream bugs upstream. A patch is a last resort.

## Layout

| Path | What |
| --- | --- |
| `common/cpp/rnwac/Kernels.{h,cpp}`, `KernelUtil.h` | The kernels and their registry. Plain C++, no react-native-audio-api types |
| `common/cpp/rnwac/KernelNodes.{h,cpp}` | `KernelEffectNode` (subclasses `audioapi::AudioNode`), `KernelSourceNode` (`audioapi::AudioScheduledSourceNode`), `KernelControlNode`, and the feedback bridge (`FeedbackSendNode`, `FeedbackReturnNode`) |
| `common/cpp/rnwac/KernelNodeHostObjects.{h,cpp}` | Their JS handles: react-native-audio-api's node host objects plus `setKernelParam(i, v)` and `kernelId` |
| `common/cpp/rnwac/Installer.{h,cpp}` | The `__rnwac*` JSI globals (create nodes, kernel timings) |
| `common/cpp/rnwac/NativeWebAudioCompatModule.*`, `src/specs/` | The pure C++ TurboModule whose `install()` puts those globals on the runtime |
| `CMakeLists.txt`, `react-native.config.js`, `android/` | Android: autolinked C++ module, links `react-native-audio-api::react-native-audio-api` via Prefab |
| `RNWebAudioCompat.podspec`, `ios/rnwac/` | iOS: pod depending on `RNAudioAPI`, module provider |
| `common/cpp/rnwac_ext/` (git-ignored) | Extension kernels another package copies in (rn-strudel) |

It's modeled on react-native-audio-worklets, upstream's reference extension (react-native-audio-api 1.0 moved the JS
worklet nodes into that package; this library's JS processors run on it). Only `StableAPI.h` may be included from
react-native-audio-api; anything else is internal and may change without notice.

Requires the React Native New Architecture.

## How the nodes behave

- **Effects** are always stereo: channelCountMode `explicit`, 2 channels, so the graph up-mixes a mono input (the 0.13
  patch duplicated the channel by hand).
- **In-place buffers:** react-native-audio-api 1.0 processes a node in place (input buffer = output buffer). Kernels need
  `out` not to alias `in`, so `KernelRunner` copies the input into per-node scratch first.
- **Tails:** an effect created with `tailSeconds > 0` declares `requiresTailProcessing`, so the graph keeps rendering it
  after its input goes silent. 'feedback-delay' and 'fdn-reverb' use 30 s. That replaces the silent keep-alive source
  the 0.13 nodes needed. (JS worklet nodes still have no tail-time and still use the keep-alive.)
- **Param changes** from JS (`setKernelParam`) are queued with `scheduleAudioEvent` and applied on the audio thread at the
  next render quantum. The queued event holds the node's graph handle, so the node can't be freed before it runs.
- **Sources** follow the same playback bookkeeping as react-native-audio-worklets' `WorkletSourceNode`
  (`updatePlaybackInfo`, `handleStopScheduled`).

## Diagnostics

`getNativeTimings()` returns per-kernel cost (count, average and max microseconds per block) for every registered
kernel, and `registeredNativeKernels()` their names. The whole-render-callback "audio load" of 0.13 (measured in a
patched `AudioDestinationNode`) can't be measured from outside, so `measureAudioLoad()` now reports `kernelLoadPct`
(time in this library's kernels / real time) and `null` for the whole-graph fields.

## Native kernels

A kernel is a plain C++ function with no react-native-audio-api types (`common/cpp/rnwac/Kernels.h`):

```cpp
void kernel(const float *const *in, float *const *out, int channels, int frames,
            const double *params, rnwac::KernelState &state, double sampleRate, double currentTime);
```

- `in` is null for source kernels.
- `out` never aliases `in`.
- `params` is a flat array of **doubles**: first the JS processor's `parameterDescriptors`, in order, then any extra
  params the JS kernel entry appends. Doubles, not floats: 32-bit params broke bit-exactness with the JS version.
- `KernelState` is zero-initialised per-node state, including growable buffers for delay lines.

Built-in kernels, ids 1-99:

| Id | Name | Kernel |
| --- | --- | --- |
| 1 | `feedback-delay` | Feedback delay line |
| 2 | `compressor` | Compressor |
| 3 | `fdn-reverb` | 8-line feedback-delay-network reverb |
| 4 | `bit-crusher` | Bit-depth reduction (Tone's `BitCrusher`) |
| 5 | `feedback-comb-filter` | Feedback comb filter (Tone's `FeedbackCombFilter`), 30 s tail |
| 6 | `modulated-delay` | Interpolated delay whose `delayTime` accepts connected signals |

Each kernel has a JS processor that serves as its spec: `src/processors/*`.

Two helper nodes support them:

- **Control node** (`createKernelControlNode`): a `ConstantSource`'s `offset` feeds a node that stores the first sample of
  each block for one kernel param and outputs silence. That gives the param real `AudioParam` automation and modulation
  at block rate.
- **Feedback bridge** (`createFeedbackBridge`): a send node stores each block and a return source plays it one quantum
  later, which closes a loop the graph would otherwise reject. Each pass adds 128 frames.

On the JS side, `registerKernel(name, { id, kind, module, extraParams, tailSeconds })` describes a kernel, and
`createNativeKernelNode(ctx, name)` gives you a node running it. To have `new AudioWorkletNode(ctx, name)` use the
kernel, which is how unmodified browser code gets it, register both versions:

```ts
registerWorkletProcessor(name, jsModule); // the JS fallback
registerNativeProcessor(name, (ctx, opts) => createNativeKernelNode(ctx, name, opts));
```

### Adding kernels from another package

rn-strudel does it this way, without editing any file of this library:

1. Put your C++ in **new** files, including `Extensions.h` declaring `namespace rnwac_ext { void registerKernels(); }`.
   Register with `rnwac::registerKernel(id, "name", fn)`, using ids 100-255, and include `<rnwac/Kernels.h>`.
2. Copy them into this package's `common/cpp/rnwac_ext/` in your own install step. If `<rnwac_ext/Extensions.h>`
   exists at build time, `Kernels.cpp` calls `rnwac_ext::registerKernels()` the first time the registry is used, and the
   CMake and podspec globs compile your `.cpp` files into this module:

   ```js
   const { applyExtensionFiles } = require('rn-web-audio-compat/scripts/apply-native');
   applyExtensionFiles('my-package', path.join(__dirname, '../native/rnwac_ext'));
   ```

3. In JS, call `registerKernel()` for each kernel. At startup, call `assertNativeKernels(ctx, [...names])` so a missing
   native build fails loudly instead of silently falling back to JS.

### Checking a kernel against its JS spec

`scripts/kernel-parity/run.sh <jest test> [extension dir]` runs on a desktop, with no device:

1. A Jest test runs each JS processor over deterministic multi-block input and writes the expected output.
2. `parity.cpp` runs the C++ kernels on the same input and requires the output to match within 2e-6 per sample.

`npm run parity` runs it for this library's kernels.
