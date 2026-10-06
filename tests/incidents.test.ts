// Incidents (server/incidents/, shared/incidents.ts): the store and its hash chain, made, changed, noted
// and resolved by hand with every change in the audit log; the detection rules (each fires at its
// threshold, dedupes into the open incident, and stays quiet below it or when off); Needs you; the seed
// of 2026-10-06 applied once; the API's checks; and test mode (server/testmode.ts) with a fake --agent
// honoured whatever it's called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { AuditLog, readAudit, useAudit } from '../src/server/audit/index.js';
import { IncidentStore, addNote, createIncident, raise, updateIncident, useIncidents, attentionBriefs, type Detection } from '../src/server/incidents/index.js';
import { cleanPatch } from '../src/server/incidents/edit.js';
import { IncidentDetector, type FloorSnapshot } from '../src/server/incidents/rules.js';
import { onIncidentSignal } from '../src/server/incidents/signals.js';
import { SEED_INCIDENTS, applySeed, wantsSeed } from '../src/server/incidents/seed.js';
import { interruptedIn } from '../src/server/incidents/office.js';
import { incidentRoutes } from '../src/server/http/routes/incidents.js';
import { DEFAULT_INCIDENT_SETTINGS, filterIncidents, normalizeSettings, sortIncidents, type IncidentSettings } from '../src/shared/incidents.js';
import { collectNeeds } from '../src/shared/needsyou.js';
import { providerCommand, configuredProvider } from '../src/server/agents.js';
import { isRealAgentCli, isTestPath, launchRefusal, testModeOf, useTestMode } from '../src/server/testmode.js';
import type { AuditEvent } from '../src/shared/audit.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { auditIdTime, draftFromEvent } from '../src/client/ui/incidents/logic.js';

const tmp = (p = 'incidents-') => mkdtempSync(path.join(os.tmpdir(), p));
const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 6, 15, 0);
const ME = { kind: 'human' as const, name: 'Keith', id: 'acc1' };

/** A fresh store and audit log, with a clock the test moves. */
function fresh() {
  const dir = tmp();
  const clock = { t: T0 };
  const log = new AuditLog(path.join(dir, 'audit'), { now: () => clock.t });
  useAudit(log);
  const store = new IncidentStore(path.join(dir, 'incidents'), () => clock.t);
  useIncidents(store, () => clock.t);
  return { dir, clock, store, log };
}

const actions = () => readAudit({ limit: 500 }).events.map((e) => e.action);

test('incidents are made, changed, noted and resolved by hand, each change audited, the file hash-chained', () => {
  const { store } = fresh();
  const i = createIncident({ title: 'Real agents in a test office', severity: 'sev2', summary: 'Four sessions', floors: ['alpha'], auditIds: ['evt1'] }, ME)!;
  assert.equal(i.number, 1);
  assert.equal(i.status, 'open');
  assert.equal(i.detectedBy.kind, 'person');
  assert.equal(i.timeline[0].kind, 'detected');
  const j = updateIncident(i.id, { severity: 'sev1', summary: 'Five sessions', linkAudit: ['evt2'], actions: [{ id: 'a1', text: 'Safe mode', status: 'open', link: { kind: 'commit', ref: 'abc1234' } }] }, ME)!;
  assert.equal(j.severity, 'sev1');
  assert.deepEqual(j.auditIds, ['evt1', 'evt2']);
  assert.ok(j.timeline.some((t) => t.text === 'Severity sev2 → sev1'));
  assert.ok(j.timeline.some((t) => t.kind === 'change' && /summary/.test(t.text)));
  addNote(i.id, 'Stopped the office', ME);
  const r = updateIncident(i.id, { status: 'resolved', rootCause: 'Fake not honoured' }, ME)!;
  assert.equal(r.status, 'resolved');
  assert.ok(r.resolvedAt);
  assert.equal(r.rootCause, 'Fake not honoured');
  // Nothing changed: nothing written.
  const lines = readFileSync(store.file, 'utf8').trim().split('\n').length;
  updateIncident(i.id, { title: r.title }, ME);
  assert.equal(readFileSync(store.file, 'utf8').trim().split('\n').length, lines);
  assert.deepEqual(actions().sort(), ['incident.created', 'incident.resolved', 'incident.updated', 'incident.updated'].sort());
  const created = readAudit({ limit: 10, actions: ['incident.created'] }).events[0];
  assert.equal(created.floor, 'alpha');
  assert.equal(created.target?.id, i.id);
  assert.equal(created.severity, 'warning');
  // The history: each line points at the one before; read back fresh it's the same incident.
  assert.deepEqual(store.verify(), { ok: true });
  assert.equal(new IncidentStore(store.dir).get(i.id)?.status, 'resolved');
  const text = readFileSync(store.file, 'utf8').replace('Fake not honoured', 'Nothing to see');
  writeFileSync(store.file, text);
  assert.equal(store.verify().ok, false);
});

test('what a person sends is checked: titles, enums, numbers and links', () => {
  assert.equal(cleanPatch(null), 'Send JSON');
  assert.match(String(cleanPatch({ title: '  ' })), /title/);
  assert.match(String(cleanPatch({ severity: 'sev9' })), /Severity/);
  assert.match(String(cleanPatch({ status: 'closed' })), /Status/);
  const p = cleanPatch({ title: 'x'.repeat(500), impact: { spendUsd: '3.456', agents: '4', data: 'worktrees' }, actions: [{ text: 'Do it', status: 'nope', link: { kind: 'pr', ref: '#12' } }, { text: '' }], floors: ['a', 'a', 'b'], hack: true });
  assert.ok(typeof p !== 'string');
  assert.equal(p.title!.length, 160);
  assert.deepEqual(p.impact, { spendUsd: 3.46, agents: 4, data: 'worktrees' });
  assert.deepEqual(p.actions, [{ id: 'a1', text: 'Do it', status: 'open', link: { kind: 'pr', ref: '#12' } }]);
  assert.deepEqual(p.floors, ['a', 'b']);
  assert.equal('hack' in p, false);
});

const det = (over: Partial<Detection> = {}): Detection => ({ rule: 'crashLoop', floor: 'alpha', severity: 'sev3', title: 'Crash loop', summary: 'Ada crashed 3 times', ...over });

test('a rule firing again dedupes into its open incident on the same floor, within the window; not across floors, once resolved, or when off', () => {
  const { store, clock } = fresh();
  const a = raise(det({ workers: [{ id: 'w1', name: 'Ada' }] }))!;
  clock.t += 10 * MIN;
  const again = raise(det({ workers: [{ id: 'w2', name: 'Bo' }], severity: 'sev2', again: 'Bo too' }))!;
  assert.equal(again.id, a.id);
  assert.equal(again.occurrences, 2);
  assert.equal(again.severity, 'sev2', 'raised to the worse severity');
  assert.deepEqual(again.workers.map((w) => w.name), ['Ada', 'Bo']);
  assert.ok(again.timeline.some((t) => t.kind === 'recurrence' && t.text === 'Bo too'));
  assert.notEqual(raise(det({ floor: 'beta' }))!.id, a.id, 'another floor');
  updateIncident(a.id, { status: 'resolved', rootCause: 'x' }, ME);
  const after = raise(det())!;
  assert.notEqual(after.id, a.id, 'resolved: a new one');
  clock.t += 25 * 60 * MIN;
  assert.notEqual(raise(det())!.id, after.id, 'past the dedupe window: a new one');
  store.setSettings({ rules: { crashLoop: { on: false } } });
  const before = store.list().length;
  assert.equal(raise(det()), undefined);
  assert.equal(store.list().length, before);
});

/** A detector on a moving clock, with what it raised. */
function detector(over: Partial<IncidentSettings['rules']> = {}) {
  const clock = { t: T0 };
  const raised: Detection[] = [];
  const settings = normalizeSettings({ rules: { ...DEFAULT_INCIDENT_SETTINGS.rules, ...over } });
  const d = new IncidentDetector({ now: () => clock.t, settings: () => settings, raise: (x) => raised.push(x), floorName: (id) => id.toUpperCase(), floorOfDir: (dir) => (dir.includes('alpha') ? 'alpha' : undefined), floorOfName: (n) => n.toLowerCase() });
  return { d, clock, raised };
}
const ev = (action: string, over: Partial<AuditEvent> = {}): AuditEvent => ({ id: `e${Math.random().toString(36).slice(2, 8)}`, at: T0, actor: { kind: 'agent', name: 'Ada', id: 'w1' }, action, summary: action, severity: 'info', prev: '', hash: '', floor: 'alpha', ...over });

test('failed sign-ins: five within ten minutes fire once (sev2), four or a slower trickle don’t, off never', () => {
  const { d, clock, raised } = detector();
  for (let i = 0; i < 4; i++) d.onAudit(ev('login.fail', { floor: undefined }));
  assert.equal(raised.length, 0);
  d.onAudit(ev('login.fail', { floor: undefined }));
  assert.equal(raised.length, 1);
  assert.equal(raised[0].rule, 'loginFailed');
  assert.equal(raised[0].severity, 'sev2');
  assert.equal(raised[0].auditIds?.length, 5);
  // Counting starts over after a burst; one every three minutes never makes five in ten.
  for (let i = 0; i < 8; i++) {
    clock.t += 3 * MIN;
    d.onAudit(ev('login.fail'));
  }
  assert.equal(raised.length, 1);
  const off = detector({ loginFailed: { on: false, count: 5, minutes: 10 } });
  for (let i = 0; i < 10; i++) off.d.onAudit(ev('login.fail'));
  assert.equal(off.raised.length, 0);
});

test('Studio mode: five held writes within ten minutes are a near miss with the agents who tried', () => {
  const { d, raised } = detector();
  for (let i = 0; i < 5; i++) d.onAudit(ev('studio.denied', { actor: { kind: 'agent', name: i % 2 ? 'Bo' : 'Ada', id: i % 2 ? 'w2' : 'w1' } }));
  assert.equal(raised.length, 1);
  assert.equal(raised[0].severity, 'near-miss');
  assert.equal(raised[0].floor, 'alpha');
  assert.deepEqual(raised[0].workers?.map((w) => w.name).sort(), ['Ada', 'Bo']);
  const lower = detector({ studioDenied: { on: true, count: 8, minutes: 10 } });
  for (let i = 0; i < 5; i++) lower.d.onAudit(ev('studio.denied'));
  assert.equal(lower.raised.length, 0, 'its threshold is a setting');
});

test('workflow and gate-check runs: three failures within an hour, counted together per floor', () => {
  const { d, raised } = detector();
  d.onAudit(ev('flow.fail', { target: { kind: 'flow', label: 'setup' } }));
  d.onSignal({ kind: 'gate-check.failed', floorDir: '/p/alpha', message: 'gate-check took too long' });
  assert.equal(raised.length, 0);
  d.onAudit(ev('flow.finish'));
  assert.equal(raised.length, 0);
  d.onAudit(ev('flow.fail'));
  assert.equal(raised.length, 1);
  assert.equal(raised[0].rule, 'flowFailed');
});

const worker = (over: Partial<WorkerInfo> = {}): WorkerInfo => ({ id: 'w1', name: 'Ada', kind: 'agent', status: 'working', ...over }) as WorkerInfo;

test('crash loops: three abnormal exits within 15 minutes; clean exits and test mode’s refusals don’t count', () => {
  const { d, clock, raised } = detector();
  const crash = (code = 1) => {
    d.onWorker('alpha', worker({ status: 'working' }));
    d.onWorker('alpha', worker({ status: 'exited', exitCode: code }));
    d.onWorker('alpha', worker({ status: 'exited', exitCode: code })); // the same exit, updated again
    clock.t += MIN;
  };
  crash(0);
  crash(0);
  crash(0);
  assert.equal(raised.length, 0);
  crash(1);
  crash(137);
  assert.equal(raised.length, 0);
  crash(1);
  assert.equal(raised.length, 1);
  assert.equal(raised[0].rule, 'crashLoop');
  assert.deepEqual(raised[0].workers, [{ id: 'w1', name: 'Ada', floor: 'alpha' }]);
  // Refused by test mode: an incident of its own (a near miss), not a crash.
  const t = detector();
  for (let i = 0; i < 3; i++) {
    t.d.onSignal({ kind: 'launch.refused', floorDir: '/x/alpha', worker: { id: 'w1', name: 'Ada' }, command: 'claude', why: 'test mode' });
    t.d.onWorker('alpha', worker({ status: 'working' }));
    t.d.onWorker('alpha', worker({ status: 'exited', exitCode: -1 }));
  }
  // The same worker refused again soon (woken again) is already on the incident; later, it counts again.
  assert.deepEqual(t.raised.map((r) => r.rule), ['realLaunch']);
  assert.equal(t.raised[0].severity, 'near-miss');
  t.clock.t += 11 * MIN;
  t.d.onSignal({ kind: 'launch.refused', floorDir: '/x/alpha', worker: { id: 'w1', name: 'Ada' }, command: 'claude', why: 'test mode' });
  assert.equal(t.raised.length, 2);
});

test('interrupted turns: the workers the last office left mid-turn with no terminal, as one sev3 with their names', () => {
  const dir = tmp();
  const file = path.join(dir, 'workers.json');
  writeFileSync(file, JSON.stringify([
    { id: 'w1', name: 'Ada', kind: 'agent', midTurn: true },
    { id: 'w2', name: 'Bo', kind: 'agent', midTurn: true, pty: { id: 'p1' } },
    { id: 'w3', name: 'Cy', kind: 'agent', midTurn: false },
    { id: 'w4', name: 'Sh', kind: 'shell', midTurn: true },
    { id: 'w5', name: 'Di', kind: 'agent', midTurn: true },
  ]));
  const got = interruptedIn(file);
  assert.deepEqual(got.map((w) => w.name), ['Ada', 'Di']);
  assert.deepEqual(interruptedIn(path.join(dir, 'missing.json')), []);
  const { d, raised } = detector();
  d.onRestored('alpha', got);
  assert.equal(raised.length, 1);
  assert.equal(raised[0].severity, 'sev3');
  assert.match(raised[0].summary, /2 workers were interrupted.*Ada, Di/);
  const off = detector({ interrupted: { on: true, count: 3 } });
  off.d.onRestored('alpha', got);
  assert.equal(off.raised.length, 0, 'fewer than the count');
});

const snap = (over: Partial<FloorSnapshot> = {}): FloorSnapshot => ({ id: 'alpha', costs: {}, undelivered: [], ...over });

test('undelivered escalation answers: after 30 minutes, once per escalation', () => {
  const { d, clock, raised } = detector();
  const und = [{ id: 'e1', title: 'Pick a DB', by: 'Ada', at: T0 }];
  d.tick([snap({ undelivered: und })]);
  clock.t += 29 * MIN;
  d.tick([snap({ undelivered: und })]);
  assert.equal(raised.length, 0);
  clock.t += 2 * MIN;
  d.tick([snap({ undelivered: und })]);
  d.tick([snap({ undelivered: und })]);
  assert.equal(raised.length, 1);
  assert.equal(raised[0].rule, 'escalationUndelivered');
  assert.match(raised[0].summary, /Pick a DB/);
});

test('spend spikes: past the dollars-an-hour limit (sev2), or N× the trailing average once there is history (sev3); quiet otherwise', () => {
  const { d, clock, raised } = detector();
  let cost = 0;
  const step = (perMin: number, minutes: number) => {
    for (let i = 0; i < minutes; i++) {
      cost += perMin;
      d.tick([snap({ costs: { w1: cost } })]);
      clock.t += MIN;
    }
  };
  step(0.02, 5 * 60); // $1.20 an hour for five hours
  assert.equal(raised.length, 0);
  step(0.15, 60); // $9 in the next hour: past 3× the average and $5, under $25
  assert.equal(raised.length, 1);
  assert.equal(raised[0].severity, 'sev3');
  assert.equal(raised[0].rule, 'spendSpike');
  // Then once an hour at most; $30 in an hour is past the limit.
  step(0.5, 120);
  assert.ok(raised.length <= 3, 'at most once an hour');
  const big = raised.find((r) => r.severity === 'sev2');
  assert.ok(big && big.impact!.spendUsd! >= 25);
  // A worker first seen with spend already on it isn't this hour's spend.
  const fresh = detector();
  fresh.d.tick([snap({ costs: { w9: 400 } })]);
  fresh.clock.t += MIN;
  fresh.d.tick([snap({ costs: { w9: 400 } })]);
  assert.equal(fresh.raised.length, 0);
  // With no history, only the absolute limit counts.
  const young = detector();
  let c = 0;
  for (let i = 0; i < 60; i++) {
    c += 0.2;
    young.d.tick([snap({ costs: { w1: c } })]);
    young.clock.t += MIN;
  }
  assert.equal(young.raised.length, 0);
});

test('the spend cap reached is a near miss when it starts pausing, and the budget module’s alerts come through the seam', () => {
  const { d, raised } = detector();
  d.tick([snap()]);
  d.tick([snap({ paused: '$10.00 of $10.00 today' })]);
  d.tick([snap({ paused: '$10.00 of $10.00 today' })]);
  assert.equal(raised.length, 1);
  assert.equal(raised[0].rule, 'spendCap');
  assert.equal(raised[0].severity, 'near-miss');
  d.onSignal({ kind: 'budget.alert', level: 'cap', text: 'The office budget is spent', spentUsd: 50 });
  assert.equal(raised[1].severity, 'sev3');
  assert.equal(raised[1].floor, undefined);
  const off = detector({ spendCap: { on: false } });
  off.d.tick([snap({ paused: 'x' })]);
  off.d.onSignal({ kind: 'budget.alert', level: 'warn', text: 'close' });
  assert.equal(off.raised.length, 0);
});

test('worktree cleanup: three failures within six hours', () => {
  const { d, raised } = detector();
  for (let i = 0; i < 2; i++) d.onSignal({ kind: 'sweep.failed', floor: 'Alpha', path: `/p/alpha/.agent-office/worktrees/w${i}`, why: 'locked' });
  assert.equal(raised.length, 0);
  d.onSignal({ kind: 'sweep.failed', floor: 'Alpha', path: '/p/alpha/.agent-office/worktrees/w3', why: 'locked' });
  assert.equal(raised.length, 1);
  assert.equal(raised[0].floor, 'alpha');
});

test('a real agent launched on a test office (allowed through) is sev2, and raises the refused one’s incident through the store', () => {
  const { store } = fresh();
  const real = new IncidentDetector({ now: () => T0, settings: () => store.settings(), raise: (x) => void raise(x), floorName: (id) => id, floorOfDir: () => 'alpha', floorOfName: () => undefined });
  real.onSignal({ kind: 'launch.refused', floorDir: '/s/alpha', worker: { id: 'w1', name: 'Ada' }, command: 'claude', why: 'test mode' });
  real.onSignal({ kind: 'launch.real', floorDir: '/s/alpha', worker: { id: 'w2', name: 'Bo' }, command: 'claude' });
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].severity, 'sev2');
  assert.equal(list[0].occurrences, 2);
  assert.equal(list[0].impact.agents, 2);
});

test('Needs you lists open sev1 and sev2 incidents of this floor and the office, worst first; not sev3, near misses, mitigated or other floors’', () => {
  const brief = (id: string, severity: 'sev1' | 'sev2' | 'sev3' | 'near-miss', floors: string[], status: 'open' | 'mitigated' = 'open') => ({ id, number: Number(id.slice(1)), title: `t${id}`, severity, status, floors, detectedAt: T0 });
  const items = collectNeeds({ floor: 'alpha', workers: [], pulls: [], floors: [], incidents: [brief('i1', 'sev2', ['alpha']), brief('i2', 'sev1', []), brief('i3', 'sev3', ['alpha']), brief('i4', 'near-miss', []), brief('i5', 'sev1', ['beta']), brief('i6', 'sev2', ['alpha'], 'mitigated')] });
  const inc = items.filter((n) => n.kind === 'incident');
  assert.deepEqual(inc.map((n) => n.key), ['incident-i2', 'incident-i1']);
  assert.equal(inc[0].level, 'block');
  assert.equal(inc[0].tag, 'SEV1');
  assert.equal(inc[1].level, 'warn');
  assert.deepEqual(inc[0].target, { to: 'incident', id: 'i2' });
  // And the server's Needs you (Teams) gets them from the store.
  fresh();
  createIncident({ title: 'Big', severity: 'sev1' }, ME);
  createIncident({ title: 'Small', severity: 'sev3' }, ME);
  assert.deepEqual(attentionBriefs().map((b) => b.title), ['Big']);
});

test('the seed of 2026-10-06 goes in once, marked retrospective, and never over incidents already there', () => {
  const { store } = fresh();
  assert.equal(applySeed(), SEED_INCIDENTS.length);
  const list = store.list();
  assert.equal(list.length, 6);
  assert.ok(list.every((i) => i.retrospective && i.timeline[0].text.startsWith('Recorded retrospectively')));
  const a = list.find((i) => /4 real Claude/.test(i.title))!;
  assert.equal(a.severity, 'sev2');
  assert.ok(a.actions.some((x) => /travel-desk and run2/.test(x.text) && x.status === 'open'));
  assert.ok(list.some((i) => /Resume-pause test office/.test(i.title) && i.severity === 'near-miss'));
  assert.equal(applySeed(), 0, 'not twice');
  assert.equal(store.list().length, 6);
  const other = fresh();
  createIncident({ title: 'Mine', severity: 'sev3' }, ME);
  assert.equal(applySeed(), 0, 'an office with incidents gets none');
  assert.equal(other.store.list().length, 1);
  // Only an office that ran that day, unless the environment says otherwise.
  assert.equal(wantsSeed([]), false, 'a new office');
  assert.equal(wantsSeed([Date.UTC(2026, 9, 6, 9)]), true);
  assert.equal(wantsSeed([Date.UTC(2026, 9, 8)]), false, 'only after that day');
  assert.equal(wantsSeed([Date.UTC(2026, 8, 1), Date.UTC(2026, 9, 8)]), false, 'before and after, but nothing that day');
  assert.equal(wantsSeed([Date.UTC(2026, 8, 1), Date.UTC(2026, 9, 6, 2), Date.UTC(2026, 9, 8)]), true);
  assert.equal(wantsSeed([Date.parse('2026-10-05T23:30:00+08:00'), Date.parse('2026-10-07T00:10:00+08:00')]), false, 'the office’s local day (UTC+8)');
  process.env.AGENT_OFFICE_SEED_INCIDENTS = '0';
  assert.equal(wantsSeed([Date.UTC(2026, 9, 6, 9)]), false);
  process.env.AGENT_OFFICE_SEED_INCIDENTS = '1';
  assert.equal(wantsSeed([]), true);
  delete process.env.AGENT_OFFICE_SEED_INCIDENTS;
});

test('the list sorts open before resolved and worst first, and filters by floor, status, severity and words', () => {
  fresh();
  const a = createIncident({ title: 'Minor', severity: 'sev3', floors: ['alpha'] }, ME)!;
  const b = createIncident({ title: 'Major', severity: 'sev2' }, ME)!;
  const c = createIncident({ title: 'Old big', severity: 'sev1', floors: ['beta'] }, ME)!;
  updateIncident(c.id, { status: 'resolved', rootCause: 'x' }, ME);
  const all = [a, b, { ...c, status: 'resolved' as const }];
  assert.deepEqual(sortIncidents(all).map((i) => i.title), ['Major', 'Minor', 'Old big']);
  assert.deepEqual(filterIncidents(all, { floor: 'alpha' }).map((i) => i.title), ['Minor']);
  assert.deepEqual(filterIncidents(all, { floor: '_office' }).map((i) => i.title), ['Major']);
  assert.deepEqual(filterIncidents(all, { status: ['resolved'] }).map((i) => i.title), ['Old big']);
  assert.deepEqual(filterIncidents(all, { severity: ['sev2', 'sev3'], q: 'maj' }).map((i) => i.title), ['Major']);
});

test('an incident made from an audit event links it and starts from its summary; an event id says when it happened', () => {
  const at = Date.UTC(2026, 9, 6, 15, 20);
  const id = `${at.toString(36).padStart(9, '0')}0aabcdef`;
  assert.equal(auditIdTime(id), at);
  assert.equal(auditIdTime('abc'), undefined);
  const d = draftFromEvent({ ...ev('studio.denied'), id, at, severity: 'warning', summary: 'Held a write' });
  assert.deepEqual(d.linkAudit, [id]);
  assert.deepEqual(d.floors, ['alpha']);
  assert.equal(d.severity, 'sev3');
  assert.deepEqual(d.workers, [{ name: 'Ada', id: 'w1', floor: 'alpha' }]);
});

// ---- The API --------------------------------------------------------------------------------------

function call(route: { handle: (...a: never[]) => unknown }, opts: { method?: string; path: string; body?: unknown; admin?: boolean }) {
  const req = Object.assign(Readable.from(opts.body === undefined ? [] : [Buffer.from(JSON.stringify(opts.body))]), { method: opts.method ?? 'GET', headers: { origin: 'http://office', host: 'office' } });
  let status = 0;
  let out: unknown;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => (out = JSON.parse(b)), headersSent: false };
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin: opts.admin ?? true }) };
  const url = new URL(`http://office${opts.path}`);
  return Promise.resolve((route.handle as (...a: unknown[]) => unknown)(ctx, { req, res, url, path: url.pathname, session: { account: { id: 'acc1', name: 'Keith' } } })).then(() => ({ status, body: out as Record<string, any> }));
}

test('the API: everyone reads, only admins change; resolving needs a root cause; notes land on the timeline', async () => {
  fresh();
  const denied = await call(incidentRoutes.create, { method: 'POST', path: '/api/incidents', body: { title: 'x', severity: 'sev2' }, admin: false });
  assert.equal(denied.status, 403);
  const made = await call(incidentRoutes.create, { method: 'POST', path: '/api/incidents', body: { title: 'Bad thing', severity: 'sev2', linkAudit: ['evt9'] } });
  assert.equal(made.status, 200);
  const id = made.body.incident.id as string;
  assert.deepEqual(made.body.incident.auditIds, ['evt9']);
  const list = await call(incidentRoutes.list, { path: '/api/incidents?floor=all&status=open', admin: false });
  assert.equal(list.body.incidents.length, 1);
  assert.equal(list.body.admin, false);
  assert.equal(list.body.counts.status.open, 1);
  const noCause = await call(incidentRoutes.one, { method: 'POST', path: `/api/incidents/${id}`, body: { status: 'resolved' } });
  assert.equal(noCause.status, 400);
  const note = await call(incidentRoutes.one, { method: 'POST', path: `/api/incidents/${id}/note`, body: { text: 'Looking' } });
  assert.equal(note.body.incident.timeline.at(-1).text, 'Looking');
  const done = await call(incidentRoutes.one, { method: 'POST', path: `/api/incidents/${id}`, body: { status: 'resolved', rootCause: 'Because' } });
  assert.equal(done.body.incident.status, 'resolved');
  assert.equal((await call(incidentRoutes.one, { path: '/api/incidents/nope' })).status, 404);
  const rules = await call(incidentRoutes.settings, { method: 'POST', path: '/api/incidents/settings', body: { rules: { loginFailed: { on: false } } } });
  assert.equal(rules.body.rules.loginFailed.on, false);
  assert.equal(rules.body.rules.crashLoop.count, 3);
  assert.ok(actions().includes('incident.resolved') && actions().includes('settings.change'));
});

// ---- Test mode --------------------------------------------------------------------------------------

test('a fake --agent stands in for Claude workers whatever its file is called', () => {
  assert.equal(configuredProvider('C:\\scratch\\fake-agent.cmd'), 'custom');
  assert.equal(providerCommand('claude', 'C:\\scratch\\fake-agent.cmd'), 'C:\\scratch\\fake-agent.cmd');
  assert.equal(providerCommand('claude', '/tmp/fake.sh'), '/tmp/fake.sh');
  assert.equal(providerCommand('claude', '/tmp/claude'), '/tmp/claude');
  assert.equal(providerCommand('claude', 'claude'), 'claude');
  // Another provider's CLI as --agent isn't Claude, and other providers keep their own executables.
  assert.equal(providerCommand('claude', '/opt/bin/codex'), 'claude');
  assert.equal(providerCommand('codex', '/tmp/fake.sh'), 'codex');
  assert.equal(providerCommand('custom', '/tmp/fake.sh'), '/tmp/fake.sh');
});

test('test mode: on by flag, environment or a test office folder (not a plain scratch); refuses real agent CLIs with a clear message and an incident signal', () => {
  const signals: string[] = [];
  const off = onIncidentSignal((s) => signals.push(s.kind));
  try {
    assert.equal(isTestPath('C:\\Users\\me\\agent-spike\\scratch\\test-offices\\x'), true);
    assert.equal(isTestPath('/home/me/test-offices/x'), true);
    assert.equal(isTestPath('/home/me/test-office-budget/proj'), true);
    assert.equal(isTestPath('/home/me/Test-Office'), true);
    assert.equal(isTestPath('/home/me/scratch/proj'), false, 'a plain scratch folder no longer');
    assert.equal(isTestPath('/home/me/scratchpad/x'), false);
    assert.equal(isTestPath('/home/me/my-test-office'), false);
    useTestMode({ flag: false, officeDir: '/home/me/office', agentCmd: 'claude', agentExplicit: false });
    assert.equal(testModeOf().on, false);
    assert.equal(testModeOf('/home/me/scratch/proj').on, false);
    assert.equal(testModeOf('/home/me/scratch/test-offices/proj').on, true);
    assert.equal(testModeOf('/home/me/test-office-2/proj').on, true);
    const w = worker({ id: 'w7', name: 'Ada' });
    const T = '/home/me/scratch/test-offices/proj';
    // A real office (a plain scratch folder too): nothing refused.
    assert.equal(launchRefusal('/home/me/proj', w, 'claude', '/usr/local/bin/claude'), undefined);
    assert.equal(launchRefusal('/home/me/scratch/proj', w, 'claude', '/usr/local/bin/claude'), undefined);
    // A floor of a test office: the real claude is refused, said on the card, and signalled.
    const msg = launchRefusal(T, w, 'claude', 'C:\\Users\\me\\.local\\bin\\claude.exe');
    assert.match(msg ?? '', /Test mode: refused to start the real claude/);
    assert.match(w.activity ?? '', /Test mode/);
    assert.deepEqual(signals, ['launch.refused']);
    // Every provider's CLI, and a few more.
    for (const bin of ['codex', 'opencode', 'grok', 'muse', 'cursor-agent', 'dsh', 'pi', 'gemini']) assert.match(launchRefusal(T, w, bin, `/usr/bin/${bin}`) ?? '', new RegExp(`real ${bin}`), bin);
    assert.equal(isRealAgentCli('codex', 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd'), true);
    assert.equal(isRealAgentCli('claude', 'C:\\Users\\me\\scratch\\test-offices\\bin\\claude.cmd'), false, 'a fake named claude in a test office folder');
    // Without an explicit --agent, even a fake isn't started: only the fake the office was started with.
    assert.match(launchRefusal(T, w, 'claude', 'C:\\Users\\me\\scratch\\test-offices\\bin\\claude.cmd') ?? '', /not the fake/);
    assert.ok(launchRefusal(T, w, '/opt/fake-agent.sh', '/opt/fake-agent.sh'));
    // The --test-mode flag, and an explicit --agent override of any name.
    useTestMode({ flag: true, officeDir: '/home/me/office', agentCmd: '/opt/stand-in.sh', agentExplicit: true });
    assert.deepEqual(testModeOf(), { on: true, why: 'started with --test-mode' });
    assert.equal(launchRefusal('/home/me/proj', w, '/opt/stand-in.sh', '/opt/stand-in.sh'), undefined);
    assert.ok(launchRefusal('/home/me/proj', w, 'opencode', '/usr/bin/opencode'));
    // A fake named claude, given explicitly, is fine where it lives in a test office's folder.
    useTestMode({ flag: true, agentCmd: 'C:\\o\\test-offices\\bin\\claude.cmd', agentExplicit: true });
    assert.equal(launchRefusal('/home/me/proj', w, 'C:\\o\\test-offices\\bin\\claude.cmd', 'C:\\o\\test-offices\\bin\\claude.cmd'), undefined);
    // A real CLI given as --agent (another provider's for Claude workers, or claude itself) is refused all the same.
    useTestMode({ flag: true, agentCmd: 'codex', agentExplicit: true });
    assert.match(launchRefusal('/home/me/proj', w, 'codex', '/usr/local/bin/codex') ?? '', /real codex/);
    useTestMode({ flag: true, agentCmd: '/usr/local/bin/claude', agentExplicit: true });
    assert.match(launchRefusal('/home/me/proj', w, '/usr/local/bin/claude', '/usr/local/bin/claude') ?? '', /real agent CLI/);
    // AGENT_OFFICE_ALLOW_REAL_AGENTS lets one through, and that's signalled as a real launch.
    process.env.AGENT_OFFICE_ALLOW_REAL_AGENTS = '1';
    assert.equal(launchRefusal('/home/me/proj', w, 'claude', '/usr/bin/claude'), undefined);
    assert.equal(signals.at(-1), 'launch.real');
    delete process.env.AGENT_OFFICE_ALLOW_REAL_AGENTS;
    useTestMode(undefined);
    process.env.AGENT_OFFICE_TEST_MODE = '1';
    assert.equal(testModeOf().why, 'AGENT_OFFICE_TEST_MODE is set');
    delete process.env.AGENT_OFFICE_TEST_MODE;
  } finally {
    off();
    useTestMode(undefined);
  }
});

test('GET /api/test-mode tells the pages whether to show the TEST MODE badge', async () => {
  useTestMode({ flag: false, officeDir: path.join(tmp(), 'scratch', 'office'), agentCmd: 'claude', agentExplicit: false });
  assert.equal((await call(incidentRoutes.testMode, { path: '/api/test-mode' })).body.on, false, 'a plain scratch folder');
  useTestMode({ flag: false, officeDir: path.join(tmp(), 'scratch', 'test-offices', 'office'), agentCmd: 'claude', agentExplicit: false });
  const r = await call(incidentRoutes.testMode, { path: '/api/test-mode' });
  assert.equal(r.body.on, true);
  assert.match(r.body.why, /test-offices/);
  useTestMode(undefined);
  assert.equal((await call(incidentRoutes.testMode, { path: '/api/test-mode' })).body.on, false);
});
