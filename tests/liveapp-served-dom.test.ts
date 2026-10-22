// The live app's served revision on the page (src/client/ui/liveapp.ts), in headless Chromium: the Live app
// tab and its chip say which build serves against the one it's updating to ("Running abc1234 · updating to
// def5678…"), an update that failed with the old build still serving ("Update to def5678 failed · still
// running abc1234"), and nothing running when that's true; the 📦 commit is only ever the served one.
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
const base: LiveAppState = { floor: 'f1', status: 'running', phase: 'running', log: [], available: true, branch: 'main', appPort: 8123 };
const served = { sha: A, subject: 'Order list', builtAt: Date.now() - 60_000 };

const chrome = findChrome();
test('in a browser: running against updating, a failed update still running the old build, nothing running', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: {
      contents: `import { store } from '../state';
        import { liveAppView } from './liveapp';
        store.floor = 'f1';
        const view = liveAppView({ send() {} }, () => {}, () => true);
        const host = document.getElementById('host');
        view.render(host);
        view.mountChip(document.getElementById('summary'));
        window.__show = (s) => view.route({ t: 'liveapp.state', state: s });`,
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
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="lite"><div id="summary"><span class="sm-name">Demo</span></div><div id="host"></div></body></html>`);
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const look = async (s: LiveAppState) => {
      await page.evaluate((st) => (window as unknown as { __show(s: unknown): void }).__show(st), s as unknown as Record<string, unknown>);
      return page.evaluate(() => ({
        rev: document.querySelector('.la-rev')?.textContent ?? null,
        commit: document.querySelector('.la-commit code')?.textContent ?? null,
        chip: document.querySelector('.la-chip')?.textContent ?? '',
        pill: document.querySelector('.la-pill')?.textContent ?? '',
      }));
    };

    let v = await look({ ...base, served });
    assert.equal(v.rev, null, 'plain running: the 📦 line says it, no second line');
    assert.equal(v.commit, 'main @abc1234');
    assert.equal(v.chip, '🌐 Live app: running · abc1234');

    v = await look({ ...base, status: 'updating', phase: 'building', served, target: { sha: D, from: A } });
    assert.equal(v.rev, 'Running abc1234 · updating to def5678…');
    assert.equal(v.commit, 'main @abc1234', 'the commit shown is the served one, never the target');
    assert.equal(v.chip, '🌐 Live app: Running abc1234 · updating to def5678…');

    v = await look({ ...base, status: 'updating', phase: 'building', lastServed: { ...served, until: Date.now() }, target: { sha: D, from: A } });
    assert.equal(v.rev, 'Updating to def5678… · nothing running (abc1234 stopped for the build)');
    assert.equal(v.commit, null, 'nothing serves: no commit is called running');
    assert.equal(v.pill, 'updating to def5678…');

    v = await look({ ...base, served, failure: { kind: 'update', at: Date.now(), why: "The project's folder has no main branch", lines: [], sha: D } });
    assert.equal(v.rev, 'Update to def5678 failed · still running abc1234');
    assert.equal(v.commit, 'main @abc1234');
    assert.equal(v.chip, '🌐 Live app: running · abc1234 · update failed');

    v = await look({ ...base, status: 'failed', phase: 'failed', appPort: undefined, lastServed: { ...served, until: Date.now() }, target: { sha: D, from: A }, failure: { kind: 'build', at: Date.now(), why: 'mxcli exited (code 1)', lines: [], sha: D } });
    assert.equal(v.rev, 'Update to def5678 failed · nothing running');
    assert.equal(v.commit, null);

    v = await look({ ...base, status: 'stopped', phase: 'stopped', appPort: undefined, lastServed: { ...served, until: Date.now() } });
    assert.match(v.rev ?? '', /^Nothing running · last ran abc1234 until \d\d:\d\d$/);
    assert.equal(v.commit, null);
    await page.close();
  } finally {
    await browser.close();
  }
});
