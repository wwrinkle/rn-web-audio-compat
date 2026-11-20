#!/usr/bin/env node
// Periodic check that the pinned/patched upstream packages listed in .claude/pinned-deps.json are at their latest
// stable release (npm `latest` dist-tag) and, for GitHub-installed libraries, at the remote's HEAD commit.
//
// Run as a Claude Code SessionStart hook (see .claude/settings.json). It only looks things up (registry metadata,
// git ls-remote): it never installs, downloads tarballs or edits files. At most once every `intervalDays`, tracked by
// .claude/pinned-deps-checked.local (gitignored). If anything is behind or inconsistent, it prints hook JSON that
// shows the user a notice and asks Claude to offer the /upgrade-pinned-deps skill, without starting it.
//
//   node .claude/hooks/pinned-deps-check.mjs            hook mode (respects the interval, prints hook JSON)
//   node .claude/hooks/pinned-deps-check.mjs --report   always check, print a plain-text table (used by the skill)
//
// The same script lives in Sound_Walk, rn-web-audio-compat and rn-strudel; keep the copies identical.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = path.join(ROOT, '.claude', 'pinned-deps.json');
const STAMP = path.join(ROOT, '.claude', 'pinned-deps-checked.local');
const REPORT = process.argv.includes('--report');
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const parse = (v) => {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v));
  return m ? m.slice(1, 4).map(Number) : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// Every place a package is declared in the given package.json files: [{ file, field, spec }].
function pinsOf(name, files) {
  const out = [];
  for (const rel of files) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const pkg = readJson(p);
    for (const field of DEP_FIELDS) {
      const spec = pkg[field]?.[name];
      if (spec !== undefined) out.push({ file: rel, field, spec });
    }
  }
  return out;
}

function installedVersion(name) {
  try {
    return readJson(path.join(ROOT, 'node_modules', name, 'package.json')).version;
  } catch {
    return null;
  }
}

async function npmLatest(name) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(`https://registry.npmjs.org/-/package/${name.replace('/', '%2F')}/dist-tags`, {
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).latest;
  } finally {
    clearTimeout(t);
  }
}

function gitHead(repo) {
  const res = spawnSync('git', ['ls-remote', `https://github.com/${repo}.git`, 'HEAD'], {
    encoding: 'utf8',
    timeout: 8000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (res.status !== 0) throw new Error((res.stderr || 'git ls-remote failed').trim());
  return res.stdout.split(/\s/)[0];
}

function lockedCommit(name) {
  try {
    const resolved = readJson(path.join(ROOT, 'package-lock.json')).packages[`node_modules/${name}`]?.resolved;
    return resolved?.split('#')[1] ?? null;
  } catch {
    return null;
  }
}

async function check(config) {
  const issues = [];
  const rows = [];
  const files = config.packageJsons ?? ['package.json'];

  await Promise.all(
    (config.npm ?? []).map(async (dep) => {
      const pins = dep.installedOnly ? [] : pinsOf(dep.name, files);
      const installed = installedVersion(dep.name);
      let latest;
      try {
        latest = await npmLatest(dep.name);
      } catch (err) {
        issues.push(`${dep.name}: registry lookup failed (${err.message})`);
        return;
      }
      // Prefer an exact/tilde/caret pin (what's actually tested) over an open peer range like >=0.10.1.
      const specs = pins.map((p) => p.spec);
      const current = dep.installedOnly
        ? installed
        : specs.find((s) => /^[~^]?\d/.test(s)) ?? specs.find((s) => parse(s)) ?? installed;
      const behind = parse(current) && parse(latest) && cmp(parse(current), parse(latest)) < 0;
      rows.push({ name: dep.name, current: current ?? '?', latest, behind, note: dep.why });
      if (behind) {
        const major = parse(current)[0] !== parse(latest)[0] || (parse(current)[0] === 0 && parse(current)[1] !== parse(latest)[1]);
        issues.push(`${dep.name}: pinned ${current}, latest ${latest}${major ? ' (breaking-range bump)' : ''}`);
      }
      // All exact pins of the same package in this repo should agree.
      const exact = [...new Set(pins.map((p) => p.spec).filter((s) => /^\d/.test(s)))];
      if (exact.length > 1) {
        issues.push(`${dep.name}: pinned to different versions here: ${pins.map((p) => `${p.file} ${p.field} ${p.spec}`).join(', ')}`);
      }
      // What's installed should satisfy an exact pin.
      if (exact.length === 1 && installed && installed !== exact[0]) {
        issues.push(`${dep.name}: package.json pins ${exact[0]} but node_modules has ${installed} (run npm install)`);
      }
      // An exact peer pin in an installed sibling library must match what this repo installs.
      for (const lib of config.peerSources ?? []) {
        let peer;
        try {
          peer = readJson(path.join(ROOT, 'node_modules', lib, 'package.json')).peerDependencies?.[dep.name];
        } catch {
          continue;
        }
        if (peer && /^\d/.test(peer) && installed && installed !== peer) {
          issues.push(`${dep.name}: installed ${installed}, but the installed ${lib} requires exactly ${peer}`);
        }
      }
    })
  );

  for (const dep of config.github ?? []) {
    const locked = lockedCommit(dep.name);
    let head;
    try {
      head = gitHead(dep.repo);
    } catch (err) {
      issues.push(`${dep.name}: could not read ${dep.repo} HEAD (${err.message})`);
      continue;
    }
    const behind = locked && locked !== head;
    rows.push({ name: dep.name, current: locked?.slice(0, 7) ?? '?', latest: head.slice(0, 7), behind, note: dep.why });
    if (behind) issues.push(`${dep.name}: lockfile has ${locked.slice(0, 7)}, ${dep.repo} HEAD is ${head.slice(0, 7)}`);
  }

  return { issues, rows: rows.sort((a, b) => a.name.localeCompare(b.name)) };
}

async function main() {
  if (!fs.existsSync(CONFIG)) return;
  const config = readJson(CONFIG);
  const intervalMs = (config.intervalDays ?? 3) * 86400000;

  if (!REPORT) {
    try {
      if (Date.now() - fs.statSync(STAMP).mtimeMs < intervalMs) return;
    } catch {
      // no stamp yet: check now
    }
  }

  const { issues, rows } = await check(config);
  const lookupFailed = issues.some((i) => /lookup failed|could not read/.test(i));
  // Only start a new interval if the registry answered; otherwise try again next session.
  if (!lookupFailed) fs.writeFileSync(STAMP, new Date().toISOString() + '\n');

  if (REPORT) {
    const w = Math.max(...rows.map((r) => r.name.length), 7);
    console.log(`${'package'.padEnd(w)}  ${'pinned'.padEnd(10)}  ${'latest'.padEnd(10)}`);
    for (const r of rows) console.log(`${r.name.padEnd(w)}  ${String(r.current).padEnd(10)}  ${String(r.latest).padEnd(10)}${r.behind ? '  BEHIND' : ''}`);
    console.log(issues.length ? `\nIssues:\n- ${issues.join('\n- ')}` : '\nAll pinned packages are current and consistent.');
    return;
  }
  if (!issues.length) return;

  const list = issues.map((i) => `- ${i}`).join('\n');
  console.log(
    JSON.stringify({
      systemMessage: `Pinned-dependency check (${path.basename(ROOT)}): ${issues.length} issue(s).\n${list}`,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          `The periodic pinned-dependency check for ${path.basename(ROOT)} found:\n${list}\n\n` +
          'At the start of your first reply in this session, before anything else, tell the user these results in a ' +
          'few lines and ask whether they want you to investigate the newer versions with the /upgrade-pinned-deps ' +
          'skill (it downloads them, checks whether the patches still apply and proposes fixes). Do not start that ' +
          'investigation, install anything or edit files for it without their permission. Then carry on with ' +
          'whatever they asked.',
      },
    })
  );
}

main().catch((err) => {
  // Never break session start over this check.
  console.error(`[pinned-deps-check] ${err.message}`);
  process.exit(0);
});
