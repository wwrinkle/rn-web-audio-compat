import { GROUPS, ROWS } from '../../conformance/rows';
import { runRow, summarize } from '../../conformance/tools';
import { TEST_PROCESSOR_SOURCE } from '../../conformance/testWorklet';
import type { TestEnv, TestResult } from '../../conformance/types';

const loaded = new WeakSet<BaseAudioContext>();
const workletUrl = URL.createObjectURL(new Blob([TEST_PROCESSOR_SOURCE], { type: 'application/javascript' }));

const env: TestEnv = {
  platform: 'web',
  audible: true,
  async createContext(options) {
    const ctx = new AudioContext(options);
    await ctx.resume();
    return ctx;
  },
  async closeContext(ctx) {
    if (ctx.state !== 'closed') await ctx.close();
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async prepareTestWorklet(ctx) {
    if (loaded.has(ctx)) return;
    await ctx.audioWorklet.addModule(workletUrl);
    loaded.add(ctx);
  },
};

const results = new Map<string, TestResult>();
const app = document.getElementById('app')!;
const summary = document.createElement('div');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Minimal markdown for the `how` cells: `code` and [text](link).
function inline(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}

const bar = el('div', 'bar');
const runAll = el('button', undefined, 'Run all');
const audible = el('label');
const box = el('input');
box.type = 'checkbox';
box.checked = true;
box.onchange = () => (env.audible = box.checked);
audible.append(box, ' play sound');
bar.append(runAll, audible, summary);
app.append(bar);

const resultEls = new Map<string, HTMLDivElement>();
for (const group of GROUPS) {
  app.append(el('h2', undefined, group));
  for (const row of ROWS.filter((r) => r.group === group)) {
    const card = el('div', 'row');
    const name = el('div', 'name');
    name.innerHTML = inline(row.name) + `<span class="badge ${row.covered}">${row.covered}</span>`;
    const button = el('button', undefined, row.test ? 'Test' : 'Not implemented');
    button.disabled = !row.test;
    const how = el('div', 'how');
    how.innerHTML = inline(row.how);
    const result = el('div', 'result');
    resultEls.set(row.id, result);
    button.onclick = async () => {
      button.disabled = true;
      result.textContent = 'running…';
      const r = await runRow(row, env);
      show(row.id, r);
      button.disabled = false;
    };
    card.append(name, button, how, result);
    app.append(card);
  }
}

function show(id: string, r: TestResult): void {
  results.set(id, r);
  const e = resultEls.get(id)!;
  e.className = `result ${r.ok ? 'ok' : 'fail'}`;
  e.textContent = `${r.ok ? 'PASS' : 'FAIL'}: ${r.detail} (${r.ms} ms)`;
  summary.textContent = summarize(results, ROWS);
}

runAll.onclick = async () => {
  runAll.disabled = true;
  for (const row of ROWS) {
    if (!row.test) continue;
    resultEls.get(row.id)!.textContent = 'running…';
    show(row.id, await runRow(row, env));
  }
  runAll.disabled = false;
};

// `#run` in the URL: run everything on load (for headless/automated checks) and expose the results.
if (location.hash === '#run') {
  env.audible = false;
  void (async () => {
    for (const row of ROWS) if (row.test) show(row.id, await runRow(row, env));
    (window as unknown as { __results: unknown }).__results = Object.fromEntries(results);
    document.title = 'DONE';
  })();
}
