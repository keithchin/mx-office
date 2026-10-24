// Increment B: one identity across entry points, and what links to a request.
//   - the link pass on a copied data folder fixture: old CR-n (no change id) and MCR-n get a linked DC-n as their
//     alias; the old records and the change record's earlier lines stay byte for byte; the chain verifies; a second
//     run adds nothing; the source folder is never touched
//   - the Model tab's Change this is linked (aliased), with entity, attribute and flow references carried; a linked
//     record never takes the engineering slot and is followed from its alias
//   - possibly related commits on main (overlap) vs linked ones (they name the change); confirm and dismiss through
//     the route, audited; neither ever marks the change implemented
//   - the policy route is admins' only
//   - the data-impact guard on a candidate holds it (the preview fact "held"), and an external push's finding is a
//     card of its own that holds no Developer change
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { changeState, type DevChange } from '../src/shared/dev-changes.js';
import { ChangeStore } from '../src/server/dev-changes/store.js';
import { DevChanges, type ChangeDeps } from '../src/server/dev-changes/service.js';
import { linkPass, mcrLink, modelRef } from '../src/server/dev-changes/links.js';
import { relatedFor } from '../src/server/dev-changes/related.js';
import { changeViews } from '../src/server/dev-changes/view.js';
import { devChangesOf } from '../src/server/dev-changes/index.js';
import { heldOn } from '../src/server/dev-changes/wire.js';
import { devChangeRoutes } from '../src/server/http/routes/dev-changes.js';
import { AuditLog, readAudit, useAudit } from '../src/server/audit/index.js';
import { DataImpact, dataImpactOf } from '../src/server/data-impact/index.js';
import { checkCandidate, checkExternal } from '../src/server/data-impact/seams.js';
import { externalItems } from '../src/server/data-impact/external.js';
import { checkPushes } from '../src/server/review-gate/pushes.js';
import { ModelUnits } from '../src/server/model/units.js';
import { stopExecWorker } from '../src/server/offloop/exec.js';
import type { ChangeRequestRecord } from '../src/shared/change-requests.js';
import type { ChangeRequest } from '../src/shared/model-change.js';
import { removeDir } from './support/cleanup.js';
import { hasSqlite, project, type MadeUnit, type V } from './support/mendix.js';

test.after(() => stopExecWorker());

const MAIN = 'a'.repeat(40);
const sha256 = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const svcOf = (dataDir: string) => {
  const store = new ChangeStore(path.join(dataDir, 'dev-changes'));
  const deps: ChangeDeps = { store, now: () => Date.UTC(2026, 9, 24, 9), blocked: () => 'no-lead', mainHead: async () => MAIN, recheck: async () => undefined, hand: async () => 'no', facts: async (_f, c) => ({ queue: c.queue }), record: () => undefined };
  return { store, svc: new DevChanges(deps) };
};

test('the link pass on a copied data folder: aliases appended, ids and history preserved, idempotent, source untouched', async () => {
  const src = mkdtempSync(path.join(tmpdir(), 'ao-lcb-src-'));
  const copy = mkdtempSync(path.join(tmpdir(), 'ao-lcb-copy-'));
  try {
    // The fixture: an office data folder from before Increment B.
    const crs: ChangeRequestRecord[] = [
      { id: 'CR-1', taskId: 'tsk_01JAAAAAAAAAAAAAAAAAAAAAA1', text: 'Show the arrival time on the badge', by: 'Alex Lee', owner: 'acc_1', at: 1_000, role: 'pm', member: 'Ada', workerId: 'w-ada', delivery: 'sent', revision: 'b'.repeat(40) },
      { id: 'CR-2', taskId: 'tsk_01JAAAAAAAAAAAAAAAAAAAAAA2', text: 'Already a Developer change', by: 'Alex Lee', at: 3_000, role: 'pm', member: 'Ada', delivery: 'sent', changeId: 'DC-1' },
    ];
    const mcrs: ChangeRequest[] = [{ id: 'MCR-1', elements: [{ kind: 'attribute', qn: 'Shop.Order.Notes' }, { kind: 'entity', qn: 'Shop.Customer' }, { kind: 'association', qn: 'Shop.Order_Customer' }, { kind: 'microflow', qn: 'Shop.ACT_Save' }], ref: 'main', sha: 'c'.repeat(40), request: 'Make the notes required', role: 'pm', member: 'Ada', when: 'after', at: 2_000, by: 'Keith', delivery: 'sent' }];
    mkdirSync(path.join(src, 'change-requests'), { recursive: true });
    mkdirSync(path.join(src, 'model-change'), { recursive: true });
    writeFileSync(path.join(src, 'change-requests', 'shop.json'), JSON.stringify({ version: 1, next: 3, items: crs }));
    writeFileSync(path.join(src, 'model-change', 'shop.json'), JSON.stringify({ version: 1, next: 2, items: mcrs }));
    const pre = svcOf(src);
    ok(await pre.svc.intake('shop', { text: 'Already a Developer change', by: 'Alex Lee', owner: 'acc_1' }));
    const before = Object.fromEntries(['change-requests/shop.json', 'model-change/shop.json', 'dev-changes/shop.jsonl'].map((f) => [f, sha256(path.join(src, f))]));
    const oldLog = readFileSync(path.join(src, 'dev-changes', 'shop.jsonl'), 'utf8');
    // The pass runs on a copy (read-only source).
    cpSync(src, copy, { recursive: true });
    const { store, svc } = svcOf(copy);
    const made = await linkPass(svc, copy, 'shop', await store.all('shop'));
    assert.deepEqual(made.map((c) => [c.id, c.linked?.kind, c.linked?.id, c.queue, c.via]), [['DC-2', 'cr', 'CR-1', 'linked', 'migrated'], ['DC-3', 'mcr', 'MCR-1', 'linked', 'migrated']], 'oldest first; CR-2 already has DC-1');
    const dc2 = made[0];
    assert.deepEqual([dc2.text, dc2.by, dc2.at, dc2.linked?.taskId, dc2.source.sha], [crs[0].text, 'Alex Lee', 1_000, crs[0].taskId, 'b'.repeat(40)], 'words, who, when and task kept as they were');
    assert.deepEqual(made[1].ref, { docType: 'domainmodel', docQn: 'Shop', name: 'Order.Notes', kind: 'attribute' });
    assert.deepEqual(made[1].refs?.map((r) => [r.kind, r.docQn, r.name]), [['entity', 'Shop', 'Customer'], ['microflow', 'Shop.ACT_Save', undefined]], 'the association can’t be named: left out');
    // Old records byte for byte; the change record only grew, its earlier lines identical; the chain verifies.
    assert.equal(sha256(path.join(copy, 'change-requests', 'shop.json')), before['change-requests/shop.json']);
    assert.equal(sha256(path.join(copy, 'model-change', 'shop.json')), before['model-change/shop.json']);
    const newLog = readFileSync(path.join(copy, 'dev-changes', 'shop.jsonl'), 'utf8');
    assert.ok(newLog.startsWith(oldLog), 'append-only');
    assert.deepEqual(await new ChangeStore(path.join(copy, 'dev-changes')).verify('shop'), { ok: true, lines: oldLog.trim().split('\n').length + 2 });
    // Again: nothing more (one-off in effect).
    assert.deepEqual(await linkPass(svc, copy, 'shop', await store.all('shop')), []);
    assert.equal(readFileSync(path.join(copy, 'dev-changes', 'shop.jsonl'), 'utf8'), newLog);
    // The source folder never changed.
    for (const [f, h] of Object.entries(before)) assert.equal(sha256(path.join(src, f)), h, f);
    assert.deepEqual(readdirSync(path.join(src, 'dev-changes')), ['shop.jsonl']);
    // A linked record never takes the engineering slot, and is followed from its alias.
    const all = await new ChangeStore(path.join(copy, 'dev-changes')).all('shop');
    assert.equal(all.filter((c) => c.queue === 'active').length, 0);
    const views = await changeViews(all, { task: () => undefined, assignments: [], pulls: [{ number: 12, title: 'MCR-1: notes required', state: 'MERGED', headRefName: 'office/ada-notes', headRefOid: 'd'.repeat(40), mergeCommit: 'e'.repeat(40) }], preview: { running: false }, contains: async () => undefined, mayCancel: () => true });
    const v3 = views.find((v) => v.id === 'DC-3')!;
    assert.deepEqual([v3.aliases, v3.state, v3.mayCancel], [['MCR-1'], 'implemented', false]);
    assert.deepEqual(views.find((v) => v.id === 'DC-2')!.aliases, ['CR-1']);
  } finally {
    removeDir(src);
    removeDir(copy);
  }
});

const ok = <T>(r: T | string): T => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};

test('the Model tab’s Change this gets a linked request id (its alias MCR-n), once; references carry entities, attributes and flows', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-lcb-mcr-'));
  try {
    const { store, svc } = svcOf(dir);
    const r: ChangeRequest = { id: 'MCR-4', elements: [{ kind: 'nanoflow', qn: 'Shop.NAV_Open' }, { kind: 'page', qn: 'Shop.Order_Edit' }], ref: 'main', sha: 'C'.repeat(40), request: 'Open the order on a double click', role: 'pm', member: 'Ada', when: 'now', at: 5, by: 'Keith', delivery: 'sent' };
    const a = await svc.link('shop', mcrLink(r, 'acc_9'));
    const b = await svc.link('shop', mcrLink(r, 'acc_9'));
    assert.deepEqual([a.change.id, a.again, b.change.id, b.again], ['DC-1', false, 'DC-1', true]);
    assert.deepEqual([a.change.via, a.change.owner, a.change.queue, a.change.source], ['model', 'acc_9', 'linked', { sha: 'c'.repeat(40), kind: 'viewed' }]);
    assert.deepEqual(a.change.ref, { docType: 'nanoflow', docQn: 'Shop.NAV_Open', kind: 'nanoflow' });
    assert.deepEqual(modelRef({ kind: 'enumeration', qn: 'Shop.Status' }), undefined);
    // An ordinary request still gets the slot: the linked one doesn't hold it.
    const deps = { ...((svc as unknown as { deps: ChangeDeps }).deps), blocked: () => undefined, hand: async () => ({ requestId: 'CR-1', taskId: 'tsk_x', member: 'Ada', role: 'pm', delivery: 'sent' as const }) };
    const live = new DevChanges(deps);
    ok(await live.intake('shop', { text: 'A Developer view change', by: 'Alex' }));
    assert.deepEqual((await store.all('shop')).map((c) => `${c.id}:${c.queue}`), ['DC-1:linked', 'DC-2:active']);
    assert.match(String(await live.cancel('shop', 'DC-1', { name: 'Admin', admin: true })), /followed from MCR-4/);
  } finally {
    removeDir(dir);
  }
});

test('possibly related vs linked commits on main; confirm and dismiss through the route, audited; never implemented', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-lcb-rel-'));
  useAudit(new AuditLog(path.join(dir, 'audit')));
  try {
    const ctx = { cfg: { dataDir: path.join(dir, 'data'), trustProxy: false, port: 80 }, meOf: (id?: string) => ({ admin: id === 'acc_9' }), floors: new Map([['shop', { id: 'shop', dir }]]) } as never;
    const { store, changes } = devChangesOf(ctx);
    const C1 = 'c1'.padEnd(40, '1');
    await store.create('shop', { id: 'DC-1', text: 'Save button label', by: 'Alex', owner: 'acc_1', at: 1, source: { sha: MAIN, kind: 'main' }, ref: { docType: 'page', docQn: 'Shop.Order_Edit', widgetName: 'btnSave' } });
    await store.event('shop', 'DC-1', { type: 'activated', at: 2, requestId: 'CR-1', taskId: 'tsk_01JABCDEFGHJKMNPQRSTVWXYZ0', member: 'Ada', role: 'pm', delivery: 'sent', main: MAIN });
    await store.event('shop', 'DC-1', { type: 'candidate', at: 3, candidate: { sha: C1, via: 'branch', branch: 'dev/DC-1', seenAt: 3 } });
    const commits = [
      { sha: '1'.repeat(40), parent: MAIN, subject: 'Tidy the order page', body: '' },
      { sha: '2'.repeat(40), parent: '1'.repeat(40), subject: 'Docs only', body: '' },
      { sha: '3'.repeat(40), parent: '2'.repeat(40), subject: 'Hotfix for DC-1 label', body: '' },
      { sha: C1, parent: '3'.repeat(40), subject: 'its own candidate', body: '' },
    ];
    const docs: Record<string, string[]> = { [`${MAIN}|${'1'.repeat(40)}`]: ['page:Shop.Order_Edit'], [`${'1'.repeat(40)}|${'2'.repeat(40)}`]: [], [`${'2'.repeat(40)}|${'3'.repeat(40)}`]: ['page:Shop.Other'], [`${MAIN}|${C1}`]: ['page:Shop.Order_Edit'] };
    const d = { docs: async (a: string, b: string) => docs[`${a}|${b}`] ?? [], commits: async () => commits, triedOk: () => false };
    const all = await store.all('shop');
    const found = await relatedFor(all[0], all, d, 10, new Set());
    assert.deepEqual(found.map((e) => [e.sha[0], e.docs, !!e.explicit]), [['1', ['page:Shop.Order_Edit'], false], ['3', [], true]], 'overlap: possibly related; names DC-1: linked; its own candidate and unrelated docs: neither');
    for (const e of found) await store.event('shop', 'DC-1', e);
    assert.deepEqual(await relatedFor((await store.all('shop'))[0], await store.all('shop'), d, 11, new Set()), [], 'seen once, not again');
    // Confirm through the route, by whoever asked; a member who didn't ask is refused; a linked one can't be decided.
    const post = async (route: keyof typeof devChangeRoutes, body: Record<string, unknown>, account: { id: string; name: string }) => {
      let status = 0;
      let out = '';
      const res = { writeHead: (s: number) => ((status = s), res), setHeader: () => undefined, end: (b?: string) => void (out = b ?? ''), headersSent: false };
      const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ floor: 'shop', ...body }))]), { method: 'POST', headers: { origin: 'http://office.test', host: 'office.test', 'content-type': 'application/json' } });
      await (devChangeRoutes[route].handle as (c: unknown, r: unknown) => unknown)(ctx, { req, res, url: new URL('http://office.test/x'), path: '/x', session: { account } });
      return { status, out: out ? JSON.parse(out) : {} };
    };
    const ALEX = { id: 'acc_1', name: 'Alex' };
    assert.equal((await post('link', { id: 'DC-1', sha: '1'.repeat(40), verdict: 'confirmed' }, { id: 'acc_2', name: 'Sam' })).status, 403);
    assert.equal((await post('link', { id: 'DC-1', sha: '3'.repeat(40), verdict: 'dismissed' }, ALEX)).status, 400, 'it names the change: linked already');
    assert.equal((await post('link', { id: 'DC-1', sha: '1'.repeat(40), verdict: 'maybe' }, ALEX)).status, 400);
    const r = await post('link', { id: 'DC-1', sha: '1'.repeat(40), verdict: 'confirmed' }, ALEX);
    assert.equal(r.status, 200);
    const c = (await store.get('shop', 'DC-1')) as DevChange;
    assert.deepEqual(c.related?.map((x) => [x.sha[0], x.verdict ?? (x.explicit ? 'linked' : 'possible'), x.by]), [['1', 'confirmed', 'Alex'], ['3', 'linked', undefined]]);
    assert.equal(changeState({ queue: c.queue }).state, 'working', 'a confirmed link never makes it implemented');
    const audit = readAudit({ floor: 'shop', limit: 100 }).events.filter((e) => e.action.startsWith('dev-change.link'));
    assert.deepEqual(audit.map((e) => [e.action, e.actor.name]), [['dev-change.link-confirmed', 'Alex']]);
    // The view lets whoever asked decide a possible one; never a linked one.
    const [v] = await changeViews(await store.all('shop'), { task: () => undefined, assignments: [], pulls: [], preview: { running: false }, contains: async () => undefined, mayCancel: (x) => x.owner === 'acc_1' });
    assert.deepEqual(v.relatedView?.map((x) => x.mayDecide), [true, false]);
    // The policy: admins only.
    assert.equal((await post('policy', { waitForReview: true }, ALEX)).status, 403);
    const p = await post('policy', { waitForReview: true }, { id: 'acc_9', name: 'Admin' });
    assert.deepEqual([p.status, p.out.policy], [200, { correctionsFirst: true, waitForReview: true }]);
    assert.deepEqual(changes.policy('shop'), { correctionsFirst: true, waitForReview: true });
  } finally {
    useAudit(undefined);
    removeDir(dir);
  }
});

// ---- the data-impact guard on a candidate, and on an external push ------------------------------------------

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();
const units = (attrs: string[]): MadeUnit[] => [
  { n: 1, container: 1, hash: 'p', doc: { $Type: 'Projects$Project' } },
  { n: 2, container: 1, hash: 'm', doc: { $Type: 'Projects$ModuleImpl', Name: 'Shop' } },
  { n: 3, container: 2, hash: 'dm', doc: { $Type: 'DomainModels$DomainModel', Entities: [3, { $ID: 'e-order', $Type: 'DomainModels$EntityImpl', Name: 'Order', MaybeGeneralization: { $Type: 'DomainModels$NoGeneralization', Persistable: true }, Attributes: [3, ...attrs.map((n): Record<string, V> => ({ $ID: `a-${n}`, $Type: 'DomainModels$Attribute', Name: n, NewType: { $Type: 'DomainModels$StringAttributeType', Length: 200 }, Value: { $Type: 'DomainModels$StoredValue', DefaultValue: '' } }))] }], Associations: [3] } },
];

test('data impact: a candidate that drops data is held (preview fact "held"); an external push’s finding is a card that holds nothing else', { skip: !(await hasSqlite()) && 'no node:sqlite' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-lcb-di-'));
  useAudit(new AuditLog(path.join(dir, 'audit')));
  const u = new ModelUnits(path.join(dir, '.cache'));
  try {
    const r = path.join(dir, 'repo');
    mkdirSync(r);
    git(r, 'init', '-q', '-b', 'main');
    const commit = async (attrs: string[], msg: string) => {
      rmSync(path.join(r, 'mprcontents'), { recursive: true, force: true });
      await project(r, units(attrs));
      git(r, 'add', '-A');
      git(r, 'commit', '-qm', msg);
      return git(r, 'rev-parse', 'HEAD');
    };
    const base = await commit(['Notes', 'Code'], 'base');
    const ctx = { cfg: { dataDir: path.join(dir, 'data') }, accounts: { state: () => ({ accounts: [{ id: 'u-admin', name: 'Ada', role: 'admin' }], invites: [], sharedPassword: false }) }, meOf: (id?: string) => ({ admin: id === 'u-admin' }) } as unknown as ConstructorParameters<typeof DataImpact>[0];
    // DC-1's candidate drops Order.Notes: held under candidate:DC-1, shown as the preview fact.
    git(r, 'switch', '-q', '-c', 'dev/DC-1');
    const cand = await commit(['Code'], 'DC-1: drop the notes');
    const v = await checkCandidate(ctx, 'DC-1', { floorId: 'shop', dir: r, base, target: cand, units: u });
    assert.equal(v.hold, true);
    const change = { id: 'DC-1', text: 't', by: 'a', at: 1, source: { sha: base, kind: 'main' as const }, queue: 'active' as const, candidates: [{ sha: cand, via: 'branch' as const, branch: 'dev/DC-1', seenAt: 1 }] };
    const held = heldOn(ctx as never, 'shop', change);
    assert.deepEqual([held?.env, held?.findings], ['candidate:DC-1', 1]);
    const [view] = await changeViews([change], { task: () => undefined, assignments: [], pulls: [], preview: { running: true, served: base }, contains: async () => false, held: (c) => heldOn(ctx as never, 'shop', c), mayCancel: () => true });
    assert.deepEqual([view.state, view.facts.preview.status, view.facts.preview.held?.env], ['candidate', 'held', 'candidate:DC-1']);
    // Approval follows the guard: bound to the candidate's environment, baseline and target, with a recovery step.
    const di = dataImpactOf(ctx);
    assert.deepEqual(await di.approve('shop', { name: 'Mo' }, 'u-member', { env: 'candidate:DC-1', base, target: cand, reason: 'x', noData: true }), [403, "You don't have the data-impact approval permission. Who has it: office admins (Ada)"]);
    assert.equal((await di.approve('shop', { name: 'Ada' }, 'u-admin', { env: 'candidate:DC-1', base, target: 'f'.repeat(40), reason: 'moved', noData: true }) as [number, string])[0], 409);
    const a = await di.approve('shop', { name: 'Ada' }, 'u-admin', { env: 'candidate:DC-1', base, target: cand, reason: 'notes were copied first', noData: true });
    assert.equal((a as { env: string }).env, 'candidate:DC-1');
    assert.equal((await checkCandidate(ctx, 'DC-1', { floorId: 'shop', dir: r, base, target: cand, units: u })).hold, false, 'approved: released');
    assert.equal(heldOn(ctx as never, 'shop', change), undefined);
    // An external push on main (no PR), from the persisted baseline: flagged as its own card; DC-1 isn't held by it.
    git(r, 'switch', '-q', 'main');
    git(r, 'update-ref', 'refs/remotes/origin/main', base);
    await checkPushes(path.join(dir, 'data'), 'shop', r, { branch: 'main', sha: base }, new Set());
    const direct = await commit(['Notes'], 'Quick fix straight on main');
    let moved: { base: string; target: string; branch: string } | undefined;
    const look = await checkPushes(path.join(dir, 'data'), 'shop', r, { branch: 'main', sha: direct }, new Set(), Date.now(), (m) => (moved = m));
    assert.equal(look.fresh[0]?.kind, 'direct');
    assert.deepEqual(moved && [moved.base, moved.target, moved.branch], [base, direct, 'main'], 'the range from the persisted tip');
    assert.equal((await checkExternal(ctx, 'main', { floorId: 'shop', dir: r, base: moved!.base, target: moved!.target, units: u })).hold, true);
    const cards = externalItems(ctx, 'shop', 'Ada');
    assert.equal(cards.length, 1);
    assert.match(cards[0].text, /^Commits pushed to main without a pull request \([0-9a-f]{7} → [0-9a-f]{7}\) may affect stored data: 1 finding$/);
    assert.match(cards[0].evidence?.[0].where ?? '', /env=external%3Amain/);
    assert.ok(cards[0].lines?.some((l) => /holds no other work/.test(l)));
    assert.equal(heldOn(ctx as never, 'shop', change), undefined, 'the external hold doesn’t hold DC-1');
  } finally {
    u.close();
    useAudit(undefined);
    removeDir(dir);
  }
});
