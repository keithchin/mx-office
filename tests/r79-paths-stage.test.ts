// Release 79's fixes outside the agent checks: a Marketplace request whose folder was stored relative is
// resolved against the project's folder (never the office's working directory), a missing folder is said as
// that instead of "git isn't installed", a download the Marketplace refuses names company-private content,
// and the stage the office's own gate-check found survives an office restart. Temp repos and fakes only: no
// Marketplace call, no real token.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveFolder } from '../src/server/marketplace/service.js';
import { placeAndCommit } from '../src/server/marketplace/place.js';
import { download, downloadWhy } from '../src/server/marketplace/download.js';
import { runCommand } from '../src/server/wizard/run.js';
import { GateSource } from '../src/server/wizard/gate-source.js';

test('a request folder stored relative resolves against the project folder, never process.cwd()', () => {
  const project = path.join(tmpdir(), 'proj-x');
  assert.equal(resolveFolder(path.join('.agent-office', 'worktrees', 'pixel-1'), project), path.join(project, '.agent-office', 'worktrees', 'pixel-1'));
  assert.equal(resolveFolder(project, undefined), project);
  assert.equal(resolveFolder('.agent-office/worktrees/x', undefined), undefined);
});

test("a folder that isn't there is said as that, never as git missing", async () => {
  const gone = path.join(tmpdir(), `no-such-folder-${Date.now()}`);
  const r = { rid: 'mkt_1', id: '1', kind: 'widget', floor: 'f', status: 'working', by: { id: 'w', name: 'Rhea' }, folder: gone, at: 0 };
  const placed = await placeAndCommit({}, r as never, 'x.mpk', { kind: 'widget', name: 'W', sha256: 'a'.repeat(64), bytes: 1 } as never);
  assert.equal(placed.ok, false);
  assert.match((placed as { error: string }).error, /folder isn’t there any more/);
  const rel = await placeAndCommit({}, { ...r, folder: '.agent-office/worktrees/x' } as never, 'x.mpk', { kind: 'widget', name: 'W', sha256: 'a'.repeat(64), bytes: 1 } as never);
  assert.match((rel as { error: string }).error, /relative path/);
  // The command runner itself: a start in a missing folder names the folder (git is installed).
  await assert.rejects(runCommand('git', ['--version'], { cwd: gone, timeoutMs: 20_000 }), /the folder it runs in isn't there/);
});

test('a download the Marketplace refuses names company-private content; a refused token is said as that (no Marketplace call)', async () => {
  assert.match(downloadWhy('9001', 'Error: GET /v1/content/9001/versions: 404 Not Found'), /Company-private Marketplace content is only visible to a token whose user belongs to the company that owns it/);
  assert.match(downloadWhy('9001', 'Error: 403 Forbidden'), /item 9001: the Marketplace didn’t show it/);
  assert.match(downloadWhy('9001', 'Error: 401 Unauthorized'), /token was refused/);
  assert.match(downloadWhy('9001', 'Error: disk full'), /^mxcli couldn’t download it: Error: disk full$/);
  const run = async () => ({ code: 1, tail: ['Error: marketplace download (resolve): 404 Not Found'], stdout: '' });
  assert.match(String(await download({ mxcli: 'mxcli', token: 'fake-token', run, cwd: tmpdir() }, '9001', '2.4.1', path.join(tmpdir(), 'x.mpk'))), /private to a company/);
});

test('the stage the office gate-check found survives a restart (kept on disk), marked as of the commit it checked', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'r79-gates-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, stdio: 'pipe' }).toString().trim();
  const origin = path.join(root, 'origin.git');
  g(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const floor = path.join(root, 'floor');
  g(root, 'clone', '-q', origin, floor);
  g(floor, 'checkout', '-q', '-b', 'main');
  writeFileSync(path.join(floor, 'PROJECT.md'), '# P\n\n## Decisions\n\n| Stage | Decision | Status |\n|---|---|---|\n');
  mkdirSync(path.join(floor, 'docs'));
  g(floor, 'add', '.');
  g(floor, 'commit', '-qm', 'scaffold');
  g(floor, 'push', '-q', 'origin', 'main');
  const keepFile = path.join(root, 'data', 'gate-runs.json');
  const rendered = '<table><tr><td>4</td><td>Build plan</td><td>PASS</td><td>ok</td></tr><tr><td>5</td><td>Build</td><td>MANUAL</td><td>in progress</td></tr></table>';
  const first = new GateSource(async (tmp) => writeFileSync(path.join(tmp, 'index.html'), rendered), { fetch: false, keepFile });
  const info = (await first.read(floor))!.info;
  await first.regenerate(floor, info, true);
  first.stop();
  await new Promise((r) => setTimeout(r, 200));
  // A new office: its gate-check hasn't run (and won't, for this test), yet the stage is the one found before.
  const again = new GateSource(async () => new Promise<void>(() => undefined), { fetch: false, keepFile, throttleMs: 600_000 });
  const read = await again.read(floor);
  again.stop();
  assert.match(read?.files['index.html'] ?? '', /Build/);
  assert.equal(read?.check.source, 'office');
  assert.equal(read?.check.sha, info.sha);
});
