// The Model tab reading a Mendix app straight out of git (server/model/): the object reader (one
// `git cat-file --batch`, trees and blobs, an LRU), a commit's model files and unit index by blob hash,
// answers kept by content so a new commit reuses every document it left alone, the tree kept by the
// app's structure (the last one at once while mxcli works out a new one), a flow's MDL after its
// diagram, the work folders mxcli reads (moved by the files that differ), and reading ahead (bounded,
// stopped by a newer run). A real git repository with a made-up project; mxcli is faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitBlobs, modelFiles, parseTree } from '../src/server/model/blobs.js';
import { ModelService } from '../src/server/model/index.js';
import type { MxRun } from '../src/server/model/mxcli.js';
import { Prefetcher } from '../src/server/model/prefetch.js';
import { ModelUnits } from '../src/server/model/units.js';
import { WorkDirs } from '../src/server/model/workdir.js';
import { stopExecWorker } from '../src/server/offloop/exec.js';
import type { GitGraph } from '../src/shared/gitgraph.js';
import { removeDir } from './support/cleanup.js';
import { guid, hasSqlite, project, type MadeUnit } from './support/mendix.js';

test.after(() => stopExecWorker());

const flowUnit = (name: string, caption: string) => ({
  $Type: 'Microflows$Microflow',
  Name: name,
  ObjectCollection: {
    $Type: 'Microflows$MicroflowObjectCollection',
    Objects: [
      3,
      { $ID: 'start-1', $Type: 'Microflows$StartEvent', RelativeMiddlePoint: '100;100', Size: '20;20' },
      { $ID: 'log-1', $Type: 'Microflows$ActionActivity', RelativeMiddlePoint: '200;100', Size: '120;60', AutoGenerateCaption: false, Caption: caption, Action: { $Type: 'Microflows$LogMessageAction', Level: 'Info', Node: "'Shop'", MessageTemplate: { Text: caption } } },
      { $ID: 'end-1', $Type: 'Microflows$EndEvent', RelativeMiddlePoint: '300;100', Size: '20;20', ReturnValue: '' },
    ],
  },
  Flows: [3, { $ID: 'f1', $Type: 'Microflows$SequenceFlow', OriginPointer: 'start-1', DestinationPointer: 'log-1' }, { $ID: 'f2', $Type: 'Microflows$SequenceFlow', OriginPointer: 'log-1', DestinationPointer: 'end-1' }],
});

const base = (): MadeUnit[] => [
  { n: 1, container: 1, hash: 'p', doc: { $Type: 'Projects$Project' } },
  { n: 2, container: 1, hash: 'm', doc: { $Type: 'Projects$ModuleImpl', Name: 'Shop' } },
  { n: 3, container: 2, hash: 'f', doc: { $Type: 'Projects$Folder', Name: 'Orders' } },
  { n: 4, container: 3, hash: 'a', doc: flowUnit('ACT_Save', 'Saving') },
  { n: 5, container: 3, hash: 'b', doc: flowUnit('ACT_Other', 'Other') },
  { n: 6, container: 2, hash: 'dm', doc: { $Type: 'DomainModels$DomainModel', Entities: [3, { $ID: 'e1', $Type: 'DomainModels$EntityImpl', Name: 'Order', Location: '10;10', Attributes: [3] }], Associations: [3], Annotations: [3] } },
];

/** A git repository whose commits are made-up projects; returns each commit's sha. */
async function repoWith(dir: string, versions: MadeUnit[][]): Promise<string[]> {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(path.join(dir, 'README.md'), 'not the model');
  const shas: string[] = [];
  for (const [i, units] of versions.entries()) {
    rmSync(path.join(dir, 'mprcontents'), { recursive: true, force: true });
    await project(dir, units);
    git('add', '-A');
    git('commit', '-qm', `v${i}`);
    shas.push(git('rev-parse', 'HEAD'));
  }
  return shas;
}

test('the object reader: blobs and trees from one git cat-file, missing ones null, an LRU in front', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-model-blobs-'));
  t.after(() => removeDir(dir));
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  writeFileSync(path.join(dir, 'a.bin'), Buffer.from([0, 1, 2, 10, 255, 10, 0]));
  writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(300_000));
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'one'], { cwd: dir });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const blobs = new GitBlobs(dir);
  t.after(() => blobs.close());
  const top = await blobs.tree(`${sha}^{tree}`);
  assert.deepEqual(top?.map((e) => e.name).sort(), ['a.bin', 'big.txt']);
  const bin = top!.find((e) => e.name === 'a.bin')!;
  const big = top!.find((e) => e.name === 'big.txt')!;
  // Many at once, in order, binary intact (newlines and zeros inside), a big one in many chunks.
  const [x, y, gone] = await Promise.all([blobs.blob(bin.sha), blobs.blob(big.sha), blobs.read('0'.repeat(40))]);
  assert.deepEqual([...x!], [0, 1, 2, 10, 255, 10, 0]);
  assert.equal(y!.length, 300_000);
  assert.equal(gone, null);
  const reads = blobs.reads;
  await blobs.blob(bin.sha);
  assert.equal(blobs.reads, reads, 'the second read comes from the LRU');
  await assert.rejects(blobs.read('HEAD; rm -rf /'), /not an object name/);
  // Closed, it starts again on the next read.
  blobs.close();
  assert.equal((await blobs.blob(big.sha))?.length, 300_000);
  assert.deepEqual(parseTree(new Uint8Array(0)), []);
});

test('a commit\'s model from git: the .mpr and its units by blob hash, the index, unchanged documents keeping their hash', async (t) => {
  if (!(await hasSqlite())) return t.skip('no node:sqlite here');
  const root = mkdtempSync(path.join(tmpdir(), 'ao-model-units-'));
  t.after(() => removeDir(root));
  const repo = path.join(root, 'repo');
  const v2 = base().map((u) => (u.n === 4 ? { ...u, doc: flowUnit('ACT_Save', 'Saving it') } : u));
  const v3 = [...v2, { n: 7, container: 3, hash: 'c', doc: flowUnit('ACT_New', 'New') }];
  const [a, b, c] = await repoWith(repo, [base(), v2, v3]);
  const units = new ModelUnits(path.join(root, 'data', 'model'));
  t.after(() => units.close());
  const files = await modelFiles(units.blobs(repo), a);
  assert.equal(files?.mpr, 'App.mpr');
  assert.equal(files?.units.size, 6);
  const ma = (await units.commit(repo, a))!;
  const mb = (await units.commit(repo, b))!;
  const mc = (await units.commit(repo, c))!;
  assert.ok(ma.ix.byName.has('microflow:Shop.ACT_Save'));
  assert.equal(ma.hashOf('microflow:Shop.ACT_Save'), files?.units.get(guid(4)), 'a unit\'s hash is its git blob');
  assert.notEqual(ma.hashOf('microflow:Shop.ACT_Save'), mb.hashOf('microflow:Shop.ACT_Save'), 'changed');
  assert.equal(ma.hashOf('microflow:Shop.ACT_Other'), mb.hashOf('microflow:Shop.ACT_Other'), 'left alone');
  assert.equal(ma.hashOf('microflow:Shop.Nope'), '');
  // The tree's key: editing a microflow's insides keeps it, adding a document changes it.
  assert.equal(ma.structure, mb.structure);
  assert.notEqual(mb.structure, mc.structure);
  // The .mpr is kept once per version, for node:sqlite.
  assert.ok(existsSync(path.join(units.mprDir, `${files!.mprBlob}.mpr`)));
  assert.equal(units.commit(repo, a), units.commit(repo, a), 'a commit is indexed once');
  await assert.rejects(units.commit(path.join(root, 'nope'), a));
});

function graphAt(sha: () => string): () => Promise<GitGraph> {
  return async () => ({ floor: 'f', defaultBranch: 'main', defaultRef: 'main', history: [{ sha: sha(), parents: [], subject: '', author: '', date: '' }], branches: [], hidden: { merged: 0, more: 0 }, at: Date.now() }) as unknown as GitGraph;
}

/** A fake mxcli: project-tree lists the units' microflows; describe --format elk gives a small MDL. */
function fakeMx(calls: string[][]): MxRun {
  return async (args) => {
    calls.push(args);
    const mpr = args[args.indexOf('-p') + 1];
    if (args[0] === 'project-tree') {
      const { DatabaseSync } = await import('node:sqlite');
      const n = new DatabaseSync(mpr, { readOnly: true }).prepare('select count(*) as n from Unit').get()?.n;
      return JSON.stringify([{ label: 'Shop', type: 'module', qualifiedName: 'Shop', children: [{ label: `${n} units`, type: 'folder' }] }]);
    }
    if (args.includes('elk')) {
      const qn = args[args.length - 1];
      return JSON.stringify({ name: qn, nodes: [{ id: 'node-log-1', type: 'action', label: 'Log' }], mdlSource: `create microflow ${qn}\nbegin\n  @position(200, 100)\n  log info node 'Shop' 'x';\nend;`, sourceMap: {} });
    }
    return 'mdl';
  };
}

test('answers by content: a new commit reuses every document it left alone; the tree by structure; the MDL after the diagram', async (t) => {
  if (!(await hasSqlite())) return t.skip('no node:sqlite here');
  const root = mkdtempSync(path.join(tmpdir(), 'ao-model-svc2-'));
  t.after(() => removeDir(root));
  const repo = path.join(root, 'repo');
  const v2 = base().map((u) => (u.n === 4 ? { ...u, doc: flowUnit('ACT_Save', 'Saving it') } : u));
  const v3 = [...v2, { n: 7, container: 3, hash: 'c', doc: flowUnit('ACT_New', 'New') }];
  const [a, b, c] = await repoWith(repo, [base(), v2, v3]);
  let main = a;
  const calls: string[][] = [];
  const svc = new ModelService(path.join(root, 'data'), { graph: graphAt(() => main), mx: fakeMx(calls) });
  t.after(() => svc.units.close());
  const floor = { id: 'f', dir: repo, workers: { list: () => [] }, github: { pulls: { items: [] } } };

  // The diagram comes from the units, no mxcli; its MDL is asked for after.
  const d1 = await svc.doc(floor, 'main', 'microflow', 'Shop.ACT_Other');
  assert.equal(d1.doc.kind, 'microflow');
  if (d1.doc.kind !== 'microflow') return;
  assert.equal(d1.doc.mdlLater, true);
  assert.deepEqual(d1.doc.nodes.find((n) => n.id === 'log-1')?.details, ['Level: Info', "Node: 'Shop'", 'Message: Other']);
  assert.equal(calls.length, 0, 'no mxcli for a diagram');
  const m = await svc.mdl(floor, 'main', 'microflow', 'Shop.ACT_Other');
  assert.match(m.mdl, /create microflow Shop.ACT_Other/);
  assert.deepEqual(m.lines['log-1'], [2, 3]);
  assert.equal(calls.length, 1);
  await assert.rejects(svc.mdl(floor, 'main', 'page', 'Shop.P'), /only microflows/);
  // Asked again, the document comes with its MDL in.
  const d1b = await svc.doc(floor, 'main', 'microflow', 'Shop.ACT_Other');
  assert.ok(d1b.doc.kind === 'microflow' && !d1b.doc.mdlLater && d1b.doc.nodes.find((n) => n.id === 'log-1')?.lines);

  const tree1 = await svc.tree(floor, 'main');
  assert.equal(tree1.stale, undefined, 'the first tree is waited for');
  const treeCalls = calls.length;
  const dm = await svc.doc(floor, 'main', 'domainmodel', 'Shop');
  assert.equal(dm.doc.kind, 'domainmodel');
  await svc.doc(floor, 'main', 'microflow', 'Shop.ACT_Save');

  // Main moves to b, which changed ACT_Save only.
  main = b;
  const misses = svc.store.misses;
  await svc.doc(floor, 'main', 'microflow', 'Shop.ACT_Other');
  await svc.doc(floor, 'main', 'domainmodel', 'Shop');
  await svc.mdl(floor, 'main', 'microflow', 'Shop.ACT_Other');
  assert.equal(svc.store.misses, misses, 'unchanged documents and their MDL come from the cache');
  assert.equal(calls.length, treeCalls, 'no mxcli for them either');
  const saved = await svc.doc(floor, 'main', 'microflow', 'Shop.ACT_Save');
  assert.equal(svc.store.misses, misses + 1, 'the changed one is read');
  assert.ok(saved.doc.kind === 'microflow' && saved.doc.nodes.some((n) => n.caption === 'Saving it'));
  const tree2 = await svc.tree(floor, 'main');
  assert.deepEqual(tree2.nodes, tree1.nodes);
  assert.equal(calls.length, treeCalls, 'same structure, same tree: no mxcli');

  // Main moves to c, which added a document: the last tree at once, the new one when asked fresh.
  main = c;
  const tree3 = await svc.tree(floor, 'main');
  assert.equal(tree3.stale, true);
  assert.deepEqual(tree3.nodes, tree1.nodes);
  const tree4 = await svc.tree(floor, 'main', true);
  assert.equal(tree4.stale, undefined);
  assert.notDeepEqual(tree4.nodes, tree1.nodes, 'the new tree (the fake lists the .mpr\'s size)');
  const changes = await svc.changes(floor, 'main');
  assert.deepEqual(changes.docs, [], 'main has no base');
});

test('work folders: mxcli\'s copy of a commit moves to the next by the files that differ, never while in use', async (t) => {
  if (!(await hasSqlite())) return t.skip('no node:sqlite here');
  const root = mkdtempSync(path.join(tmpdir(), 'ao-model-work-'));
  t.after(() => removeDir(root));
  const repo = path.join(root, 'repo');
  const v2 = base().map((u) => (u.n === 4 ? { ...u, doc: flowUnit('ACT_Save', 'Saving it') } : u));
  const [a, b] = await repoWith(repo, [base(), v2]);
  const units = new ModelUnits(path.join(root, 'data'));
  t.after(() => units.close());
  const blobs = units.blobs(repo);
  const [fa, fb] = [(await modelFiles(blobs, a))!, (await modelFiles(blobs, b))!];
  const work = new WorkDirs(path.join(root, 'data'), 1);
  const seen = await work.use(blobs, a, fa, async (mpr, dir) => {
    assert.ok(existsSync(mpr));
    assert.ok(existsSync(path.join(dir, 'mprcontents', guid(4).slice(0, 2), guid(4).slice(2, 4), `${guid(4)}.mxunit`)));
    return dir;
  });
  assert.equal(work.written, 7, 'the .mpr and six units');
  // With one folder, b waits until a's run is done, then only the .mpr and the changed unit are written.
  let release!: () => void;
  const holding = work.use(blobs, a, fa, () => new Promise<void>((r) => (release = r)));
  let bRan = false;
  const onB = work.use(blobs, b, fb, async (mpr, dir) => {
    bRan = true;
    assert.equal(dir, seen);
    return readFileSync(mpr).length;
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(bRan, false, 'a folder in use is not changed under it');
  release();
  await holding;
  assert.ok((await onB) > 0);
  assert.equal(work.written, 9, 'two files for the next commit');
  // A new office finds what the folder holds.
  const again = new WorkDirs(path.join(root, 'data'), 1);
  await again.use(blobs, b, fb, async () => {});
  assert.equal(again.written, 0);
});

test('reading ahead: at most MAX tasks, one at a time, a newer run for the floor stopping the older', async () => {
  const p = new Prefetcher(3);
  const order: string[] = [];
  const task = (s: string) => async () => void order.push(s);
  assert.equal(await p.run('f', ['a', 'b', 'c', 'd', 'e'].map(task)), 3, 'bounded');
  assert.deepEqual(order, ['a', 'b', 'c']);
  order.length = 0;
  const first = p.run('f', ['1', '2', '3'].map(task));
  const second = p.run('f', ['x', 'y'].map(task));
  assert.equal(await first, 0, 'stopped before its first task: they moved on');
  assert.equal(await second, 2);
  assert.deepEqual(order, ['x', 'y']);
  const other = p.run('g', [task('g1'), async () => Promise.reject(new Error('one failing doesn\'t stop the rest')), task('g2')]);
  p.cancel('nobody');
  assert.equal(await other, 3);
  assert.equal(p.busy('g'), false);
});

test('reading ahead in the service: opening a document reads its module; main moving reads what changed', async (t) => {
  if (!(await hasSqlite())) return t.skip('no node:sqlite here');
  const root = mkdtempSync(path.join(tmpdir(), 'ao-model-ahead-'));
  t.after(() => removeDir(root));
  const repo = path.join(root, 'repo');
  const v2 = base().map((u) => (u.n === 5 ? { ...u, doc: flowUnit('ACT_Other', 'Other, changed') } : u));
  const [a, b] = await repoWith(repo, [base(), v2]);
  let main = a;
  const svc = new ModelService(path.join(root, 'data'), { graph: graphAt(() => main), mx: fakeMx([]) });
  t.after(() => svc.units.close());
  const floor = { id: 'f', dir: repo, workers: { list: () => [] }, github: { pulls: { items: [] } } };
  await svc.doc(floor, 'main', 'microflow', 'Shop.ACT_Save');
  while (svc.prefetch.busy('f')) await new Promise((r) => setTimeout(r, 5));
  const misses = svc.store.misses;
  await svc.doc(floor, 'main', 'microflow', 'Shop.ACT_Other');
  await svc.doc(floor, 'main', 'domainmodel', 'Shop');
  assert.equal(svc.store.misses, misses, 'the module was read ahead');
  // Main moves while the tab is in use: what changed is read before anyone asks.
  main = b;
  const warmed = await svc.warmMove(floor, a, b);
  assert.ok(warmed >= 2, 'the tree and the changed flow');
  const after = svc.store.misses;
  const d = await svc.doc(floor, 'main', 'microflow', 'Shop.ACT_Other');
  assert.equal(svc.store.misses, after, 'already worked out');
  assert.ok(d.doc.kind === 'microflow' && d.doc.nodes.some((n) => n.caption === 'Other, changed'));
});
