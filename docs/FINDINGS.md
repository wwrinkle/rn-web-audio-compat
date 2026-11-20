# Findings: react-native-audio-api vs. the Web Audio API

What we learned running browser Web Audio code (Strudel/superdough) on
[react-native-audio-api](https://github.com/software-mansion/react-native-audio-api) 0.13.x, on real devices
(iPhone, Pixel 10) and the Android emulator, and what changed with 1.0 (sections say so where they differ). Each item says what goes wrong, why, and what this library does about it.
Source comments refer to these sections by name.

Most of these fail **silently**: no exception and no log, the audio is just wrong. When something sounds off, check this
list before assuming the DSP is wrong.

## Worklet rules

`AudioWorkletNode` here runs a JS `process()` function on react-native-audio-api's worklet runtime (via
react-native-worklets), synchronously from the audio render thread.

- **An exception in a worklet callback kills the app.** The audio thread calls the callback without any guard, so a
  throw goes straight to `std::terminate()` → SIGABRT, with nothing in the JS console. Every callback in this library
  is wrapped in try/catch and silences the block instead.
- **`process()` must be self-contained.** The worklet Babel transform serializes one function. References to other
  module-level bindings (a sibling `const`, a helper function) are not carried over; they fail on the worklet runtime
  even though Jest tests (which call `process()` as a plain function) pass. Nest helpers inside `process()`, or give a
  helper its own `'worklet'` directive and capture it through a local `const`.
- **Allocate buffers in `createState()`**, on the JS thread, not inside `process()`.
- **Never touch a Reanimated `SharedValue` from an audio callback.** Reading one from a non-UI runtime hops
  synchronously onto the UI thread, and writing one queues work there; with the audio thread waiting on the UI thread
  and vice versa, the app deadlocked on Android (ANR). All state shared with the audio thread uses react-native-worklets'
  `Synchronizable` (`getBlocking()` / `setBlocking()`: a plain mutex usable from any thread).
- **Don't read your own writes back through shared state** from the JS thread in one synchronous burst. `LiveAudioParam`
  keeps its automation events in a plain JS array and only *publishes* them to the worklet.
- **Reads are not free.** A `Synchronizable.getBlocking()` from the audio thread costs 10-20 µs; params are cached behind
  one per-node version counter so a block normally does a single read.

## JS on the audio thread is expensive

On a Pixel 10 with Hermes, the DSP math itself is tiny (8-90 µs per 128-frame block on the JS thread), but the same
`process()` runs 2-8x slower inside the worklet runtime, and real-time cadence (cold caches, low clock) adds another
2-4x: 260-520 µs per voice per effect, 10-20% of the 2.67 ms budget each. A few stacked effects exhaust the budget.

Hence the **native kernels**: the patch lets `WorkletProcessingNode` / `WorkletSourceNode` run a registered C++ function
instead of calling JS (see [native/README.md](../native/README.md)). The JS processor stays as the spec (checked
sample-by-sample against the C++ by `scripts/kernel-parity`) and as the fallback (`setNativeProcessorsEnabled(false)`).

## The native graph rejects cycles

Browsers allow a cycle through a `DelayNode` (the classic feedback delay: `delay → gain → delay`). react-native-audio-api's
`HostGraph::addEdge()` rejects **any** cycle, and the JSI `connect()` binding discards the error, so `connect()` returns
normally and the edge simply isn't there: one echo, no repeats.

Fix: effects with feedback keep their loop inside one node. `FeedbackDelayNode` (a C++ kernel with its own delay line)
replaces graph-cycle delays.

## No tail-time

Once every upstream source of a node has stopped, react-native-audio-api stops processing the node. A delay or reverb
whose input went silent is cut off instead of ringing out.

Fix up to 0.13.6: `FeedbackDelayNode` and the FDN reverb kept a silent `ConstantSourceNode` connected (a "keep-alive").
Since 1.0 a node can declare a tail (`requiresTailProcessing` + `computeTailFrames`), and this library's C++ kernel nodes
do (30 s for delay and reverb). JS worklet nodes (react-native-audio-worklets) still have no tail, so in JS-processor mode
`FeedbackDelayNode` still uses the keep-alive and stops it on `disconnect()`.

## Fan-out: nodes process in place

react-native-audio-api nodes (in the default channel-count mode) process in place on their input's buffer, and a node
that was already processed this render quantum hands a second consumer its own, never-written buffer. So a node feeding
two consumers gives the second one silence (reverb/delay sends got nothing), and parallel consumers mutate the shared
source (superdough's vowel filter, five parallel bandpasses, cascaded into silence).

Fix: a node in explicit channel-count mode mixes into its own buffer, which avoids both problems. The `GainNode`,
`StereoPannerNode`, `WaveShaperNode`, `BiquadFilterNode` and `DelayNode` globals are explicit-stereo subclasses, and
`installWebAudioCompat(ctx)` makes the context's `create*()` methods return explicit-stereo nodes too. The
`ChannelMergerNode` / `ChannelSplitterNode` pass-throughs are explicit-stereo as well: when they weren't, an analyser
tapping superdough's output merger (a second consumer) read silence for some patterns and not others, depending on the
order the graph happened to process the two consumers in.

## `onended` and leaked nodes

Fixed upstream in 1.0, which has a native `onended` (and `addEventListener('ended')`). This library's alias is gone: on
1.0 it hid the real property, so nothing fired. Up to 0.13.6: react-native-audio-api only had camelCase `onEnded`. Browser code that registers cleanup with `node.onended = fn` sets a
plain property that is never called, so every node it would have released leaks. In superdough that was every effect
chain of every note: the graph grew by about two worklet nodes a second, timing drifted, and the app eventually crashed.

Fix up to 0.13.6: `globals.ts` defined `onended` on `AudioScheduledSourceNode.prototype`, forwarding to `onEnded`.

## Audio-thread events stop after about six contexts (1.0.1)

Every context claims a block of react-native-audio-api's event queue (256 entries) and never gives it back, so after
about six contexts in the app's lifetime **every audio-thread event is silently dropped**: `onended`,
`onpositionchanged` (which `createAudioClock` ticks on), everything. Upstream knows: a comment in
`events/AudioEventHandlerRegistry.h` says the blocks "are never recycled", and raises the capacity only for its own
test harness (`RN_AUDIO_API_NODE`: 8192). Found with the conformance suite, which makes a context per row: on a Pixel 10
the 7th context got no events (bisected with a probe that re-ran the `onended` row after every row).

Impact: none for an app with one long-lived context (rn-strudel's `initStrudel()` makes one). It bites anything that
creates contexts repeatedly, e.g. a new context per play/stop. Workaround: keep one context for the app's lifetime. The
conformance suite's three event rows (`onended`, `playbackRate`, `start(when, offset, duration)`) fail on 1.0.1 for this
reason only; each passes when run in a fresh app.

## Browser globals and import order

Browser libraries touch Web Audio names as bare globals, at module-evaluation time: `new GainNode(...)`,
`X instanceof AudioNode`, `BaseAudioContext.prototype.createX = ...`, `typeof AudioContext !== 'undefined'` guards.
None of these names are globals on React Native, and each failure looks different: a `ReferenceError` at startup (a
white screen), a feature silently switched off by a `typeof` guard, or an `instanceof` throw that aborts a cleanup loop
halfway and leaks the rest.

Fix: `import 'rn-web-audio-compat/globals'` **first**. ES imports evaluate fully, dependencies included, before the
importing module's own statements, so a global set later in the same file is already too late. When checking a
library for dependencies on globals, search for all four shapes (`new X(`, `instanceof X`, `X.prototype.`, `typeof X`),
and remember that satisfying one `typeof` guard can bring a previously dead code path to life.

## Contexts start on `resume()`

Like a browser context, a new react-native-audio-api `AudioContext` only starts rendering (and `currentTime` only
advances) after `resume()` or once its first source starts.

## Crashes fixed in the native patch (up to 0.13.6)

All reproduced on a device before fixing. Since 1.0 there is no patch (see [native/README.md](../native/README.md));
status on 1.0.1 per item:

- One worklet runtime per context: react-native-audio-worklets uses a single shared audio runtime, which was the fix.
- Unlocked worklet runtime, dangling `AudioParam` inputs: the code involved was rewritten in 1.0 (worklets moved to their
  own package; the graph was refactored). The conformance suite ran clean, but these need their original stress tests
  (create/close cycles with worklet nodes; releasing LFO-modulated filters) before they count as fixed.
- `ConvolverNode` before a buffer is set: fixed upstream (the convolver was redesigned); the conformance rows pass.

Up to 0.13.6:

- **One worklet runtime per context (GC crash).** `AudioContext` created a new worklet runtime for every context. When a
  closed context was collected, its runtime was destroyed while JS objects of its worklet nodes still referenced values
  in it, and destroying those later crashed (SIGSEGV in `worklets::SerializableJSRef` / `jsi::Value::~Value`, on the JS
  or GC thread). Reproduced on a Pixel 10 by creating and closing contexts that host a worklet node (crash at cycle 15
  in one run, 155 in another); with one shared runtime, 2 x 300 cycles ran clean. Sharing is safe because the runtime
  is locked (next item).
- **Unlocked worklet runtime (Hermes crash on node creation).** For the audio runtime the library ran worklet jobs on
  the audio thread without locking the runtime, while the JS thread ran JS on the same runtime to create nodes: Hermes
  SIGSEGV/SIGBUS. The patch always locks.
- **Dangling `AudioParam` inputs.** `AudioParam` keeps raw pointers to the nodes connected to it, and a node being
  disconnected or destroyed didn't remove itself, so the render thread dereferenced a freed modulator (SIGSEGV in
  `AudioParam::processInputs`, after releasing an LFO-modulated filter).
- **`ConvolverNode` before a buffer is set.** The render thread called `.at(0)` on an empty vector (`std::out_of_range`).

## API bugs fixed in the patch (up to 0.13.6)

Found by the conformance suite ([COVERAGE.md](../COVERAGE.md)):

- `AudioParam.value` returned the old value right after a write, until the audio thread caught up. **Still so in
  1.0.1**; since 1.0 `globals.ts` fixes it in JS (the setter remembers the value; automation calls forget it).
- `WaveShaperNode` ignored a `curve` passed to its constructor, and the `curve` getter always returned `null`. Fixed
  upstream in 1.0.
- `new PeriodicWave(ctx, { real, imag })` threw for plain number arrays. Fixed upstream in 1.0.

## Android

- **Underruns.** Oboe's default buffer (about two bursts) leaves no headroom for JS callbacks; the patch uses the
  maximum buffer size (1920 frames, about 40 ms). Latency is higher; for playback it doesn't matter.
- **Screen lock stops JS timers.** React Native on Android drives `setTimeout` / `setInterval` from the display's frame
  callback, which stops when the screen locks, so a `setInterval`-driven scheduler stops scheduling while audio keeps
  rendering. `createAudioClock(ctx)` gives such code a `setInterval` / `clearInterval` clocked by the audio thread.
- **Background audio needs a foreground service.** react-native-audio-api's Expo plugin declares one, but it only runs
  while a playback notification is shown, and Android 13+ needs the `POST_NOTIFICATIONS` permission for that.
  `startBackgroundPlayback()` / `stopBackgroundPlayback()` handle both.

## Development gotchas

- **Stale JS bundle.** Gradle's bundle task doesn't notice changes inside `node_modules`: after changing the patch or
  anything installed there, `rm -rf android/app/build/generated/assets/react` before building, or the old JS ships.
- **Parallel install scripts.** npm runs dependencies' `postinstall` scripts in parallel; `apply-native.js` takes a
  lock so two packages applying native changes at once don't see each other's half-written files.
- **Headless emulator.** Without a display there is no vsync, so `setTimeout` may never fire in the app; wait on audio
  time instead.
- **Crash that happens during startup.** Start capturing the device log *before* launching the app. A crash while
  modules are loading is over in milliseconds, and a capture that starts late looks the same as a hang.
