// The acceptance record (gap map F2): append-only and hash-chained per floor, versions v1, v1.1…, a reopen
// that never erases the record it reopens, "changed since acceptance" from what's there now, the evidence
// trace finding the records, and only the Project Manager (an admin) accepting or reopening.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { changedSince, cleanExceptions, compareVersions, cyclesOf, suggestVersion, versionProblem, type AcceptanceRecord } from '../src/shared/acceptance.js';
import { parseLocator } from '../src/shared/evidence/types.js';
import { AcceptanceStore } from '../src/server/acceptance/store.js';
import { buildTrace } from '../src/server/evidence/trace.js';
import { progressAcceptance } from '../src/server/progress/index.js';
import { progressRoutes } from '../src/server/http/routes/progress.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'acceptance-'));

function record(version: string, cycle: number, over: Partial<AcceptanceRecord> = {}): AcceptanceRecord {
  return {
    schemaVersion: 1,
    id: `acc_${version.replace('.', '_')}`,
    projectId: 'prj_01J0000000000000000000000A',
    floorId: 'shop',
    version,
    cycle,
    acceptedAt: 1_000 + cycle,
    acceptedBy: { name: 'Pat' },
    scope: { agreed: [{ label: 'BRD F001', status: 'present' }], delivered: [{ label: 'BRDs built', status: 'unknown', detail: 'not recorded' }] },
    source: { branch: 'main', commit: 'a'.repeat(40), gaps: ['no build reference'] },
    tests: [{ label: 'Gate 6 · Test', status: 'pass' }, { label: 'CI', status: 'unknown', detail: 'no pull requests seen' }],
    docs: [{ label: 'PROJECT.md', status: 'present', locator: `git:${'a'.repeat(40)}:PROJECT.md` }],
    exceptions: [{ text: 'Wireframes missing', owner: 'Lead Designer' }],
    cost: { at: 1_000, spent: 12.5, estimated: 0, unmeteredCalls: 0, byStage: [] },
    deliverablesDigest: 'd1',
    refs: [],
    ...over,
  };
}

test('the store is append only and hash-chained; an edited line breaks the chain', () => {
  const dir = tmp();
  try {
    let t = 10;
    const s = new AcceptanceStore(dir, 'shop', () => t++);
    s.append({ op: 'accept', record: record('v1', 1) });
    s.append({ op: 'reopen', reopen: { id: 'reo_1', at: 20, by: { name: 'Pat' }, from: 'v1', version: 'v1.1', scopeNote: 'Add expenses' } });
    s.append({ op: 'accept', record: record('v1.1', 2) });
    assert.equal(s.all().length, 3);
    assert.deepEqual(s.verify(), { ok: true });
    const lines = readFileSync(s.file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[1]).prev.length, 64);
    // A fresh instance reads the same history.
    assert.deepEqual(new AcceptanceStore(dir, 'shop').cycles().map((c) => [c.version, !!c.record]), [['v1', true], ['v1.1', true]]);
    writeFileSync(s.file, `${lines[0].replace('"Pat"', '"Mallory"')}\n${lines.slice(1).join('\n')}\n`);
    assert.equal(new AcceptanceStore(dir, 'shop').verify().ok, false);
    writeFileSync(s.file, `${[lines[0], lines[2]].join('\n')}\n`);
    assert.equal(new AcceptanceStore(dir, 'shop').verify().ok, false, 'a dropped line shows too');
    assert.throws(() => new AcceptanceStore(dir, '../evil'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cycles: v1 is open from the start; a reopen keeps the record and starts the next version', () => {
  assert.deepEqual(cyclesOf([]), [{ version: 'v1', n: 1 }]);
  const r1 = record('v1', 1);
  const cycles = cyclesOf([
    { op: 'accept', record: r1 },
    { op: 'accept', record: record('v9', 1) }, // a second accept of one cycle is ignored
    { op: 'reopen', reopen: { id: 'reo_1', at: 5, by: { name: 'Pat' }, from: 'v1', version: 'v1.1', scopeNote: 'More' } },
  ]);
  assert.equal(cycles.length, 2);
  assert.equal(cycles[0].record, r1, 'the reopened record is untouched');
  assert.equal(cycles[1].version, 'v1.1');
  assert.equal(cycles[1].record, undefined);
  assert.equal(cycles[1].opened?.scopeNote, 'More');
  // A reopen before any acceptance is not a cycle.
  assert.equal(cyclesOf([{ op: 'reopen', reopen: { id: 'r', at: 1, by: { name: 'x' }, from: 'v1', version: 'v2', scopeNote: 'x' } }]).length, 1);
  const pa = progressAcceptance(cycles, []);
  assert.deepEqual(pa, { version: 'v1.1', cycle: 2, earlier: [{ version: 'v1', at: r1.acceptedAt }] });
});

test('versions: v1, v1.1, v2; the next must come after the last accepted', () => {
  assert.equal(compareVersions('v1.10', 'v1.9') > 0, true);
  const open = cyclesOf([]);
  assert.equal(suggestVersion(open), 'v1');
  assert.equal(versionProblem('v1', open), undefined);
  assert.match(versionProblem('1.0', open) ?? '', /looks like v1/);
  const accepted = cyclesOf([{ op: 'accept', record: record('v1', 1) }]);
  assert.equal(suggestVersion(accepted), 'v1.1');
  assert.match(versionProblem('v1', accepted) ?? '', /after v1/);
  assert.equal(versionProblem('v2', accepted), undefined);
});

test('exceptions need words and an owner', () => {
  assert.deepEqual(cleanExceptions(undefined), []);
  assert.deepEqual(cleanExceptions([{ text: ' Wireframes ', owner: ' Hedy ' }, { text: '', owner: '' }]), [{ text: 'Wireframes', owner: 'Hedy' }]);
  assert.match(String(cleanExceptions([{ text: 'No owner' }])), /needs an owner/);
  assert.match(String(cleanExceptions('x')), /list/);
});

test('changed since acceptance: the branch moved or the deliverables changed; unknowns are not changes', () => {
  const r = record('v1', 1);
  assert.deepEqual(changedSince(r, { commit: 'a'.repeat(40), digest: 'd1' }), []);
  assert.deepEqual(changedSince(r, {}), [], 'nothing known now: nothing claimed');
  const moved = changedSince(r, { commit: 'b'.repeat(40), digest: 'd2' });
  assert.equal(moved.length, 2);
  assert.match(moved[0], /main moved from aaaaaaaa to bbbbbbbb/);
});

test('the evidence trace finds accept and reopen records by their delivery locator', () => {
  const dir = tmp();
  try {
    const s = new AcceptanceStore(dir, 'shop', () => 5_000);
    s.append({ op: 'accept', record: record('v1', 1) });
    s.append({ op: 'reopen', reopen: { id: 'reo_1', at: 6_000, by: { name: 'Pat' }, from: 'v1', version: 'v1.1', scopeNote: 'More' } });
    const none = () => [];
    const view = buildTrace({ floorId: 'shop', projectId: 'prj_01J0000000000000000000000A', now: 9_000 }, { audit: none, chatter: none, runs: none, spend: none, incidents: none, acceptance: () => s.all() });
    const ev = view.events.filter((e) => e.source.sourceSystem === 'delivery');
    assert.deepEqual(ev.map((e) => [e.eventType, e.action]), [['review.completed', 'acceptance.accept'], ['other', 'acceptance.reopen']]);
    assert.equal(ev[0].source.locator, 'delivery:shop:acc_v1');
    assert.deepEqual(parseLocator(ev[0].source.locator), { scheme: 'delivery', floor: 'shop', recordId: 'acc_v1' });
    assert.equal(ev[0].projectId, 'prj_01J0000000000000000000000A');
    assert.ok(view.coverage.some((c) => c.source === 'delivery' && c.status === 'available'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Who may accept or reopen ----------------------------------------------------------------------

type Handle = (c: unknown, r: unknown) => Promise<void> | void;

function call(opts: { origin?: string; type?: string; admin: boolean; body: unknown; floors?: Map<string, unknown> }) {
  const headers: Record<string, string> = { host: 'office.test', ...(opts.origin ? { origin: opts.origin } : {}), ...(opts.type ? { 'content-type': opts.type } : {}) };
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(opts.body))]), { method: 'POST', headers });
  let status = 0;
  let body: unknown;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => void (body = JSON.parse(b)), headersSent: false };
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin: opts.admin }), floors: opts.floors ?? new Map() };
  const route = progressRoutes.act;
  return Promise.resolve((route.handle as Handle)(ctx, { req, res, url: new URL(`http://office.test${route.path}`), path: route.path, session: {} })).then(() => ({ status, body: body as { error?: string } }));
}

const ORIGIN = 'http://office.test';

test('POST /api/acceptance: the Project Manager (an admin) only, for accept and reopen', async () => {
  for (const body of [{ floor: 'shop', action: 'accept', confirm: true }, { floor: 'shop', action: 'reopen', scopeNote: 'x' }]) {
    const r = await call({ origin: ORIGIN, admin: false, body });
    assert.equal(r.status, 403, JSON.stringify(body));
    assert.match(r.body.error ?? '', /Project Manager \(an admin\)/);
  }
  assert.equal((await call({ origin: ORIGIN, admin: true, body: { floor: 'shop', action: 'accept', confirm: true } })).status, 404, 'an admin gets past the check');
});

test('POST /api/acceptance: another site is refused, a form without JSON too, and an accept must be confirmed', async () => {
  assert.equal((await call({ origin: 'https://evil.test', type: 'application/json', admin: true, body: { floor: 'shop', action: 'accept' } })).status, 403);
  assert.equal((await call({ admin: true, body: { floor: 'shop', action: 'accept' } })).status, 403);
  const floors = new Map([['shop', {}]]);
  const r = await call({ origin: ORIGIN, admin: true, floors, body: { floor: 'shop', action: 'accept' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error ?? '', /Confirm/);
  assert.equal((await call({ origin: ORIGIN, admin: true, floors, body: { floor: 'shop', action: 'merge' } })).status, 400);
});

test('every progress and acceptance route needs a signed-in session', () => {
  for (const r of Object.values(progressRoutes)) assert.equal(r.auth, 'session', r.path);
});
