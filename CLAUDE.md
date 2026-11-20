# rn-web-audio-compat: notes for working on this repo

Read [README.md](README.md), then [docs/FINDINGS.md](docs/FINDINGS.md) before touching anything that runs on the audio
thread, and [native/README.md](native/README.md) before touching the native module.

- **License boundary:** MIT. Nothing derived from superdough/Strudel (AGPL) goes here, JS or C++. Strudel-specific
  code lives in the sibling repo `rn-strudel`.
- **Single source of truth:** `conformance/rows.ts` feeds COVERAGE.md (`npm run coverage`), the example app and the web
  demo. When you change coverage, change the row, regenerate, and run the suite on web and on a device.
- **Tests are written against the standard Web Audio API** (through `globalThis`), so the web demo runs them unchanged
  in a browser, which is the reference. If a browser disagrees with a test, fix the test.
- **No patches to upstream:** since react-native-audio-api 1.0 the C++ lives in this library's own native module
  (`common/cpp/rnwac/`), on react-native-audio-api's stable extension API; include only
  `<audioapi/compatibility/StableAPI.h>` from it. Keep patches to upstream libraries at zero: anything that can be done in
  this module or in JS goes there, and upstream bugs get reported upstream. After changing a kernel, run
  `npm run parity`.
- **Device runs:** delete `example/android/app/build/generated/assets/react` before `./gradlew :app:assembleRelease`,
  or a stale JS bundle ships. `EXPO_PUBLIC_AUTORUN=1` runs the whole suite on launch; read `[CONFORMANCE]` lines from
  `adb logcat`. Keep the phone unlocked (`adb shell svc power stayon usb`): the app stalls behind the lock screen.
- **Typecheck** with `npm run typecheck` (the example's tsconfig covers `src/` and `conformance/`).
- **iOS:** run the `iOS example build` workflow (free: public repo), sideload the .ipa, read `[CONFORMANCE]` lines
  from the device log (e.g. `pymobiledevice3 syslog live`, started before opening the app).
