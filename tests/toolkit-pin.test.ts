// A project's pinned toolkit (src/server/toolkit-pin/, src/shared/toolkit.ts): the commit classification and
// the Toolkit line, the verdict diff, pointing a project's instruction files at its pin with the ritual's
// `git pull` taken out, the pin worktrees (made, reused, pruned), working out an unpinned project's commit,
// and Update toolkit's preview (with a fake gate-check), update and roll back. Temp git repos only: a fake
// toolkit with a bare origin, and a project with its own bare origin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changeText, classifyCommit, kindsSummary, stageWarning, toolkitLine, verdictDiff, worse } from '../src/shared/toolkit.js';
import { bashForm, pinBlock, pinInstructions, pointAtPin, saysPull, toolkitPaths, withBlock, withoutPull } from '../src/server/toolkit-pin/instructions.js';
import { ensurePin, pinDir, prunePins, commitsIn } from '../src/server/toolkit-pin/pins.js';
import { detect } from '../src/server/toolkit-pin/detect.js';
import { nextRecord, previousOf, recordOf, withAck, withRecord } from '../src/server/toolkit-pin/record.js';
import { ToolkitService } from '../src/server/toolkit-pin/service.js';
import { ToolkitJobs, upgradeCopies } from '../src/server/toolkit-pin/jobs.js';
import { playbook, type PlaybookContext } from '../src/server/roster/playbooks.js';
import { discoveryBrief } from '../src/server/wizard/brief.js';
import { ROLES } from '../src/shared/roster/roles.js';

// ---- pure ----------------------------------------------------------------------------------------

test('commits are classed by their conventional prefix and by touching gate rules', () => {
  assert.deepEqual(classifyCommit('fix(exec.sh): restore names only the errors'), ['fix']);
  assert.deepEqual(classifyCommit('new(bin/context-audit.sh): which files fill the context'), ['new']);
  assert.deepEqual(classifyCommit('feat!: a breaking thing'), ['new']);
  assert.deepEqual(classifyCommit('fix(gate-check): read stage decisions from the Decisions table only'), ['fix', 'gate']);
  assert.deepEqual(classifyCommit('learn(bug-logs): draft entry', ['skills/checkpoints/checkpoint-brd.md']), ['gate']);
  assert.deepEqual(classifyCommit('Windows: root walks never ended'), ['fix']);
  assert.deepEqual(classifyCommit('Merge pull request #1'), ['other']);
  assert.deepEqual(classifyCommit('chore: tidy', ['bin/gate-check.sh']), ['gate']);
  assert.equal(kindsSummary([{ kinds: ['fix'] }, { kinds: ['new'] }, { kinds: ['fix', 'gate'] }]), 'fix/new/gate-rule changes');
  assert.equal(kindsSummary([{ kinds: ['other'] }]), 'other changes');
});

test('the Toolkit line says the commit, its date and what is newer', () => {
  const newer = { count: 3, commits: [], summary: 'fix/new/gate-rule changes' };
  assert.equal(toolkitLine({ state: 'pinned', source: 'record', commit: { sha: '7b4b4cf0123', date: '2026-10-08' }, newer }), 'toolkit 7b4b4cf (2026-10-08) · 3 newer commits available (fix/new/gate-rule changes)');
  assert.equal(toolkitLine({ state: 'pinned', source: 'record', commit: { sha: '7b4b4cf0123' }, newer: { count: 0, commits: [], summary: '' } }), 'toolkit 7b4b4cf · up to date');
  assert.match(toolkitLine({ state: 'detected', source: 'ack', commit: { sha: 'abcdef12' }, newer: { count: 1, commits: [], summary: 'fix changes' } }), /^toolkit ≈ abcdef1 · 1 newer commit available \(fix changes\) · not pinned$/);
  assert.equal(toolkitLine({ state: 'unknown', source: 'none', newer: { count: 0, commits: [], summary: '' } }), 'toolkit version unknown — pin now');
});

test('the preview compares stage verdicts: what changed, which way, and why', () => {
  const before = [
    { id: '0', title: 'Triage', status: 'PASS' },
    { id: '2', title: 'Requirements', status: 'PASS' },
    { id: '3', title: 'Design', status: 'FAIL', detail: 'no wireframes' },
  ];
  const after = [
    { id: '0', title: 'Triage', status: 'PASS' },
    { id: '2', title: 'Requirements', status: 'FAIL', detail: 'BRD drift: 2 rules unsynced' },
    { id: '3', title: 'Design', status: 'PASS' },
    { id: '⟳', title: 'Protocol freshness', status: 'NOTICE' },
  ];
  const d = verdictDiff(before, after);
  assert.deepEqual(d.map((c) => [c.id, c.before, c.after]), [['2', 'PASS', 'FAIL'], ['3', 'FAIL', 'PASS']]);
  assert.equal(changeText(d[0]), 'Stage 2 (Requirements) PASS → FAIL because BRD drift: 2 rules unsynced');
  assert.equal(worse(d[0]), true);
  assert.equal(worse(d[1]), false);
  assert.match(stageWarning({ id: '2', title: 'Requirements', status: 'FAIL' }) ?? '', /in progress/);
  assert.equal(stageWarning({ id: '2', status: 'PENDING' }), undefined);
});

// The ritual as the toolkit's init-project.sh and sync-project.sh write it (2026-10).
const RITUAL = `## Wiring

| Key | Path | Notes |
|---|---|---|
| Toolkit root | \`/c/Users/me/agent-spike/mxcli-project-toolkit\` | The process authority |

## Session-start ritual (before any pipeline work)

1. \`git -C /c/Users/me/agent-spike/mxcli-project-toolkit pull --ff-only\`
2. If \`git -C /c/Users/me/agent-spike/mxcli-project-toolkit branch --show-current\` isn't the clone's default branch
3. \`/c/Users/me/agent-spike/mxcli-project-toolkit/bin/status.sh <project-root> --brief\`

## Session-start ritual (mandatory, before any pipeline work)

1. \`git -C /c/Users/me/agent-spike/mendix-toolkit pull --ff-only\` then \`git -C /c/Users/me/agent-spike/mendix-toolkit rev-parse --short HEAD\`

Read C:\\Users\\me\\agent-spike\\mendix-toolkit\\skills\\conversion-runbook.md and C:/Users/me/agent-spike/mendix-toolkit/agents/x.md.
Not a toolkit: /c/Users/me/agent-spike/mendix-toolkit-old/x and https://github.com/a/b/mxcli-project-toolkit.
T=/c/Users/me/agent-spike/mendix-toolkit; git -C /c/Users/me/agent-spike/mendix-toolkit pull --ff-only
`;

test("a pinned project's instructions name the pin in each spelling, and never say to pull", () => {
  const pin = 'C:\\Users\\me\\agent-spike\\mendix-toolkit-pins\\0123456789ab';
  assert.deepEqual(toolkitPaths(RITUAL).sort(), ['/c/Users/me/agent-spike/mendix-toolkit', '/c/Users/me/agent-spike/mxcli-project-toolkit', 'C:/Users/me/agent-spike/mendix-toolkit', 'C:\\Users\\me\\agent-spike\\mendix-toolkit'].sort());
  const out = withoutPull(pointAtPin(RITUAL, pin), '0123456789abcdef');
  assert.ok(!saysPull(out), out);
  assert.ok(saysPull(RITUAL));
  assert.match(out, /\| Toolkit root \| `\/c\/Users\/me\/agent-spike\/mendix-toolkit-pins\/0123456789ab` \|/);
  assert.match(out, /1\. `git -C \/c\/Users\/me\/agent-spike\/mendix-toolkit-pins\/0123456789ab rev-parse --short HEAD` \(the toolkit is pinned by Agent Office at 0123456/);
  assert.match(out, /C:\\Users\\me\\agent-spike\\mendix-toolkit-pins\\0123456789ab\\skills\\conversion-runbook\.md/);
  assert.match(out, /C:\/Users\/me\/agent-spike\/mendix-toolkit-pins\/0123456789ab\/agents\/x\.md/);
  assert.match(out, /mendix-toolkit-old\/x and https:\/\/github\.com\/a\/b\/mxcli-project-toolkit/, 'other folders and URLs are left alone');
  // Pointing it again (the next update) moves pin to pin.
  const next = pointAtPin(out, 'C:\\Users\\me\\agent-spike\\mendix-toolkit-pins\\fedcba987654');
  assert.ok(!next.includes('0123456789ab'));
  // The block goes in before the first ritual, once.
  const block = pinBlock(pin, '0123456789abcdef', '2026-10-08');
  const once = withBlock(out, block);
  const twice = withBlock(once, pinBlock(pin, 'fedcba9876543210'));
  assert.equal(twice.split('agent-office:toolkit-pin:start').length, 2);
  assert.ok(once.indexOf('Toolkit version (pinned by Agent Office)') < once.indexOf('## Session-start ritual'));
  assert.match(twice, /commit `fedcba9`/);
  assert.ok(!saysPull(twice));
});

test("the team's Playbooks and the Discovery brief name the pin and say not to pull it", () => {
  const ctx: PlaybookContext = { project: 'p', name: 'Ada', level: 2, lessons: 'L.md', names: Object.fromEntries(ROLES.map((r) => [r.id, r.title])) as PlaybookContext['names'], toolkit: { dir: 'C:\\tk-pins\\0123456789ab', sha: '0123456789abcdef' } };
  const text = playbook('chief-analyst' as Parameters<typeof playbook>[0], ctx);
  assert.match(text, /## The toolkit version/);
  assert.match(text, /pinned at `0123456`, a read-only copy at `C:\/tk-pins\/0123456789ab`\. Never `git pull`/);
  assert.ok(!saysPull(text));
  const unpinned = playbook('chief-analyst' as Parameters<typeof playbook>[0], { ...ctx, toolkit: undefined });
  assert.ok(!/## The toolkit version/.test(unpinned));
  const plan = { name: 'x', clients: [], operators: [], roles: [], intake: [], entry: 'greenfield', tier: 'small', description: 'd' } as unknown as Parameters<typeof discoveryBrief>[0];
  assert.match(discoveryBrief(plan, 'C:/tk-pins/0123456789ab', '0123456789abcdef'), /pinned for this project at `0123456`: never `git pull`/);
});

test('the record in agent-office.project.json keeps the other settings and a history to roll back with', () => {
  const r1 = nextRecord(undefined, 'a'.repeat(40), 'Ann', 'create', 'https://x/tk.git', '2026-10-01');
  const r2 = nextRecord(r1, 'b'.repeat(40), 'Ann', 'update', undefined, '2026-10-08');
  const text = withRecord('{"repo":"o/p","clients":["C"]}', r2);
  const back = recordOf(text)!;
  assert.equal(back.commit, 'b'.repeat(40));
  assert.equal(previousOf(back), 'a'.repeat(40));
  assert.equal(back.repo, 'https://x/tk.git');
  assert.deepEqual(JSON.parse(text).clients, ['C']);
  assert.equal(withAck('x\nToolkit commit: 1234567\nExec approval: auto\n', 'abcdef0123'), 'x\nToolkit commit: abcdef0\nExec approval: auto\n');
  assert.equal(recordOf('{"toolkit":{"commit":"nope"}}'), undefined);
});

// ---- git -----------------------------------------------------------------------------------------

interface World {
  root: string;
  toolkit: string;
  origin: string;
  floor: string;
  c: string[];
  g: (cwd: string, ...args: string[]) => string;
  put: (dir: string, file: string, text: string) => void;
}

function world(t: { after(fn: () => void): void }): World {
  const root = mkdtempSync(path.join(tmpdir(), 'office-tkpin-'));
  t.after(() => {
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: path.join(root, 'mendix-toolkit'), stdio: 'ignore' });
    } catch {
      // gone already
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const g = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'pipe' }).toString().trim();
  const put = (dir: string, file: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };
  // The fake toolkit: rules.txt says which stages fail; gate-check here is a Node stand-in (gateCheck below).
  const tkOrigin = path.join(root, 'tk-origin.git');
  g(root, 'init', '-q', '--bare', '-b', 'main', tkOrigin);
  const toolkit = path.join(root, 'mendix-toolkit');
  g(root, 'clone', '-q', tkOrigin, toolkit);
  g(toolkit, 'checkout', '-q', '-b', 'main');
  g(toolkit, 'config', 'core.autocrlf', 'false');
  const c: string[] = [];
  const commit = (msg: string, files: Record<string, string>) => {
    for (const [f, text] of Object.entries(files)) put(toolkit, f, text);
    g(toolkit, 'add', '-A');
    g(toolkit, 'commit', '-qm', msg);
    c.push(g(toolkit, 'rev-parse', 'HEAD'));
  };
  commit('new: the toolkit', { 'bin/gate-check.sh': '#!/bin/sh\n', 'bin/init-project.sh': '#!/bin/sh\n', 'rules.txt': '2=PASS\n', 'project-bin/exec.sh': 'echo v1\n', 'project-bin/_common.sh': 'common v1\n', 'skills/conversion-runbook.md': '# runbook\n' });
  commit('fix(exec.sh): v2', { 'project-bin/exec.sh': 'echo v2\n', 'project-bin/_common.sh': 'common v2\n' });
  g(toolkit, 'push', '-q', 'origin', 'main');
  commit('fix: stricter stage 2', { 'bin/gate-check.sh': '#!/bin/sh\n# stricter\n', 'rules.txt': '2=FAIL\n' });
  commit('new(skills): another skill', { 'skills/another.md': 'x\n' });
  g(toolkit, 'push', '-q', 'origin', 'main');
  // The project: on toolkit c[0] (PROJECT.md's ack, the copied scripts), wired to an old path.
  const origin = path.join(root, 'proj-origin.git');
  g(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const seed = path.join(root, 'seed');
  g(root, 'clone', '-q', origin, seed);
  g(seed, 'checkout', '-q', '-b', 'main');
  put(seed, 'PROJECT.md', `# P\n\nToolkit commit: ${c[0].slice(0, 7)}\n\n## Decisions\n\n| Stage | Decision | Status |\n|---|---|---|\n`);
  put(seed, 'CLAUDE.local.md', `# CLAUDE.local.md\n\n${RITUAL}`);
  put(seed, 'CLAUDE.md', '# Project\n\n<!-- mxtk:wiring:start -->\nsee /c/Users/me/agent-spike/mxcli-project-toolkit/bin/exec-approval.sh\n<!-- mxtk:wiring:end -->\n');
  put(seed, 'bin/exec.sh', 'echo v1\n');
  put(seed, 'bin/_common.sh', 'common v1 hardened by the project\n');
  put(seed, 'agent-office.project.json', '{"repo":"o/p"}\n');
  g(seed, 'add', '-A');
  g(seed, 'commit', '-qm', 'scaffold');
  g(seed, 'push', '-q', 'origin', 'main');
  const floor = path.join(root, 'floor');
  g(root, 'clone', '-q', origin, floor);
  g(floor, 'config', 'user.email', 't@t');
  g(floor, 'config', 'user.name', 't');
  return { root, toolkit, origin, floor, c, g, put };
}

/** gate-check's stand-in: the stage verdicts rules.txt of the toolkit it's run from says, as gate-check's dashboard. */
async function fakeGateCheck(toolkit: string, worktree: string) {
  const rules = readFileSync(path.join(toolkit, 'rules.txt'), 'utf8');
  const two = /2=(\w+)/.exec(rules)?.[1] ?? 'PASS';
  const row = (id: string, title: string, st: string, why: string) => `<tr><td>${id}</td><td>${title}</td><td>${st}</td><td>${why}</td></tr>`;
  writeFileSync(path.join(worktree, 'index.html'), `<table>${row('0', 'Triage', 'PASS', 'signed off')}${row('2', 'Requirements', two, two === 'FAIL' ? 'BRD drift: rules unsynced' : 'ok')}</table>`);
}

const floorOf = (w: World) => ({ id: 'f1', dir: w.floor, name: 'proj' });

async function until(fn: () => boolean, ms = 60_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('a pin is a detached worktree per commit, reused, and pruned when no project needs it', async (t) => {
  const w = world(t);
  const a = await ensurePin(w.toolkit, w.c[0]);
  assert.equal(a, pinDir(w.toolkit, w.c[0]));
  assert.equal(path.basename(path.dirname(a)), 'mendix-toolkit-pins');
  assert.equal(w.g(a, 'rev-parse', 'HEAD'), w.c[0]);
  assert.equal(readFileSync(path.join(a, 'rules.txt'), 'utf8'), '2=PASS\n');
  writeFileSync(path.join(a, 'marker.tmp'), 'x');
  assert.equal(await ensurePin(w.toolkit, w.c[0].slice(0, 10)), a, 'the same commit reuses the folder');
  assert.ok(existsSync(path.join(a, 'marker.tmp')), 'reused, not made again');
  // A pull in a pin fails: its HEAD is detached, so the old ritual can't move it.
  assert.throws(() => w.g(a, 'pull', '--ff-only'));
  assert.equal(w.g(a, 'rev-parse', 'HEAD'), w.c[0]);
  // Someone checked something out in it: made again at the pinned commit.
  w.g(a, 'checkout', '-q', '--detach', w.c[1]);
  assert.equal(w.g(await ensurePin(w.toolkit, w.c[0]), 'rev-parse', 'HEAD'), w.c[0]);
  const b = await ensurePin(w.toolkit, w.c[2]);
  assert.notEqual(a, b);
  assert.deepEqual(await prunePins(w.toolkit, [w.c[2]]), [w.c[0].slice(0, 12)]);
  assert.ok(!existsSync(a) && existsSync(b));
  const commits = await commitsIn(w.toolkit, `${w.c[1]}..${w.c[3]}`);
  assert.deepEqual(commits.map((x) => x.kinds), [['new'], ['fix', 'gate']]);
});

test("an unpinned project's commit is worked out from PROJECT.md's ack, else from its copied scripts", async (t) => {
  const w = world(t);
  const fromAck = await detect(w.toolkit, w.floor, readFileSync(path.join(w.floor, 'PROJECT.md'), 'utf8'));
  assert.deepEqual([fromAck.source, fromAck.sha], ['ack', w.c[0]]);
  const fromScripts = await detect(w.toolkit, w.floor, '# no ack\n');
  assert.equal(fromScripts.source, 'snapshot');
  assert.equal(fromScripts.sha, w.c[0], 'bin/exec.sh is project-bin/exec.sh as c0 had it');
  assert.match(fromScripts.detail ?? '', /1 of 2 copied scripts/);
  w.put(w.floor, 'bin/exec.sh', 'echo v2\n');
  assert.equal((await detect(w.toolkit, w.floor, undefined)).sha, w.c[1]);
  rmSync(path.join(w.floor, 'bin'), { recursive: true, force: true });
  assert.equal((await detect(w.toolkit, w.floor, 'Toolkit commit: deadbee\n')).source, 'none');
});

test('scripts the project never edited are brought up to the new commit; edited ones are left', async (t) => {
  const w = world(t);
  assert.deepEqual(await upgradeCopies(w.toolkit, w.c[0], w.c[1], w.floor), ['exec.sh']);
  assert.equal(readFileSync(path.join(w.floor, 'bin/exec.sh'), 'utf8'), 'echo v2\n');
  assert.match(readFileSync(path.join(w.floor, 'bin/_common.sh'), 'utf8'), /hardened/);
});

test('Update toolkit: the status line, a preview with the verdict diff, the update, and the roll back', async (t) => {
  const w = world(t);
  const svc = new ToolkitService({ root: () => w.toolkit });
  const floor = floorOf(w);
  // Not pinned: detected from the ack.
  let s = await svc.status(floor);
  assert.equal(s.state, 'detected');
  assert.equal(s.commit?.sha, w.c[0]);
  assert.equal(s.newer.count, 3);
  assert.equal(s.newer.summary, 'fix/new/gate-rule changes');
  assert.equal(s.latest?.sha, w.c[3]);
  // Pinned at c1 (as if pinned before).
  svc.setPin(floor, w.c[1]);
  s = await svc.status(floor);
  assert.deepEqual([s.state, s.commit?.sha, s.newer.count], ['pinned', w.c[1], 2]);
  assert.equal(s.runsFrom, pinDir(w.toolkit, w.c[1]));

  const synced: string[] = [];
  const jobs = new ToolkitJobs(svc, {
    gateCheck: (tk, wt) => fakeGateCheck(tk, wt),
    sync: async (tk, dir, _f, log) => {
      synced.push(tk);
      log('sync-project: nothing to do');
      // An older sync-project.sh appends the ritual again, with its own (the pin's) path.
      writeFileSync(path.join(dir, 'CLAUDE.local.md'), `${readFileSync(path.join(dir, 'CLAUDE.local.md'), 'utf8')}\n1. \`git -C ${bashForm(tk)} pull --ff-only\`\n`);
    },
    current: async () => ({ id: '2', title: 'Requirements', status: 'FAIL' }),
  });
  const by = { name: 'Ann' };
  const p = await jobs.preview(floor, 'latest', by);
  assert.ok(typeof p !== 'string', String(p));
  await until(() => jobs.get(p.id)?.status !== 'running');
  const pv = jobs.get(p.id)!;
  assert.equal(pv.status, 'ready', pv.error);
  assert.deepEqual(pv.changes?.map((c) => changeText(c)), ['Stage 2 (Requirements) PASS → FAIL because BRD drift: rules unsynced']);
  assert.deepEqual(pv.commits?.map((c) => c.sha), [w.c[3], w.c[2]]);
  assert.match(pv.stageWarning ?? '', /Stage 2/);
  assert.equal(w.g(w.floor, 'status', '--porcelain'), '', 'the preview wrote nothing in the floor');
  assert.equal(w.g(w.floor, 'worktree', 'list').split('\n').length, 1, 'its worktrees are gone');

  // Confirm: the pin moves, one commit lands on main.
  const a = await jobs.apply(floor, w.c[3], by);
  assert.ok(typeof a !== 'string', String(a));
  await until(() => jobs.get(a.id)?.status !== 'running');
  const done = jobs.get(a.id)!;
  assert.equal(done.status, 'done', `${done.error}\n${done.log.join('\n')}`);
  assert.equal(done.pushed, 'main');
  assert.equal(w.g(w.origin, 'log', '-1', '--format=%s', 'main'), `chore(toolkit): update to ${w.c[3].slice(0, 7)}`);
  const show = (f: string) => w.g(w.origin, 'show', `main:${f}`);
  const pin3 = pinDir(w.toolkit, w.c[3]);
  assert.equal(recordOf(show('agent-office.project.json'))?.commit, w.c[3]);
  assert.equal(JSON.parse(show('agent-office.project.json')).repo, 'o/p');
  assert.match(show('PROJECT.md'), new RegExp(`Toolkit commit: ${w.c[3].slice(0, 7)}`));
  const local = show('CLAUDE.local.md');
  assert.ok(!saysPull(local), local);
  assert.ok(local.includes(bashForm(pin3)), 'the wiring names the new pin');
  assert.match(local, /Toolkit version \(pinned by Agent Office\)/);
  assert.ok(show('CLAUDE.md').includes(`${bashForm(pin3)}/bin/exec-approval.sh`));
  assert.equal(show('bin/exec.sh'), 'echo v1', 'exec.sh: c1 → c3 never changed it, and the project still has c0’s (not the from commit’s): left');
  assert.deepEqual(synced, [pin3, pin3], 'the preview ran the sync in its temporary copy too, then the update');
  assert.equal(svc.book.get('f1')?.commit, w.c[3]);
  assert.equal(svc.book.get('f1')?.previous, w.c[1]);
  assert.equal(w.g(w.floor, 'branch', '--list', 'agent-office/*'), '', 'its branch is gone');
  assert.equal(w.g(w.toolkit, 'rev-parse', 'HEAD'), w.c[3], 'the shared clone was never moved');

  // Roll back: to the previous pin, the same way.
  s = await svc.status(floor);
  assert.deepEqual([s.commit?.sha, s.previous, s.newer.count], [w.c[3], w.c[1], 0]);
  const r = await jobs.apply(floor, w.c[1], by);
  assert.ok(typeof r !== 'string', String(r));
  assert.equal(r.action, 'rollback');
  await until(() => jobs.get(r.id)?.status !== 'running');
  assert.equal(jobs.get(r.id)?.status, 'done', jobs.get(r.id)?.error);
  w.g(w.floor, 'fetch', '-q', 'origin');
  assert.equal(w.g(w.origin, 'log', '-1', '--format=%s', 'main'), `chore(toolkit): roll back to ${w.c[1].slice(0, 7)}`);
  const rec = recordOf(show('agent-office.project.json'))!;
  assert.equal(rec.commit, w.c[1]);
  assert.deepEqual(rec.history?.map((h) => h.action), ['update', 'rollback']);
  assert.ok(show('CLAUDE.local.md').includes(bashForm(pinDir(w.toolkit, w.c[1]))));
  assert.ok(!saysPull(show('CLAUDE.local.md')));
  assert.equal(await jobs.apply(floor, w.c[1], by), `The project is already pinned to ${w.c[1].slice(0, 7)}`);
});

test("pinInstructions leaves a project that's already pointed at its pin as it is", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-tkpin-files-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'CLAUDE.local.md'), RITUAL);
  mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
  writeFileSync(path.join(dir, '.claude', 'agents', 'gate-agent.md'), 'Run /c/Users/me/agent-spike/mendix-toolkit/bin/gate-check.sh\n');
  const o = { pin: 'C:\\x\\mendix-toolkit-pins\\0123456789ab', sha: '0123456789abcdef' };
  assert.deepEqual(pinInstructions(dir, o).sort(), ['.claude/agents/gate-agent.md', 'CLAUDE.local.md']);
  assert.deepEqual(pinInstructions(dir, o), []);
  assert.match(readFileSync(path.join(dir, '.claude', 'agents', 'gate-agent.md'), 'utf8'), /\/c\/x\/mendix-toolkit-pins\/0123456789ab\/bin\/gate-check\.sh/);
});

test("a new project is set up from a pin of the fork's newest commit, records it, and its ritual doesn't pull", async (t) => {
  const w = world(t);
  const init = `#!/bin/sh
P="$1"; T="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$P/bin" "$P/.claude"
echo "# intake" > "$P/intake.md"
printf '# P\n\nToolkit commit: %s\n\n## Decisions\n' "$(git -C "$T" rev-parse --short HEAD)" > "$P/PROJECT.md"
printf '## Session-start ritual\n\n1. \`git -C %s pull --ff-only\`\n' "$T" > "$P/CLAUDE.local.md"
: > "$P/bin/install-project-hooks.sh"; : > "$P/.claude/settings.local.json"; : > "$P/.claude/.doctor-receipt"
`;
  w.put(w.toolkit, 'bin/init-project.sh', init);
  w.g(w.toolkit, 'add', '-A');
  w.g(w.toolkit, 'commit', '-qm', 'new(init): scaffold');
  w.g(w.toolkit, 'push', '-q', 'origin', 'main');
  const tip = w.g(w.toolkit, 'rev-parse', 'HEAD');
  // The shared clone's HEAD stays behind origin: the new project still gets origin's newest.
  w.g(w.toolkit, 'reset', '-q', '--hard', w.c[3]);
  const dir = path.join(w.root, 'newproj');
  mkdirSync(path.join(dir, '.claude'), { recursive: true });
  writeFileSync(path.join(dir, '.claude', 'toolkit.env'), 'MXBUILD_PATH=C:\Mendix\mxbuild.exe\n');
  const { setupSteps } = await import('../src/server/wizard/steps.js');
  const cfg = { toolkitDir: w.toolkit, bash: 'bash', mendixDir: w.root, org: 'o', adminTokenFile: path.join(w.root, 'none') };
  const steps = setupSteps({ cfg, projectsDir: () => w.root, floorOf: () => undefined, addFloor: async () => 'no', adoptFloor: () => 'no', queue: () => 'no', hired: () => false, known: () => false, hire: async () => 'no' } as unknown as Parameters<typeof setupSteps>[0]);
  const job = { id: 'j', dir, by: 'Ann', startedAt: 1, log: [], plan: { owner: 'o', name: 'newproj', description: 'd', clients: [], operators: [], roles: [], entry: 'greenfield', tier: 'small', mendix: '11.6.4', interview: 'steering' } } as unknown as Parameters<(typeof steps)['init']>[0];
  const io = { log: () => undefined };
  await steps.init(job, io);
  assert.equal(job.toolkit?.sha, tip);
  const pin = pinDir(w.toolkit, tip);
  assert.equal(job.toolkit?.dir, pin);
  const local = readFileSync(path.join(dir, 'CLAUDE.local.md'), 'utf8');
  assert.ok(local.includes(bashForm(pin)), local);
  assert.ok(!saysPull(local), local);
  assert.match(readFileSync(path.join(dir, 'PROJECT.md'), 'utf8'), new RegExp(`Toolkit commit: ${tip.slice(0, 7)}`));
  assert.ok(readFileSync(path.join(dir, '.claude', 'toolkit.env'), 'utf8').includes(`MXTK_ROOT=${pin.replace(/\\/g, '/')}`));
  await steps.settings(job, io);
  assert.equal(recordOf(readFileSync(path.join(dir, 'agent-office.project.json'), 'utf8'))?.commit, tip);
  assert.equal(w.g(w.toolkit, 'rev-parse', 'HEAD'), w.c[3], 'the shared clone itself was left where it was');
});

test("without a dashboard, the preview reads the verdicts from gate-check's summary lines", async () => {
  const { verdictsFromOutput } = await import('../src/server/toolkit-pin/jobs.js');
  const out = 'Artifact erd PENDING\nStage P (Kickoff): PASS · Surface MISSING: index.html — all 1 intake questions carry an answer marker [x]\nStage 0 (Triage): FAIL · triage.md has no CONFIRMED decision\nStage 7 (Cutover): WAIVED · Surface not declared\n';
  assert.deepEqual(verdictsFromOutput(out).map((v) => [v.id, v.title, v.status, v.detail]), [
    ['P', 'Kickoff', 'PASS', 'all 1 intake questions carry an answer marker [x]'],
    ['0', 'Triage', 'FAIL', 'triage.md has no CONFIRMED decision'],
    ['7', 'Cutover', 'WAIVED', 'Surface not declared'],
  ]);
});
