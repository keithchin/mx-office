// A walkthrough batch played by its plan, end to end against the fake app (tests/fixtures/walkthroughs/app.ts,
// which keeps what was submitted until its "database" is reset) and fake journeys in a throwaway repo
// (./fixtures/walkthroughs/rig.ts): a journey that runs after another, recorded alone, plays that one first
// unfilmed and says so; a full batch gives one group per fresh start, each on a fresh database (the first
// boots the app, the next ones get a new database of the same instance), templates aren't recorded; a group
// inside its journey's time window moves to the end and is then skipped with the reason. Headless Chromium;
// skipped where it can't start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO, PASSING } from './fixtures/walkthroughs/app.js';
import { browserCheck, done, only, rig } from './fixtures/walkthroughs/rig.js';

const TITLE = 'Sample request C';
const SUBMIT = {
  ...PASSING,
  id: 'submit-request',
  $comment: ['START STATE: fresh DB with the demo seed only (step 1 checks the new request isn’t there yet). NOT re-runnable: a second run finds it already listed.'],
  steps: [{ ...PASSING.steps[0], ui: { ...PASSING.steps[0].ui, textAbsent: [TITLE] } }, ...PASSING.steps.slice(1)],
};
const LISTED = {
  id: 'request-listed',
  title: 'See the submitted request in the list',
  persona: DEMO.user,
  $comment: ['START STATE: run directly after submit-request (its request is the precondition).'],
  steps: [
    { name: 'Open the request list', actions: [{ do: 'nav', item: 'Requests' }], ui: { ready: '.mx-name-dgRequests' } },
    { name: 'The new request is listed', ui: { textPresent: [TITLE] } },
  ],
};
const FRESH = {
  id: 'fresh-list',
  title: 'An untouched request list',
  $comment: ['START STATE: fresh DB with the demo seed only.'],
  steps: [{ name: 'Only the demo requests', actions: [{ do: 'nav', item: 'Requests' }], ui: { ready: '.mx-name-dgRequests', textPresent: ['Sample request A'], textAbsent: [TITLE] } }],
};
const HOME = { id: 'open-home', title: 'Open the home page', steps: [{ name: 'Open the request list', actions: [{ do: 'nav', item: 'Requests' }], ui: { ready: '.mx-name-dgRequests' } }] };
const EXAMPLE = { $comment: ['A worked example of the journey shape.'], name: 'Example', steps: [{ name: 'Open <Page>', actions: [{ do: 'nav', item: '<Page>' }] }] };
const SKELETON = { id: 'skeleton', title: 'Walking skeleton', steps: [{ name: 'Home', actions: [{ do: 'nav', item: 'Home' }] }] };
// Files in this order on purpose: alphabetical order would play the journey that needs another's data first.
const FILES = { 'a-request-listed': LISTED, 'b-submit-request': SUBMIT, 'c-fresh-list': FRESH, 'd-open-home': HOME, example: EXAMPLE, skeleton: SKELETON };

test('one journey that runs after another, recorded alone: the other is played first, unfilmed, and the card says so', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const r = await rig({ journeys: FILES });
  try {
    await r.w.record('demo', { by: 'Pat', journeys: ['request-listed'] });
    await r.w.idle();
    const m = (await r.w.store.read('demo', await only(r, 'request-listed')))!;
    assert.equal(m.status, 'passed', JSON.stringify(m.failure));
    assert.deepEqual(m.start?.setup, ['Submit a new request'], 'played first to set up its start state');
    assert.deepEqual([m.start?.group, m.start?.groups, m.start?.db], [1, 1, 'boot']);
    assert.ok(m.outputs.notes.some((n) => /“Submit a new request” first \(not filmed\)/.test(n)));
    assert.equal((await r.w.store.list('demo')).filter((x) => x.journey.id === 'submit-request').length, 0, 'the setup play is no recording of its own');
    assert.deepEqual(r.app.saved(), [TITLE], 'it really ran, on the same database');
    assert.deepEqual([r.boots.length, r.freshDbs, r.stops], [1, 0, 1]);
    assert.deepEqual(r.app.signIns(), [DEMO.user], 'one session for the group, the setup play included');
    assert.deepEqual(r.app.logouts(), [DEMO.user]);
  } finally {
    await done(r);
  }
});

test('a full batch: one group per fresh start, a fresh database for each, chains in order, templates not recorded', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const r = await rig({ journeys: FILES });
  try {
    const v = await r.w.view('demo', true);
    assert.deepEqual(v.journeys.map((j) => j.id).sort(), ['fresh-list', 'open-home', 'request-listed', 'submit-request'], 'Record never offers a template');
    assert.deepEqual(v.plan?.groups.map((g) => g.steps.map((s) => s.id)), [['submit-request', 'request-listed'], ['fresh-list'], ['open-home']]);
    assert.deepEqual(v.plan?.skipped.map((k) => [k.id, k.kind]), [['example', 'template'], ['skeleton', 'template']]);
    await assert.rejects(r.w.record('demo', { by: 'Pat', journeys: ['skeleton'] }), /template/);
    const id = await r.w.record('demo', { by: 'Pat' });
    let seenGroups = '';
    while (!seenGroups) {
      const b = (await r.w.view('demo', true)).batches.find((x) => x.id === id);
      if (!b) break;
      if (b.group?.n === 2) seenGroups = `${b.group.n}/${b.group.of}`;
      else await new Promise((x) => setTimeout(x, 20));
    }
    await r.w.idle();
    const all = await r.w.store.list('demo');
    assert.deepEqual(all.map((m) => m.journey.id).sort(), ['fresh-list', 'open-home', 'request-listed', 'submit-request'], 'templates: no recording at all');
    for (const m of all) assert.equal(m.status, 'passed', `${m.journey.id}: ${JSON.stringify(m.failure)}`);
    const by = new Map(all.map((m) => [m.journey.id, m]));
    assert.deepEqual(['submit-request', 'request-listed', 'fresh-list', 'open-home'].map((j) => by.get(j)!.start?.group), [1, 1, 2, 3]);
    assert.equal(by.get('fresh-list')!.start?.db, 'fresh-db', 'a later group gets a new database of the same app');
    assert.equal(by.get('request-listed')!.start?.setup, undefined, 'its prerequisite was filmed in the same batch: no setup');
    assert.deepEqual([r.boots.length, r.freshDbs, r.stops], [1, 2, 1], 'one app, a fresh database for each of the 3 groups, stopped once');
    assert.equal(seenGroups, '2/3', 'the progress says which group');
    assert.deepEqual(r.app.logouts(), [DEMO.user, DEMO.user, DEMO.user], 'signed out at the end of every group');
  } finally {
    await done(r);
  }
});

test('a time window: the group moves to the end, then is skipped with the reason, never a silent failure', async (t) => {
  if (!(await browserCheck)) return t.skip('no headless Chromium here');
  const WINDOW = { ...FRESH, $comment: [...FRESH.$comment, 'Do not run between 07:30-08:00 UTC (two periods are open then).'] };
  const r = await rig({ journeys: { 'c-fresh-list': WINDOW, 'd-open-home': HOME }, now: () => new Date('2026-10-19T07:42:00Z') });
  try {
    await r.w.record('demo', { by: 'Pat' });
    await r.w.idle();
    const m = (await r.w.store.read('demo', await only(r, 'fresh-list')))!;
    assert.equal(m.status, 'skipped');
    assert.match(m.failure?.why ?? '', /^skipped: An untouched request list must not run between 07:30–08:00 UTC \(it is 07:42 there\)/);
    const home = (await r.w.store.read('demo', await only(r, 'open-home')))!;
    assert.equal(home.status, 'passed', 'the other group still ran');
    assert.equal(r.boots.length, 1);
  } finally {
    await done(r);
  }
});
