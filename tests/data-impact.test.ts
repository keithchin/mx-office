// The data-impact guard (server/data-impact/, shared/data-impact.ts): every detection kind from a made-up MPR v2
// project read straight out of git (removed, renamed and no-longer-persistable entities, removed, renamed,
// retyped and now-calculated attributes, removed, renamed and re-stored associations, a changed delete
// behaviour, removed and renamed enumeration values in use, a generalization change), what isn't a finding
// (a longer string, a new attribute, a page edit), `unknown` when a model can't be read (which holds), the
// approval's binding to environment, baseline, target and recovery evidence (any change voids it, said in the
// record and the audit), the dump step recorded and re-checked, the permission (office admins by default, not
// a member, the policy can name accounts), and the hash-chained audit. No mxcli, no database, no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuditLog, readAudit, useAudit, verifyAudit } from '../src/server/audit/index.js';
import { DataImpact } from '../src/server/data-impact/index.js';
import { ModelUnits } from '../src/server/model/units.js';
import { stopExecWorker } from '../src/server/offloop/exec.js';
import { diffSnapshots, holdReason, NO_DATA_STATEMENT, type ImpactKind, type ModelSnapshot } from '../src/shared/data-impact.js';
import { liveNeeds, liveNotifies, liveStatus, revisionLine } from '../src/shared/liveapp/status.js';
import type { LiveAppState } from '../src/shared/protocol.js';
import { removeDir } from './support/cleanup.js';
import { hasSqlite, project, type MadeUnit, type V } from './support/mendix.js';

test.after(() => stopExecWorker());

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();

// ---- A made-up app: module Sales with Order, Customer, Note, an association and an enumeration --------

type Attr = { id: string; name: string; type: string; len?: number; enumeration?: string; calculated?: boolean };
type Ent = { id: string; name: string; attrs: Attr[]; persistable?: boolean; gen?: string };
type Assoc = { id: string; name: string; parent: string; child: string; type?: string; owner?: string; del?: string };
type Model = { entities: Ent[]; assocs: Assoc[]; enumValues: { id: string; name: string }[]; page?: string };

const attrDoc = (a: Attr): Record<string, V> => ({
  $ID: a.id,
  $Type: 'DomainModels$Attribute',
  Name: a.name,
  NewType: { $Type: `DomainModels$${a.type}AttributeType`, ...(a.len !== undefined ? { Length: a.len } : {}), ...(a.enumeration ? { Enumeration: a.enumeration } : {}) },
  Value: a.calculated ? { $Type: 'DomainModels$CalculatedValue' } : { $Type: 'DomainModels$StoredValue', DefaultValue: '' },
});
const entDoc = (e: Ent): Record<string, V> => ({
  $ID: e.id,
  $Type: 'DomainModels$EntityImpl',
  Name: e.name,
  MaybeGeneralization: e.gen ? { $Type: 'DomainModels$Generalization', Generalization: e.gen } : { $Type: 'DomainModels$NoGeneralization', Persistable: e.persistable !== false },
  Attributes: [3, ...e.attrs.map(attrDoc)],
});
const assocDoc = (a: Assoc): Record<string, V> => ({ $ID: a.id, $Type: 'DomainModels$Association', Name: a.name, ParentPointer: a.parent, ChildPointer: a.child, Type: a.type ?? 'Reference', Owner: a.owner ?? 'Default', DeleteBehavior: { ParentDeleteBehavior: a.del ?? 'DeleteMeButKeepReferences', ChildDeleteBehavior: 'DeleteMeButKeepReferences' } });

function units(m: Model): MadeUnit[] {
  return [
    { n: 1, container: 1, hash: 'p', doc: { $Type: 'Projects$Project' } },
    { n: 2, container: 1, hash: 'm', doc: { $Type: 'Projects$ModuleImpl', Name: 'Sales' } },
    { n: 3, container: 2, hash: 'dm', doc: { $Type: 'DomainModels$DomainModel', Entities: [3, ...m.entities.map(entDoc)], Associations: [3, ...m.assocs.map(assocDoc)] } },
    { n: 4, container: 2, hash: 'en', doc: { $Type: 'Enumerations$Enumeration', Name: 'Status', Values: [3, ...m.enumValues.map((v) => ({ $ID: v.id, $Type: 'Enumerations$EnumerationValue', Name: v.name }))] } },
    { n: 5, container: 2, hash: 'pg', doc: { $Type: 'Forms$Page', Name: 'Home', Title: m.page ?? 'Home' } },
  ];
}

const BASE: Model = {
  entities: [
    { id: 'e-order', name: 'Order', attrs: [{ id: 'a-notes', name: 'Notes', type: 'String', len: 500 }, { id: 'a-qty', name: 'Quantity', type: 'Integer' }, { id: 'a-status', name: 'Status', type: 'Enumeration', enumeration: 'Sales.Status' }, { id: 'a-code', name: 'Code', type: 'String', len: 20 }, { id: 'a-total', name: 'Total', type: 'Decimal' }] },
    { id: 'e-customer', name: 'Customer', attrs: [{ id: 'a-name', name: 'Name', type: 'String', len: 200 }] },
    { id: 'e-note', name: 'Note', attrs: [{ id: 'a-text', name: 'Text', type: 'String', len: 0 }] },
    { id: 'e-draft', name: 'Draft', persistable: false, attrs: [{ id: 'a-tmp', name: 'Tmp', type: 'String', len: 10 }] },
    { id: 'e-vip', name: 'Vip', gen: 'Sales.Customer', attrs: [] },
  ],
  assocs: [
    { id: 's-oc', name: 'Order_Customer', parent: 'e-order', child: 'e-customer' },
    { id: 's-on', name: 'Order_Note', parent: 'e-order', child: 'e-note' },
    { id: 's-od', name: 'Order_Draft', parent: 'e-order', child: 'e-draft' },
  ],
  enumValues: [
    { id: 'v-open', name: 'Open' },
    { id: 'v-closed', name: 'Closed' },
    { id: 'v-held', name: 'OnHold' },
  ],
};

const clone = (m: Model): Model => JSON.parse(JSON.stringify(m));
const edit = (fn: (m: Model) => void): Model => {
  const m = clone(BASE);
  fn(m);
  return m;
};
const order = (m: Model) => m.entities.find((e) => e.name === 'Order')!;

async function repo(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-di-'));
  const u = new ModelUnits(path.join(dir, '.cache'));
  t.after(() => {
    u.close();
    removeDir(dir);
  });
  const r = path.join(dir, 'repo');
  mkdirSync(r);
  git(r, 'init', '-q', '-b', 'main');
  const commit = async (m: Model | null, msg: string, extra?: Record<string, string>) => {
    if (m) {
      rmSync(path.join(r, 'mprcontents'), { recursive: true, force: true });
      await project(r, units(m));
    }
    for (const [f, text] of Object.entries(extra ?? {})) writeFileSync(path.join(r, f), text);
    git(r, 'add', '-A');
    git(r, 'commit', '-qm', msg);
    return git(r, 'rev-parse', 'HEAD');
  };
  return { dir, repo: r, units: u, commit };
}

const SKIP = !(await hasSqlite()) && 'no node:sqlite';

test('detection: every kind, from the units in git, with the unit, the element and a plain risk line', { skip: SKIP }, async (t) => {
  const r = await repo(t);
  const di = new DataImpact(fakeCtx(r.dir));
  const a = di.guard.assessments(r.units);
  const base = await r.commit(BASE, 'base');
  const cases: [string, Model, ImpactKind, RegExp][] = [
    ['attribute removed', edit((m) => void (order(m).attrs = order(m).attrs.filter((x) => x.name !== 'Notes'))), 'attribute-removed', /^may drop data in Sales\.Order\.Notes$/],
    ['attribute renamed', edit((m) => void (order(m).attrs.find((x) => x.name === 'Notes')!.name = 'Remarks')), 'attribute-renamed', /^renamed Sales\.Order\.Notes → Sales\.Order\.Remarks: the runtime keeps the column's data by the attribute's id/],
    ['attribute type', edit((m) => void Object.assign(order(m).attrs.find((x) => x.name === 'Quantity')!, { type: 'String', len: 10 })), 'attribute-type', /^may drop or convert data in Sales\.Order\.Quantity \(Integer → String\(10\)\)$/],
    ['string shortened', edit((m) => void (order(m).attrs.find((x) => x.name === 'Notes')!.len = 100)), 'attribute-type', /String\(500\) → String\(100\)/],
    ['now calculated', edit((m) => void (order(m).attrs.find((x) => x.name === 'Total')!.calculated = true)), 'attribute-calculated', /^may drop data in Sales\.Order\.Total \(no longer stored/],
    ['entity removed', edit((m) => void ((m.entities = m.entities.filter((e) => e.name !== 'Note')), (m.assocs = m.assocs.filter((x) => x.name !== 'Order_Note')))), 'entity-removed', /^may drop data in Sales\.Note \(the entity is removed: its table and 1 attribute\)$/],
    ['entity renamed', edit((m) => void (m.entities.find((e) => e.name === 'Note')!.name = 'Comment')), 'entity-renamed', /^renamed Sales\.Note → Sales\.Comment/],
    ['entity not persistable', edit((m) => void (m.entities.find((e) => e.name === 'Note')!.persistable = false)), 'entity-not-persistable', /no longer persistable/],
    ['association removed', edit((m) => void (m.assocs = m.assocs.filter((x) => x.name !== 'Order_Customer'))), 'association-removed', /^may drop data in Sales\.Order_Customer \(the links between records\)$/],
    ['association renamed', edit((m) => void (m.assocs.find((x) => x.name === 'Order_Customer')!.name = 'Order_Buyer')), 'association-renamed', /^renamed Sales\.Order_Customer → Sales\.Order_Buyer/],
    ['association storage', edit((m) => void (m.assocs.find((x) => x.name === 'Order_Customer')!.type = 'ReferenceSet')), 'association-storage', /Reference\/Default → ReferenceSet\/Default/],
    ['delete behaviour', edit((m) => void (m.assocs.find((x) => x.name === 'Order_Customer')!.del = 'DeleteMeAndReferences')), 'delete-behaviour', /^changes which data goes when a record is deleted: Sales\.Order_Customer \(parent: keep references; child: keep references → parent: delete the other side too; child: keep references\)$/],
    ['enum value removed', edit((m) => void (m.enumValues = m.enumValues.filter((v) => v.name !== 'Closed'))), 'enum-value-removed', /^may drop or convert data in Sales\.Order\.Status \(value Closed removed from Sales\.Status\)$/],
    ['enum value renamed', edit((m) => void (m.enumValues.find((v) => v.name === 'OnHold')!.name = 'Paused')), 'enum-value-renamed', /value OnHold renamed to Paused: stored rows keep OnHold/],
    ['generalization', edit((m) => void (m.entities.find((e) => e.name === 'Vip')!.gen = 'System.User')), 'generalization', /^may convert or drop data in Sales\.Vip \(generalization Sales\.Customer → System\.User\)$/],
  ];
  for (const [label, m, kind, risk] of cases) {
    const sha = await r.commit(m, label);
    const got = await a.assess(r.repo, base, sha);
    assert.equal(got.status, 'impact', label);
    const f = got.findings.find((x) => x.kind === kind);
    assert.ok(f, `${label}: ${JSON.stringify(got.findings)}`);
    assert.match(f.risk, risk, label);
    assert.equal(f.unit, kind.startsWith('enum') ? 'enumeration Sales.Status' : 'Sales domain model', label);
    assert.equal(got.uncertainty, 'Detected from the model diff; migration logic and Java are not analysed.');
  }
  // Not findings: a longer string, a new attribute, a non-persistable entity's attribute, an unused value added, a page edit.
  const fine = await r.commit(
    edit((m) => {
      order(m).attrs.find((x) => x.name === 'Code')!.len = 0;
      order(m).attrs.push({ id: 'a-new', name: 'Due', type: 'DateTime' });
      m.entities.find((e) => e.name === 'Draft')!.attrs = [];
      m.enumValues.push({ id: 'v-new', name: 'Archived' });
      m.page = 'Welcome';
    }),
    'harmless',
  );
  assert.deepEqual(await a.assess(r.repo, base, fine), { ...(await a.assess(r.repo, base, fine)), status: 'clear', findings: [] });
  // Docs alone: none of the units it reads changed (equal hashes), so nothing is decoded.
  const docs = await r.commit(null, 'docs', { 'README.md': 'hi' });
  assert.equal((await a.assess(r.repo, fine, docs)).status, 'clear');
  // Kept per revision pair: the same object again.
  assert.equal(await a.assess(r.repo, base, fine), await a.assess(r.repo, base, fine));
});

test('the 15-attribute removal: one finding per attribute, each naming it', () => {
  const attrs = Array.from({ length: 16 }, (_, i) => ({ id: `a${i}`, name: `Field${i}`, type: 'String(200)', stored: true }));
  const snap = (n: number): ModelSnapshot => ({ entities: [{ id: 'e', qn: 'Inspection.Sheet', module: 'Inspection', persistable: true, generalization: '', attrs: attrs.slice(0, n) }], associations: [], enums: [] });
  const f = diffSnapshots(snap(16), { entities: [{ ...snap(16).entities[0], attrs: [attrs[0], { id: 'x', name: 'RejectionNote', type: 'String(500)', stored: true }] }], associations: [], enums: [] });
  assert.equal(f.length, 15);
  assert.ok(f.every((x) => x.kind === 'attribute-removed' && /^may drop data in Inspection\.Sheet\.Field\d+$/.test(x.risk)));
});

test('unknown: a model that cannot be read holds, and is not kept as an answer', { skip: SKIP }, async (t) => {
  const r = await repo(t);
  const base = await r.commit(BASE, 'base');
  rmSync(path.join(r.repo, 'App.mpr'));
  const gone = await r.commit(null, 'the project file is gone');
  const di = new DataImpact(fakeCtx(r.dir));
  const got = await di.guard.assessments(r.units).assess(r.repo, base, gone);
  assert.equal(got.status, 'unknown');
  assert.match(got.error ?? '', /^the model couldn't be read: no Mendix project \(\.mpr\) in this commit/);
  assert.equal(di.guard.assessments(r.units).peek(r.repo, base, gone), undefined, 'unknown is never kept');
  const v = await di.guard.check({ floorId: 'demo', dir: r.repo, base, target: gone, units: r.units });
  assert.equal(v.hold, true);
  assert.match(v.hold ? v.why : '', /^Update held: data impact unknown at [0-9a-f]{7} \(the model couldn't be read: .*\); needs data-impact approval$/);
});

// ---- The guard, the approval and the permission -----------------------------------------------------

function fakeCtx(dataDir: string, accounts = [{ id: 'u-admin', name: 'Ada', role: 'admin' }, { id: 'u-member', name: 'Mo', role: 'member' }, { id: 'u-owner', name: 'Olu', role: 'member' }]) {
  return {
    cfg: { dataDir },
    accounts: { state: () => ({ accounts, invites: [], sharedPassword: false }) },
    meOf: (id: string | undefined) => ({ admin: accounts.find((a) => a.id === id)?.role === 'admin' }),
  } as unknown as ConstructorParameters<typeof DataImpact>[0];
}

test('the hold, the permission, the dump and an approval bound to environment, baseline, target and recovery evidence; audited', { skip: SKIP }, async (t) => {
  const r = await repo(t);
  useAudit(new AuditLog(path.join(r.dir, 'audit')));
  t.after(() => useAudit(undefined));
  const dumpsTaken: string[] = [];
  const di = new DataImpact(fakeCtx(r.dir), {
    pg: () => ({ host: '127.0.0.1', port: 1, user: 'x', password: 'x', database: 'demo_live' }),
    takeDump: async (_pg, file) => {
      dumpsTaken.push(file);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, 'PGDMP fake dump');
      return { size: 15, sha256: (await import('node:crypto')).createHash('sha256').update('PGDMP fake dump').digest('hex'), verified: 'pg_restore --list read 3 entries' };
    },
  });
  const base = await r.commit(BASE, 'base');
  const cand = await r.commit(edit((m) => void (order(m).attrs = order(m).attrs.filter((x) => x.name !== 'Notes'))), 'drop Notes');
  const check = (target = cand, b = base) => di.guard.check({ floorId: 'demo', dir: r.repo, base: b, target, units: r.units });
  const v = await check();
  assert.equal(v.hold, true);
  assert.equal(v.hold && v.why, `Update held: possible data impact at ${cand.slice(0, 7)}; needs data-impact approval`);
  // The hold as its own fact in the view, findings, who may approve.
  const member = di.view('demo', 'u-member');
  assert.deepEqual([member.held?.env, member.held?.base, member.held?.target, member.held?.status], ['live-preview', base, cand, 'impact']);
  assert.equal(member.canApprove, false);
  assert.equal(member.approvers, 'office admins (Ada)');
  assert.equal(member.assessment?.findings[0].element, 'Sales.Order.Notes');
  assert.equal(di.view('demo', 'u-admin').canApprove, true);
  // Asked again with the same binding: one hold, one audit line.
  await check();
  // Refused without the permission (a member, the project owner by default), with who can.
  const refused = await di.approve('demo', { name: 'Mo', id: 'u-member' }, 'u-member', { base, target: cand, reason: 'go', noData: true });
  assert.deepEqual(refused, [403, "You don't have the data-impact approval permission. Who has it: office admins (Ada)"]);
  assert.ok(Array.isArray(await di.approve('demo', { name: 'Olu', id: 'u-owner' }, 'u-owner', { base, target: cand, reason: 'go', noData: true })), 'the owner is not an approver by default');
  // The policy can name an account.
  di.setPolicy({ admins: true, accounts: ['u-owner', 'nobody'] }, { name: 'Ada', id: 'u-admin' });
  assert.equal(di.mayApprove('u-owner'), true);
  assert.equal(di.approvers(), 'office admins (Ada) and Olu');
  di.setPolicy({ admins: true, accounts: [] }, { name: 'Ada', id: 'u-admin' });
  // A recovery step and a reason are required; a stale binding is a 409.
  assert.deepEqual(await di.approve('demo', { name: 'Ada', id: 'u-admin' }, 'u-admin', { base, target: cand, reason: 'ok go' }), [400, 'Choose a recovery step: a database dump, or "no data to keep"']);
  assert.deepEqual(await di.approve('demo', { name: 'Ada', id: 'u-admin' }, 'u-admin', { base, target: cand, noData: true }), [400, 'Say why (a reason is required)']);
  assert.equal(((await di.approve('demo', { name: 'Ada', id: 'u-admin' }, 'u-admin', { base, target: base, reason: 'x y z', noData: true })) as [number, string])[0], 409);
  // The dump step: recorded with path, size and sha256, for this binding.
  const d = await di.dump('demo', { name: 'Ada', id: 'u-admin' });
  assert.ok(typeof d !== 'string');
  assert.deepEqual([d.base, d.target, d.env, d.size, d.database, d.verified], [base, cand, 'live-preview', 15, 'demo_live', 'pg_restore --list read 3 entries']);
  assert.match(d.sha256, /^[0-9a-f]{64}$/);
  assert.equal(path.dirname(d.path), path.join(r.dir, 'data-impact', 'dumps', 'demo'));
  assert.equal(di.view('demo', 'u-admin').dumps[0].id, d.id);
  const ok = await di.approve('demo', { name: 'Ada', id: 'u-admin' }, 'u-admin', { base, target: cand, reason: 'notes moved to Comment first', dump: d.id });
  assert.ok(!Array.isArray(ok));
  assert.deepEqual([ok.env, ok.base, ok.target, ok.recovery.kind, ok.reason, ok.by.name], ['live-preview', base, cand, 'dump', 'notes moved to Comment first', 'Ada']);
  assert.deepEqual(ok.recovery.kind === 'dump' && [ok.recovery.path, ok.recovery.size, ok.recovery.sha256], [d.path, d.size, d.sha256]);
  // A new commit on the candidate before it was applied voids it: reassessed, held again.
  const cand2 = await r.commit(edit((m) => void (order(m).attrs = order(m).attrs.filter((x) => x.name !== 'Notes' && x.name !== 'Code'))), 'drop Code too');
  const again = await check(cand2);
  assert.equal(again.hold, true);
  const voided = di.view('demo', 'u-admin').approvals.find((x) => x.id === ok.id);
  assert.match(voided?.void?.why ?? '', /^the candidate changed \([0-9a-f]{7} → [0-9a-f]{7}\)$/);
  // A different baseline voids an approval too; so does a changed dump file.
  const ok2 = await di.approve('demo', { name: 'Ada', id: 'u-admin' }, 'u-admin', { base, target: cand2, reason: 'test data only', noData: true });
  assert.ok(!Array.isArray(ok2));
  assert.equal(ok2.recovery.kind === 'none' && ok2.recovery.statement, NO_DATA_STATEMENT);
  const fromElsewhere = await check(cand2, cand);
  assert.equal(fromElsewhere.hold, true);
  assert.match(di.view('demo', 'u-admin').approvals.find((x) => x.id === ok2.id)?.void?.why ?? '', /^the starting baseline changed/);
  const d3 = await di.dump('demo', { name: 'Ada', id: 'u-admin' });
  assert.ok(typeof d3 !== 'string');
  const ok3 = await di.approve('demo', { name: 'Ada', id: 'u-admin' }, 'u-admin', { base: cand, target: cand2, reason: 'dump taken', dump: d3.id });
  assert.ok(!Array.isArray(ok3));
  writeFileSync(d3.path, 'PGDMP tampered!');
  assert.equal((await check(cand2, cand)).hold, true, 'a changed dump no longer counts');
  assert.equal(di.view('demo', 'u-admin').approvals.find((x) => x.id === ok3.id)?.void?.why, 'the database dump changed (sha256)');
  // Approved with an intact dump: the guard lets exactly this binding through, and the hold is released.
  const d4 = await di.dump('demo', { name: 'Ada', id: 'u-admin' });
  assert.ok(typeof d4 !== 'string');
  const ok4 = await di.approve('demo', { name: 'Ada', id: 'u-admin' }, 'u-admin', { base: cand, target: cand2, reason: 'fresh dump', dump: d4.id });
  assert.ok(!Array.isArray(ok4));
  const passed = await check(cand2, cand);
  assert.equal(passed.hold, false);
  assert.equal(!passed.hold && passed.approval?.id, ok4.id);
  assert.equal(di.view('demo', 'u-admin').held, undefined);
  // Once used it stays as it was (it applied its candidate); the next change is assessed on its own.
  const cand3 = await r.commit(edit((m) => void (order(m).attrs = order(m).attrs.filter((x) => !['Notes', 'Code', 'Total'].includes(x.name)))), 'drop Total');
  assert.equal((await check(cand3, cand2)).hold, true);
  const used = di.view('demo', 'u-admin').approvals.find((x) => x.id === ok4.id)!;
  assert.ok(used.used && !used.void);
  // The audit: hold, dump, approve, void, release, policy; the chain holds.
  const ev = readAudit({ floor: 'demo', limit: 100 }).events;
  const actions = ev.map((e) => e.action);
  for (const a of ['data-impact.hold', 'data-impact.dump', 'data-impact.approve', 'data-impact.void', 'data-impact.release']) assert.ok(actions.includes(a), a);
  assert.equal(actions.filter((a) => a === 'data-impact.hold').length, 4, 'one hold line per binding: (base→cand), (base→cand2), (cand→cand2), (cand2→cand3)');
  assert.equal(actions.filter((a) => a === 'data-impact.void').length, 3);
  const approve = ev.find((e) => e.action === 'data-impact.approve' && e.details?.target === cand)!;
  assert.deepEqual([approve.details?.env, approve.details?.base, approve.details?.target, approve.details?.reason], ['live-preview', base, cand, 'notes moved to Comment first']);
  assert.equal((approve.details?.recovery as { sha256: string }).sha256, d.sha256);
  assert.equal(approve.actor.name, 'Ada');
  assert.ok(readAudit({ floor: 'all', limit: 100 }).events.some((e) => e.action === 'data-impact.policy'));
  assert.equal(verifyAudit('demo').ok, true);
  assert.equal(dumpsTaken.length, 3);
});

// ---- The words the live app's state and Needs you use -------------------------------------------------

test('held words: a separate fact (merged on main, not applied), running or not, one Needs-you row that notifies', () => {
  const T = 'abcdef1234567890abcdef1234567890abcdef12';
  const S = '1234567890abcdef1234567890abcdef12345678';
  const running: LiveAppState = { floor: 'demo', status: 'running', phase: 'running', log: [], available: true, branch: 'main', served: { sha: S, builtAt: 1 }, failure: { kind: 'held', at: 5, why: holdReason('impact', T), lines: [], sha: T } };
  assert.deepEqual(liveStatus(running), { word: 'running · update held', tone: 'bad' });
  assert.equal(revisionLine(running), 'Merged on main at abcdef1; not applied to the live preview: data-impact hold · still running 1234567');
  const [row] = liveNeeds(running, 'demo');
  assert.equal(row.key, `live-held:${T}`);
  assert.equal(row.level, 'block');
  assert.equal(row.text, 'Live app: merged on main at abcdef1; not applied to the live preview: data-impact hold (possible data impact). Needs data-impact approval; still running main @1234567');
  assert.ok(liveNotifies(row.key));
  assert.doesNotMatch(row.text, /runs abcdef1|running abcdef1/, 'never says the preview runs the held commit');
  const stopped: LiveAppState = { ...running, status: 'failed', phase: 'failed', served: undefined, failure: { kind: 'held', at: 5, why: holdReason('unknown', T, 'x'), lines: [], sha: T } };
  assert.deepEqual(liveStatus(stopped), { word: 'start held (data impact)', tone: 'bad' });
  assert.equal(revisionLine(stopped), 'Merged on main at abcdef1; not applied to the live preview: data-impact hold · nothing running');
  const rows = liveNeeds(stopped, 'demo');
  assert.equal(rows.filter((r) => r.key.startsWith('live-held:')).length, 1);
  assert.match(rows.find((r) => r.key.startsWith('live-held:'))!.text, /\(data impact unknown\)\. Needs data-impact approval; nothing running$/);
});
