// "Add a source folder" (server/wizard/source-folder.ts, shared/source-folder.ts): what is skipped, the summary
// shown before copying, the caps, the refused paths, the copy at setup, the draft keeping the folder, the
// planner getting only a file index, and the route for admins only. On a synthetic fake Next.js tree
// (tests/support/fake-next-tree.ts), never a real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { checkSourcePath, scanSourceFolder } from '../src/server/wizard/source-folder.js';
import { copySourceFolder } from '../src/server/wizard/source-snapshot.js';
import { bytesText, fileIndexText, summaryText, type SourceFolder } from '../src/shared/source-folder.js';
import { Planner, plannerConfig } from '../src/server/wizard/planner/index.js';
import { fakeEngine } from '../src/server/wizard/planner/fake.js';
import type { PlannerEngine } from '../src/server/wizard/planner/engine.js';
import { briefInput } from '../src/server/wizard/planner/prompts.js';
import { sourceFolderRoutes } from '../src/server/http/routes/source-folder.js';
import { withSourceFolder, ignoresSources } from '../src/server/wizard/source-step.js';
import { newJob } from '../src/server/wizard/job.js';
import { CONTENT_MARKER, KEPT, fakeNextTree } from './support/fake-next-tree.js';
import { discoveryPlan } from './support/discovery-plans.js';

const tmp = (n: string) => mkdtempSync(path.join(os.tmpdir(), `srcfolder-${n}-`));
const listAll = (dir: string, rel = ''): string[] => readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listAll(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`]));
const scanned = async (dir: string) => {
  const s = await scanSourceFolder(dir);
  if ('error' in s) throw new Error(s.error);
  return s;
};

test('the scan skips dependency and build folders, secrets-like files and files over the cap, and says so before copying', async () => {
  const root = tmp('scan');
  try {
    const src = fakeNextTree(path.join(root, 'shop-app'));
    const s = await scanned(src);
    assert.equal(s.name, 'shop-app');
    assert.deepEqual(s.index.map((f) => f.path).sort(), [...KEPT].sort(), 'only the app’s own files');
    assert.equal(s.files, KEPT.length);
    assert.deepEqual(s.skipped.dirs, { node_modules: 2, '.git': 1, '.next': 1, dist: 1, build: 1, coverage: 1, '.turbo': 1, __pycache__: 1 });
    assert.equal(s.skipped.secrets, 5, '.env, .env.local, .pem, .key, .pfx');
    assert.equal(s.skipped.large, 1);
    const bytes = KEPT.reduce((n, f) => n + readFileSync(path.join(src, f)).length, 0);
    assert.equal(s.bytes, bytes);
    assert.equal(summaryText(s), `11 files, ${bytesText(bytes)}; skipped: .git, .next, .turbo, __pycache__, build, coverage, dist, node_modules (2), 5 secrets-like files, 1 file over 5 MB`);
    assert.equal(summaryText({ files: 212, bytes: 9 * 1024 * 1024, skipped: { dirs: { node_modules: 1 }, secrets: 2, large: 0, links: 0 } }), '212 files, 9 MB; skipped: node_modules, 2 secrets-like files');
    assert.equal(s.index[0].path.includes('/'), false, 'the index is shallowest first');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the copy leaves out everything the scan does, never copies a secret, and a Retry imports it afresh', async () => {
  const root = tmp('copy');
  try {
    const src = fakeNextTree(path.join(root, 'shop-app'));
    const dest = path.join(root, 'project', 'sources', 'legacy', 'shop-app');
    const c = await copySourceFolder(src, dest);
    assert.equal(c.files, KEPT.length);
    assert.equal(c.replaced, false);
    assert.deepEqual(listAll(dest).sort(), [...KEPT].sort());
    for (const bad of ['.env', '.env.local', 'certs/server.pem', 'certs/app.key', 'certs/client.pfx', 'node_modules/react/index.js', 'public/demo-video.mp4']) assert.equal(existsSync(path.join(dest, bad)), false, bad);
    const again = await copySourceFolder(src, dest);
    assert.equal(again.files, KEPT.length);
    assert.equal(again.replaced, true, 'a Retry replaces the snapshot with a fresh one');
    assert.equal(again.manifest.sha256, c.manifest.sha256, 'the same source gives the same snapshot');
    assert.deepEqual(listAll(dest).sort(), [...KEPT].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the size and file-count caps refuse a folder, and a folder over a cap copies nothing', async () => {
  const root = tmp('caps');
  try {
    const src = fakeNextTree(path.join(root, 'shop-app'));
    const few = await scanSourceFolder(src, { maxFiles: 5, maxBytes: 1e9, fileMaxBytes: 5 * 1024 * 1024 });
    assert.match('error' in few ? few.error : '', /More than 5 files/);
    const small = await scanSourceFolder(src, { maxFiles: 1000, maxBytes: 100, fileMaxBytes: 5 * 1024 * 1024 });
    assert.match('error' in small ? small.error : '', /More than 0 MB/);
    const dest = path.join(root, 'out');
    await assert.rejects(copySourceFolder(src, dest, { maxFiles: 5, maxBytes: 1e9, fileMaxBytes: 5 * 1024 * 1024 }));
    assert.equal(existsSync(dest), false, 'nothing copied');
    assert.deepEqual(readdirSync(root), ['shop-app'], 'no staging folder, manifest or operation record either');
    const empty = path.join(root, 'only-secrets');
    mkdirSync(path.join(empty, 'node_modules'), { recursive: true });
    writeFileSync(path.join(empty, '.env'), 'X=1');
    assert.match(String((await scanSourceFolder(empty) as { error: string }).error), /nothing to copy/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refused paths: not a full path, missing, a file, a drive, the home folder, system folders, the office’s own folders and the projects home', async () => {
  const root = tmp('refuse');
  try {
    const dataDir = path.join(root, 'office-data');
    const projectsDir = path.join(root, 'projects');
    mkdirSync(path.join(dataDir, 'wizard-drafts'), { recursive: true });
    mkdirSync(path.join(projectsDir, 'Org', 'app'), { recursive: true });
    writeFileSync(path.join(root, 'a-file.txt'), 'x');
    const office = { dataDir, projectsDir, codeDir: path.join(root, 'office-code') };
    mkdirSync(office.codeDir);
    const refused = async (p: unknown) => {
      const r = await checkSourcePath(p, office);
      assert.ok('error' in r, `${String(p)} should be refused`);
      return (r as { error: string }).error;
    };
    assert.match(await refused(''), /full path/);
    assert.match(await refused('relative/folder'), /full path/);
    assert.match(await refused(path.join(root, 'nope')), /no folder/);
    assert.match(await refused(path.join(root, 'a-file.txt')), /isn’t a folder/);
    assert.match(await refused(path.parse(root).root), /whole drive/);
    assert.match(await refused(os.homedir()), /home folder/);
    assert.match(await refused(path.dirname(os.homedir())), /home folder/);
    if (process.platform === 'win32') assert.match(await refused(process.env.WINDIR ?? 'C:\\Windows'), /system folder/);
    else assert.match(await refused('/etc'), /system folder/);
    assert.match(await refused(path.join(dataDir, 'wizard-drafts')), /inside the office’s data folder/);
    assert.match(await refused(path.join(projectsDir, 'Org', 'app')), /inside the projects home/);
    assert.match(await refused(root), /around the office’s data folder/);
    assert.match(await refused(office.codeDir), /office’s own code/);
    const ok = await checkSourcePath(`"${fakeNextTree(path.join(root, 'legacy', 'shop-app'))}"`, office);
    assert.ok('path' in ok, 'a quoted path to an app folder is fine');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a temporary folder reached through a link into a system folder (macOS: /var/folders is /private/var/folders) is the user’s own; the office’s folders there are still refused', { skip: process.platform === 'win32' || !existsSync('/var/tmp') }, async (t) => {
  // macOS's shape on any Unix: TMPDIR is a link whose real path is under /var.
  let real: string;
  try {
    real = mkdtempSync(path.join('/var/tmp', 'srcfolder-real-'));
  } catch {
    t.skip('/var/tmp is not writable here');
    return;
  }
  const outside = tmp('link');
  const before = process.env.TMPDIR;
  try {
    const linked = path.join(outside, 'T');
    symlinkSync(real, linked);
    process.env.TMPDIR = linked;
    assert.equal(os.tmpdir(), linked);
    const office = { dataDir: path.join(linked, 'office-data'), projectsDir: path.join(linked, 'projects'), codeDir: path.join(linked, 'office-code') };
    mkdirSync(path.join(office.dataDir, 'wizard-drafts'), { recursive: true });
    const app = fakeNextTree(path.join(linked, 'legacy', 'shop-app'));
    const ok = await checkSourcePath(app, office);
    assert.ok('path' in ok, 'error' in ok ? ok.error : '');
    // On macOS /var/tmp is itself a link (to /private/var/tmp), so compare with the fully resolved path.
    assert.equal(ok.path, path.join(realpathSync.native(real), 'legacy', 'shop-app'), 'its real path');
    const inData = await checkSourcePath(path.join(office.dataDir, 'wizard-drafts'), office);
    assert.match('error' in inData ? inData.error : '', /inside the office’s data folder/, 'the office’s folders compare by their real paths');
    // Outside the temporary folder, /var is still a system folder.
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    if (!os.tmpdir().startsWith('/var/tmp')) {
      const sys = await checkSourcePath(real, office);
      assert.match('error' in sys ? sys.error : '', /system folder/);
    }
  } finally {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    rmSync(outside, { recursive: true, force: true });
    rmSync(real, { recursive: true, force: true });
  }
});

/** An engine that records what each planning call was given, and answers as the test planner. */
function recording(): { engine: PlannerEngine; briefs: Parameters<PlannerEngine['brief']>[0][] } {
  const base = fakeEngine();
  const briefs: Parameters<PlannerEngine['brief']>[0][] = [];
  return { briefs, engine: { ...base, brief: (req) => (briefs.push(req), base.brief(req)) } };
}

test('the draft keeps the source folder across a restart, a migration or a change only, and the planner gets only its file index', async () => {
  const root = tmp('draft');
  try {
    const src = fakeNextTree(path.join(root, 'shop-app'));
    const s = await scanned(src);
    const rec = recording();
    const cfg = plannerConfig({ AGENT_OFFICE_PLANNER: 'fake' });
    const p = new Planner(path.join(root, 'data'), { engine: rec.engine, config: cfg });
    const who = { id: 'a1', name: 'Alex' };
    const plan = p.create(who, { mode: 'plan', prompt: 'x' });
    assert.match(String(p.setSource(plan, s)), /Migrate an app and Change an existing app/);
    const d = p.create(who, { mode: 'migrate', prompt: 'Rebuild the shop app' });
    assert.equal(p.setSource(d, s), undefined);
    // A fresh planner reads the draft from disk: a resumed draft keeps the folder.
    const again = new Planner(path.join(root, 'data'), { engine: rec.engine, config: cfg }).get(d.id, who)!;
    assert.equal(again.source?.path, src);
    assert.equal(again.source?.files, KEPT.length);
    assert.equal(p.draft(d, who), undefined);
    await p.running.get(d.id);
    const req = rec.briefs[0];
    assert.ok(req.sourceIndex?.includes('app/orders/page.tsx'), 'paths are in the index');
    assert.ok(req.sourceIndex?.includes('confidential'));
    assert.ok(!req.sourceIndex?.includes(CONTENT_MARKER), 'never a file’s contents');
    assert.ok(!JSON.stringify(req.files).includes(CONTENT_MARKER), 'the tree is not sent as files either');
    const lines = (req.sourceIndex ?? '').split('\n').filter((l) => l.startsWith('- '));
    assert.ok(lines.length === KEPT.length && !lines.some((l) => /\.env|node_modules|\.pem|demo-video/.test(l)), 'skipped files are not in the index');
    const input = briefInput(req.prompt, [], [], undefined, req.sourceIndex);
    assert.ok(input.includes('You have not read it and cannot: the team reads the code after setup'));
    assert.ok(!input.includes(CONTENT_MARKER));
    // Another way in forgets it.
    p.update(d, { mode: 'plan' });
    assert.equal(d.source, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the file index is capped', () => {
  const index = Array.from({ length: 400 }, (_, i) => ({ path: `src/f${i}.ts`, size: 10 }));
  const s: SourceFolder = { path: 'C:/x', name: 'x', files: 400, bytes: 4000, skipped: { dirs: {}, secrets: 0, large: 0, links: 0 }, index, scannedAt: '' };
  const text = fileIndexText(s, 150);
  assert.equal(text.split('\n').filter((l) => l.startsWith('- ')).length, 150);
  assert.ok(text.includes('150 of 400 files'));
});

/** A request the route handler reads: a method, headers and a JSON body. */
function req(method: string, body?: unknown) {
  const r = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as Readable & Record<string, unknown>;
  Object.assign(r, { method, headers: { host: 'office.test', origin: 'http://office.test' } });
  return r;
}
function res() {
  const out = { status: 0, body: '' as string, writeHead(s: number) { out.status = s; }, end(b: string) { out.body = b; } };
  return out;
}

test('the source-folder route is for admins only, from the office’s own pages, and keeps the scan on the draft', async () => {
  const root = tmp('route');
  try {
    const src = fakeNextTree(path.join(root, 'legacy', 'shop-app'));
    const cfg = { dataDir: path.join(root, 'data') };
    let admin = false;
    const ctx = { cfg, meOf: () => ({ admin }), building: { projectsDir: path.join(root, 'projects') } } as never;
    const route = sourceFolderRoutes.sourceFolder;
    const go = async (p: string, method: string, body?: unknown, id = '') => {
      const r = res();
      await route.handle(ctx, { req: req(method, body), res: r, url: new URL(`http://office.test${p}?id=${id}`), path: p, session: { account: { id: 'a1', name: 'Alex' } } } as never);
      return r;
    };
    assert.equal((await go('/api/source-folder/scan', 'POST', { path: src })).status, 403, 'not an admin');
    admin = true;
    const { plannerOf } = await import('../src/server/wizard/planner/index.js');
    const d = plannerOf(ctx).create({ id: 'a1', name: 'Alex' }, { mode: 'migrate', prompt: 'x' });
    assert.equal((await go('/api/source-folder/scan', 'GET', undefined, d.id)).status, 405);
    const bad = await go('/api/source-folder/scan', 'POST', { path: cfg.dataDir }, d.id);
    assert.equal(bad.status, 400);
    const ok = await go('/api/source-folder/scan', 'POST', { path: src }, d.id);
    assert.equal(ok.status, 200, ok.body);
    assert.equal((JSON.parse(ok.body) as { source: SourceFolder }).source.files, KEPT.length);
    const cleared = await go('/api/source-folder/clear', 'POST', {}, d.id);
    assert.equal((JSON.parse(cleared.body) as { source?: unknown }).source, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('at setup the intake step copies the folder into sources/legacy/<name>/ and keeps it out of git', async () => {
  const root = tmp('step');
  try {
    const src = fakeNextTree(path.join(root, 'shop-app'));
    const dir = path.join(root, 'project');
    mkdirSync(dir);
    const plan = discoveryPlan('migration', { sourceFolder: { path: src, name: 'shop-app', files: KEPT.length, bytes: 1 } });
    const job = Object.assign(newJob(plan, 'Probe'), { dir });
    const steps = withSourceFolder({ intake: async () => ({ status: 'done', detail: 'answers' }) } as never);
    const r = await steps.intake(job, { log: () => undefined });
    assert.equal(r.status, 'done');
    assert.match(String(r.detail), /sources\/legacy\/shop-app\/: 11 files/);
    assert.deepEqual(listAll(path.join(dir, 'sources', 'legacy', 'shop-app')).sort(), [...KEPT].sort());
    assert.ok(ignoresSources(readFileSync(path.join(dir, '.gitignore'), 'utf8')));
    assert.ok(ignoresSources('/sources/\n') && ignoresSources('sources\n') && !ignoresSources('/sourcesx/\n'));
    // Without a source folder the step is untouched.
    const plain = Object.assign(newJob(discoveryPlan('migration'), 'Probe'), { dir });
    assert.deepEqual(await steps.intake(plain, { log: () => undefined }), { status: 'done', detail: 'answers' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
