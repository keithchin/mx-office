// The Model tab's server plumbing (server/model/): reading units (BSON, the .mpr's unit table), the
// per-commit snapshots and answers (taken once, shared while in flight, pruned), mxcli's output,
// the limiter, the service's refs and access checks, and the routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeBson, guidOf, list, textOf } from '../src/server/model/bson.js';
import { diffIndexes, openIndex } from '../src/server/model/mpr.js';
import { Limiter, parseJsonOut, stripNoise } from '../src/server/model/mxcli.js';
import { ModelStore, mprIn, SNAP_MAX } from '../src/server/model/store.js';
import { ModelService, REF_OK } from '../src/server/model/index.js';
import { modelRoutes } from '../src/server/http/routes/model.js';
import type { GitGraph } from '../src/shared/gitgraph.js';

// ---- a small BSON writer, for units made up in the tests ----
type V = string | number | boolean | null | V[] | { [k: string]: V } | Uint8Array;
function bson(doc: Record<string, V>): Buffer {
  const parts: Buffer[] = [];
  const cstr = (s: string) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
  for (const [k, v] of Object.entries(doc)) {
    if (v instanceof Uint8Array) {
      const len = Buffer.alloc(4);
      len.writeInt32LE(v.length);
      parts.push(Buffer.from([0x05]), cstr(k), len, Buffer.from([0]), Buffer.from(v));
    } else if (typeof v === 'string') {
      const s = Buffer.from(v, 'utf8');
      const len = Buffer.alloc(4);
      len.writeInt32LE(s.length + 1);
      parts.push(Buffer.from([0x02]), cstr(k), len, s, Buffer.from([0]));
    } else if (typeof v === 'number') {
      const b = Buffer.alloc(4);
      b.writeInt32LE(v);
      parts.push(Buffer.from([0x10]), cstr(k), b);
    } else if (typeof v === 'boolean') parts.push(Buffer.from([0x08]), cstr(k), Buffer.from([v ? 1 : 0]));
    else if (v === null) parts.push(Buffer.from([0x0a]), cstr(k));
    else if (Array.isArray(v)) parts.push(Buffer.from([0x04]), cstr(k), bson(Object.fromEntries(v.map((x, i) => [String(i), x]))));
    else parts.push(Buffer.from([0x03]), cstr(k), bson(v as Record<string, V>));
  }
  const body = Buffer.concat(parts);
  const len = Buffer.alloc(4);
  len.writeInt32LE(body.length + 5);
  return Buffer.concat([len, body, Buffer.from([0])]);
}

const guidBytes = (n: number) => {
  const b = new Uint8Array(16);
  b[0] = n;
  b[15] = 0xab;
  return b;
};

test('BSON: documents, lists without their marker, ids as GUIDs, texts', () => {
  const id = guidBytes(1);
  const doc = decodeBson(bson({ $ID: id, $Type: 'Microflows$Microflow', Name: 'ACT_Go', N: 3, Ok: true, Nothing: null, Items: [3, { $Type: 'x', Name: 'a' }, { $Type: 'x', Name: 'b' }], Caption: { Items: [3, { LanguageCode: 'nl_NL', Text: 'Hoi' }, { LanguageCode: 'en_US', Text: 'Hi' }] } }));
  assert.equal(doc.$ID, guidOf(id));
  assert.equal(guidOf(id), '00000001-0000-0000-0000-0000000000ab');
  assert.equal(doc.Name, 'ACT_Go');
  assert.equal(doc.N, 3);
  assert.equal(doc.Ok, true);
  assert.equal(doc.Nothing, null);
  assert.deepEqual(list(doc.Items).map((x) => x.Name), ['a', 'b']);
  assert.equal(textOf(doc.Caption), 'Hi');
  // Only the top level: nested documents are skipped by their length.
  assert.equal(decodeBson(bson({ A: { B: 'deep' }, Name: 'top' }), 0).A, null);
  assert.throws(() => decodeBson(Buffer.from([1, 2])));
});

/** A made-up MPR v2 project: the unit table in an SQLite .mpr and each unit's BSON in mprcontents/. */
async function project(dir: string, units: { n: number; container: number; hash: string; doc: Record<string, V> }[]) {
  const { DatabaseSync } = await import('node:sqlite');
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'App.mpr'));
  db.exec('CREATE TABLE Unit (UnitID BLOB PRIMARY KEY NOT NULL, ContainerID BLOB, ContainmentName TEXT, TreeConflict LONG, ContentsHash TEXT, ContentsConflicts TEXT)');
  const ins = db.prepare('INSERT INTO Unit VALUES (?, ?, ?, 0, ?, ?)');
  for (const u of units) {
    ins.run(guidBytes(u.n), guidBytes(u.container), '', u.hash, '');
    const id = guidOf(guidBytes(u.n));
    const f = path.join(dir, 'mprcontents', id.slice(0, 2), id.slice(2, 4), `${id}.mxunit`);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, bson(u.doc));
  }
  db.close();
  return path.join(dir, 'App.mpr');
}

test('the unit index: qualified names through the containers, and documents changed by content hash', async (t) => {
  try {
    await import('node:sqlite');
  } catch {
    return t.skip('no node:sqlite here');
  }
  const root = mkdtempSync(path.join(tmpdir(), 'ao-model-ix-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = [
    { n: 1, container: 1, hash: 'p', doc: { $Type: 'Projects$Project' } },
    { n: 2, container: 1, hash: 'm', doc: { $Type: 'Projects$ModuleImpl', Name: 'Shop' } },
    { n: 3, container: 2, hash: 'f', doc: { $Type: 'Projects$Folder', Name: 'Orders' } },
    { n: 4, container: 3, hash: 'mf1', doc: { $Type: 'Microflows$Microflow', Name: 'ACT_Order_Save' } },
    { n: 5, container: 2, hash: 'dm1', doc: { $Type: 'DomainModels$DomainModel', Entities: [3, { $Type: 'DomainModels$EntityImpl', Name: 'Order' }] } },
    { n: 6, container: 3, hash: 'pg', doc: { $Type: 'Forms$Page', Name: 'Order_Edit' } },
  ];
  const a = await openIndex(await project(path.join(root, 'a'), base));
  assert.ok(a);
  assert.ok(a.byName.has('microflow:Shop.ACT_Order_Save'));
  assert.ok(a.byName.has('domainmodel:Shop'));
  assert.ok(a.byName.has('page:Shop.Order_Edit'));
  const dm = await a.read(a.byName.get('domainmodel:Shop')!);
  assert.equal(list(dm?.Entities)[0].Name, 'Order');
  const head = [...base.filter((u) => u.n !== 6), { ...base[3], hash: 'mf2' }, { n: 7, container: 3, hash: 'nf', doc: { $Type: 'Microflows$Nanoflow', Name: 'NF_Go' } }].filter((u, i, all) => all.findIndex((x) => x.n === u.n) === i || u.hash === 'mf2');
  const b = await openIndex(await project(path.join(root, 'b'), head.filter((u) => !(u.n === 4 && u.hash === 'mf1'))));
  assert.deepEqual(diffIndexes(a, b!), { added: ['nanoflow:Shop.NF_Go'], removed: ['page:Shop.Order_Edit'], changed: ['microflow:Shop.ACT_Order_Save'] });
});

test('mxcli\'s output: the PoC warning and chatter go, JSON is found, its complaints come through', () => {
  const out = 'WARNING: This is a vibe-coded PoC, alpha quality, use with caution.\nConnected to: app.mpr (Mendix 11.12.4)\n[{"a":1}]\n';
  assert.equal(stripNoise(out), '[{"a":1}]');
  assert.deepEqual(parseJsonOut(out), [{ a: 1 }]);
  assert.throws(() => parseJsonOut('WARNING: This is a vibe-coded PoC\nError: entity not found: X'), /entity not found/);
});

test('the limiter runs at most n at once, in order', async () => {
  const lim = new Limiter(2);
  let running = 0;
  let most = 0;
  const order: number[] = [];
  await Promise.all(
    [1, 2, 3, 4, 5].map((i) =>
      lim.run(async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 15));
        order.push(i);
        running--;
      }),
    ),
  );
  assert.equal(most, 2);
  assert.deepEqual(order.slice(0, 2).sort(), [1, 2]);
  assert.equal(lim.busy, 0);
});

test('the store: one answer per (commit, key) on disk, shared while in flight', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-model-store-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new ModelStore(root);
  let calls = 0;
  const work = () => store.cached('abc1234', 'doc:microflow:M.F', async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true };
  });
  const [x, y] = await Promise.all([work(), work()]);
  assert.deepEqual(x, { ok: true });
  assert.deepEqual(y, { ok: true });
  assert.equal(calls, 1, 'two asks at once share one read');
  const again = new ModelStore(root);
  assert.deepEqual(await again.cached('abc1234', 'doc:microflow:M.F', async () => (calls++, { ok: false })), { ok: true });
  assert.equal(calls, 1, 'a commit is read once, then from disk');
  await assert.rejects(store.snapshot(root, 'not-a-sha;rm'), /not a commit/);
  assert.equal(mprIn(['README.md', 'app/App.mpr', 'App.mpr', '.hidden/x.mpr', 'a/b/c.mpr']), 'App.mpr');
  assert.equal(mprIn(['app/App.mpr']), 'app/App.mpr');
  assert.equal(mprIn(['a/b/c.mpr']), undefined);
});

test('snapshots: the commit\'s .mpr and mprcontents taken out of git once, the oldest let go', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-model-snap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  mkdirSync(path.join(repo, 'mprcontents', 'aa'), { recursive: true });
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(path.join(repo, 'App.mpr'), 'sqlite');
  writeFileSync(path.join(repo, 'mprcontents', 'aa', 'u.mxunit'), 'unit');
  writeFileSync(path.join(repo, 'README.md'), 'not taken');
  git('add', '-A');
  git('commit', '-qm', 'one');
  const sha = git('rev-parse', 'HEAD');
  const store = new ModelStore(path.join(root, 'data'));
  const [s1, s2] = await Promise.all([store.snapshot(repo, sha), store.snapshot(repo, sha)]);
  assert.equal(s1.dir, s2.dir);
  assert.ok(existsSync(s1.mpr));
  assert.ok(existsSync(path.join(s1.dir, 'mprcontents', 'aa', 'u.mxunit')));
  assert.ok(!existsSync(path.join(s1.dir, 'README.md')), 'only the model is taken out');
  // More than SNAP_MAX snapshots: the oldest go.
  for (let i = 0; i < SNAP_MAX + 2; i++) {
    const d = path.join(root, 'data', 'model', 'snap', `${String(i).padStart(7, '0')}aaa`);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, '.ok'), 'App.mpr');
  }
  await store.prune();
  assert.equal(readdirSync(path.join(root, 'data', 'model', 'snap')).length, SNAP_MAX);
});

function graph(): GitGraph {
  const commit = (sha: string) => ({ sha, parents: [], subject: '', author: '', date: '' });
  return {
    floor: 'f',
    defaultBranch: 'main',
    defaultRef: 'main',
    history: [commit('a'.repeat(40))],
    branches: [
      { name: 'office/ada-1', where: 'local', sha: 'b'.repeat(40), subject: '', author: '', date: '', ahead: 2, behind: 0, merged: false, fork: 'a'.repeat(40), worker: { id: 'w1', name: 'Ada', color: '#f00', status: 'working' } },
      { name: 'office/old', where: 'local', sha: 'c'.repeat(40), subject: '', author: '', date: '', ahead: 0, behind: 3, merged: true },
      { name: 'feature/pr', where: 'remote', sha: 'd'.repeat(40), subject: '', author: '', date: '', ahead: 1, behind: 0, merged: false, fork: 'a'.repeat(40), pr: { number: 9, title: 'x', state: 'OPEN', isDraft: false, checks: 'pass', reviewDecision: '', url: 'u' } },
    ],
    hidden: { merged: 0, more: 0 },
    at: 0,
  } as unknown as GitGraph;
}

test('the service: main and the live branches as refs, refs resolved to commits, odd names refused', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-model-svc-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const floor = { id: 'f', dir: root, workers: { list: () => [] }, github: { pulls: { items: [] } } };
  const svc = new ModelService(root, { graph: async () => graph(), mx: null, git: async () => '' });
  const refs = await svc.refs(floor);
  assert.deepEqual(refs.refs.map((r) => r.ref), ['main', 'office/ada-1', 'feature/pr']);
  assert.equal(refs.refs[1].worker, 'Ada');
  assert.equal(refs.refs[2].pr, 9);
  assert.match(refs.problem ?? '', /mxcli/);
  assert.deepEqual(await svc.resolve(floor, 'main'), { sha: 'a'.repeat(40) });
  assert.deepEqual(await svc.resolve(floor, 'office/ada-1'), { sha: 'b'.repeat(40), base: 'a'.repeat(40) });
  await assert.rejects(svc.resolve(floor, '--upload-pack=evil'), /not a branch/);
  await assert.rejects(svc.resolve(floor, 'a..b'), /not a branch/);
  await assert.rejects(svc.resolve(floor, 'nope'), /no branch/);
  assert.ok(REF_OK.test('office/ada-1234'));
  assert.ok(!REF_OK.test('-x'));
  // Without mxcli the tree says why instead of hanging.
  await assert.rejects(svc.changes(floor, 'main').then(() => svc.tree(floor, 'main')), /mxcli|Mendix|commit/);
});

test('routes: every Model route is for signed-in people, and a floor that isn\'t there is a 404', async () => {
  for (const r of Object.values(modelRoutes)) {
    assert.equal(r.auth, 'session');
    assert.equal(r.method, 'GET');
    assert.match(String(r.path), /^\/api\/model\//);
  }
  let status = 0;
  let body: unknown;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => (body = JSON.parse(b)), headersSent: false, setHeader() {} };
  const ctx = { floors: new Map(), cfg: { dataDir: tmpdir() } };
  await (modelRoutes.tree.handle as (c: unknown, r: unknown) => Promise<void>)(ctx, { res, url: new URL('http://x/api/model/tree?floor=nope'), req: {}, path: '/api/model/tree', session: {} });
  assert.equal(status, 404);
  assert.deepEqual(body, { error: 'No such floor' });
  const floor = { id: 'f', dir: tmpdir(), workers: { list: () => [] }, github: { pulls: { items: [] } } };
  await (modelRoutes.doc.handle as (c: unknown, r: unknown) => Promise<void>)({ ...ctx, floors: new Map([['f', floor]]) }, { res, url: new URL('http://x/api/model/doc?floor=f&type=micro flow&name=x'), req: {}, path: '/api/model/doc', session: {} });
  assert.equal(status, 502);
  assert.match((body as { error: string }).error, /type and name/);
});
