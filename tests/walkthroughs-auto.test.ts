// Walkthroughs by themselves, and who they sign in as (./fixtures/walkthroughs/rig.ts: a fake app standing in
// for the office's recording copy): test evidence for main records its passing journeys once per commit with
// no live app at all, a ready milestone too, only with the switch on, Cancel stops a batch and its app; the
// sign-in is the journey runner's identity (project.config.js) and a login form drawn late is waited for; an
// account that isn't let in fails as a sign-in, never as step 1, and no password is written; an app that
// doesn't start is said on every card of its batch. Headless Chromium; skipped where it can't start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { LiveReadiness } from '../src/shared/liveapp/readiness.js';
import { DEMO } from './fixtures/walkthroughs/app.js';
import { browserCheck, done, only, rig } from './fixtures/walkthroughs/rig.js';

const ready = (sha: string, result: 'passed' | 'failed'): LiveReadiness => ({ sha, goal: 'Sample app', ready: true, headline: '', at: 1, milestones: [{ id: 'phase-1', title: 'Requests', rows: [2], inLive: [2], onMain: [], onBranch: [], missing: [], journeys: [{ id: 'new-request', result }], state: result === 'passed' ? 'ready' : 'unverified', line: '' }] });

test('auto-record without a live app: test evidence for main records its passing journeys once per commit, on the office’s own app; switched off records nothing; cancel works', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const r = await rig();
  try {
    assert.deepEqual(await r.w.onTestRuns('demo'), [], 'nothing passed against main yet');
    r.passed = ['new-request'];
    await r.w.setSettings('demo', { autoRecord: false });
    assert.deepEqual(await r.w.onTestRuns('demo'), [], 'switched off: nothing');
    await r.w.setSettings('demo', { autoRecord: true });
    const [batch] = await r.w.onTestRuns('demo');
    assert.match(batch ?? '', /^wb_/);
    assert.deepEqual(await r.w.onTestRuns('demo'), [], 'queued once');
    await r.w.idle();
    const m = (await r.w.store.read('demo', await only(r, 'new-request')))!;
    assert.equal(m.trigger, 'auto');
    assert.equal(m.by, 'Mx Office (build on main passed)');
    assert.equal(m.status, 'passed', JSON.stringify(m.failure));
    assert.equal(m.batch, batch);
    assert.deepEqual(r.boots, [r.sha], 'the office booted its own copy of the app at main');
    assert.deepEqual(await r.w.onTestRuns('demo'), [], 'once per commit, also after it was recorded');
    const news = { key: 'k', kind: 'ready' as const, milestone: 'phase-1', title: 'Requests', at: 1, sha: r.sha };
    assert.deepEqual(await r.w.onReady('demo', news, ready(r.sha, 'passed')), [], 'a ready milestone whose journey is already recorded at this commit');
    assert.deepEqual(await r.w.onReady('demo', news, ready(r.sha, 'failed')), [], 'not verified: nothing');
    // Cancel a running batch: the app it booted is stopped, the rest of the batch never plays.
    const c = await r.w.record('demo', { by: 'Pat' });
    let playing: { n: number; ids: string[] } | undefined;
    while (!playing) {
      const b = (await r.w.view('demo', true)).batches.find((x) => x.id === c && x.phase === 'recording' && /Step/.test(x.line ?? ''));
      if (b) playing = { n: b.n, ids: b.journeys.map((j) => j.id) };
      else await new Promise((x) => setTimeout(x, 30));
    }
    assert.deepEqual(playing.ids, ['approve-request', 'new-request'], 'a batch plays its journeys in file order');
    assert.equal(r.w.cancel('demo', c), true);
    await r.w.idle();
    const after = new Map((await r.w.store.list('demo')).filter((x) => x.batch === c).map((x) => [x.journey.id, x.status]));
    assert.equal(after.get(playing.ids[playing.n - 1]), 'cancelled', 'the one playing is cancelled');
    for (const id of playing.ids.slice(playing.n)) assert.equal(after.has(id), false, 'the rest never started');
    assert.equal(r.stops, 2, 'every app the office booted was stopped');
  } finally {
    await done(r);
  }
});

const CONFIG = `'use strict';
const DEFAULT_USER = '${DEMO.user}';
const DEFAULT_PASS = '${DEMO.password}';
function credentials() { return { user: process.env.TEST_USER || DEFAULT_USER, pass: process.env.TEST_PASS || DEFAULT_PASS }; }
module.exports = { credentials, roles: {} };
`;

test('the sign-in: the journey runner’s identity from project.config.js, a login form that draws late is waited for', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const r = await rig({ config: CONFIG, lateFormMs: 1500 });
  try {
    await r.w.setSettings('demo', { demoUser: 'demo_wrong', demoPassword: 'nope' });
    const v = await r.w.view('demo', true);
    assert.deepEqual(v.identity, { user: DEMO.user, from: 'project-config' });
    await r.w.record('demo', { by: 'Pat', journeys: ['new-request'] });
    await r.w.idle();
    const id = await only(r, 'new-request');
    const m = (await r.w.store.read('demo', id))!;
    assert.equal(m.status, 'passed', JSON.stringify(m.failure));
    assert.equal(m.app.user, DEMO.user);
    assert.equal(m.app.userFrom, 'journey', 'its persona names the runner’s default account');
    const dir = r.w.store.recDir('demo', id);
    for (const f of ['manifest.json', 'captions.vtt', 'chapters.vtt']) assert.ok(!readFileSync(path.join(dir, f), 'utf8').includes(DEMO.password), `no password in ${f}`);
  } finally {
    await done(r);
  }
});

test('an account the app doesn’t let in: the recording fails as a sign-in (“still on the sign-in page”), never as step 1', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const r = await rig({ lateFormMs: 800 });
  try {
    await r.w.setSettings('demo', { demoUser: 'demo_nobody', demoPassword: 'Wrong2025!' });
    await r.w.record('demo', { by: 'Pat', journeys: ['new-request'] });
    await r.w.idle();
    const m = (await r.w.store.read('demo', await only(r, 'new-request')))!;
    assert.equal(m.status, 'error');
    assert.equal(m.failure?.step, undefined);
    assert.match(m.failure?.why ?? '', /^couldn't sign in as demo_nobody: still on the sign-in page/);
    assert.ok(m.steps.every((s) => s.status === 'not-run'), 'no step is blamed for it');
    assert.ok(!JSON.stringify(m).includes('Wrong2025!'), 'the password is never written');
  } finally {
    await done(r);
  }
});

test('the recording app doesn’t start: every journey of the batch says so on its card', async () => {
  const r = await rig();
  try {
    r.bootError = 'mxcli exited (code 1)';
    await r.w.record('demo', { by: 'Pat' });
    await r.w.idle();
    const all = await r.w.store.list('demo');
    assert.deepEqual(all.map((m) => m.journey.id).sort(), ['approve-request', 'new-request']);
    for (const m of all) {
      assert.equal(m.status, 'error');
      assert.match(m.failure?.why ?? '', /the recording app didn’t start: mxcli exited \(code 1\)/);
    }
    assert.equal(r.stops, 0, 'nothing booted, nothing to stop');
  } finally {
    await done(r);
  }
});
