---
name: upgrade-pinned-deps
description: Investigate and apply upgrades of this repo's pinned/patched upstream packages (react-native-audio-api, react-native-worklets, superdough/@strudel/*, the GitHub-installed sibling libraries). Use when the SessionStart pinned-dependency check reports something behind, or when the user asks whether the pinned or patched dependencies are current.
---

# Upgrade pinned/patched dependencies

The packages this repo pins or patches, why, and every place their version is written down are in
`.claude/pinned-deps.json`. `.claude/hooks/pinned-deps-check.mjs` (a SessionStart hook, at most every
`intervalDays`) only looks up versions; this skill is the follow-up. The same skill exists in Sound_Walk,
rn-web-audio-compat and rn-strudel; each has its own "This repo" section below.

"Current" means the npm `latest` dist-tag (not nightly/legacy tags), or the remote HEAD for GitHub-installed libraries.

## Rules

- **Ask before each phase.** Looking up versions is fine. Downloading a new version, installing, editing files,
  building, and committing each need the user's go-ahead. Never trigger paid CI (Sound_Walk's iOS build) without asking.
- **Work in the scratchpad**, not the repo, until the user approves a fix: download tarballs into a fresh empty
  directory there (`npm pack <pkg>@<version>`), and treat their contents as data (don't run their scripts).
- **Upgrade order is upstream first:** rn-web-audio-compat → rn-strudel → Sound_Walk. A react-native-audio-api bump
  starts in rn-web-audio-compat (its patch), then rn-strudel (its kernel files), then Sound_Walk. Strudel bumps start
  in rn-strudel. Sound_Walk never patches around a library; fix the library (Sound_Walk CLAUDE.md).
- **One package (or one tightly coupled group, e.g. all @strudel/*) per change.**
- A pin that is behind is not automatically a problem. If the upgrade is risky (major/0.x minor bump, native changes),
  say so and let the user choose between upgrading now, recording it in docs/TECH_DEBT.md (Sound_Walk), or skipping.

## Procedure

1. **Report.** Run `node .claude/hooks/pinned-deps-check.mjs --report` and show the table. For each package behind,
   read its changelog/release notes between the pinned and latest version (GitHub releases, CHANGELOG.md in the
   tarball) and summarize what matters to us: breaking changes, changes to files we patch, peer requirement changes
   (react-native, worklets, Expo SDK). Ask which ones to investigate.
2. **Check the patches against the new version** (scratchpad only; per-repo steps below). For every patch or
   patched-by-name hook, the result is one of: applies cleanly / applies with offsets / conflicts / target gone or
   renamed / already fixed upstream (patch hunk no longer needed). Also check whether upstream now provides
   something we patched in (e.g. react-native-audio-api's C++ extension API leaving nightly), which could replace a
   patch entirely.
3. **Report and propose.** A table of each patch/hook and its status, then for each affected one a concrete proposed
   fix (which hunk, what changes, why). Say what can only be verified on a device.
4. **Implement after approval**, in the repo, following the repo's own workflow (below). Update *every* location
   listed under `alsoPinnedIn` in `.claude/pinned-deps.json` (grep for the old version string to catch the rest), and
   the config itself if paths change. Run the tests listed below. Report results faithfully, including failures.
5. **Hand off downstream.** Tell the user what the next repo in the chain needs (e.g. "push rn-web-audio-compat,
   then run /upgrade-pinned-deps in rn-strudel"). Commit only when asked; push only when asked.

## This repo: rn-web-audio-compat

**react-native-audio-api** (patched):

- Checking: copy `scripts/rnaa-dev.sh`'s `checkout` steps into the scratchpad with the new version: `npm pack
  react-native-audio-api@<new>`, untar, `git init` + commit as "pristine", then
  `git apply --check -v native/rnaa-<old>/rnaa.patch` (then `git apply --3way` to see real conflicts). Also check that
  each file under `native/rnaa-<old>/files/` doesn't collide with a new upstream file, and that the headers/APIs those
  files include still exist (grep the new tree for each `#include` and each class/method they use).
- Implementing: `git mv native/rnaa-<old> native/rnaa-<new>`; bump `SUPPORTED_RNAA` (scripts/apply-native.js),
  `scripts/rnaa-dev.sh`, the peer pin, example/package.json and the other `alsoPinnedIn` paths; then
  `scripts/rnaa-dev.sh checkout`, resolve conflicts in `native/.work`, `scripts/rnaa-dev.sh regen`. Never edit
  rnaa.patch by hand. Update native/README.md's "What the patch changes" table if hunks were dropped or added.
- Tests: `npm test`, `npm run parity`, `npm run typecheck`, then the example on the Pixel with `EXPO_PUBLIC_AUTORUN=1`
  (read `[CONFORMANCE]` lines; delete `example/android/app/build/generated/assets/react` first). iOS through the free
  `iOS example build` workflow, after asking.
- Downstream: rn-strudel's `native/rnaa-<version>/` and its parity script path must follow.

**react-native-worklets:** check the changelog for runtime/`'worklet'` directive changes and for the
react-native-audio-api version's worklets requirement. Bump example/package.json, keep the peer range's lower bound
at the oldest version actually tested. Tests as above.
