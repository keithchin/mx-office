// The 🌐 Live app tab's hint when the app refused a session (src/client/ui/liveapp/session-cap.ts): an
// unlicensed Mendix app keeps only 6 open (shared/liveapp/session-cap.ts). It shows on the runtime log's
// "Maximum number of sessions exceeded" line or a request the runtime answered 402, and goes with a runtime
// start (a restart ends every session), a reset or another project. In headless Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import { CAP_HINT, TRIAL_SESSIONS } from '../src/shared/liveapp/session-cap.js';

const root = path.join(import.meta.dirname, '..');
const chrome = findChrome();

const log = (id: number, message: string, more: Record<string, unknown> = {}) => ({ id, time: `2026-10-18 21:57:0${id}.295`, level: 'warning', node: 'WebUI', message, ...more });

test('the hint: shown on the runtime’s refusal or a 402, gone after a restart', { skip: chrome ? false : 'no Chromium here' }, async () => {
  assert.match(CAP_HINT, new RegExp(`keeps only ${TRIAL_SESSIONS} open at once`));
  const out = await build({
    stdin: { contents: `import { sessionCapHint } from './session-cap'; const c = sessionCapHint(); document.body.append(c.el); window.C = c;`, resolveDir: path.join(root, 'src/client/ui/liveapp'), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const route = (msg: unknown, floor = 'demo') => page.evaluate(([m, f]) => (window as unknown as { C: { route(m: unknown, f: string): void } }).C.route(m, f), [msg, floor] as const);
    const shown = () => page.evaluate(() => { const el = document.querySelector<HTMLElement>('.la-cap')!; return el.hidden ? '' : el.textContent ?? ''; });

    await route({ t: 'liveapp.console', floor: 'demo', reset: true, log: [log(1, 'Core: Initialized license.')] });
    assert.equal(await shown(), '', 'nothing refused: no hint');
    await route({ t: 'liveapp.console', floor: 'other', log: [log(2, 'Maximum number of sessions exceeded! (You are currently using a trial license)')] });
    assert.equal(await shown(), '', 'another project’s app');
    await route({ t: 'liveapp.console', floor: 'demo', log: [log(3, 'Maximum number of sessions exceeded! (You are currently using a trial license)')] });
    assert.equal(await shown(), `${CAP_HINT} (last refused at 21:57:03)`);
    await route({ t: 'liveapp.console', floor: 'demo', log: [log(4, 'runtime start 2026-10-18T22:00:00+08:00', { mark: true, level: 'info', node: 'mxcli' })] });
    assert.equal(await shown(), '', 'a restart ends every session');
    await route({ t: 'liveapp.console', floor: 'demo', net: [{ id: 9, at: Date.now(), method: 'POST', path: '/xas/', status: 402, kind: 'xas', reqHeaders: [] }] });
    assert.match(await shown(), /^The app refused a session/, 'the client’s 402');
    await route({ t: 'floor.enter' });
    assert.equal(await shown(), '');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
