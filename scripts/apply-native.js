#!/usr/bin/env node
// Applies rn-web-audio-compat's native changes to the app's installed react-native-audio-api:
//   1. copies the new source files in native/rnaa-<version>/files/ (kernel registry, host objects), and
//   2. applies native/rnaa-<version>/rnaa.patch (edits to existing library files).
// Idempotent: already-applied parts are skipped, so it is safe to run from this package's postinstall AND from the
// app's own postinstall (recommended: the app's runs last, after every package is installed, and also after an install
// that replaced only react-native-audio-api). After it changes anything, rebuild the native app.
//
// Other libraries extend the native side by adding NEW files only (see native/README.md), via applyExtensionFiles().
//
// Usage: npx rn-web-audio-compat-apply [--rnaa <path to react-native-audio-api>]

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SUPPORTED_RNAA = '0.13.5';
const TAG = '[rn-web-audio-compat]';

function findRnaaDir(explicit) {
  if (explicit) return path.resolve(explicit);
  const bases = [process.env.INIT_CWD, process.cwd(), path.resolve(__dirname, '..')].filter(Boolean);
  for (const base of bases) {
    try {
      return path.dirname(require.resolve('react-native-audio-api/package.json', { paths: [base] }));
    } catch {
      // try the next base
    }
  }
  return null;
}

// Runs git apply against files in `dir`. GIT_CEILING_DIRECTORIES keeps git from discovering an enclosing repository
// (e.g. the app's), which would otherwise make it resolve patch paths from that repo's root and silently skip them.
function gitApply(dir, patchFile, args) {
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const res = spawnSync('git', ['apply', '-p1', ...args, patchFile], { cwd: dir, env, encoding: 'utf8' });
  if (res.error) throw new Error(`${TAG} could not run git (needed to apply the patch): ${res.error.message}`);
  return res;
}

// Copies every file under `filesDir` into `rnaaDir` at the same relative path. Returns the number changed.
function copyTree(filesDir, rnaaDir) {
  let changed = 0;
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(filesDir, rel))) {
      const r = path.join(rel, name);
      const src = path.join(filesDir, r);
      if (fs.statSync(src).isDirectory()) {
        walk(r);
        continue;
      }
      const dst = path.join(rnaaDir, r);
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

function checkVersion(rnaaDir, owner) {
  const version = JSON.parse(fs.readFileSync(path.join(rnaaDir, 'package.json'), 'utf8')).version;
  if (version !== SUPPORTED_RNAA) {
    throw new Error(
      `${owner} supports react-native-audio-api ${SUPPORTED_RNAA} exactly, found ${version} at ${rnaaDir}. ` +
        `Install react-native-audio-api@${SUPPORTED_RNAA}.`
    );
  }
}

function applyCompat(rnaaDir) {
  checkVersion(rnaaDir, 'rn-web-audio-compat');
  const nativeDir = path.resolve(__dirname, '..', 'native', `rnaa-${SUPPORTED_RNAA}`);
  const copied = copyTree(path.join(nativeDir, 'files'), rnaaDir);
  const patchFile = path.join(nativeDir, 'rnaa.patch');
  let patched = 'already applied';
  if (gitApply(rnaaDir, patchFile, ['--check', '--reverse']).status !== 0) {
    const check = gitApply(rnaaDir, patchFile, ['--check']);
    if (check.status !== 0) {
      throw new Error(
        `${TAG} rnaa.patch does not apply to ${rnaaDir} (files modified by something else?):\n${check.stderr}` +
          'Reinstall react-native-audio-api (e.g. delete it from node_modules and npm install), then run this again.'
      );
    }
    const res = gitApply(rnaaDir, patchFile, []);
    if (res.status !== 0) throw new Error(`${TAG} git apply failed:\n${res.stderr}`);
    patched = 'applied';
  }
  return { copied, patched };
}

// For extension libraries: ensure the compat patch is in place, then copy their own new files (never edits).
function applyExtensionFiles(owner, filesDir, rnaaDirArg) {
  const rnaaDir = findRnaaDir(rnaaDirArg);
  if (!rnaaDir) {
    console.warn(`[${owner}] react-native-audio-api not found; skipping native setup.`);
    return null;
  }
  const compat = applyCompat(rnaaDir);
  checkVersion(rnaaDir, owner);
  const copied = copyTree(filesDir, rnaaDir);
  return { rnaaDir, compat, copied };
}

function main() {
  const i = process.argv.indexOf('--rnaa');
  const rnaaDir = findRnaaDir(i > 0 ? process.argv[i + 1] : undefined);
  if (!rnaaDir) {
    console.warn(`${TAG} react-native-audio-api not found; skipping native setup.`);
    return;
  }
  const { copied, patched } = applyCompat(rnaaDir);
  console.log(`${TAG} ${rnaaDir}: patch ${patched}, ${copied} file(s) copied.` + (copied || patched === 'applied' ? ' Rebuild the native app.' : ''));
}

module.exports = { applyCompat, applyExtensionFiles, findRnaaDir, SUPPORTED_RNAA };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
