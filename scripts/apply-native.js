#!/usr/bin/env node
// rn-web-audio-compat no longer patches react-native-audio-api (since 1.0 it is a native module of its own, built on
// react-native-audio-api's stable extension API; see native/README.md). The one install-time step left is for extension
// libraries: copying their C++ kernels into this package's common/cpp/rnwac_ext/, where the CMakeLists.txt and podspec
// globs compile them into this module. Kernels.cpp registers them through rnwac_ext::registerKernels().
//
// Only NEW files: an extension never edits this library's own files. Idempotent, and it takes a lock because npm runs
// different packages' install scripts in parallel. Rebuild the native app after it changes anything.

const fs = require('fs');
const path = require('path');

const EXT_DIR = path.resolve(__dirname, '..', 'common', 'cpp', 'rnwac_ext');

// Copies every file under `fromDir` into `toDir` at the same relative path. Returns the number changed.
function copyTree(fromDir, toDir) {
  let changed = 0;
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(fromDir, rel))) {
      const r = path.join(rel, name);
      const src = path.join(fromDir, r);
      if (fs.statSync(src).isDirectory()) {
        walk(r);
        continue;
      }
      const dst = path.join(toDir, r);
      const next = fs.readFileSync(src);
      if (fs.existsSync(dst) && Buffer.compare(fs.readFileSync(dst), next) === 0) continue;
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, next);
      changed += 1;
    }
  };
  walk('');
  return changed;
}

// Cross-process lock (mkdir is atomic). Waits up to 2 minutes; a lock older than that is treated as stale.
function withLock(fn) {
  fs.mkdirSync(path.dirname(EXT_DIR), { recursive: true });
  const lockDir = `${EXT_DIR}.lock`;
  const deadline = Date.now() + 120000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      try {
        age = Date.now() - fs.statSync(lockDir).mtimeMs;
      } catch {
        continue;
      }
      if (age > 120000) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`[rn-web-audio-compat] timed out waiting for ${lockDir}`);
      Atomics.wait(pause, 0, 0, 100);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

// For extension libraries: copies the C++ files in `filesDir` (an Extensions.h declaring rnwac_ext::registerKernels(),
// plus its .cpp files) into this package's common/cpp/rnwac_ext/. Returns { extDir, copied }.
function applyExtensionFiles(owner, filesDir) {
  if (!fs.existsSync(filesDir)) throw new Error(`[${owner}] extension kernel directory not found: ${filesDir}`);
  return withLock(() => ({ extDir: EXT_DIR, copied: copyTree(filesDir, EXT_DIR) }));
}

module.exports = { applyExtensionFiles, EXT_DIR };
