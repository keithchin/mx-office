// Add from Marketplace (src/server/marketplace/, bin/office-marketplace.js, shared/marketplace.ts): an agent's
// request, the office's own download with ITS Mendix token (a fake mxcli here, never the network), the package
// check, placing and committing it in the agent's branch as the office (a real git repository in a temp folder),
// a package file the PM picked (wrong id or version refused), and the test switch's scope: only the office's own
// download, never agents, never GitHub. The token values are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsageError, parseArgs, TOOLS } from '../bin/office-workers.js';
import { formatMarketplace } from '../bin/office-marketplace.js';
import { packageMismatch, readMarketplaceAsk, versionFromFileName, widgetFileName, type MarketplaceRequest } from '../src/shared/marketplace.js';
import { marketplaceCandidates } from '../src/shared/decisions/marketplace.js';
import { readPackage } from '../src/server/marketplace/mpk.js';
import { marketplaceToken } from '../src/server/marketplace/token.js';
import { childEnv, type Run } from '../src/server/marketplace/download.js';
import { MarketplaceService, WAIT_MAX_MS } from '../src/server/marketplace/service.js';
import { runCommand } from '../src/server/wizard/run.js';
import { ALLOW_MENDIX_MARKETPLACE_ENV, ALLOW_CLAUDE_GATEWAY_ENV, ALLOW_TOKEN_ENV, dropTestCredentials, forgetDroppedCredentials, mendixMarketplaceAllowed } from '../src/server/testcreds.js';
import { useTestMode } from '../src/server/testmode.js';
import { withConnections } from '../src/server/connections/env.js';
import { moduleMpk, widgetMpk, zip } from './support/mpk.js';
import { removeDir } from './support/cleanup.js';

const SECRET = 'mx-fake-marketplace-pat-1234567890';
const GH = 'ghp_fakeTokenForTestsOnly000000000000';
const tmp = (p: string) => realpathSync(mkdtempSync(path.join(os.tmpdir(), p)));
const OFFICE = { name: 'Mx Office', email: 'office@agents.mx-office.local' };

test('the command line and the MCP tool: add needs an id and a kind; list; words back', () => {
  const a = parseArgs(['marketplace', 'add', '--id', '235351', '--version', '2.5.1', '--kind', 'widget', '--name', 'com.mendix.widget.web.FileUploader', '--why', 'receipt upload']);
  assert.deepEqual(a, { cmd: 'marketplace', op: 'add', id: '235351', version: '2.5.1', kind: 'widget', name: 'com.mendix.widget.web.FileUploader', why: 'receipt upload' });
  assert.deepEqual(parseArgs(['marketplace', 'list']), { cmd: 'marketplace', op: 'list', json: false });
  assert.throws(() => parseArgs(['marketplace', 'add', '--kind', 'widget']), UsageError);
  assert.throws(() => parseArgs(['marketplace', 'add', '--id', '1', '--kind', 'theme']), UsageError);
  assert.throws(() => parseArgs(['marketplace', 'install', '--id', '1']), UsageError);
  const tool = TOOLS.find((t) => t.name === 'marketplace_add');
  assert.ok(tool, 'an MCP tool');
  assert.match(tool!.description, /never download or install it yourself and never need a Mendix token/);
  assert.match(formatMarketplace({ requests: [{ rid: 'mkt_1', id: '1', kind: 'widget', status: 'added', commit: 'abcdef123', by: 'Rhea' }], canDownload: false }, 'list'), /mkt_1 {2}widget 1 \(latest\) · added · commit abcdef1 · Rhea/);
});

test('the request is checked: id, kind, version, name', () => {
  assert.equal(typeof readMarketplaceAsk({ id: 'abc', kind: 'widget' }), 'string');
  assert.equal(typeof readMarketplaceAsk({ id: '1', kind: 'theme' }), 'string');
  assert.equal(typeof readMarketplaceAsk({ id: '1', kind: 'widget', version: '2.5; rm -rf' }), 'string');
  assert.equal(typeof readMarketplaceAsk({ id: '1', kind: 'widget', name: '../x' }), 'string');
  assert.deepEqual(readMarketplaceAsk({ id: 235351, kind: 'widget', version: '2.5.1' }), { id: '235351', kind: 'widget', version: '2.5.1' });
});

test('a package file is read without unpacking: widget name, version, widget ids; module name; refusals', () => {
  const w = readPackage(widgetMpk(), 'x.mpk');
  assert.ok(typeof w !== 'string');
  assert.deepEqual([w.kind, w.name, w.version, w.widgetIds], ['widget', 'FileUploader', '2.5.1', ['com.example.widget.web.fileuploader.FileUploader']]);
  assert.equal(w.sha256.length, 64);
  assert.equal(widgetFileName(w), 'com.example.widget.web.FileUploader.mpk');
  const m = readPackage(moduleMpk(), 'SampleUtils_1.4.0.mpk');
  assert.ok(typeof m !== 'string');
  assert.deepEqual([m.kind, m.name, m.version, m.versionFrom], ['module', 'SampleUtils', '1.4.0', 'file name']);
  assert.equal((readPackage(moduleMpk(), 'SampleUtils.mpk') as { version?: string }).version, undefined);
  assert.match(String(readPackage(Buffer.from('not a zip at all'), 'x.mpk')), /not a package file/);
  assert.match(String(readPackage(zip({ 'readme.txt': 'hi' }), 'x.mpk')), /no package\.xml/);
  assert.equal(versionFromFileName('Connector-v6.3.0.mpk'), '6.3.0');
  // Matching: the widget id, its package name, or the clientModule name; the version when both say one.
  assert.equal(packageMismatch(w, { kind: 'widget', name: 'com.example.widget.web.FileUploader', version: '2.5.1' }), undefined);
  assert.equal(packageMismatch(w, { kind: 'widget', name: 'FileUploader' }), undefined);
  assert.match(String(packageMismatch(w, { kind: 'widget', name: 'com.example.widget.web.Combobox' })), /not com\.example\.widget\.web\.Combobox/);
  assert.match(String(packageMismatch(w, { kind: 'widget', version: '2.4.1' })), /version 2\.5\.1, and the request is for 2\.4\.1/);
  assert.match(String(packageMismatch(w, { kind: 'module' })), /widget package/);
});

/** A project folder: a git repository with an app on branch dev/receipts. */
function project(t: { after(fn: () => void): void }) {
  const root = tmp('mkt-proj-');
  t.after(() => removeDir(root));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' } }).trim();
  git('init', '-q', '-b', 'main');
  mkdirSync(path.join(root, 'app', 'widgets'), { recursive: true });
  writeFileSync(path.join(root, 'app', 'App.mpr'), 'model');
  writeFileSync(path.join(root, 'app', 'widgets', '.keep'), '');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'dev/receipts');
  // The agent's own half-done, staged work stays out of the office's commit.
  writeFileSync(path.join(root, 'app', 'notes.txt'), 'agent wip');
  git('add', 'app/notes.txt');
  return { root, git };
}

function service(t: { after(fn: () => void): void }, opts: { token?: boolean; pkg?: Buffer } = {}) {
  const data = tmp('mkt-data-');
  t.after(() => removeDir(data));
  const calls: { cmd: string; args: string[]; env: Record<string, string | undefined> }[] = [];
  const audits: string[] = [];
  const told: string[] = [];
  const run: Run = async (cmd, args, o) => {
    calls.push({ cmd, args, env: (o.env ?? {}) as Record<string, string | undefined> });
    if (cmd === 'git') return runCommand(cmd, args, o);
    if (args[1] === 'download') {
      writeFileSync(args[args.indexOf('-o') + 1], opts.pkg ?? widgetMpk());
      return { code: 0, tail: [], stdout: '' };
    }
    if (args[1] === 'info') return { code: 0, tail: [], stdout: JSON.stringify({ name: 'File Uploader', publisher: 'Example Co', license: 'Apache 2.0', latestVersion: '2.5.1' }) };
    if (args[1] === 'install') {
      mkdirSync(path.join(o.cwd, 'javasource', 'sampleutils'), { recursive: true });
      writeFileSync(path.join(o.cwd, 'javasource', 'sampleutils', 'Util.java'), 'class Util {}');
      return { code: 0, tail: [], stdout: '' };
    }
    return { code: 1, tail: ['unexpected'], stdout: '' };
  };
  const s = new MarketplaceService({
    dataDir: data,
    mxcli: () => 'mxcli-fake',
    token: () => (opts.token === false ? { why: 'This is a test office: it holds no Mendix token' } : { token: SECRET }),
    run,
    identity: () => OFFICE,
    tell: (_f, _w, text) => (told.push(text), true),
    audit: (...a) => void audits.push(JSON.stringify(a)),
  });
  return { s, data, calls, audits, told };
}

const AGENT = { id: 'w1', name: 'Rhea' };

test('approve: the office downloads with its own token, checks, commits only the .mpk to the branch as the office; the token is nowhere else', async (t) => {
  const { root, git } = project(t);
  const { s, data, calls, audits, told } = service(t);
  const { request: r } = await s.ask('demo', AGENT, root, 'dev/receipts', { id: '235351', kind: 'widget', version: '2.5.1', name: 'com.example.widget.web.FileUploader', why: 'receipt upload' });
  assert.equal(r.info?.publisher, 'Example Co', 'looked up with the office’s token');
  assert.equal((await s.ask('demo', AGENT, root, 'dev/receipts', { id: '235351', kind: 'widget', version: '2.5.1' })).joined, true, 'asked twice: one card');
  const out = await s.approve('demo', r.rid, 'Pat');
  assert.ok(out.ok, out.ok ? '' : out.error);
  const added = out.request.added!;
  assert.deepEqual(added.files, ['app/widgets/com.example.widget.web.FileUploader.mpk']);
  assert.ok(existsSync(path.join(root, 'app', 'widgets', 'com.example.widget.web.FileUploader.mpk')));
  assert.equal(git('log', '-1', '--format=%an <%ae>|%cn <%ce>|%s'), `${OFFICE.name} <${OFFICE.email}>|${OFFICE.name} <${OFFICE.email}>|Add widget FileUploader 2.5.1 from the Mendix Marketplace (item 235351, sha256 ${added.pkg.sha256.slice(0, 12)})`);
  assert.equal(git('rev-parse', 'HEAD'), added.commit);
  assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'dev/receipts');
  assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n'), ['app/widgets/com.example.widget.web.FileUploader.mpk'], 'only the package');
  assert.match(git('status', '--porcelain'), /^A {2}app\/notes\.txt$/m, 'the agent’s staged work is still staged, not committed');
  // The token went into the mxcli download and info children only, with a home of their own.
  const mx = calls.filter((c) => c.cmd === 'mxcli-fake');
  assert.deepEqual(mx.map((c) => c.args.slice(0, 2).join(' ')), ['marketplace info', 'marketplace download']);
  for (const c of mx) {
    assert.equal(c.env.MENDIX_PAT, SECRET);
    assert.notEqual(c.env.USERPROFILE, os.homedir(), 'not the machine user’s home (no ~/.mxcli login fallback)');
    assert.equal(c.env.GH_TOKEN, undefined);
  }
  for (const c of calls.filter((x) => x.cmd === 'git')) for (const v of Object.values(c.env)) assert.notEqual(v, SECRET, 'git never sees the token');
  const store = readFileSync(path.join(data, 'marketplace', 'demo.json'), 'utf8');
  for (const [where, text] of [['audit', audits.join('\n')], ['agent messages', told.join('\n')], ['the record', store], ['the commit', git('log', '-1', '--format=%B')]] as const) assert.ok(!text.includes(SECRET), `no token in ${where}`);
  assert.match(audits.join('\n'), /marketplace\.added/);
  assert.match(told.at(-1)!, /The office added widget FileUploader 2\.5\.1 .* to your branch dev\/receipts .*mxcli widget init/);
  assert.equal(out.request.status, 'added');
  assert.equal((await s.approve('demo', r.rid, 'Pat')).ok, false, 'not twice');
});

test('no token the office may use: no download, the card says why; a package file still works', async (t) => {
  const { root, git } = project(t);
  const { s, calls } = service(t, { token: false });
  const { request: r } = await s.ask('demo', AGENT, root, 'dev/receipts', { id: '235351', kind: 'widget', version: '2.5.1', name: 'FileUploader' });
  assert.equal(r.info, undefined, 'nothing looked up');
  const v = await s.view('demo', true);
  assert.equal(v.canDownload, false);
  assert.match(String(v.noDownload), /test office/);
  const cards = marketplaceCandidates(v, 'demo');
  assert.equal(cards.length, 1);
  assert.match(cards[0].body.question, /Add widget FileUploader 2\.5\.1 to dev\/receipts\?/);
  assert.ok(cards[0].body.evidence.some((e) => /Licence: not known/.test(e.label)));
  const refused = await s.approve('demo', r.rid, 'Pat');
  assert.equal(refused.ok, false);
  // A package file: the wrong widget and the wrong version are refused before anything is written.
  const wrongId = await s.importFile('demo', r.rid, 'Pat', { bytes: widgetMpk('Combobox', '2.5.1', 'com.example.widget.web.combobox.Combobox'), name: 'Combobox.mpk' });
  assert.ok(!wrongId.ok && /not FileUploader/.test(wrongId.error));
  const wrongVersion = await s.importFile('demo', r.rid, 'Pat', { bytes: widgetMpk('FileUploader', '2.4.1'), name: 'FileUploader.mpk' });
  assert.ok(!wrongVersion.ok && /version 2\.4\.1, and the request is for 2\.5\.1/.test(wrongVersion.error));
  const notMpk = await s.importFile('demo', r.rid, 'Pat', { bytes: Buffer.from('MZ...'), name: 'setup.exe' });
  assert.equal(notMpk.ok, false);
  assert.equal(readdirSync(path.join(root, 'app', 'widgets')).filter((f) => f.endsWith('.mpk')).length, 0, 'nothing placed');
  assert.equal(git('log', '--oneline').split('\n').length, 1, 'nothing committed');
  // The right one, by path on the office's machine.
  const file = path.join(tmp('mkt-dl-'), 'FileUploader.mpk');
  t.after(() => removeDir(path.dirname(file)));
  writeFileSync(file, widgetMpk());
  const ok = await s.importFile('demo', r.rid, 'Pat', { path: file });
  assert.ok(ok.ok, ok.ok ? '' : ok.error);
  assert.equal(ok.request.added?.how, 'file');
  assert.match(git('log', '-1', '--format=%an'), /Mx Office/);
  assert.equal(calls.filter((c) => c.cmd === 'mxcli-fake').length, 0, 'no mxcli call needed a token');
});

test('the branch moved, or decline: nothing changes; decline tells the agent with the PM’s words', async (t) => {
  const { root, git } = project(t);
  const { s, told } = service(t);
  const { request: r } = await s.ask('demo', AGENT, root, 'dev/receipts', { id: '1', kind: 'widget', name: 'FileUploader' });
  git('checkout', '-q', 'main');
  const moved = await s.approve('demo', r.rid, 'Pat');
  assert.ok(!moved.ok && /on main now, not dev\/receipts/.test(moved.error));
  assert.equal((await s.view('demo', true)).requests[0].status, 'failed', 'shown on the card with why');
  const d = await s.decline('demo', r.rid, 'Pat', 'Use the core uploader in a later phase');
  assert.ok(d.ok);
  assert.match(told.at(-1)!, /declined .*Their words: Use the core uploader in a later phase/s);
  assert.equal(marketplaceCandidates(await s.view('demo', true), 'demo').length, 0, 'no card once declined');
});

test('the test switch: only the office’s own download gets the environment’s Mendix token; agents get none, GitHub stays dropped', (t) => {
  // The token rule, by its parts.
  const deps = (env: NodeJS.ProcessEnv, withheld: boolean, connections = () => 'stored-should-not-be-used') => ({ env, withheld: () => withheld, allowed: mendixMarketplaceAllowed, connections });
  assert.match(String((marketplaceToken(deps({ MENDIX_PAT: SECRET }, true)) as { why: string }).why), /test office/);
  let asked = false;
  const on = marketplaceToken(deps({ [ALLOW_MENDIX_MARKETPLACE_ENV]: '1', MENDIX_PAT: SECRET, GH_TOKEN: GH }, true, () => ((asked = true), 'stored')));
  assert.deepEqual(on, { token: SECRET, source: 'test-switch' });
  assert.equal(asked, false, 'Connections’ stored token is never read in a test office');
  assert.match(String((marketplaceToken(deps({ [ALLOW_MENDIX_MARKETPLACE_ENV]: '1' }, true)) as { why: string }).why), /without MENDIX_PAT/);
  assert.deepEqual(marketplaceToken(deps({}, false, () => SECRET)), { token: SECRET, source: 'connections' });
  assert.equal(mendixMarketplaceAllowed({ [ALLOW_TOKEN_ENV]: '1' }), false, 'the GitHub override does not open it');
  assert.equal(mendixMarketplaceAllowed({ [ALLOW_CLAUDE_GATEWAY_ENV]: '1' }), false, 'nor the Claude one');
  // In a running test office with the switch on: GitHub variables still dropped, agents' environment without any Mendix variable.
  const keep = { ...process.env };
  t.after(() => {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
    useTestMode(undefined);
    forgetDroppedCredentials();
  });
  const env: NodeJS.ProcessEnv = { [ALLOW_MENDIX_MARKETPLACE_ENV]: '1', MENDIX_PAT: SECRET, GH_TOKEN: GH, GITHUB_TOKEN: GH, PATH: 'x' };
  assert.equal(dropTestCredentials({ testMode: true, dir: tmp('test-office-mkt-') }, env, () => undefined), true);
  assert.equal(env.GH_TOKEN, undefined, 'GitHub still dropped with the switch on');
  assert.equal(env.GITHUB_TOKEN, undefined);
  useTestMode({ flag: true, agentCmd: 'fake', agentExplicit: true });
  process.env[ALLOW_MENDIX_MARKETPLACE_ENV] = '1';
  process.env.MENDIX_PAT = SECRET;
  delete process.env[ALLOW_TOKEN_ENV];
  const agentEnv = withConnections({ MENDIX_PAT: SECRET, MX_PAT: SECRET, MENDIX_TOKEN: SECRET, PATH: 'x' }, tmp('test-office-floor-'));
  for (const k of ['MENDIX_PAT', 'MX_PAT', 'MENDIX_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) assert.equal(agentEnv[k], undefined, `agents get no ${k}`);
  assert.ok(!Object.values(agentEnv).includes(SECRET), 'the token is nowhere in an agent’s environment');
  assert.deepEqual(marketplaceToken(), { token: SECRET, source: 'test-switch' }, 'the office’s own download may use it');
  // And the office's git/mxcli children start from a scrubbed environment (the token goes in by name, only for the download).
  const child = childEnv(tmp('mkt-home-'), {}, { ...process.env, GH_TOKEN: GH });
  assert.equal(child.MENDIX_PAT, undefined);
  assert.equal(child.GH_TOKEN, undefined);
});

test('the card: a request waiting, the item, version, publisher, licence, who asked and why; no card for one added', () => {
  const r: MarketplaceRequest = { rid: 'mkt_a', floor: 'demo', id: '235351', kind: 'widget', version: '2.5.1', status: 'pending', by: AGENT, folder: 'C:/p', branch: 'dev/receipts', at: 1, why: 'receipt upload', info: { title: 'File Uploader', publisher: 'Example Co', licence: 'Apache 2.0' } };
  const [c] = marketplaceCandidates({ floor: 'demo', admin: true, canDownload: true, requests: [r, { ...r, rid: 'mkt_b', status: 'added' }] }, 'demo');
  assert.equal(c.body.question, 'Add widget File Uploader 2.5.1 to dev/receipts?');
  assert.match(String(c.body.detail), /Rhea asked for it: “receipt upload”/);
  const labels = c.body.evidence.map((e) => e.label).join(' | ');
  assert.match(labels, /Marketplace item 235351 \(File Uploader\) \| Version: 2\.5\.1 \| Publisher: Example Co \| Licence: Apache 2\.0/);
  assert.equal(c.need.kind, 'marketplace');
  assert.doesNotMatch([c.body.question, c.body.detail, c.body.after, c.need.text].join(' '), /floor/i, 'say project, not floor');
});

test('a module: installed with mxcli install --file (no token) only into a clean app, everything it changed committed as the office', async (t) => {
  const { root, git } = project(t);
  const { s, calls, told } = service(t, { token: false });
  const { request: r } = await s.ask('demo', AGENT, root, 'dev/receipts', { id: '42', kind: 'module', version: '1.4.0', name: 'SampleUtils' });
  const file = path.join(tmp('mkt-mod-'), 'SampleUtils_1.4.0.mpk');
  t.after(() => removeDir(path.dirname(file)));
  writeFileSync(file, moduleMpk());
  // A wrong package is refused before anything else.
  const wrong = await s.importFile('demo', r.rid, 'Pat', { bytes: moduleMpk(), name: 'SampleUtils_1.3.0.mpk' });
  assert.ok(!wrong.ok && /version 1\.3\.0 \(by its file name\)/.test(wrong.error));
  // The agent's staged notes.txt is an uncommitted change in the app: not a failure (release 81), it waits, nothing run.
  const dirty = await s.importFile('demo', r.rid, 'Pat', { path: file });
  assert.ok(dirty.ok && dirty.request.status === 'waiting', 'approved, waiting for a clean app');
  assert.match(dirty.request.note ?? '', /uncommitted changes/);
  assert.equal(calls.filter((c) => c.cmd === 'mxcli-fake').length, 0);
  assert.ok(told.some((t) => /Commit your work/.test(t)), 'the agent is told to commit');
  assert.match(marketplaceCandidates({ floor: 'demo', admin: true, canDownload: false, requests: [dirty.request] }, 'demo')[0].need.text, /waiting for Rhea to commit/);
  assert.ok(!(await s.importFile('demo', r.rid, 'Pat', { path: file })).ok, 'approved once: not twice');
  // Still dirty: still waiting.
  await s.retryWaiting(['demo']);
  assert.equal((await s.store.get('demo', r.rid))?.status, 'waiting');
  git('commit', '-qm', 'agent work');
  // Clean now: the minute's retry adds it, the agent is told.
  await s.retryWaiting(['demo']);
  const ok = { request: (await s.store.get('demo', r.rid))! };
  assert.equal(ok.request.status, 'added');
  assert.ok(told.some((t) => /The office added module SampleUtils/.test(t)));
  const install = calls.find((c) => c.args[1] === 'install')!;
  assert.deepEqual(install.args.slice(0, 3), ['marketplace', 'install', '--file']);
  assert.equal(install.env.MENDIX_PAT, undefined, 'a module install needs no token');
  assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n'), ['app/javasource/sampleutils/Util.java']);
  assert.match(git('log', '-1', '--format=%an|%s'), /^Mx Office\|Add module SampleUtils 1\.4\.0/);
});

test('waiting too long fails with why; a corrected re-request closes the failed one; Decline works on a waiting one', async (t) => {
  const { root } = project(t);
  let now = Date.UTC(2026, 9, 28, 9);
  const { s, data } = service(t, { token: false });
  (s as unknown as { deps: { now: () => number } }).deps.now = () => now;
  const file = path.join(tmp('mkt-mod2-'), 'SampleUtils_1.4.0.mpk');
  t.after(() => removeDir(path.dirname(file)));
  writeFileSync(file, moduleMpk());
  const { request: a } = await s.ask('demo', AGENT, root, 'dev/receipts', { id: '42', kind: 'module', version: '1.4.0', name: 'SampleUtils' });
  assert.equal((await s.importFile('demo', a.rid, 'Pat', { path: file })).ok, true);
  assert.ok(existsSync(path.join(data, 'marketplace', 'waiting', a.rid)), 'the checked package is kept while it waits');
  now += WAIT_MAX_MS + 60_000;
  await s.retryWaiting(['demo']);
  const failed = (await s.store.get('demo', a.rid))!;
  assert.equal(failed.status, 'failed');
  assert.match(failed.note ?? '', /still had uncommitted changes after 8 h/);
  assert.ok(!existsSync(path.join(data, 'marketplace', 'waiting', a.rid)), 'its kept package is let go');
  // The agent asks again, corrected (another version of the same item): the failed one is closed as superseded.
  const { request: b } = await s.ask('demo', AGENT, root, 'dev/receipts', { id: '42', kind: 'module', version: '1.4.1', name: 'SampleUtils' });
  const old = (await s.store.get('demo', a.rid))!;
  assert.deepEqual([old.status, old.supersededBy], ['superseded', b.rid]);
  assert.equal(marketplaceCandidates({ floor: 'demo', admin: true, canDownload: false, requests: await s.store.list('demo') }, 'demo').length, 1, 'one card: the new request');
  // Decline on a waiting one: declined, its package let go.
  const f2 = path.join(path.dirname(file), 'SampleUtils_1.4.1.mpk');
  writeFileSync(f2, moduleMpk());
  assert.equal((await s.importFile('demo', b.rid, 'Pat', { path: f2 })).ok, true);
  const d = await s.decline('demo', b.rid, 'Pat', 'Not now');
  assert.ok(d.ok && d.request.status === 'declined');
  assert.ok(!existsSync(path.join(data, 'marketplace', 'waiting', b.rid)));
});
