# Native changes to react-native-audio-api

rn-web-audio-compat needs a few changes to react-native-audio-api's own source: crash and API fixes, and a way to run
C++ DSP kernels inside its graph. The library's documented C++ extension API only exists in its nightly builds, so we
patch the stable release instead. This is pinned to **react-native-audio-api 0.13.5**: the install step refuses other
versions.

## How it's applied

`scripts/apply-native.js` runs from this package's `postinstall`. You can also run it yourself as `npx rn-web-audio-compat-apply`.
It works on the installed `node_modules/react-native-audio-api` in two steps:

1. It copies the new files in `rnaa-0.13.5/files/`.
2. It applies `rnaa-0.13.5/rnaa.patch` (edits to existing files) with `git apply`.

The script is idempotent: parts that are already applied are skipped, so it's safe to run more than once. It also takes
a lock, because npm runs different packages' install scripts in parallel. Rebuild the native app after it changes
anything. On Android, also delete `android/app/build/generated/assets/react`: Gradle doesn't notice changes inside
`node_modules` (see [docs/FINDINGS.md](../docs/FINDINGS.md#development-gotchas)).

Recommended: run it from your app's own `postinstall` too. That hook runs after every package is installed, including
after an install that replaced only react-native-audio-api:

```json
"scripts": { "postinstall": "rn-web-audio-compat-apply" }
```

The C++ is shared by iOS and Android. Android's CMake and iOS's podspec pick up new files through their existing globs.

## What the patch changes

| Area | Files | Why |
| --- | --- | --- |
| Native kernels | `core/effects/WorkletProcessingNode.*`, `core/sources/WorkletSourceNode.*`, their host objects, `src/core/Worklet*Node.ts`, `src/jsi-interfaces.ts`; new `dsp/rnwac/*` | `setKernel(id)` / `setKernelParam(i, v)`: the node runs a C++ kernel instead of calling JS on the audio thread |
| Timing | `core/destinations/AudioDestinationNode.cpp`, `BaseAudioContextHostObject.*` | Per-kernel and whole-render-callback timing (`getKernelTimings()`), used by `measureAudioLoad()`, plus the list of registered kernels |
| Shared worklet runtime | `src/AudioAPIModule/AudioAPIModule.ts` | One runtime for every context. A runtime per context crashed during garbage collection after `close()` |
| Runtime lock | `BaseAudioContextHostObject.cpp` | Audio-runtime worklet jobs raced with JS-thread node creation (Hermes crash) |
| Dangling param inputs | `core/AudioNode.cpp`, `core/utils/AudioGraphManager.cpp` | A freed node stayed in the input list of an `AudioParam` it was connected to |
| Convolver | `core/effects/ConvolverNode.cpp` | Crash when rendering before a buffer is set |
| Android buffer | `android/.../AudioPlayer.cpp` | Maximum Oboe buffer: the default one underruns with JS callbacks |
| API fixes | `src/core/AudioParam.ts`, `WaveShaperNode.ts`, `PeriodicWave.ts`, `BaseAudioContext.ts` | Read-after-write for `AudioParam.value`; `WaveShaperNode` curve; `PeriodicWave` from plain arrays |

Details of each problem are in [docs/FINDINGS.md](../docs/FINDINGS.md).

## Native kernels

A kernel is a plain C++ function with no react-native-audio-api types
(`rnaa-0.13.5/files/common/cpp/audioapi/dsp/rnwac/Kernels.h`):

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

Each kernel has a JS processor that serves as its spec: `src/processors/*`.

On the JS side, `registerKernel(name, { id, kind, module, extraParams })` describes a kernel, and
`createNativeKernelNode(ctx, name)` gives you a node running it. To have `new AudioWorkletNode(ctx, name)` use the
kernel, which is how unmodified browser code gets it, register both versions:

```ts
registerWorkletProcessor(name, jsModule); // the JS fallback
registerNativeProcessor(name, (ctx, opts) => createNativeKernelNode(ctx, name, opts));
```

### Adding kernels from another package

Another package can add kernels without editing any file this patch touches, so both can be applied in any order and
re-applied safely. (rn-strudel does it this way.)

1. Put your C++ in **new** files under `common/cpp/audioapi/dsp/rnwac_ext/` in react-native-audio-api, including
   `Extensions.h` declaring `namespace rnwac_ext { void registerKernels(); }`. If that header exists at build time,
   `Kernels.cpp` calls `rnwac_ext::registerKernels()` the first time the registry is used. Register with
   `rnwac::registerKernel(id, "name", fn)`, using ids 100-255.
2. Copy the files in your own install step:

   ```js
   const { applyExtensionFiles } = require('rn-web-audio-compat/scripts/apply-native');
   applyExtensionFiles('my-package', path.join(__dirname, '../native/files'));
   ```

   This applies rn-web-audio-compat's patch first if it isn't applied yet, under the same lock.
3. In JS, call `registerKernel()` for each kernel. At startup, call `assertNativeKernels(ctx, [...names])` so a missing
   native build fails loudly instead of silently falling back to JS.

### Checking a kernel against its JS spec

`scripts/kernel-parity/run.sh <jest test> [extension dir]` runs on a desktop, with no device:

1. A Jest test runs each JS processor over deterministic multi-block input and writes the expected output.
2. `parity.cpp` runs the C++ kernels on the same input and requires the output to match within 2e-6 per sample.

`npm run parity` runs it for this library's kernels.

## Updating the patch

```sh
scripts/rnaa-dev.sh checkout   # native/.work/package = pristine 0.13.5 (a git repo) with rnaa.patch applied
# edit files under native/.work/package (NEW files go in native/rnaa-0.13.5/files instead)
scripts/rnaa-dev.sh regen      # rewrites rnaa.patch from native/.work/package
```

`native/.work` is git-ignored.
