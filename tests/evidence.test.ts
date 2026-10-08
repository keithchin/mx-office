// Ids and evidence contracts (docs/knowledge-evals/gap-map.md, increment F1): stable project ids across
// restarts, renames and re-adds; the audit chain with and without ids; each read-only adapter mapping its
// source with unknown ids listed as gaps (never blank, never zero); locator safety; the trace route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RunRecord } from '../src/shared/analysis.js';
import type { SpendRow } from '../src/shared/budget/types.js';
import type { ChatterMessage } from '../src/shared/chatter.js';
import { cleanIds, isExecutionId, isProjectId, isTaskId, issueTaskId, legacyQueueTaskId, mintExecutionId, mintProjectId, mintTaskId, ulid } from '../src/shared/evidence/ids.js';
import { formatLocator, isTraceEvent, parseLocator, validateEvidenceRef, validateTraceEvent, type TraceEvent } from '../src/shared/evidence/types.js';
import type { Incident } from '../src/shared/incidents.js';
import { Building, type FloorDef } from '../src/server/building.js';
import { AuditLog } from '../src/server/audit/log.js';
import { ProjectIds } from '../src/server/projects/ids.js';
import { fromAudit, fromChatter, fromIncident, fromRun, fromSpendRow, type AdapterCtx } from '../src/server/evidence/adapters.js';
import { buildTrace, diskSources, type TraceSources } from '../src/server/evidence/trace.js';
import { evidenceRoutes } from '../src/server/http/routes/evidence.js';

function tmp(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, '.agent-office');
  mkdirSync(dataDir, { recursive: true });
  return { root, dataDir };
}

const PRJ = mintProjectId(1_700_000_000_000);
const ctxFor = (over: Partial<AdapterCtx> = {}): AdapterCtx => ({ floorId: 'shop', repo: 'acme/shop', projectId: PRJ, now: 1_800_000_000_000, ...over });
const gapOf = (e: TraceEvent, f: string) => e.gaps.find((g) => g.field === f);
function valid(e: TraceEvent) {
  assert.deepEqual(validateTraceEvent(e), [], JSON.stringify(e));
  for (const f of ['projectId', 'executionId', 'taskId', 'agentInstanceId', 'roleId', 'sessionId'] as const) {
    const v = (e as unknown as Record<string, unknown>)[f];
    assert.ok(v === undefined || (typeof v === 'string' && v.length > 0), `${f} is never blank`);
    assert.ok((v !== undefined) !== !!gapOf(e, f), `${f} is either present or a gap`);
  }
}

// ---- Ids -------------------------------------------------------------------------------------------

test('ids: ULIDs sort by time, ids validate by kind, invalid recorded ids are dropped', () => {
  const a = ulid(1000, () => new Uint8Array(16));
  const b = ulid(2000, () => new Uint8Array(16).fill(31));
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(a < b);
  assert.ok(isProjectId(mintProjectId()) && !isProjectId('prj_') && !isProjectId('shop'));
  assert.ok(isExecutionId(mintExecutionId()) && !isExecutionId(mintProjectId()));
  assert.ok(isTaskId(mintTaskId()));
  assert.equal(issueTaskId('Acme/Shop', 12), 'issue:acme/shop#12');
  assert.equal(issueTaskId('acme/shop', 0), undefined);
  assert.equal(issueTaskId(undefined, 3), undefined);
  assert.equal(legacyQueueTaskId('shop', 'a1b2c3d4e5f6'), 'queue:shop/a1b2c3d4e5f6');
  assert.equal(legacyQueueTaskId('../x', 'a1b2c3'), undefined);
  assert.deepEqual(cleanIds({ projectId: PRJ, executionId: 'exe_nope', agentInstanceId: 'a1b2c3d4e5f6', roleId: 'lead-developer', spanId: 'ok-1', extra: 1 }), { projectId: PRJ, agentInstanceId: 'a1b2c3d4e5f6', roleId: 'lead-developer', spanId: 'ok-1' });
  assert.equal(cleanIds({ projectId: 'x' }), undefined);
  assert.equal(cleanIds('nope'), undefined);
});

// ---- Project ids -----------------------------------------------------------------------------------

function floorsJson(root: string, dataDir: string, ids: string[]): FloorDef[] {
  const defs = ids.map((id, i) => {
    const dir = path.join(root, 'acme', id);
    mkdirSync(dir, { recursive: true });
    return { id, name: id, repo: `acme/${id}`, dir, palette: i, addedBy: 'Sam', addedAt: 1 };
  });
  writeFileSync(path.join(dataDir, 'floors.json'), JSON.stringify(defs));
  return defs;
}
const savedDefs = (dataDir: string) => JSON.parse(readFileSync(path.join(dataDir, 'floors.json'), 'utf8')) as FloorDef[];

test('project ids: floors from before get one on the first load, kept in floors.json, the same after a restart', (t) => {
  const { root, dataDir } = tmp(t);
  floorsJson(root, dataDir, ['api', 'web']);
  const first = new Building(dataDir, root, { projectIds: new ProjectIds(dataDir) });
  const ids = first.list().map((d) => d.projectId);
  assert.ok(ids.every(isProjectId));
  assert.notEqual(ids[0], ids[1]);
  assert.deepEqual(savedDefs(dataDir).map((d) => d.projectId), ids, 'recorded in floors.json at once');
  // A restart: new registry and building read back the same ids, and the routing ids are unchanged.
  const again = new Building(dataDir, root, { projectIds: new ProjectIds(dataDir) });
  assert.deepEqual(again.list().map((d) => [d.id, d.projectId]), [['api', ids[0]], ['web', ids[1]]]);
  // A building without the registry (agent-office setup) keeps them as they are.
  new Building(dataDir, root).remove('api');
  assert.equal(savedDefs(dataDir)[0].projectId, ids[1]);
});

test('project ids: a floor taken off and added again under another name keeps its project id', (t) => {
  const { root, dataDir } = tmp(t);
  const [web] = floorsJson(root, dataDir, ['web']);
  const b = new Building(dataDir, root, { projectIds: new ProjectIds(dataDir) });
  const prj = b.list()[0].projectId!;
  assert.ok(typeof b.remove('web', 'Sam') === 'object');
  // Added again as "Web shop": a new slug and floor id, the same repository, no projectId carried.
  writeFileSync(path.join(dataDir, 'floors.json'), JSON.stringify([{ ...web, id: 'web-shop', name: 'Web shop', repo: 'ACME/web' }]));
  const after = new Building(dataDir, root, { projectIds: new ProjectIds(dataDir) });
  assert.deepEqual(after.list().map((d) => [d.id, d.projectId]), [['web-shop', prj]]);
});

test('project ids: a reused slug is a new project; a lost registry adopts the ids floors.json carries', (t) => {
  const { root, dataDir } = tmp(t);
  const reg = new ProjectIds(dataDir, () => 10);
  const a = reg.ensure({ id: 'web', repo: 'acme/web', dir: path.join(root, 'a') });
  assert.equal(reg.ensure({ id: 'web', repo: 'acme/web', dir: path.join(root, 'a') }), a);
  const b = reg.ensure({ id: 'web', repo: 'other/site', dir: path.join(root, 'b') });
  assert.notEqual(a, b, 'the same slug for another repository is another project');
  assert.equal(new ProjectIds(dataDir).byFloorId('web'), b, 'an old floor id resolves to the project that has it now');
  // A checkout with no repository is known by its folder.
  const local = reg.ensure({ id: 'scratch', dir: path.join(root, 'scratch') });
  assert.equal(reg.ensure({ id: 'scratch-2', dir: path.join(root, 'scratch') }), local);
  // Registry gone: the id the floor carries is taken, not replaced.
  rmSync(path.join(dataDir, 'projects'), { recursive: true });
  const fresh = new ProjectIds(dataDir);
  assert.equal(fresh.ensure({ id: 'web', repo: 'acme/web', dir: path.join(root, 'a'), projectId: a }), a);
  assert.deepEqual(fresh.get(a)?.floorIds, ['web']);
});

// ---- Audit ids -------------------------------------------------------------------------------------

test('audit: events with and without ids chain and verify; invalid ids are not written', (t) => {
  const { dataDir } = tmp(t);
  const log = new AuditLog(path.join(dataDir, 'audit'));
  log.append({ floor: 'shop', actor: { kind: 'office', name: 'The queue' }, action: 'queue.start', summary: 'old style' });
  const withIds = log.append({ floor: 'shop', actor: { kind: 'office', name: 'The queue' }, action: 'queue.start', summary: 'new style', ids: { projectId: PRJ, executionId: 'not-one', agentInstanceId: 'a1b2c3d4e5f6' } });
  assert.deepEqual(withIds.ids, { projectId: PRJ, agentInstanceId: 'a1b2c3d4e5f6' });
  log.append({ floor: 'shop', actor: { kind: 'office', name: 'x' }, action: 'other', summary: 'bad ids only', ids: { projectId: 'nope' } });
  const reread = new AuditLog(path.join(dataDir, 'audit'));
  assert.deepEqual(reread.verify('shop'), { ok: true });
  const events = reread.events('shop');
  assert.equal(events[0].ids, undefined);
  assert.equal(events[2].ids, undefined);
  assert.ok(!readFileSync(reread.fileOf('shop'), 'utf8').includes('not-one'));
});

// ---- Adapters --------------------------------------------------------------------------------------

test('adapter: audit events, with recorded ids when the event has them and inferred ones otherwise', (t) => {
  const { dataDir } = tmp(t);
  const log = new AuditLog(path.join(dataDir, 'audit'));
  const queued = log.append({ floor: 'shop', actor: { kind: 'office', name: 'The queue' }, action: 'queue.start', target: { kind: 'worker', id: 'a1b2c3d4e5f6', label: 'Ada' }, summary: 'Ada started', details: { task: 'ffeeddccbbaa', issue: 7 } });
  const e = fromAudit(queued, ctxFor(), 0);
  valid(e);
  assert.equal(e.eventType, 'task.assigned');
  assert.equal(e.projectId, PRJ);
  assert.equal(e.idSource.projectId, 'inferred');
  assert.equal(e.taskId, 'queue:shop/ffeeddccbbaa');
  assert.equal(e.agentInstanceId, 'a1b2c3d4e5f6');
  assert.match(gapOf(e, 'executionId')!.reason, /F2/);
  assert.equal(e.source.sourceVersion, queued.hash);
  assert.equal(e.source.locator, `audit:shop:${queued.id}`);
  assert.deepEqual(validateEvidenceRef(e.source), []);

  const exe = mintExecutionId();
  const rec = fromAudit(log.append({ floor: 'shop', actor: { kind: 'human', name: 'Sam' }, action: 'worker.prompt', summary: 'Prompted', ids: { projectId: PRJ, executionId: exe, roleId: 'lead-developer' } }), ctxFor());
  valid(rec);
  assert.equal(rec.eventType, 'human.intervention');
  assert.equal(rec.executionId, exe);
  assert.equal(rec.idSource.executionId, 'recorded');
  assert.equal(rec.idSource.projectId, 'recorded');
  // An office-wide event on a floor with no project id: the project is a gap, not blank.
  const office = fromAudit(log.append({ actor: { kind: 'human', name: 'Sam' }, action: 'login.ok', summary: 'Signed in' }), ctxFor({ projectId: undefined }));
  valid(office);
  assert.ok(gapOf(office, 'projectId'));
  assert.equal(office.source.locator.startsWith('audit:_office:'), true);
});

test('adapter: chatter messages are derived, with the speaker as the agent instance when it is a worker', () => {
  const m: ChatterMessage = { id: 'Abc_def-123456', at: 5, floor: 'shop', from: { name: 'Ada', kind: 'agent', roleId: 'lead-developer', workerId: 'a1b2c3d4e5f6' }, to: { group: 'pm' }, kind: 'escalation', text: 'Need a decision' };
  const e = fromChatter(m, ctxFor());
  valid(e);
  assert.equal(e.eventType, 'escalation.raised');
  assert.equal(e.agentInstanceId, 'a1b2c3d4e5f6');
  assert.equal(e.roleId, 'lead-developer');
  assert.equal(e.source.retentionClass, 'chatter-capped');
  assert.equal(e.payload.derived, true);
  const pm = fromChatter({ ...m, id: 'pm-1', kind: 'message', from: { name: 'Sam', kind: 'human' } }, ctxFor());
  valid(pm);
  assert.equal(pm.eventType, 'human.intervention');
  assert.match(gapOf(pm, 'agentInstanceId')!.reason, /human/);
  assert.ok(gapOf(pm, 'roleId'));
});

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'shop:a1b2c3d4e5f6', floor: 'shop', repo: 'acme/shop', worker: 'Ada', workerId: 'a1b2c3d4e5f6', provider: 'claude', model: 'claude-opus-5-5', modelLabel: 'Opus 5.5',
  title: 'Leave form', issue: 4, prompt: 'Build it', startedAt: 100, endedAt: 900, durationMs: 800, activeMs: 500, apiCalls: 3, toolCalls: 9,
  tokens: { input: 10, output: 20, cacheWrite: 0, cacheRead: 0 }, cost: 1.25, humanPrompts: 1, needsInput: 0, needsInputMs: 0, outcome: 'merged', types: ['logic'], typesBy: 'keywords', updatedAt: 950, ...over,
});

test('adapter: analysis runs start and end; cost is estimated for Claude and unknown, not 0, for unmetered providers', () => {
  const [start, end] = fromRun(run(), ctxFor());
  valid(start);
  valid(end);
  assert.equal(start.eventType, 'execution.started');
  assert.equal(end.eventType, 'execution.completed');
  assert.equal(end.taskId, 'issue:acme/shop#4');
  assert.equal(end.idSource.taskId, 'inferred');
  assert.deepEqual(end.payload.cost, { status: 'estimated', value: 1.25 });
  assert.ok(gapOf(end, 'executionId') && gapOf(end, 'roleId'));
  const codex = fromRun(run({ provider: 'codex', cost: 0, tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } }), ctxFor())[1];
  assert.equal((codex.payload.cost as { status: string }).status, 'unknown');
  assert.equal((codex.payload.tokens as { status: string }).status, 'unknown');
  assert.equal(fromRun(run({ outcome: 'running' }), ctxFor()).length, 1, 'a running task has not ended');
});

test('adapter: budget ledger rows; unmetered cost is unknown and subagent or background spend names no instance', () => {
  const row: SpendRow = { day: '2026-10-01', agent: 'a1b2c3d4e5f6', model: 'claude-sonnet-5-5', stage: '5', issue: 4, cost: 0.5, calls: 2 };
  const e = fromSpendRow(row, ctxFor());
  valid(e);
  assert.equal(e.eventType, 'budget.updated');
  assert.equal(e.occurredAt, Date.parse('2026-10-01T00:00:00Z'));
  assert.equal(e.agentInstanceId, 'a1b2c3d4e5f6');
  assert.deepEqual(e.payload.cost, { status: 'estimated', value: 0.5 });
  assert.deepEqual(parseLocator(e.source.locator), { scheme: 'budget', floor: 'shop', rowKey: e.source.sourceId });
  const un = fromSpendRow({ ...row, agent: 'a1b2c3d4e5f6/explorer', cost: 0, unmetered: true }, ctxFor());
  valid(un);
  assert.equal((un.payload.cost as { status: string }).status, 'unknown');
  assert.match(gapOf(un, 'agentInstanceId')!.reason, /subagent/);
  const bg = fromSpendRow({ ...row, agent: 'bg:naming' }, ctxFor());
  valid(bg);
  assert.match(gapOf(bg, 'agentInstanceId')!.reason, /background/);
  assert.notEqual(un.source.sourceId, e.source.sourceId, 'each row has its own key');
});

const incident = (over: Partial<Incident> = {}): Incident => ({
  id: 'inc-lx1abc12', number: 3, title: 'Spend spike', severity: 'sev2', status: 'open', detectedAt: 300, detectedBy: { kind: 'rule', name: 'Spend spike', rule: 'spendSpike' }, floors: ['shop'], summary: 'Too much',
  impact: {}, timeline: [], actions: [{ id: 'a1', text: 'Cap it', status: 'open', link: { kind: 'pr', ref: '#9' } }], auditIds: ['x1'], workers: [{ id: 'a1b2c3d4e5f6', name: 'Ada', floor: 'shop' }], occurrences: 1, lastSeenAt: 300, createdAt: 300, updatedAt: 400, ...over,
});

test('adapter: incidents are evidence of kind incident; several workers are a gap, listed in the payload', () => {
  const e = fromIncident(incident(), ctxFor());
  valid(e);
  assert.equal(e.eventType, 'incident.recorded');
  assert.equal(e.source.kind, 'incident');
  assert.equal(e.source.sourceId, 'INC-3');
  assert.equal(e.agentInstanceId, 'a1b2c3d4e5f6');
  const two = fromIncident(incident({ workers: [{ id: 'a1b2c3d4e5f6', name: 'Ada' }, { id: 'ffeeddccbbaa', name: 'Bo' }] }), ctxFor());
  valid(two);
  assert.match(gapOf(two, 'agentInstanceId')!.reason, /several/);
});

// ---- The trace -------------------------------------------------------------------------------------

test('trace: merges every source oldest first, filters by since, reports coverage, absent events and a source that is missing', (t) => {
  const { dataDir } = tmp(t);
  const log = new AuditLog(path.join(dataDir, 'audit'), { now: () => 200 });
  log.append({ floor: 'shop', actor: { kind: 'office', name: 'q' }, action: 'queue.start', summary: 'started' });
  const sources: TraceSources = {
    audit: () => log.events('shop'),
    chatter: () => undefined,
    runs: () => [run()],
    spend: () => [{ day: '2026-10-01', agent: 'a1b2c3d4e5f6', model: 'm', stage: '5', cost: 1, calls: 1 }, { day: 'garbage', agent: 'x', model: 'm', stage: '5', cost: 1, calls: 1 }],
    incidents: () => [incident()],
  };
  const view = buildTrace({ floorId: 'shop', projectId: PRJ, repo: 'acme/shop', now: 5 }, sources);
  assert.deepEqual(view.events.map((e) => e.occurredAt), [...view.events.map((e) => e.occurredAt)].sort((a, b) => a - b));
  assert.ok(view.events.every(isTraceEvent));
  assert.equal(view.coverage.find((c) => c.source === 'chatter')?.status, 'missing');
  assert.equal(view.coverage.find((c) => c.source === 'budget')?.events, 1, 'a row with no real day is skipped, not dated 0');
  assert.ok(view.absent.includes('tool.completed') && view.absent.includes('check.completed'));
  assert.equal(view.tenantId, 'local');
  const later = buildTrace({ floorId: 'shop', projectId: PRJ, since: 350, now: 5 }, sources);
  assert.ok(later.events.every((e) => e.occurredAt >= 350));
  assert.ok(later.events.length < view.events.length);
  const two = buildTrace({ floorId: 'shop', projectId: PRJ, limit: 2, now: 5 }, sources);
  assert.equal(two.events.length, 2);
  assert.equal(two.truncated, true);
});

test('trace: disk sources read the office files without writing any', (t) => {
  const { dataDir } = tmp(t);
  new AuditLog(path.join(dataDir, 'audit')).append({ floor: 'shop', actor: { kind: 'office', name: 'q' }, action: 'queue.add', summary: 'queued' });
  const view = buildTrace({ floorId: 'shop', projectId: PRJ }, diskSources(dataDir, 'shop'));
  assert.equal(view.events.length, 1);
  assert.deepEqual(view.coverage.map((c) => [c.source, c.status]), [['audit', 'available'], ['chatter', 'empty'], ['analysis', 'empty'], ['budget', 'empty'], ['incidents', 'empty'], ['delivery', 'empty']]);
  assert.deepEqual(readdir(dataDir), ['audit'], 'no other source made a file');
});
const readdir = (d: string) => readdirSync(d).sort();

// ---- Locators and validation -----------------------------------------------------------------------

test('locators: round-trip, and reject traversal, absolute and backslashed paths', () => {
  for (const s of ['audit:shop:abc123', 'chatter:shop:Abc_def-1', 'analysis:shop:a1b2c3d4e5f6', 'budget:shop:2026-10-01.abcdef012345', 'incidents:inc-x1', 'git:abc1234:docs/a.md']) {
    const l = parseLocator(s);
    assert.ok(l, s);
    assert.equal(formatLocator(l!), s);
  }
  for (const s of ['git:abc1234:../etc/passwd', 'git:abc1234:/etc/passwd', 'git:abc1234:C:/x', 'git:abc1234:a\\b', 'audit:../x:1', 'audit:shop:..', 'audit:shop', 'file:/x', 'incidents:a:b', 'audit:shop:a\nb', 42]) {
    assert.equal(parseLocator(s), undefined, String(s));
  }
});

test('validation: an EvidenceRef names its tenant, kind, source and a valid locator; a trace event needs every id or a gap', () => {
  const e = fromChatter({ id: 'm1', at: 1, floor: 'shop', from: { name: 'Ada', kind: 'agent' }, to: { group: 'team' }, kind: 'journal', text: 'x' }, ctxFor());
  valid(e);
  assert.deepEqual(validateEvidenceRef({ ...e.source, tenantId: 'acme', kind: 'nope', locator: 'git:abc1234:../x', availability: 'gone' }), ['tenantId', 'kind', 'locator', 'availability']);
  assert.deepEqual(validateEvidenceRef(null), ['not an object']);
  const { projectId: _p, ...noProject } = e;
  assert.ok(validateTraceEvent({ ...noProject, idSource: {} }).includes('projectId: missing without a gap'));
  assert.ok(validateTraceEvent({ ...e, executionId: 'exe_bad' }).includes('executionId'));
  assert.ok(validateTraceEvent({ ...e, roleId: 'lead-developer', idSource: { ...e.idSource, roleId: 'recorded' } }).some((x) => x.includes('both present and a gap')));
});

// ---- The route -------------------------------------------------------------------------------------

test('GET /api/evidence/trace: a floor that is open, with its project id; 404 and 400 otherwise', async (t) => {
  const { root, dataDir } = tmp(t);
  floorsJson(root, dataDir, ['shop']);
  const building = new Building(dataDir, root, { projectIds: new ProjectIds(dataDir) });
  const ctx = { cfg: { dataDir }, building, floors: new Map([['shop', {}]]) };
  const call = (q: string) => {
    let status = 0;
    let body: Record<string, unknown> = {};
    const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => void (body = JSON.parse(b)), headersSent: false };
    (evidenceRoutes.trace.handle as (c: unknown, r: unknown) => void)(ctx, { res, url: new URL(`http://office.test/api/evidence/trace?${q}`), path: '/api/evidence/trace', session: {} });
    return { status, body };
  };
  assert.equal(call('floor=nope').status, 404);
  assert.equal(call('floor=shop&since=whenever').status, 400);
  const ok = call('floor=shop&since=0');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.projectId, building.list()[0].projectId);
  assert.equal(ok.body.floorId, 'shop');
  assert.ok(Array.isArray(ok.body.events) && Array.isArray(ok.body.absent));
  assert.equal(evidenceRoutes.trace.auth, 'session');
});
