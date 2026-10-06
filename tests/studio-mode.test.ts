// Studio mode (server/studio/watch.ts, detect.ts, guard.ts and bin/studio-guard.js): seeing Studio Pro
// open on a floor's project from the process list and the lock, the transitions it makes and keeps,
// and the agents' PreToolUse guard that holds their mxcli writes meanwhile. Nothing here looks at
// the real machine's processes or starts Studio Pro: the machine is a stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import path from 'node:path';
import { DEFAULT_STUDIO_MCP_URL, lockOwner, namesProject, parseCimProcesses, parseTasklist, sightFloor, studioMcpUrl, studioProcesses, type DetectDeps, type StudioProcess } from '../src/server/studio/detect.js';
import { StudioWatch, markerPath, modelChanges, statePath, type StudioFloor, type WatchDeps } from '../src/server/studio/watch.js';
import { officeStudio, studioGuardHook } from '../src/server/studio/guard.js';
import { AuditLog, useAudit } from '../src/server/audit/index.js';
import type { AuditEvent, AuditInput } from '../src/shared/audit.js';
import { hasStudioMcp, type StudioState } from '../src/shared/studio.js';
import { collectNeeds } from '../src/client/ui/needsyou/logic.js';
// @ts-expect-error plain JS, no types
import { decide, denyReason, findMarker, lineWrite, mdlWrites, mxcliWrite, readMarker, simpleCommands } from '../bin/studio-guard.js';

const MPR = 'C:\\Users\\Pat Smith\\My Projects\\Shop App\\Shop App.mpr';
const EXE = '"C:\\Program Files\\Mendix\\11.12.4\\modeler\\studiopro.exe"';

// ---- Detection: parsing and matching --------------------------------------------------------

test('tasklist CSV gives the studiopro.exe ids, and "no tasks" gives none', () => {
  assert.deepEqual(parseTasklist('INFO: No tasks are running which match the specified criteria.\r\n'), []);
  assert.deepEqual(parseTasklist('"studiopro.exe","4242","Console","1","812,004 K"\r\n"StudioPro.exe","77","Console","1","1 K"\r\n'), [4242, 77]);
  assert.deepEqual(parseTasklist('"node.exe","1","Console","1","1 K"'), []);
});

test("PowerShell's Win32_Process JSON: one process is an object, more a list, and a missing command line is empty", () => {
  assert.deepEqual(parseCimProcesses(`{"ProcessId":12,"CommandLine":"${EXE.replace(/\\/g, '\\\\').replace(/"/g, '\\"')} \\"C:\\\\x\\\\A.mpr\\""}`), [{ pid: 12, cmd: `${EXE} "C:\\x\\A.mpr"` }]);
  assert.deepEqual(parseCimProcesses('[{"ProcessId":1,"CommandLine":null},{"ProcessId":2,"CommandLine":"a"}]'), [
    { pid: 1, cmd: '' },
    { pid: 2, cmd: 'a' },
  ]);
  assert.deepEqual(parseCimProcesses(''), []);
  assert.deepEqual(parseCimProcesses('not json'), []);
});

test('a command line names the project: the .mpr or its folder, any case, either slash, spaces and all', () => {
  assert.ok(namesProject(`${EXE} "${MPR}"`, MPR), 'quoted, as Studio Pro gets it');
  assert.ok(namesProject(`${EXE} "c:/users/pat smith/my projects/shop app/SHOP APP.MPR"`, MPR), 'other case and slashes');
  assert.ok(namesProject(`${EXE} --file "${MPR}"`, MPR), 'behind a flag');
  assert.ok(namesProject(`${EXE} "C:\\Users\\Pat Smith\\My Projects\\Shop App"`, MPR), 'the folder');
  assert.ok(namesProject(`${EXE} C:\\\\Users\\\\Pat Smith\\\\My Projects\\\\Shop App\\\\Shop App.mpr`, MPR), 'doubled backslashes');
  assert.ok(!namesProject(`${EXE} "C:\\Users\\Pat Smith\\My Projects\\Shop App 2\\Shop App 2.mpr"`, MPR), 'a project whose folder starts the same');
  assert.ok(!namesProject(`${EXE} "C:\\Users\\Pat Smith\\My Projects\\Shop App\\Shop App.mpr.bak"`, MPR), 'a file named after it');
  assert.ok(!namesProject(EXE, MPR), 'no project at all');
  assert.ok(!namesProject('', MPR));
});

test("a floor is open by its process, or by its lock's owner still running; a lock whose Studio Pro is gone is stale", () => {
  const named: StudioProcess = { pid: 10, cmd: `${EXE} "${MPR}"` };
  const loose: StudioProcess = { pid: 11, cmd: EXE };
  const other: StudioProcess = { pid: 12, cmd: `${EXE} "C:\\Other\\Other.mpr"` };
  // What Studio Pro writes in <app>.mpr.lock (and leaves behind when it closes).
  const lockBy = (pid: number) => JSON.stringify({ SessionId: 'b74a8af9-ce2b-408f-ac44-b6c173ec5db8', ProcessId: pid });
  assert.equal(lockOwner(lockBy(38256)), 38256);
  assert.equal(lockOwner('garbage'), undefined);
  assert.deepEqual(sightFloor(MPR, undefined, [named]), { open: true, pid: 10, via: 'process', staleLock: false });
  assert.deepEqual(sightFloor(MPR, lockBy(11), [other, loose]), { open: true, pid: 11, via: 'lock', staleLock: false }, 'the lock names its Studio Pro');
  assert.deepEqual(sightFloor(MPR, lockBy(12), [other]), { open: true, pid: 12, via: 'lock', staleLock: false }, 'even one whose command line names another project');
  assert.deepEqual(sightFloor(MPR, lockBy(999), [loose]), { open: false, staleLock: true }, "the lock's Studio Pro is gone: stale, whatever else runs");
  assert.deepEqual(sightFloor(MPR, lockBy(999), []), { open: false, staleLock: true });
  assert.deepEqual(sightFloor(MPR, '', [other, loose]), { open: true, pid: 11, via: 'lock', staleLock: false }, "a lock that can't be read: a Studio Pro naming no project");
  assert.deepEqual(sightFloor(MPR, '', [other]), { open: false, staleLock: false }, "an unreadable lock and another project's Studio Pro: not ours, not stale either");
  assert.deepEqual(sightFloor(MPR, '', []), { open: false, staleLock: true });
  assert.deepEqual(sightFloor(MPR, undefined, [loose]), { open: false, staleLock: false }, 'no lock, no name: Studio Pro on something else');
});

test("Studio Pro's MCP server: port 7782 by default, a port or a whole URL from the environment, and only from 11.10", () => {
  assert.equal(studioMcpUrl({}), DEFAULT_STUDIO_MCP_URL);
  assert.equal(studioMcpUrl({ AGENT_OFFICE_STUDIO_MCP_PORT: '7790' }), 'http://localhost:7790/mcp');
  assert.equal(studioMcpUrl({ AGENT_OFFICE_STUDIO_MCP_PORT: 'nope' }), DEFAULT_STUDIO_MCP_URL);
  assert.equal(studioMcpUrl({ AGENT_OFFICE_STUDIO_MCP_URL: 'http://127.0.0.1:9000/mcp/' }), 'http://127.0.0.1:9000/mcp');
  assert.ok(hasStudioMcp('11.10.0') && hasStudioMcp('11.12.4') && hasStudioMcp('12.0.0'));
  assert.ok(!hasStudioMcp('11.9.1') && !hasStudioMcp('10.24.3') && !hasStudioMcp(undefined));
});

test('command lines are asked for only when a new studiopro.exe shows up', async () => {
  let pids = [5];
  const asked: number[][] = [];
  const d: DetectDeps = { platform: 'win32', pids: async () => pids, commandLines: async (p) => (asked.push(p), p.map((pid) => ({ pid, cmd: `cmd-${pid}` }))), answers: async () => false };
  const known = new Map<number, string>();
  assert.deepEqual(await studioProcesses(d, known), [{ pid: 5, cmd: 'cmd-5' }]);
  await studioProcesses(d, known);
  assert.equal(asked.length, 1, 'same process: nothing asked');
  pids = [5, 6];
  assert.deepEqual(await studioProcesses(d, known), [
    { pid: 5, cmd: 'cmd-5' },
    { pid: 6, cmd: 'cmd-6' },
  ]);
  pids = [];
  assert.deepEqual(await studioProcesses(d, known), []);
  assert.equal(known.size, 0, 'closed ones are forgotten');
});

// ---- Transitions, persistence, the marker ---------------------------------------------------

test('model changes in git status: the .mpr and mprcontents/, renamed and quoted ones too, not the lock or other files', () => {
  const out = [' M App.mpr', '?? mprcontents/ab/cd/x.mxunit', 'R  old.txt -> "My App/mprcontents/y.mxunit"', '?? App.mpr.lock', ' M src/readme.md', '?? App.mpr.bak'].join('\n');
  assert.deepEqual(modelChanges(out), ['App.mpr', 'mprcontents/ab/cd/x.mxunit', 'My App/mprcontents/y.mxunit']);
  assert.deepEqual(modelChanges(''), []);
});

function world(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'studio-mode-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const mpr = path.join(dir, 'Shop App.mpr');
  writeFileSync(mpr, '');
  const floor: StudioFloor = { id: 'shop', dir, def: { name: 'Shop' } };
  const m = {
    now: 1_000_000,
    procs: [] as StudioProcess[],
    lock: undefined as string | undefined,
    mcp: false,
    git: '',
    version: '11.12.4' as string | undefined,
    audits: [] as AuditInput[],
    chatter: [] as string[],
    toasts: [] as string[],
    states: [] as StudioState[],
  };
  const deps = (): WatchDeps => ({
    now: () => m.now,
    detect: { platform: 'win32', pids: async () => m.procs.map((p) => p.pid), commandLines: async () => m.procs, answers: async () => m.mcp },
    readLock: (p) => (p === `${mpr}.lock` ? m.lock : undefined),
    findMpr: () => mpr,
    readVersion: () => m.version,
    gitStatus: async () => m.git,
    mcpUrl: DEFAULT_STUDIO_MCP_URL,
    sink: {
      state: (_f, s) => m.states.push(s),
      audit: (e) => m.audits.push(e),
      chatter: (_f, d) => m.chatter.push(d.text),
      toast: (_f, text) => m.toasts.push(text),
    },
  });
  return { dir, mpr, floor, m, deps };
}

test('Studio Pro opening and closing: marker, audit, chatter, state, and the uncommitted changes it left', async (t) => {
  const { dir, mpr, floor, m, deps } = world(t);
  const w = new StudioWatch(deps());
  await w.poll([floor]);
  assert.equal(w.stateOf('shop')?.open, false);
  assert.ok(!existsSync(markerPath(dir)));
  assert.equal(m.audits.length, 0, 'closed from the start: nothing to say');

  m.now += 4000;
  m.procs = [{ pid: 4242, cmd: `${EXE} "${mpr}"` }];
  m.mcp = true;
  await w.poll([floor]);
  const open = w.stateOf('shop')!;
  assert.deepEqual(open, { floor: 'shop', open: true, since: m.now, pid: 4242, via: 'process', mcp: { url: DEFAULT_STUDIO_MCP_URL, available: true } });
  assert.deepEqual(m.audits.map((a) => a.action), ['studio.opened']);
  assert.deepEqual(m.chatter, ['Studio Pro is open on Shop App — mxcli writes paused']);
  const marker = JSON.parse(readFileSync(markerPath(dir), 'utf8'));
  assert.deepEqual(marker, { floor: 'shop', app: 'Shop App', mpr, since: m.now, pid: 4242, mcp: DEFAULT_STUDIO_MCP_URL });
  assert.equal(m.states.length, 1);

  m.now += 4000;
  await w.poll([floor]);
  assert.equal(m.states.length, 1, 'nothing changed: nothing sent');

  m.now += 60_000;
  m.procs = [];
  m.git = ' M Shop App.mpr\n?? mprcontents/a/b.mxunit\n';
  await w.poll([floor]);
  const closed = w.stateOf('shop')!;
  assert.equal(closed.open, false);
  assert.deepEqual(closed.uncommitted, { since: m.now, files: 2 });
  assert.ok(!existsSync(markerPath(dir)), 'the marker goes with it');
  assert.deepEqual(m.audits.map((a) => a.action), ['studio.opened', 'studio.closed']);
  assert.equal(m.audits[1].details?.openFor, 64_000);
  assert.match(m.chatter[1], /^Studio Pro closed — mxcli writes allowed again\. Project Manager: commit your Studio Pro changes/);
  assert.match(m.toasts.at(-1)!, /Commit your Studio Pro changes so the agents build on them/i);

  // The Needs you strip shows it to the Project Manager…
  const needs = collectNeeds({ floor: 'shop', workers: [], pulls: [], floors: [], studio: closed });
  assert.deepEqual(
    needs.map((n) => [n.kind, n.text]),
    [['studio', 'Commit your Studio Pro changes so the agents build on them (2 model files changed)']],
  );
  // …until git says they're committed (asked again at most every 30 s).
  m.git = '';
  m.now += 10_000;
  await w.poll([floor]);
  assert.ok(w.stateOf('shop')?.uncommitted, 'not asked again yet');
  m.now += 30_000;
  await w.poll([floor]);
  assert.equal(w.stateOf('shop')?.uncommitted, undefined);
  assert.equal(collectNeeds({ floor: 'shop', workers: [], pulls: [], floors: [], studio: w.stateOf('shop') }).length, 0);

  const kept = JSON.parse(readFileSync(statePath(dir), 'utf8'));
  assert.deepEqual(
    kept.history.map((h: { event: string }) => h.event),
    ['opened', 'closed'],
  );
});

test('a restart picks up where it was: still open keeps its since, closed while away is said once', async (t) => {
  const { dir, mpr, floor, m, deps } = world(t);
  m.procs = [{ pid: 7, cmd: `${EXE} "${mpr}"` }];
  await new StudioWatch(deps()).poll([floor]);
  const since = m.now;
  rmSync(markerPath(dir));

  // Restarted, Studio Pro still open: no new "opened", and the marker is put back.
  m.now += 100_000;
  const again = new StudioWatch(deps());
  await again.poll([floor]);
  assert.equal(again.stateOf('shop')?.since, since);
  assert.deepEqual(m.audits.map((a) => a.action), ['studio.opened']);
  assert.ok(existsSync(markerPath(dir)), 'the marker is put right on the first look');

  // Restarted after Studio Pro closed while the office was away: one "closed".
  m.procs = [];
  m.now += 100_000;
  const third = new StudioWatch(deps());
  await third.poll([floor]);
  assert.deepEqual(m.audits.map((a) => a.action), ['studio.opened', 'studio.closed']);
  assert.ok(!existsSync(markerPath(dir)));
  assert.deepEqual(
    third.historyOf('shop').map((h) => h.event),
    ['opened', 'closed'],
  );
});

test('a lock with no Studio Pro is a stale lock: said once, never a marker; a Studio Pro from its start page with the lock is open', async (t) => {
  const { dir, floor, m, deps } = world(t);
  m.version = '11.6.4';
  const w = new StudioWatch(deps());
  m.lock = JSON.stringify({ SessionId: 'x', ProcessId: 9 });
  await w.poll([floor]);
  assert.deepEqual(w.stateOf('shop'), { floor: 'shop', open: false, since: m.now, staleLock: { since: m.now } });
  assert.deepEqual(m.audits.map((a) => [a.action, a.severity]), [['studio.stale-lock', 'warning']]);
  assert.ok(!existsSync(markerPath(dir)));
  await w.poll([floor]);
  assert.equal(m.audits.length, 1);

  m.procs = [{ pid: 9, cmd: EXE }];
  await w.poll([floor]);
  const s = w.stateOf('shop')!;
  assert.equal(s.open, true);
  assert.equal(s.via, 'lock');
  assert.equal(s.staleLock, undefined);
  assert.equal(s.mcp, undefined, 'no MCP server before 11.10');
  assert.ok(existsSync(markerPath(dir)));

  // It closes and leaves its lock behind, as Studio Pro does: closed, and a stale lock said quietly.
  m.procs = [];
  await w.poll([floor]);
  assert.equal(w.stateOf('shop')?.open, false);
  assert.ok(w.stateOf('shop')?.staleLock);
  assert.deepEqual(m.audits.map((a) => [a.action, a.severity]), [['studio.stale-lock', 'warning'], ['studio.opened', 'notice'], ['studio.closed', 'notice'], ['studio.stale-lock', 'info']]);
  assert.ok(!existsSync(markerPath(dir)));
});

test('floors without an .mpr cost nothing: no process list is asked for', async () => {
  let asked = 0;
  const w = new StudioWatch({
    now: () => 1,
    detect: { platform: 'win32', pids: async () => (asked++, []), commandLines: async () => [], answers: async () => false },
    readLock: () => undefined,
    findMpr: () => undefined,
    readVersion: () => undefined,
    gitStatus: async () => '',
    mcpUrl: DEFAULT_STUDIO_MCP_URL,
    sink: { state: () => undefined, audit: () => undefined, chatter: () => undefined, toast: () => undefined },
  });
  await w.poll([{ id: 'web', dir: tmpdir(), def: { name: 'Web' } }]);
  assert.equal(asked, 0);
  assert.equal(w.stateOf('web')?.open, false);
});

// ---- The guard: which commands write the model ----------------------------------------------

test('shell words: quotes, escapes, and ; && | ( ) $( ) and newlines between commands', () => {
  assert.deepEqual(simpleCommands(`cd "my dir" && mxcli -c 'list entities; show pages' | tee out; echo "a\\"b"`), [['cd', 'my dir'], ['mxcli', '-c', 'list entities; show pages'], ['tee', 'out'], ['echo', 'a"b']]);
  assert.deepEqual(simpleCommands('x=$(mxcli exec a.mdl)\nls'), [['x='], ['mxcli', 'exec', 'a.mdl'], ['ls']]);
});

test('mxcli: exec, fix, layout, rename, widget sync, theme switcher install, a writing -c and the REPL write; reads and --mcp writes go through', () => {
  const writes = [
    'mxcli exec script.mdl',
    './mxcli exec script.mdl --continue-on-error',
    'mxcli -p "My App.mpr" exec x.mdl',
    "'C:\\tools\\mxcli.exe' exec x.mdl",
    'MXCLI_ALLOW_STUDIO_PRO_OPEN=1 mxcli exec x.mdl --force',
    'mxcli fix widgets -p app.mpr',
    'mxcli layout -p app.mpr',
    'mxcli rename -p app.mpr entity A.B C',
    'mxcli widget sync -p app.mpr',
    'mxcli theme switcher install -p app.mpr',
    `mxcli -p app.mpr -c "create entity Shop.Order (Name: String)"`,
    `mxcli -c "connect local 'app.mpr'; list entities; alter entity A.B add attribute C: String"`,
    'mxcli -p app.mpr',
    'mxcli < script.mdl',
    "mxcli -p app.mpr <<'EOF'\ncreate entity Shop.X (A: String);\nEOF",
    'mxcli exec x.mdl > out.log 2>&1',
    'cd app && ./mxcli exec x.mdl',
    'bash -c "mxcli exec x.mdl"',
    'sudo -E env FOO=1 mxcli exec x.mdl',
    'timeout 600 mxcli exec x.mdl',
    'ls *.mdl | xargs mxcli exec',
    './bin/exec.sh scripts/orders.mdl',
    'bash bin/exec.sh --patch fix.py',
    'FORCE_EXEC=1 bin/exec.sh x.mdl',
    './bin/restore-mpr.sh',
    'python3 bin/wf-set-call-captions.py app.mpr',
    'mx update-widgets app.mpr',
  ];
  const reads = [
    'mxcli check script.mdl',
    'mxcli check script.mdl -p app.mpr --references',
    'mxcli lint -p app.mpr',
    'mxcli report -p app.mpr',
    'mxcli show entities -p app.mpr',
    'mxcli describe entity Shop.Order -p app.mpr',
    'mxcli diff -p app.mpr script.mdl',
    'mxcli -p app.mpr -c "list entities"',
    `mxcli -c "connect local 'app.mpr'; describe entity A.B; show pages -- create nothing"`,
    'mxcli exec --help',
    'mxcli --version',
    'mxcli layout --dry-run -p app.mpr',
    'mxcli rename -p app.mpr entity A.B C --dry-run',
    'mxcli widget list',
    'mxcli theme apply signal',
    'mxcli --mcp http://localhost:7782/mcp -p app.mpr exec x.mdl',
    'mxcli exec x.mdl --mcp=http://localhost:7782/mcp',
    'mxcli tui -c',
    'mxcli lint -p app.mpr > lint.txt 2>&1',
    './bin/verify-model.sh',
    'git commit -m "mxcli exec is paused"',
    'echo mxcli exec',
    'grep -r "mxcli exec" docs',
    'cat bin/exec.sh',
    'npm test',
    'mx check app.mpr',
  ];
  for (const c of writes) assert.ok(lineWrite(c), `should hold: ${c}`);
  for (const c of reads) assert.equal(lineWrite(c), undefined, `should let through: ${c}`);
  assert.equal(mxcliWrite(['exec', 'x.mdl']), 'mxcli exec');
  assert.ok(mdlWrites('create module X;'));
  assert.ok(!mdlWrites("/* alter */ list entities; -- drop\nshow pages\n/"));
  assert.ok(!mdlWrites("describe entity A.B where x = 'create ; drop'"));
});

test('the decision: only Bash, only with the marker, and the message names the app and the MCP route when there is one', () => {
  const marker = { floor: 'shop', app: 'Shop App', mpr: MPR, since: 1 };
  const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });
  assert.equal(decide(bash('mxcli exec x.mdl'), undefined), undefined, 'Studio Pro closed');
  assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: 'x.mdl' } }, marker), undefined);
  assert.equal(decide(bash('mxcli check x.mdl'), marker), undefined);
  const d = decide(bash('mxcli exec x.mdl'), marker);
  assert.equal(d.why, 'mxcli exec');
  assert.match(d.reason, /^Studio Pro has Shop App open/);
  assert.match(d.reason, /Don't write to the model with mxcli/);
  assert.match(d.reason, /otherwise work on reviews, tests or docs, or escalate/);
  const viaMcp = denyReason({ ...marker, mcp: 'http://localhost:7782/mcp' }, 'mxcli exec');
  assert.match(viaMcp, /mxcli --mcp http:\/\/localhost:7782\/mcp/);
});

test('the marker is found from the floor, from a worktree inside it, and from a git worktree anywhere else', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'studio-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const floor = path.join(root, 'shop');
  const marker = path.join(floor, '.agent-office', 'studio-open.json');
  mkdirSync(path.join(floor, '.agent-office', 'worktrees', 'ada', 'src'), { recursive: true });
  mkdirSync(path.join(floor, '.git', 'worktrees', 'bob'), { recursive: true });
  writeFileSync(path.join(floor, '.git', 'worktrees', 'bob', 'commondir'), '../..\n');
  const away = path.join(root, 'elsewhere', 'bob');
  mkdirSync(path.join(away, 'app'), { recursive: true });
  writeFileSync(path.join(away, '.git'), `gitdir: ${path.join(floor, '.git', 'worktrees', 'bob')}\n`);
  assert.equal(findMarker(path.join(floor, '.agent-office', 'worktrees', 'ada', 'src')), undefined, 'no marker: Studio Pro closed');
  writeFileSync(marker, JSON.stringify({ floor: 'shop', app: 'Shop', mpr: 'x', since: 1 }));
  assert.equal(findMarker(floor), marker);
  assert.equal(findMarker(path.join(floor, '.agent-office', 'worktrees', 'ada', 'src')), marker);
  assert.equal(findMarker(path.join(away, 'app')), marker, 'through .git → gitdir → commondir');
  assert.equal(findMarker(path.join(root, 'elsewhere')), undefined);
});

test("a marker whose Studio Pro is gone holds nothing (the office went away before it could take it down)", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studio-marker-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = path.join(dir, 'studio-open.json');
  writeFileSync(f, JSON.stringify({ floor: 'shop', app: 'Shop', mpr: 'x', since: 1, pid: 123 }));
  assert.equal(readMarker(f, () => false), undefined);
  assert.equal(readMarker(f, () => true).app, 'Shop');
  writeFileSync(f, JSON.stringify({ floor: 'shop', app: 'Shop', mpr: 'x', since: 1, pid: process.pid }));
  assert.equal(readMarker(f).app, 'Shop', 'a live process (this one)');
  writeFileSync(f, '{broken');
  assert.equal(readMarker(f), undefined);
});

test('the hook: a shell test for the marker before any Node, and the guard denying an mxcli exec end to end', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studio-hook-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = path.join(import.meta.dirname, '..', 'bin', 'studio-guard.js');
  const hook = studioGuardHook(dir, script, '/usr/bin/node')!;
  assert.equal(hook.matcher, 'Bash');
  const fwd = (p: string) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p);
  assert.equal(hook.hooks[0].command, `if [ -f '${fwd(path.join(dir, 'studio-open.json'))}' ]; then '/usr/bin/node' '${fwd(script)}' '${fwd(path.join(dir, 'studio-open.json'))}'; fi`);
  assert.equal(studioGuardHook(dir, ''), undefined, 'no guard script, no hook');

  const marker = path.join(dir, 'studio-open.json');
  writeFileSync(marker, JSON.stringify({ floor: 'shop', app: 'Shop App', mpr: MPR, since: 1, pid: process.pid }));
  const run = (command: string) => spawnSync(process.execPath, [script, marker], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: dir }), encoding: 'utf8', env: { ...process.env, AGENT_OFFICE_HOOK_URL: '' } });
  const denied = run('mxcli exec x.mdl');
  assert.equal(denied.status, 0);
  const out = JSON.parse(denied.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /Studio Pro has Shop App open/);
  const allowed = run('mxcli lint -p app.mpr');
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, '');
});

// ---- The denial in the audit log --------------------------------------------------------------

test("POST /office/studio: the worker's own token, and a studio.denied event under its name", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studio-audit-'));
  const seen: AuditEvent[] = [];
  useAudit(new AuditLog(path.join(dir, 'audit')), (e) => seen.push(e));
  t.after(() => {
    useAudit(undefined);
    rmSync(dir, { recursive: true, force: true });
  });
  const floor = { id: 'shop', def: { name: 'Shop' }, workers: { authenticate: (id: string, token: string) => (id === 'w1' && token === 'tok' ? { id: 'w1', name: 'Ada' } : undefined) } };
  const ctx = { workerFloor: (id: string) => (id === 'w1' ? floor : undefined) };
  const call = async (token: string, body: unknown) => {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    let status = 0;
    const res = { writeHead: (s: number) => ((status = s), res), end: () => undefined, headersSent: false };
    await (officeStudio as (...a: unknown[]) => Promise<void>)(ctx, req, res, new URL('http://127.0.0.1/office/studio?worker=w1'));
    return status;
  };
  assert.equal(await call('wrong', {}), 401);
  assert.equal(seen.length, 0);
  assert.equal(await call('tok', { why: 'mxcli exec', command: 'mxcli exec x.mdl' }), 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].action, 'studio.denied');
  assert.deepEqual(seen[0].actor, { kind: 'agent', name: 'Ada', id: 'w1' });
  assert.equal(seen[0].floor, 'shop');
  assert.deepEqual(seen[0].details, { why: 'mxcli exec', command: 'mxcli exec x.mdl' });
});
