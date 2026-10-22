// Design systems: a task's guidance file is written (critical write) BEFORE the task is given its path
// (server/design/line.ts). A slow writer can't expose a file that isn't there yet, a failing one can't produce a
// path at all (the manifest records the guidance as unavailable, with why), a file written by an earlier run
// is found at its exact size, and a project with no binding gets no line and no manifest, as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DesignLines, type GuidanceWriter } from '../src/server/design/line.js';
import { DesignProjects } from '../src/server/design/projects.js';
import type { DesignContextRecord, ProjectDesignBinding } from '../src/shared/design/types.js';
import { designWorld, published, appDir } from './design-helpers.js';

const B: ProjectDesignBinding = { systemId: 'dsg_01JA0000000000000000000000', name: 'Acme', n: 1, digest: 'a'.repeat(64), kind: 'branded', themeName: 'acme-aaaaaaaa', preset: 'administration', approval: { kind: 'wizard', by: 'Ada', at: 1 }, exceptions: [] };
const T = { floorId: 'f1', taskId: 'tsk_X', text: 'Build the form', issue: 7 };

async function world(t: { after(fn: () => void): void }, write?: GuidanceWriter) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-design-guidance-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'design-systems');
  const projects = new DesignProjects(root);
  const lines = new DesignLines(root, dir, projects, (id, n) => path.join(root, 'packages', id, `v${n}`), () => 5, write);
  return { dir, root, projects, lines };
}

const manifest = async (lines: DesignLines): Promise<DesignContextRecord[]> => {
  await lines.settled('f1');
  return readFileSync(lines.manifestFile('f1'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
};
const plain: GuidanceWriter = async (file, text) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
};

test('a slow writer: until the file is written the task gets no path (guidance unavailable, recorded); then the path, to a file that is there', async (t) => {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  let calls = 0;
  const { projects, lines } = await world(t, async (file, text) => {
    calls++;
    await gate;
    await plain(file, text);
  });
  await projects.bind('f1', undefined, B);
  const preparing = lines.prepare('f1');
  const early = lines.line(T)!;
  assert.match(early, /^Design: Acme@v1 #aaaaaaa \(Branded Atlas\) is bound, but its guidance file couldn't be prepared for this task/);
  assert.doesNotMatch(early, /Read |guidance\//, 'no path to a file that is not there');
  assert.ok(early.length <= 300);
  const g = lines.guidance('f1', B, []);
  assert.equal(existsSync(g.file), false);
  open();
  await preparing;
  assert.equal(calls, 1, 'one write for the one file, however many asked');
  const later = lines.line(T)!;
  assert.match(later, /Read .*guidance/);
  const [first, second] = await manifest(lines);
  assert.deepEqual([first.status, first.guidance], ['unavailable', undefined]);
  assert.match(first.reason!, /not written yet|still being written/);
  assert.equal(second.status, 'supplied');
  assert.ok(existsSync(second.guidance!), 'the path given is a file that is there');
  assert.equal(readFileSync(second.guidance!, 'utf8').length, second.guidanceChars);
  assert.ok(!('read' in second), 'supplied, never "read"');
});

test('a failing writer never produces a path: unavailable in the manifest with why; prepare reports the failure', async (t) => {
  const { projects, lines } = await world(t, async () => {
    throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  });
  await projects.bind('f1', undefined, B);
  await assert.rejects(lines.prepare('f1'), /EACCES/);
  const line = lines.line(T)!;
  assert.doesNotMatch(line, /Read |\.md/);
  const [rec] = await manifest(lines);
  assert.deepEqual([rec.status, rec.guidance, rec.guidanceChars], ['unavailable', undefined, 0]);
  assert.match(rec.reason!, /EACCES/);
  assert.equal(existsSync(lines.guidance('f1', B, []).file), false);
});

test('every file a task can get is written ahead (project-wide and per issue); a file from an earlier run is found at its exact size, a torn one is not', async (t) => {
  const { root, dir, projects, lines } = await world(t);
  await projects.bind('f1', undefined, B);
  await projects.select('f1', { patternId: 'forms.validated', version: 1, scope: { issue: 7 }, by: 'Ada', at: 2 });
  await projects.select('f1', { patternId: 'admin.details', version: 1, scope: { project: true }, by: 'Ada', at: 3 });
  await lines.prepare('f1');
  for (const ids of [['admin.details'], ['forms.validated']]) assert.ok(existsSync(lines.guidance('f1', B, ids).file), ids.join());
  assert.match(lines.line(T)!, /Patterns: forms\.validated\. Read /);
  // A restart: a new provider, nothing written by it yet.
  const again = new DesignLines(root, dir, projects, (id, n) => path.join(root, 'packages', id, `v${n}`), () => 6, async () => assert.fail('nothing to write: the file is there'));
  assert.match(again.line(T)!, /Read /);
  const g = lines.guidance('f1', B, ['admin.details']);
  writeFileSync(g.file, g.text.slice(0, 10));
  const third = new DesignLines(root, dir, projects, (id, n) => path.join(root, 'packages', id, `v${n}`), () => 7, plain);
  assert.match(third.line({ ...T, issue: 8 })!, /couldn't be prepared/, 'a torn file is not given');
  await third.settled('f1');
});

test('a project with no binding: no line, no manifest, nothing written (as before)', async (t) => {
  let calls = 0;
  const { lines } = await world(t, async () => void calls++);
  await lines.prepare('f1');
  assert.equal(lines.line(T), undefined);
  await lines.settled('f1');
  assert.equal(existsSync(lines.manifestFile('f1')), false);
  assert.equal(calls, 0);
});

test('through the service: right after Use for… and after a new project is bound, the task’s path is to a file that is there', async (t) => {
  const { s, root, floors } = designWorld(t);
  const v = await published(s);
  const dir = appDir(root);
  floors.push({ id: 'f1', name: 'p', dir });
  assert.equal((await s.setupNew('f1', dir, v.id, v.n, 'Ada')).ok, true);
  const first = s.lines.line({ ...T, issue: undefined })!;
  assert.ok(existsSync(/Read (\S+) first/.exec(first)![1]));
  assert.equal(await s.select('f1', 'forms.validated', { issue: 9 }, 'Ada', false), undefined);
  const line = s.lines.line({ ...T, issue: 9 })!;
  // The pattern is named, or counted when a long temporary folder (macOS's) leaves the line no room for
  // it; either way the file the line points at has it.
  assert.match(line, /Patterns: (forms\.validated|1 in the file)\./);
  const file = /Read (\S+) first/.exec(line)![1];
  assert.ok(existsSync(file));
  assert.match(readFileSync(file, 'utf8'), /## Patterns for this task\n\n# .*\(`forms\.validated@1`\)/);
});
