// Walkthroughs and an unlicensed Mendix app's session cap (shared/liveapp/session-cap.ts says what was
// measured): the fake app (./fixtures/walkthroughs/app.ts) keeps at most `cap`
// sessions, anonymous ones too with guest access, and counts sign-ins and logouts. A batch signs each account
// in once, films every journey on that one session, never loads the app in a context of its own, and signs
// out at the end; a sign-in the app refuses says what the app said and what it means. Headless Chromium;
// skipped where it can't start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { removeDir } from './support/cleanup.js';
import { isSessionCap, TRIAL_SESSIONS } from '../src/shared/liveapp/session-cap.js';
import { CAP_TEXT, DEMO } from './fixtures/walkthroughs/app.js';
import { browserCheck, done, only, rig } from './fixtures/walkthroughs/rig.js';

test('a batch of two journeys as one account: one sign-in, one session, signed out at the end', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const r = await rig({ app: { cap: TRIAL_SESSIONS } });
  try {
    await r.w.record('demo', { by: 'Pat' });
    await r.w.idle();
    const pass = (await r.w.store.read('demo', await only(r, 'new-request')))!;
    const fail = (await r.w.store.read('demo', await only(r, 'approve-request')))!;
    assert.equal(pass.status, 'passed', JSON.stringify(pass.failure));
    assert.equal(fail.status, 'failed', 'the second journey ran on the same session (its step 2 is the one that fails)');
    assert.deepEqual(r.app.signIns(), [DEMO.user], 'signed in once for the batch, not once per journey or per context');
    assert.deepEqual(r.app.logouts(), [DEMO.user], 'signed out when the batch was done');
    assert.equal(r.app.open(), 0, 'no session left behind');
    assert.equal(r.app.refusals(), 0);
  } finally {
    await done(r);
  }
});

test('guest access: the sign-in goes to login.html, so no anonymous session is opened on the way', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const r = await rig({ app: { cap: TRIAL_SESSIONS, guest: true } });
  try {
    await r.w.record('demo', { by: 'Pat', journeys: ['new-request'] });
    await r.w.idle();
    const m = (await r.w.store.read('demo', await only(r, 'new-request')))!;
    assert.equal(m.status, 'passed', JSON.stringify(m.failure));
    assert.equal(r.app.anonymous(), 0, 'nothing loaded the app without a session');
    assert.deepEqual(r.app.signIns(), [DEMO.user]);
    assert.deepEqual(r.app.logouts(), [DEMO.user]);
    assert.equal(r.app.open(), 0);
  } finally {
    await done(r);
  }
});

test('the app refuses the session (its cap is taken): a sign-in failure with the app’s words and what they mean', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const r = await rig({ app: { cap: TRIAL_SESSIONS } });
  try {
    r.app.hold(TRIAL_SESSIONS);
    await r.w.record('demo', { by: 'Pat' });
    await r.w.idle();
    for (const j of ['new-request', 'approve-request']) {
      const m = (await r.w.store.read('demo', await only(r, j)))!;
      assert.equal(m.status, 'error');
      assert.equal(m.failure?.step, undefined, 'no step is blamed for it');
      assert.equal(m.failure?.why, `couldn't sign in as ${DEMO.user}: the app says “${CAP_TEXT}” (an unlicensed Mendix app keeps only ${TRIAL_SESSIONS} sessions open at once, signed-in and guest)`);
    }
    assert.equal(r.app.refusals(), 1, 'one try for the account in the batch: every try can cost a session');
    assert.deepEqual(r.app.signIns(), []);
  } finally {
    await done(r);
  }
});

test('Mendix’s login.html only says “Sign in failed.”: the recording app’s runtime log says it was the session cap', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const dir = mkdtempSync(path.join(tmpdir(), 'walk-cap-'));
  const log = path.join(dir, 'runtime.log');
  writeFileSync(log, '2026-10-18 21:55:48.478 INFO - Core: Initialized license.\n');
  const r = await rig({ app: { cap: TRIAL_SESSIONS, runtimeLog: log } });
  try {
    r.app.hold(TRIAL_SESSIONS);
    await r.w.record('demo', { by: 'Pat', journeys: ['new-request'] });
    await r.w.idle();
    const m = (await r.w.store.read('demo', await only(r, 'new-request')))!;
    assert.equal(m.status, 'error');
    assert.equal(m.failure?.why, `couldn't sign in as ${DEMO.user}: the app refused a new session (its log says “Maximum number of sessions exceeded”): an unlicensed Mendix app keeps only ${TRIAL_SESSIONS} sessions open at once, signed-in and guest`);
  } finally {
    await done(r);
    removeDir(dir);
  }
});

test('the session cap’s words: the runtime log’s line and the client’s dialog', () => {
  assert.equal(isSessionCap('Maximum number of sessions exceeded! (You are currently using a trial license)'), true);
  assert.equal(isSessionCap('The current license does not allow more users to sign in.'), true);
  assert.equal(isSessionCap('The username or password you entered is incorrect.'), false);
  assert.equal(isSessionCap(undefined), false);
});
