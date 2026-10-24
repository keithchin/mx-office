// The App Workspace's explorer on the server (server/app-explorer/, http/routes/app-explorer.ts) and its
// shared rules (shared/app-explorer.ts):
//   - the business tree built from the app's units at a revision, one level at a time: Pages by part of the
//     app with each page's address (or none when it needs a record), Data's kinds of records, Logic, the
//     Marketplace parts after the app's own, and a newer revision's tree differing from an older one's
//   - plain labels (no engineering words: the App Workspace's words check passes on every label)
//   - what changed between two revisions (documents and files), for the "changed" dots
//   - the all-files view: the denylist (never .git, the office's folder, env files, keys, credentials,
//     config.json, token files) and the .gitignore, paths checked (no `..`, nothing absolute), big folders
//     paged, files read-only as text, a picture or "can't be shown"
//   - the route: signed in only, a full commit id asked for, bad paths refused
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanTreePath, deniedPath, pageUrl, plainName, FILES_PAGE, type ExplorerNode } from '../src/shared/app-explorer.js';
import { explorerChanges, explorerLevel } from '../src/server/app-explorer/index.js';
import { fileAt, folderAt } from '../src/server/app-explorer/files.js';
import { appExplorerRoutes } from '../src/server/http/routes/app-explorer.js';
import { modelOf } from '../src/server/model/index.js';
import { stopExecWorker } from '../src/server/offloop/exec.js';
import { removeDir } from './support/cleanup.js';
import { hasSqlite, project, type MadeUnit } from './support/mendix.js';

test.after(() => stopExecWorker());

const page = (name: string, url?: string) => ({ $Type: 'Forms$Page', Name: name, ...(url !== undefined ? { Url: url } : {}) });
const flow = (type: 'Microflows$Microflow' | 'Microflows$Nanoflow', name: string) => ({ $Type: type, Name: name, ObjectCollection: { $Type: 'Microflows$MicroflowObjectCollection', Objects: [3] }, Flows: [3] });
const entity = (name: string) => ({ $ID: name, $Type: 'DomainModels$EntityImpl', Name: name, Location: '10;10', Attributes: [3] });

const v1 = (): MadeUnit[] => [
  { n: 1, container: 1, hash: 'p', doc: { $Type: 'Projects$Project' } },
  { n: 2, container: 1, hash: 'm', doc: { $Type: 'Projects$ModuleImpl', Name: 'VisitorDesk' } },
  { n: 3, container: 2, hash: 'pg1', doc: page('Visitor_Overview', 'visitors') },
  { n: 4, container: 2, hash: 'pg2', doc: page('Visitor_NewEdit', 'visitor/{Id}') },
  { n: 5, container: 2, hash: 'mf1', doc: flow('Microflows$Microflow', 'ACT_Visitor_Commit') },
  { n: 6, container: 2, hash: 'nf1', doc: flow('Microflows$Nanoflow', 'NF_ShowBadge') },
  { n: 7, container: 2, hash: 'dm', doc: { $Type: 'DomainModels$DomainModel', Entities: [3, entity('Visitor'), entity('HostApproval')], Associations: [3], Annotations: [3] } },
  { n: 8, container: 1, hash: 'm2', doc: { $Type: 'Projects$ModuleImpl', Name: 'Atlas_Core', FromAppStore: true } },
  { n: 9, container: 8, hash: 'pg3', doc: page('Atlas_Default') },
];

function git(dir: string, ...a: string[]) {
  return execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
}

async function appRepo(root: string): Promise<{ dir: string; a: string; b: string }> {
  const dir = path.join(root, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  await project(dir, v1());
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'one');
  const a = git(dir, 'rev-parse', 'HEAD');
  // The second version: the overview page edited, a page added.
  rmSync(path.join(dir, 'mprcontents'), { recursive: true, force: true });
  await project(dir, [...v1().map((u) => (u.n === 3 ? { ...u, hash: 'pg1b', doc: { ...page('Visitor_Overview', 'visitors'), Title: 'Today' } } : u)), { n: 10, container: 2, hash: 'pg4', doc: page('Host_Dashboard', 'host') }]);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'two');
  return { dir, a, b: git(dir, 'rev-parse', 'HEAD') };
}

const labels = (nodes: ExplorerNode[]) => nodes.map((n) => n.label);
type Level = Exclude<Awaited<ReturnType<typeof explorerLevel>>, { error: string }>;
const lvl = async (...a: Parameters<typeof explorerLevel>) => {
  const r = await explorerLevel(...a);
  assert.ok(!('error' in r), JSON.stringify(r));
  return r as Level;
};

test('the business tree from the app at a revision: Pages by part with addresses, Data, Logic, add-ons last, in plain words', async (t) => {
  if (!(await hasSqlite())) return t.skip('no node:sqlite here');
  const root = mkdtempSync(path.join(tmpdir(), 'ao-explorer-biz-'));
  const ctx = { cfg: { dataDir: path.join(root, 'data') } };
  t.after(() => (modelOf(ctx).units.close(), removeDir(root)));
  const { dir, a, b } = await appRepo(root);
  const floor = { id: 'f1', dir } as never;

  const top = await lvl(ctx, floor, a, '');
  assert.deepEqual(labels(top.nodes), ['Pages', 'Data', 'Logic']);
  assert.deepEqual(top.nodes.map((n) => n.count), [3, 1, 2], 'pages, parts with data, logic');
  const parts = await lvl(ctx, floor, a, 'pages');
  assert.deepEqual(labels(parts.nodes), ['Visitor desk', 'Atlas core'], 'the app’s own part first, the Marketplace one after');
  assert.equal(parts.nodes[1].addon, true);
  const pages = await lvl(ctx, floor, a, 'pages/VisitorDesk');
  assert.deepEqual(labels(pages.nodes), ['Visitor new edit', 'Visitor overview']);
  assert.equal(pages.nodes.find((n) => n.qn === 'VisitorDesk.Visitor_Overview')?.url, '/p/visitors');
  assert.equal(pages.nodes.find((n) => n.qn === 'VisitorDesk.Visitor_NewEdit')?.url, undefined, 'needs a record: no address, a preview');
  assert.match(pages.nodes[0].hint ?? '', /preview/);
  const data = await lvl(ctx, floor, a, 'data/VisitorDesk');
  assert.deepEqual(labels(data.nodes), ['Host approval', 'Visitor']);
  assert.equal(data.nodes[0].key, 'domainmodel:VisitorDesk');
  const logic = await lvl(ctx, floor, a, 'logic/VisitorDesk');
  assert.deepEqual(labels(logic.nodes), ['Show badge', 'Visitor commit'], 'conventions’ prefixes left out, engineering words as they are');
  assert.deepEqual(logic.nodes.map((n) => n.hint), ['Logic that runs in the browser', 'Logic that runs on the server'], 'the kind only in the tooltip');
  // At the newer revision: the added page is there; the older revision's answer is unchanged.
  assert.deepEqual(labels((await lvl(ctx, floor, b, 'pages/VisitorDesk')).nodes), ['Host dashboard', 'Visitor new edit', 'Visitor overview']);
  assert.equal((await lvl(ctx, floor, a, 'pages/VisitorDesk')).nodes.length, 2);
  // Unknown levels are refused.
  const bad = await explorerLevel(ctx, floor, a, 'pages/Nope');
  assert.ok('error' in bad && bad.status === 404);
  // What changed from a to b: the edited and the added page, and the files under mprcontents.
  const ch = await explorerChanges(ctx, floor, a, b);
  assert.deepEqual([...ch.docs].sort(), ['page:VisitorDesk.Host_Dashboard', 'page:VisitorDesk.Visitor_Overview']);
  assert.ok(ch.files.some((f) => f.startsWith('mprcontents/')));
});

test('plain labels and page addresses', () => {
  assert.equal(plainName('VisitorDesk.ACT_Visitor_NewEdit'), 'Visitor new edit');
  assert.equal(plainName('HTTPRequestLog'), 'HTTP request log');
  assert.equal(plainName('SUB_Merge_Repo_Model'), 'Merge repo model', 'engineering words stay as they are');
  assert.equal(plainName('DS_GetOpenItems'), 'Get open items');
  assert.equal(pageUrl('visitors'), '/p/visitors');
  assert.equal(pageUrl('/p/visitors'), '/p/visitors');
  assert.equal(pageUrl('visitor/{Id}'), undefined);
  assert.equal(pageUrl('https://elsewhere.test/x'), undefined);
  assert.equal(pageUrl(''), undefined);
});

test('the denylist: never git’s folder, the office’s, env files, keys, credentials, config.json or token files', () => {
  for (const p of ['.git/config', 'a/.git/HEAD', '.agent-office/config.json', '.env', '.env.local', 'web/.env.production', 'certs/server.key', 'certs/server.pem', 'keys/app.pfx', 'credentials.json', 'Credentials', 'config.json', 'deploy/config.json', 'secrets.yaml', 'secret.txt', '.npmrc', '.git-credentials', 'home/.ssh/id_rsa', 'id_ed25519.pub', '.claude/settings.local.json', 'gh-token', 'github-token.txt', 'api.token']) assert.equal(deniedPath(p), true, p);
  for (const p of ['README.md', 'docs/brd/brd.md', 'theme/web/design-tokens.json', 'javasource/Main.java', 'App.mpr', 'environments.md', 'keyboard.png', 'docs/config.md', 'secretary.md']) assert.equal(deniedPath(p), false, p);
});

test('paths are checked: no .., nothing absolute, no backslashes or control characters', () => {
  assert.equal(cleanTreePath(''), '');
  assert.equal(cleanTreePath(undefined), '');
  assert.equal(cleanTreePath('docs/brd/'), 'docs/brd');
  for (const p of ['..', '../x', 'a/../../etc', 'a/./b', '/etc/passwd', 'C:/Windows', 'c:\\x', 'a\\b', '~/x', 'a//b', 'a\u0000b', 'x'.repeat(2000), 5]) assert.equal(cleanTreePath(p), null, String(p).slice(0, 20));
});

test('all files at a revision: the denylist and .gitignore applied, big folders paged, files read-only, bad paths refused', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-explorer-files-'));
  t.after(() => removeDir(root));
  const dir = path.join(root, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  const put = (p: string, body: string | Buffer) => (mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }), writeFileSync(path.join(dir, p), body));
  put('README.md', '# Visitor desk\n');
  put('.gitignore', 'build/\n*.log\n');
  put('.env', 'TOKEN=abc');
  put('config.json', '{"token":"abc"}');
  put('certs/app.key', 'k');
  put('.agent-office/notes.json', '{}');
  put('docs/brd.md', '# BRD');
  put('theme/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  put('App.mpr', Buffer.from([0, 1, 2]));
  put('big.txt', 'x'.repeat(600 * 1024));
  for (let i = 0; i < 700; i++) put(`many/f${String(i).padStart(3, '0')}.txt`, String(i));
  put('build/out.js', 'ignored');
  put('server.log', 'ignored');
  git(dir, 'add', '-A');
  // Committed before the .gitignore would have stopped them: still never shown.
  git(dir, 'add', '-f', 'build/out.js', 'server.log');
  git(dir, 'commit', '-qm', 'one');
  const sha = git(dir, 'rev-parse', 'HEAD');

  const top = await folderAt(dir, sha, '');
  assert.ok(!('error' in top));
  assert.deepEqual(top.nodes.map((n) => n.label), ['docs', 'many', 'theme', '.gitignore', 'App.mpr', 'big.txt', 'README.md']);
  assert.equal(top.nodes.find((n) => n.label === 'many')?.count, 700);
  const many = await folderAt(dir, sha, 'many');
  assert.ok(!('error' in many));
  assert.equal(many.nodes.length, FILES_PAGE);
  assert.equal(many.total, 700);
  assert.equal(many.next, FILES_PAGE);
  const last = await folderAt(dir, sha, 'many/', 600);
  assert.ok(!('error' in last) && last.nodes.length === 100 && last.next === undefined);

  const readme = await fileAt(dir, sha, 'README.md');
  assert.ok(!('error' in readme) && readme.kind === 'text' && readme.text === '# Visitor desk\n');
  const logo = await fileAt(dir, sha, 'theme/logo.png');
  assert.ok(!('error' in logo) && logo.kind === 'image' && logo.data?.startsWith('data:image/png;base64,'));
  const mpr = await fileAt(dir, sha, 'App.mpr');
  assert.ok(!('error' in mpr) && mpr.kind === 'binary' && mpr.text === undefined);
  const big = await fileAt(dir, sha, 'big.txt');
  assert.ok(!('error' in big) && big.kind === 'large' && big.text === undefined);
  for (const p of ['.env', 'config.json', 'certs/app.key', '.agent-office/notes.json', 'build/out.js', 'server.log', '.git/config', 'nope.md']) {
    const r = await fileAt(dir, sha, p);
    assert.ok('error' in r && r.status === 404, p);
  }
  for (const p of ['../outside.txt', '/etc/passwd', 'C:/Windows/win.ini', 'docs/../.env', 'docs\\brd.md']) {
    const r = await fileAt(dir, sha, p);
    assert.ok('error' in r && r.status === 400, p);
    const f = await folderAt(dir, sha, p);
    assert.ok('error' in f && f.status === 400, p);
  }
  for (const p of ['.git', '.agent-office', 'build']) {
    const f = await folderAt(dir, sha, p);
    assert.ok('error' in f && f.status === 404, p);
  }

  // Through the route: signed in only, a full commit id, the same refusals.
  assert.equal(appExplorerRoutes.explorer.auth, 'session');
  const ctx = { cfg: { dataDir: path.join(root, 'data') }, floors: new Map([['f1', { id: 'f1', dir }]]) };
  const call = async (q: string) => {
    let status = 0;
    let body = '';
    const res = { writeHead: (s: number) => (status = s), end: (b: string) => (body = b) };
    const url = new URL(`http://office.test/api/app-explorer/${q}`);
    await appExplorerRoutes.explorer.handle(ctx as never, { req: {} as never, res: res as never, url, path: url.pathname, session: {} as never } as never);
    return { status, body: JSON.parse(body || '{}') as Record<string, unknown> };
  };
  assert.equal((await call(`files?floor=f1&rev=${sha}&path=`)).status, 200);
  assert.equal((await call(`files?floor=f1&rev=HEAD&path=`)).status, 400, 'a full commit id only');
  assert.equal((await call(`files?floor=f1&rev=${sha}&path=..%2F..`)).status, 400);
  assert.equal((await call(`file?floor=f1&rev=${sha}&path=.env`)).status, 404);
  assert.equal((await call(`file?floor=nope&rev=${sha}&path=README.md`)).status, 404);
  const ok = await call(`file?floor=f1&rev=${sha}&path=docs%2Fbrd.md`);
  assert.equal(ok.body.text, '# BRD');
});
