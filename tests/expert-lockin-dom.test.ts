// The Lock in panel (src/client/ui/expert/lockin.ts) in headless Chromium with every client stylesheet, the office's
// answers faked: ✕ top right, Esc and ✕ give focus back to the Lock in button; Run the checks off while the session
// works (and says why); Merge to main off until a failure is accepted by name and the data impact confirmed, then
// posted with exactly those; the Free App steps; Deploy blocked by demo users; Close phase after the merge; phone
// width without a horizontal scroll. Nothing here says "floor".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import type { LockInView } from '../src/shared/expert-lockin.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
function sheets(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(root, dir)).sort()) {
    const p = path.join(dir, e);
    if (statSync(path.join(root, p)).isDirectory()) out.push(...sheets(p));
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

const SHA = 'a3f91c2e5b7d4c1f8e9a0b2c3d4e5f6a7b8c9d0e';
const now = Date.now();
const base: LockInView = { floor: 'demo', branch: 'session/main', head: SHA, main: 'b'.repeat(40), ahead: 12, running: false, newer: 0, licence: 'free', demoUsers: { on: true, count: 6, known: true }, deploy: { allowed: false, why: 'Free App: there is no deploy API. Publish from Studio Pro instead' }, decisions: 4 };
const FRESH: LockInView = { ...base, busy: 'The session is working' };
const DONE: LockInView = {
  ...base,
  run: {
    id: 'r1',
    commit: SHA,
    by: 'Pat',
    startedAt: now - 292_000,
    finishedAt: now,
    checks: [
      { kind: 'mx-check', name: 'mx check', status: 'passed', summary: '0 errors' },
      { kind: 'microflow-tests', name: 'Microflow tests', status: 'warn', summary: 'None in this app', prompt: 'Add tests' },
      { kind: 'journeys', name: 'Journeys', status: 'failed', summary: '33 of 34 passed', detail: 'Failed at this commit: J-04', prompt: 'Fix J-04' },
      { kind: 'lint', name: 'Lint', status: 'passed', summary: '0 errors · 0 new' },
    ],
  },
  impact: { status: 'impact', lines: ['may drop data in Sales.Order.Notes'] },
  phase: { id: 'ph-2', name: 'Orders', order: 2, of: 4, rowsDone: 4, rows: 4, complete: true },
};
const MERGED: LockInView = { ...DONE, impact: undefined, merged: { merge: 'c'.repeat(40), sha: SHA, into: 'main', by: 'Pat', at: now, newer: 0, commits: 12, push: 'ok', session: 'fast-forward', accepted: ['Journeys'] } };

test('the panel is opened from the Session header, nothing of it in lite.ts', () => {
  assert.match(read('src/client/ui/expert/page.ts'), /openLockIn\(store\.floor, lockIn\)/);
  assert.doesNotMatch(read('src/client/lite.ts'), /lockin/i);
});

const chrome = findChrome();
test('in a browser: ✕, Esc and focus, busy, accept by name, data impact, Free App steps, deploy blocked, close phase, phone width', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: { contents: `import { openLockIn } from './lockin'; window.T = { open: () => openLockIn('demo', document.getElementById('opener')) };`, resolveDir: path.join(root, 'src/client/ui/expert'), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const css = sheets('src/client')
    .filter((f) => !/login\.css$|[\\/]mobile[\\/]|[\\/]first-run[\\/]/.test(f))
    .map((f) => read(f).replace(/@import[^;]+;/g, ''))
    .join('\n');
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    const posted: { path: string; body: Record<string, unknown> }[] = [];
    let view: LockInView = FRESH;
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://office.test/**', async (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="portal-light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style></head><body class="lite"><main class="lite-main" style="padding:16px"><button id="opener" class="btn primary">Lock in</button></main><div id="modal-root"></div><div id="toasts"></div></body></html>` });
      if (u.pathname === '/api/expert/lockin') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(view) });
      if (u.pathname.startsWith('/api/expert/lockin/')) {
        posted.push({ path: u.pathname, body: JSON.parse(r.request().postData() ?? '{}') });
        if (u.pathname.endsWith('/merge')) view = MERGED;
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
      return r.fulfill({ status: 404, body: '' });
    });
    await page.goto('http://office.test/');
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const T = <R>(js: string) => page.evaluate(js) as Promise<R>;
    const text = () => T<string>(`document.querySelector('.xl').innerText`);
    const open = async () => {
      await page.focus('#opener');
      await T(`T.open()`);
      await page.waitForSelector('.xl .xl-row');
    };
    // ✕ top right, Esc gives focus back to the opener.
    await open();
    assert.ok(await T<boolean>(`!!document.querySelector('.xl header .close')`), 'a ✕ in the header');
    assert.match(await text(), /The session is working: wait for the turn to end, or stop it in the session/);
    assert.equal(await T<boolean>(`document.querySelector('.xl-primary').disabled`), true, 'Run the checks is off while the session works');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.xl', { state: 'detached' });
    assert.equal(await T<string>(`document.activeElement?.id`), 'opener', 'Esc: focus back on Lock in');
    await open();
    await page.click('.xl header .close');
    await page.waitForSelector('.xl', { state: 'detached' });
    assert.equal(await T<string>(`document.activeElement?.id`), 'opener', '✕: focus back on Lock in');
    // Checks done with a failure and a data impact: Merge off until both are said.
    view = DONE;
    await open();
    const t = await text();
    assert.match(t, /Journeys\s+33 of 34 passed\s+Failed at this commit: J-04/);
    assert.match(t, /Demo users\s+On \(6\)\s+blocks Deploy only/);
    assert.match(t, /Blocked: Journeys/);
    assert.match(t, /may drop data in Sales\.Order\.Notes/);
    assert.match(t, /Press Run once to check it starts\.[\s\S]*Then press Publish/);
    assert.match(t, /Free App: there is no deploy API/);
    assert.doesNotMatch(t, /\bfloor\b/i);
    assert.equal(await T<boolean>(`document.querySelector('.xl-primary').disabled`), true);
    await page.click('input[data-check="Journeys"]');
    assert.equal(await T<boolean>(`document.querySelector('.xl-primary').disabled`), true, 'still off: the data impact');
    await page.click('.xl-impact-box');
    assert.equal(await T<boolean>(`document.querySelector('.xl-primary').disabled`), false);
    await page.click('.xl-primary');
    await page.waitForSelector('.xl-close-phase');
    assert.deepEqual(posted.at(-1), { path: '/api/expert/lockin/merge', body: { floor: 'demo', commit: SHA, accept: ['Journeys'], confirmImpact: true } });
    assert.match(await text(), /Merged as ccccccc \(12 commits\)\. Pushed to Team Server\. session\/main carries on from it\./);
    assert.match(await text(), /Phase 2 of 4, Orders: all 4 rows done\./);
    await page.click('.xl-close-phase');
    assert.deepEqual(posted.at(-1), { path: '/api/expert/lockin/close-phase', body: { floor: 'demo', phase: 'ph-2' } });
    await page.click('.xl-publish');
    assert.deepEqual(posted.at(-1), { path: '/api/expert/lockin/publish', body: { floor: 'demo' } });
    // Phone width: no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 800 });
    assert.ok(await T<boolean>(`document.querySelector('.xl').getBoundingClientRect().right <= window.innerWidth + 1`), 'the panel fits a phone');
    assert.ok(await T<boolean>(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'no horizontal scroll');
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
