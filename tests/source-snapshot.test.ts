// The imported snapshot of a source folder (server/wizard/source-snapshot.ts): a Retry imports the folder as
// it is now (a same-size edit, a deleted file), the manifest matches the completed bytes, an import that
// stops mid-copy or mid-swap never publishes a mixed snapshot and the next run recovers, a source changing
// while it is copied is caught, the source is never written, and links and junctions are still never
// followed. On synthetic trees only (tests/support/fake-next-tree.ts), never a real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copySourceFolder, importSnapshot, recoverSnapshot, snapshotPaths, snapshotState, verifySnapshot, SnapshotError, type SnapshotManifest } from '../src/server/wizard/source-snapshot.js';
import { withSourceFolder } from '../src/server/wizard/source-step.js';
import { newJob } from '../src/server/wizard/job.js';
import { KEPT, fakeNextTree } from './support/fake-next-tree.js';
import { discoveryPlan } from './support/discovery-plans.js';

const tmp = (n: string) => mkdtempSync(path.join(os.tmpdir(), `srcsnap-${n}-`));
const listAll = (dir: string, rel = ''): string[] => readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listAll(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`]));
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const at = (dir: string, rel: string) => path.join(dir, ...rel.split('/'));
const manifestOf = (dest: string) => JSON.parse(readFileSync(snapshotPaths(dest).manifest, 'utf8')) as SnapshotManifest;
/** Every file under `dir` with its bytes' hash: what a snapshot (or a source) holds. */
const contents = (dir: string) => Object.fromEntries(listAll(dir).sort().map((f) => [f, sha(readFileSync(at(dir, f)))]));
/** The manifest re-checked by hand: the completed folder holds exactly its files, with its bytes. */
function assertManifestMatches(dest: string) {
  const m = manifestOf(dest);
  assert.deepEqual(listAll(dest).sort(), m.entries.map((e) => e.path).sort(), 'exactly the manifest’s files');
  for (const e of m.entries) {
    const b = readFileSync(at(dest, e.path));
    assert.equal(b.length, e.size, e.path);
    assert.equal(sha(b), e.sha256, e.path);
  }
  assert.equal(m.files, m.entries.length);
  assert.equal(m.bytes, m.entries.reduce((n, e) => n + e.size, 0));
}
/** What sits beside the snapshot: only the folder and its manifest once an import is complete. */
const beside = (dest: string) => readdirSync(path.dirname(dest)).sort();
function setup(n: string) {
  const root = tmp(n);
  const src = fakeNextTree(path.join(root, 'shop-app'));
  const dest = path.join(root, 'project', 'sources', 'legacy', 'shop-app');
  return { root, src, dest, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('a Retry imports a same-size edit and drops a deleted file: the reviewer’s repro', async () => {
  const t = setup('retry');
  try {
    writeFileSync(at(t.src, 'lib/flag.ts'), 'export const v = "old";\n');
    await importSnapshot(t.src, t.dest);
    assert.equal(readFileSync(at(t.dest, 'lib/flag.ts'), 'utf8'), 'export const v = "old";\n');
    assert.deepEqual(beside(t.dest), ['shop-app', 'shop-app.manifest.json']);
    // The same length, so the old size check kept the stale copy.
    writeFileSync(at(t.src, 'lib/flag.ts'), 'export const v = "new";\n');
    unlinkSync(at(t.src, 'lib/db.ts'));
    const r = await importSnapshot(t.src, t.dest);
    assert.equal(r.replaced, true);
    assert.equal(readFileSync(at(t.dest, 'lib/flag.ts'), 'utf8'), 'export const v = "new";\n', 'the edit is imported');
    assert.equal(existsSync(at(t.dest, 'lib/db.ts')), false, 'the deleted file doesn’t survive');
    assert.deepEqual(listAll(t.dest).sort(), [...KEPT.filter((f) => f !== 'lib/db.ts'), 'lib/flag.ts'].sort());
    assertManifestMatches(t.dest);
    assert.deepEqual(await verifySnapshot(t.dest), { ok: true, problems: [], manifest: manifestOf(t.dest) });
    assert.deepEqual(beside(t.dest), ['shop-app', 'shop-app.manifest.json'], 'no staging, previous or record left');
    // Something added to the snapshot by hand doesn't survive a Retry either, and verify notices it meanwhile.
    writeFileSync(at(t.dest, 'extra.txt'), 'x');
    assert.match((await verifySnapshot(t.dest)).problems.join(), /extra\.txt: not in the manifest/);
    await importSnapshot(t.src, t.dest);
    assert.equal(existsSync(at(t.dest, 'extra.txt')), false);
  } finally {
    t.done();
  }
});

test('the setup step’s Retry re-imports the folder, with the manifest in its detail', async () => {
  const t = setup('step');
  try {
    const dir = path.join(t.root, 'project');
    mkdirSync(dir, { recursive: true });
    const plan = discoveryPlan('migration', { sourceFolder: { path: t.src, name: 'shop-app', files: KEPT.length, bytes: 1 } });
    const job = Object.assign(newJob(plan, 'Probe'), { dir });
    const steps = withSourceFolder({ intake: async () => ({ status: 'done', detail: 'answers' }) } as never);
    const logs: string[] = [];
    await steps.intake(job, { log: (l) => logs.push(l) });
    writeFileSync(at(t.src, 'README.md'), readFileSync(at(t.src, 'README.md'), 'utf8').replace('Shop', 'SHOP'));
    const r = await steps.intake(job, { log: (l) => logs.push(l) });
    assert.match(String(r.detail), /sources\/legacy\/shop-app\/: 11 files, .*manifest sources\/legacy\/shop-app\.manifest\.json \(sha256 [0-9a-f]{12}\), replacing the earlier snapshot/);
    assert.match(readFileSync(path.join(dir, 'sources', 'legacy', 'shop-app', 'README.md'), 'utf8'), /# SHOP app/);
    assert.ok(logs.some((l) => /git-ignored, never pushed to GitHub/.test(l)));
    assert.ok(!logs.some((l) => /nothing is uploaded/.test(l)), 'no claim the code never leaves the machine');
  } finally {
    t.done();
  }
});

test('an import that stops mid-copy never publishes: the completed snapshot stays exactly as it was, and the next run recovers', async () => {
  const t = setup('crash-copy');
  try {
    await importSnapshot(t.src, t.dest);
    const before = contents(t.dest);
    const manifestBefore = readFileSync(snapshotPaths(t.dest).manifest, 'utf8');
    writeFileSync(at(t.src, 'app/page.tsx'), 'export default 2;\n');
    let n = 0;
    await assert.rejects(importSnapshot(t.src, t.dest, { at: (p) => { if (p === 'copy' && ++n === 4) throw new Error('crash mid-copy'); } }), /crash mid-copy/);
    assert.deepEqual(contents(t.dest), before, 'the published snapshot is untouched');
    assert.equal(readFileSync(snapshotPaths(t.dest).manifest, 'utf8'), manifestBefore);
    assert.equal(await snapshotState(t.dest), 'interrupted', 'the operation record shows it');
    assert.ok(existsSync(snapshotPaths(t.dest).staging), 'a crash leaves the partial copy for the next run');
    const notes: string[] = [];
    const r = await importSnapshot(t.src, t.dest, { onNote: (l) => notes.push(l) });
    assert.match(String(r.recovered), /stopped while copying: its partial copy was thrown away/);
    assert.ok(notes.some((l) => /stopped while copying/.test(l)));
    assert.equal(readFileSync(at(t.dest, 'app/page.tsx'), 'utf8'), 'export default 2;\n');
    assertManifestMatches(t.dest);
    assert.equal(await snapshotState(t.dest), 'recorded');
    assert.deepEqual(beside(t.dest), ['shop-app', 'shop-app.manifest.json']);
  } finally {
    t.done();
  }
});

test('an import that stops at the swap is finished by the next run, never left mixed', async () => {
  for (const stop of ['publish', 'swap#1', 'swap#2'] as const) {
    const t = setup(`crash-${stop.replace('#', '')}`);
    try {
      writeFileSync(at(t.src, 'lib/flag.ts'), 'old');
      await importSnapshot(t.src, t.dest);
      const old = contents(t.dest);
      writeFileSync(at(t.src, 'lib/flag.ts'), 'new');
      unlinkSync(at(t.src, 'README.md'));
      let swaps = 0;
      await assert.rejects(
        importSnapshot(t.src, t.dest, {
          at: (p) => {
            if (stop === 'publish' && p === 'publish') throw new Error('crash at publish');
            if (p === 'swap' && `swap#${++swaps}` === stop) throw new Error('crash mid-swap');
          },
        }),
        /crash/,
      );
      if (stop === 'publish') assert.deepEqual(contents(t.dest), old, 'before the swap the old snapshot stands');
      // The recovery alone (no new import): whatever is published afterwards is one whole snapshot with its manifest.
      const said = await recoverSnapshot(t.dest);
      assert.ok(said, stop);
      assertManifestMatches(t.dest);
      const now = contents(t.dest);
      if (stop === 'publish') assert.deepEqual(now, old, 'stopped while copying: the old snapshot stays');
      else {
        assert.match(said, /finished/);
        assert.equal(readFileSync(at(t.dest, 'lib/flag.ts'), 'utf8'), 'new', `${stop}: the checked new snapshot is swapped in`);
        assert.equal(existsSync(at(t.dest, 'README.md')), false);
      }
      assert.deepEqual(beside(t.dest), ['shop-app', 'shop-app.manifest.json'], stop);
      assert.equal((await verifySnapshot(t.dest)).ok, true, stop);
    } finally {
      t.done();
    }
  }
});

test('a source changed between hashing and the check stops the import (same size, same modified time): nothing is published', async () => {
  const t = setup('mutate');
  try {
    await importSnapshot(t.src, t.dest);
    const old = contents(t.dest);
    const f = at(t.src, 'lib/db.ts');
    const whole = 1_700_000_000; // a whole second, so putting it back is exact
    utimesSync(f, whole, whole);
    const err = await importSnapshot(t.src, t.dest, {
      at: (p, rel) => {
        if (p !== 'copied' || rel !== 'lib/db.ts') return;
        writeFileSync(f, readFileSync(f, 'utf8').replace('DATABASE', 'DATABASX'));
        utimesSync(f, whole, whole); // only the bytes give it away
      },
    }).then(() => undefined, (e: Error) => e);
    assert.ok(err instanceof SnapshotError, String(err));
    assert.match(err.message, /The source folder changed while it was being copied \(lib\/db\.ts\): stop whatever is writing to it/);
    assert.deepEqual(contents(t.dest), old, 'the completed snapshot is unchanged');
    assert.deepEqual(beside(t.dest), ['shop-app', 'shop-app.manifest.json'], 'the partial copy and record are cleared');
  } finally {
    t.done();
  }
});

test('a file changed while it is copied is copied again, and one that keeps changing stops the import', async () => {
  const t = setup('mutate-retry');
  try {
    const f = at(t.src, 'app/layout.tsx');
    const bump = (text: string) => {
      writeFileSync(f, text);
      const later = new Date(statSync(f).mtimeMs + 5_000 + Math.random() * 1000);
      utimesSync(f, later, later);
    };
    const notes: string[] = [];
    let once = false;
    await importSnapshot(t.src, t.dest, { onNote: (l) => notes.push(l), at: (p, rel) => { if (p === 'copied' && rel === 'app/layout.tsx' && !once) { once = true; bump('changed'); } } });
    assert.deepEqual(notes, ['app/layout.tsx changed while it was being copied: copying it again']);
    assert.equal(readFileSync(at(t.dest, 'app/layout.tsx'), 'utf8'), 'changed', 'the file as it is now');
    assertManifestMatches(t.dest);
    const old = contents(t.dest);
    let k = 0;
    await assert.rejects(importSnapshot(t.src, t.dest, { at: (p, rel) => { if (p === 'copied' && rel === 'app/layout.tsx') bump(`changed ${++k}`); } }), /app\/layout\.tsx kept changing while it was being copied: stop whatever is writing/);
    assert.deepEqual(contents(t.dest), old);
    assert.deepEqual(beside(t.dest), ['shop-app', 'shop-app.manifest.json']);
    // A file deleted mid-import stops it too.
    await assert.rejects(importSnapshot(t.src, t.dest, { at: (p, rel) => { if (p === 'copy' && rel === 'app/page.tsx') unlinkSync(at(t.src, 'packages/ui/button.tsx')); } }), /packages\/ui\/button\.tsx disappeared while the folder was being copied/);
    assert.deepEqual(contents(t.dest), old);
  } finally {
    t.done();
  }
});

test('the source is only read: every file, skipped ones too, keeps its bytes and modified time', async () => {
  const t = setup('readonly');
  try {
    const snap = () => Object.fromEntries(listAll(t.src).map((f) => [f, `${sha(readFileSync(at(t.src, f)))}@${statSync(at(t.src, f)).mtimeMs}`]));
    const before = snap();
    await importSnapshot(t.src, t.dest);
    await importSnapshot(t.src, t.dest);
    assert.deepEqual(snap(), before);
    await assert.rejects(importSnapshot(t.src, path.join(t.src, 'out')), /inside the source folder/, 'never a snapshot inside the source');
    assert.equal(existsSync(path.join(t.src, 'out')), false);
  } finally {
    t.done();
  }
});

test('links and junctions are never followed, and the caps still refuse a folder before anything is written', async () => {
  const t = setup('links');
  try {
    const outside = path.join(t.root, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret-notes.txt'), 'not part of the app');
    symlinkSync(outside, path.join(t.src, 'linked-dir'), 'junction');
    let fileLink = true;
    try {
      symlinkSync(path.join(outside, 'secret-notes.txt'), path.join(t.src, 'linked-file.txt'), 'file');
    } catch {
      fileLink = false; // Windows without Developer Mode: file symlinks need rights a junction doesn't
    }
    const r = await importSnapshot(t.src, t.dest);
    assert.equal(r.skipped.links, fileLink ? 2 : 1);
    assert.deepEqual(listAll(t.dest).sort(), [...KEPT].sort(), 'nothing through a link or junction');
    assertManifestMatches(t.dest);
    await assert.rejects(copySourceFolder(t.src, path.join(t.root, 'p2', 'shop-app'), { maxFiles: 3, maxBytes: 1e9, fileMaxBytes: 5 * 1024 * 1024 }), /More than 3 files/);
    assert.equal(existsSync(path.join(t.root, 'p2')), false, 'nothing written past a cap');
  } finally {
    t.done();
  }
});

test('leftovers with no record are cleared, and a snapshot from before manifests is replaced by a recorded one', async () => {
  const t = setup('legacy');
  try {
    const p = snapshotPaths(t.dest);
    mkdirSync(path.join(t.dest, 'old'), { recursive: true });
    writeFileSync(path.join(t.dest, 'old', 'stale.ts'), 'stale');
    mkdirSync(p.staging, { recursive: true });
    writeFileSync(path.join(p.staging, 'half.ts'), 'half');
    assert.equal(await snapshotState(t.dest), 'unrecorded');
    assert.match((await verifySnapshot(t.dest)).problems.join(), /no manifest/);
    const r = await importSnapshot(t.src, t.dest);
    assert.match(String(r.recovered), /partial copy was thrown away/);
    assert.equal(r.replaced, true);
    assert.equal(existsSync(path.join(t.dest, 'old')), false, 'the unrecorded snapshot’s extra files are gone');
    assert.equal(await snapshotState(t.dest), 'recorded');
    assertManifestMatches(t.dest);
    assert.deepEqual(beside(t.dest), ['shop-app', 'shop-app.manifest.json']);
    const m = manifestOf(t.dest);
    assert.equal(m.version, 1);
    assert.equal(m.source, t.src);
    assert.deepEqual(m.entries.map((e) => e.path), [...m.entries.map((e) => e.path)].sort(), 'entries in path order');
  } finally {
    t.done();
  }
});
