// Walkthrough videos, the pure parts (shared/walkthroughs/, server/walkthroughs/store.ts): a test journey
// as a script (both toolkit shapes, seeds, honest blocks), the captions, chapters and index.md, which
// journeys record by themselves when a milestone is ready, the working copies' cleanup and quota, and the
// little helpers (WAV lengths, the proxy's host).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { narrationOf, repoDirOf, scriptOf } from '../src/shared/walkthroughs/script.js';
import { captionsOf, chaptersOf, indexMd, vttTime } from '../src/shared/walkthroughs/vtt.js';
import { autoJourneys } from '../src/shared/walkthroughs/auto.js';
import type { WalkManifest, WalkScript } from '../src/shared/walkthroughs/types.js';
import type { LiveReadiness } from '../src/shared/liveapp/readiness.js';
import { WalkStore } from '../src/server/walkthroughs/store.js';
import { toneWav, wavMs } from '../src/server/walkthroughs/media.js';
import { proxyHost } from '../src/server/walkthroughs/office.js';

const RUNNER = JSON.stringify({
  id: 'J-PR-01',
  title: 'Purchase request: submit for approval',
  persona: 'requester_test_user',
  requirement: ['UC-01', 'build-plan row 10'],
  seeds: [{ name: 'title', value: 'Sample request' }, { name: 'supplier', sql: 'SELECT Name AS n FROM Shop.Supplier LIMIT 1' }],
  steps: [
    { name: 'open the request list', actions: [{ do: 'nav', group: 'Procurement', item: 'Request List' }], ui: { ready: '.mx-name-dgRequests', checks: ['btnNewRequest'] } },
    { name: 'fill in the title', actions: [{ do: 'click', widget: 'btnNewRequest', label: 'New request' }, { do: 'fill', widget: 'tbTitle', value: '{{title}}', label: 'Title' }] },
    { name: 'pick the supplier', actions: [{ do: 'combobox', widget: 'cbSupplier', match: '{{supplier}}' }] },
    { name: 'submit', actions: [{ do: 'click', widget: 'btnSubmit' }, { do: 'dismissModal' }], ui: { textPresent: ['Request submitted', '{{title}}'], textAbsent: ['No requests yet'] } },
    { name: 'odd one', actions: [{ do: 'teleport' }] },
  ],
});

test('a journey-runner journey as a script: captions, actions, checks, seeds filled in, honest blocks', () => {
  const s = scriptOf('tests/e2e/purchase.journey.json', RUNNER) as WalkScript;
  assert.equal(typeof s, 'object');
  assert.equal(s.journey, 'J-PR-01');
  assert.deepEqual(s.requirement, ['UC-01', 'build-plan row 10']);
  assert.equal(s.steps.length, 5);
  assert.deepEqual(s.steps[0].actions, [{ do: 'nav', group: 'Procurement', item: 'Request List', caption: 'Open Procurement › Request List' }]);
  assert.deepEqual(s.steps[0].checks, { ready: '.mx-name-dgRequests', visible: ['.mx-name-btnNewRequest'], textPresent: [], textAbsent: [] });
  assert.deepEqual(s.steps[1].actions[1], { do: 'fill', selector: '.mx-name-tbTitle', value: 'Sample request', caption: 'Type “Sample request” into Title' });
  assert.equal(s.steps[1].blocked, undefined);
  assert.match(s.steps[2].blocked ?? '', /\{\{supplier\}\}.*database query/, 'a seed only SQL gives is never guessed');
  assert.deepEqual(s.steps[3].checks.textPresent, ['Request submitted', 'Sample request']);
  assert.match(s.steps[4].blocked ?? '', /teleport/);
  assert.equal(narrationOf(s.steps[0]), 'open the request list. Open Procurement › Request List.');
  assert.equal(repoDirOf('J-PR-01'), 'docs/walkthroughs/j-pr-01');
  assert.equal(repoDirOf('x', 'tour'), 'docs/walkthroughs/guided-tour');
});

test('the simple journey shape, and files that are not journeys', () => {
  const s = scriptOf('tests/e2e/simple.journey.json', JSON.stringify({ name: 'Example', role: 'demo user', steps: [{ name: 'Open the overview', page: '/p/overview', expectText: ['Overview'] }, { name: 'Submit', click: 'Submit' }] })) as WalkScript;
  assert.equal(s.journey, 'simple');
  assert.equal(s.title, 'Example');
  assert.deepEqual(s.steps[0].actions, [{ do: 'goto', path: '/p/overview', caption: 'Open /p/overview' }]);
  assert.deepEqual(s.steps[0].checks.textPresent, ['Overview']);
  assert.deepEqual(s.steps[1].actions, [{ do: 'click', selector: 'text=Submit', caption: 'Click Submit' }]);
  assert.equal(typeof scriptOf('x.journey.json', '{nope'), 'string');
  assert.equal(typeof scriptOf('x.journey.json', '{"steps":[]}'), 'string');
});

const manifest = (o: Partial<WalkManifest> = {}): WalkManifest => ({
  schema: 1,
  id: 'wt_01JAAAAAAAAAAAAAAAAAAAAAAA',
  floor: 'demo',
  kind: 'workflow',
  journey: { id: 'new-request', title: 'New request', file: 'tests/e2e/new-request.journey.json', requirement: ['UC-01'] },
  trigger: 'manual',
  by: 'Pat',
  app: { commit: 'abc1234def5678', origin: 'http://127.0.0.1:9' },
  startedAt: 1,
  durationMs: 9000,
  status: 'passed',
  steps: [
    { n: 1, caption: 'Open the list', status: 'passed', startMs: 2500, endMs: 4000 },
    { n: 2, caption: 'Click New --> form', status: 'failed', startMs: 4000, endMs: 6100, why: 'not there' },
    { n: 3, caption: 'Submit', status: 'not-run' },
  ],
  outputs: { video: 'walkthrough.mp4', format: 'mp4', captions: 'captions.vtt', chapters: 'chapters.vtt', narration: 'none', notes: [] },
  ...o,
});

test('captions: one cue per step that ran, failed ones say so; chapters; index.md ties each video to its commit', () => {
  assert.equal(vttTime(3_723_045), '01:02:03.045');
  const c = captionsOf(manifest());
  assert.match(c, /^WEBVTT\n/);
  assert.match(c, /00:00:02\.500 --> 00:00:04\.000\nStep 1 of 3 · Open the list/);
  assert.match(c, /Step 2 of 3 · Click New → form — failed: not there/, 'no stray cue arrow inside a cue');
  assert.doesNotMatch(c, /Submit/, 'a step that never ran has no caption');
  assert.match(chaptersOf(manifest()), /00:00:00\.000 --> 00:00:09\.000\nNew request/);
  const md = indexMd([{ dir: 'new-request', m: manifest() }, { dir: 'guided-tour', m: manifest({ kind: 'tour', journey: { id: 'guided-tour', title: 'Guided tour: Demo', file: '', requirement: [] }, parts: [], outputs: { video: 'tour.mp4', narration: 'none', notes: [] } }) }]);
  assert.match(md, /^# Walkthroughs/);
  assert.match(md, /evidence only for the commit it recorded/);
  assert.match(md, /\| \[New request\]\(new-request\/walkthrough\.mp4\) \| UC-01 \| `abc1234` \| 1\/3 passed \| 9 s \|/);
  assert.ok(md.indexOf('Guided tour') < md.indexOf('[New request]'), 'the tour comes first');
});

const readiness = (state: 'ready' | 'unverified', result: 'passed' | 'failed' = 'passed'): LiveReadiness => ({
  sha: 'abc1234def5678',
  goal: 'Demo',
  ready: state === 'ready',
  headline: '',
  at: 1,
  milestones: [{ id: 'phase-1', title: 'Requests', rows: [1], inLive: [1], onMain: [], onBranch: [], missing: [], journeys: [{ id: 'new-request', result }, { id: 'list', result: 'not-run' }], state, line: '' }],
});

test('auto-record: only a ready milestone, only its passing journeys, only with the switch on, once per commit', () => {
  const base = { milestone: 'phase-1', sha: 'abc1234def5678', autoRecord: true, done: new Set<string>() };
  assert.deepEqual(autoJourneys({ ...base, readiness: readiness('ready') }), ['new-request']);
  assert.deepEqual(autoJourneys({ ...base, readiness: readiness('ready'), autoRecord: false }), [], 'switched off');
  assert.deepEqual(autoJourneys({ ...base, readiness: readiness('unverified', 'failed') }), [], 'a failed journey records nothing');
  assert.deepEqual(autoJourneys({ ...base, readiness: readiness('ready'), sha: 'other' }), [], 'the app moved on');
  assert.deepEqual(autoJourneys({ ...base, readiness: readiness('ready'), done: new Set(['new-request']) }), [], 'already recorded');
  assert.deepEqual(autoJourneys({ ...base, readiness: readiness('ready'), milestone: 'phase-9' }), []);
});

test('the working copies: files only from inside a recording, old auto-recordings cleaned up, quota', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'walk-store-'));
  try {
    const s = new WalkStore(dir, 1e9);
    assert.equal(s.file('demo', 'wt_01JAAAAAAAAAAAAAAAAAAAAAAA', '../../x.png'), undefined);
    assert.equal(s.file('demo', 'wt_01JAAAAAAAAAAAAAAAAAAAAAAA', 'steps/01.png'), path.join(dir, 'demo', 'wt_01JAAAAAAAAAAAAAAAAAAAAAAA', 'steps', '01.png'));
    assert.throws(() => s.recDir('demo', '../evil'));
    const now = 100 * 24 * 3_600_000;
    const ids = ['wt_01JBBBBBBBBBBBBBBBBBBBBBB1', 'wt_01JBBBBBBBBBBBBBBBBBBBBBB2', 'wt_01JBBBBBBBBBBBBBBBBBBBBBB3', 'wt_01JBBBBBBBBBBBBBBBBBBBBBB4', 'wt_01JBBBBBBBBBBBBBBBBBBBBBB5'];
    for (const [k, id] of ids.entries()) {
      await s.write(manifest({ id, trigger: k === 4 ? 'manual' : 'auto', startedAt: now - (k === 3 ? 30 : 1) * 24 * 3_600_000 + k }));
      writeFileSync(path.join(s.recDir('demo', id), 'walkthrough.mp4'), Buffer.alloc(400));
    }
    // Four auto (one 30 days old), one manual: the old one goes; three newest auto stay.
    const gone = await s.cleanup(now);
    assert.deepEqual(gone, [ids[3]]);
    assert.equal((await s.list('demo')).length, 4);
    // Over a quota: the oldest auto ones go until it fits; the manual one stays.
    const tight = new WalkStore(dir, (await s.used()) - 1000);
    const more = await tight.cleanup(now);
    assert.deepEqual(more, [ids[0]], 'the oldest auto-recording went first');
    assert.ok(existsSync(s.recDir('demo', ids[4])));
    assert.ok((await tight.used()) <= tight.quota);
    // Settings default, then saved.
    assert.equal((await s.settings('demo')).autoRecord, true);
    await s.setSettings('demo', { autoRecord: false, narrate: false, demoUser: 'demo_viewer', demoPassword: 'x' });
    assert.equal((await s.settings('demo')).demoUser, 'demo_viewer');
    mkdirSync(path.join(dir, 'other'), { recursive: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('helpers: a WAV length from its header; the proxy is reached on loopback when the office binds everywhere', () => {
  assert.equal(wavMs(toneWav(1500)), 1500);
  assert.equal(wavMs(Buffer.from('nope')), 0);
  assert.equal(proxyHost('0.0.0.0'), '127.0.0.1');
  assert.equal(proxyHost(''), '127.0.0.1');
  assert.equal(proxyHost('192.168.1.5'), '192.168.1.5');
  assert.equal(proxyHost('::1'), '[::1]');
});

test('a milestone ready in the live app reaches the office’s walkthroughs (liveapp/ready-bus.ts)', async () => {
  process.env.AGENT_OFFICE_KOKORO = 'off';
  const { emitLiveReady } = await import('../src/server/liveapp/ready-bus.js');
  const { walkthroughsOf } = await import('../src/server/walkthroughs/office.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'walk-bus-'));
  try {
    const ctx = { cfg: { dataDir: dir, host: '127.0.0.1' }, floors: new Map(), toFloor: () => undefined } as unknown as Parameters<typeof walkthroughsOf>[0];
    const w = walkthroughsOf(ctx);
    assert.equal(walkthroughsOf(ctx), w, 'one per office');
    const got: string[] = [];
    w.onReady = async (floor, news) => (got.push(`${floor}:${news.milestone}@${news.sha}`), []);
    emitLiveReady(ctx, 'demo', { key: 'k', kind: 'ready', milestone: 'phase-1', title: 'Requests', at: 1, sha: 'abc' }, readiness('ready'));
    assert.deepEqual(got, ['demo:phase-1@abc']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
