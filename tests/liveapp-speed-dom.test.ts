// How fast the live app followed main, on the 🌐 Live app tab (src/client/ui/liveapp/speed.ts), in headless
// Chromium: "⚡ Updated in 9 s (hot reload)" with each phase's time on hover, "Updated in 41 s (restart: domain
// model changed)", the merges one update brought in, the build a docs-only commit is served from, and the
// admins' Hot reload and Keep warm boxes, which send liveapp.prefs. Nothing for someone who isn't an admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import type { LiveAppState } from '../src/shared/protocol.js';

const root = path.join(import.meta.dirname, '..');
const A = 'abc1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const D = 'def5678ddddddddddddddddddddddddddddddddd';
const C = 'c0ffee0ccccccccccccccccccccccccccccccccc';
const base: LiveAppState = { floor: 'f1', status: 'running', phase: 'running', log: [], available: true, branch: 'main', appPort: 8123, served: { sha: D, subject: 'Home page', builtAt: Date.now() - 5_000 }, prefs: { hotReload: true, hotReloadFrom: 'default', keepWarm: false }, hot: { on: true } };

const chrome = findChrome();
test('in a browser: the timing line and why, its phases, grouped merges, and the settings for admins', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: {
      contents: `import { store } from '../state';
        import { liveAppView } from './liveapp';
        store.floor = 'f1';
        window.__sent = [];
        const view = liveAppView({ send(m) { window.__sent.push(m); } }, () => {}, () => true);
        view.render(document.getElementById('host'));
        window.__show = (s, admin) => { store.me = { admin }; view.route({ t: 'liveapp.state', state: s }); };`,
      resolveDir: path.join(root, 'src/client/ui'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.route('**/*', (r) => r.fulfill({ status: 404, body: '' }));
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="lite"><div id="host"></div></body></html>`);
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const look = async (s: LiveAppState, admin = true) => {
      await page.evaluate(([st, a]) => (window as unknown as { __show(s: unknown, a: boolean): void }).__show(st, a as boolean), [s as unknown as Record<string, unknown>, admin] as const);
      return page.evaluate(() => ({
        time: document.querySelector('.ls-time')?.textContent ?? null,
        tip: document.querySelector('.ls-time')?.getAttribute('title') ?? null,
        built: document.querySelector('.ls-built')?.textContent ?? null,
        boxes: [...document.querySelectorAll('.ls-pref')].map((l) => `${l.textContent?.trim()}:${(l.querySelector('input') as HTMLInputElement).checked}`),
        hot: document.querySelector('.ls-hot')?.textContent ?? null,
        run: document.querySelector('.ls-hot-run')?.textContent ?? null,
        locked: (document.querySelector('.ls-pref input') as HTMLInputElement | null)?.disabled ?? null,
      }));
    };

    let v = await look({ ...base, lastUpdate: { mode: 'hot', reason: 'page and logic changes', ok: true, at: Date.now(), totalMs: 9_200, from: A, to: D, phases: [{ name: 'fetch', ms: 300 }, { name: 'classify', ms: 150 }, { name: 'apply', ms: 8_500 }, { name: 'answer', ms: 250 }] } });
    assert.equal(v.time, '⚡ Updated in 9 s (hot reload)');
    assert.equal(v.tip, 'fetch 0.3 s · classify 0.1 s · apply 9 s · first answer 0.3 s');
    assert.deepEqual(v.boxes, ['Hot reload: on (default):true', 'Keep warm:false']);
    assert.equal(v.run, null, 'the run uses what the setting says');
    assert.equal(v.built, null);

    v = await look({ ...base, lastUpdate: { mode: 'restart', reason: 'domain model changed', ok: true, at: Date.now(), totalMs: 41_000, commits: 3, included: [{ sha: C, subject: 'Merge pull request #7' }], phases: [{ name: 'fetch', ms: 400 }, { name: 'classify', ms: 200 }, { name: 'stop', ms: 900 }, { name: 'build', ms: 25_000 }, { name: 'start', ms: 14_500 }] } });
    assert.equal(v.time, '⚡ Updated in 41 s (restart: domain model changed) · 3 commits in one go');
    assert.match(v.tip ?? '', /stop 0\.9 s · build 25 s · runtime start 15 s\nAlso brought in: c0ffee0 Merge pull request #7$/);

    v = await look({ ...base, served: { ...base.served!, built: A }, lastUpdate: { mode: 'none', reason: 'no app files changed', ok: true, at: Date.now(), totalMs: 700, phases: [] } });
    assert.equal(v.time, '⚡ Updated in 0.7 s (no restart: no app files changed)');
    assert.equal(v.built, 'build of abc1234');

    // The boxes send the project's setting.
    await page.click('.ls-pref:nth-of-type(2) input');
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent.filter((m) => (m as { t: string }).t === 'liveapp.prefs')), [{ t: 'liveapp.prefs', keepWarm: true }]);

    // Someone who isn't an admin sees how it went, not the settings.
    v = await look({ ...base, lastUpdate: { mode: 'hot', reason: 'page and logic changes', ok: true, at: Date.now(), totalMs: 9_000, phases: [] } }, false);
    assert.equal(v.time, '⚡ Updated in 9 s (hot reload)');
    assert.deepEqual(v.boxes, []);
    assert.equal(v.hot, 'Hot reload: on (default)', 'everyone sees whether hot reload is on');

    // A run keeps its way until its next start, and memory can make it restart for every change: said beside the setting.
    v = await look({ ...base, prefs: { hotReload: false, hotReloadFrom: 'project', keepWarm: false } });
    assert.deepEqual(v.boxes, ['Hot reload: off:false', 'Keep warm:false']);
    assert.equal(v.run, 'this run keeps hot reload until its next start');
    v = await look({ ...base, hot: { on: false, why: 'only 1.2 GB of 16.0 GB memory free, and a hot-reload app needs about 2.0 GB: this run restarts for every change' } });
    assert.equal(v.run, 'this run restarts for every change: only 1.2 GB of 16.0 GB memory free, and a hot-reload app needs about 2.0 GB');
    v = await look({ ...base, hot: { on: false, why: 'hot reload is off' } });
    assert.equal(v.run, 'this run restarts for every change: hot reload starts with the next start');
    v = await look({ ...base, status: 'stopped', phase: 'stopped', served: undefined, hot: { on: false, why: 'hot reload is off' } });
    assert.equal(v.run, null, 'nothing runs: only the setting');
    // The office turned it off for every project: shown, and the box can't turn it back on.
    v = await look({ ...base, prefs: { hotReload: false, hotReloadFrom: 'office', keepWarm: false }, hot: undefined });
    assert.deepEqual(v.boxes, ['Hot reload: off (for every project on this office):false', 'Keep warm:false']);
    assert.equal(v.locked, true);
    await page.close();
  } finally {
    await browser.close();
  }
});
