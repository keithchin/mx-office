// Increment A's accurate-state rules, without a browser: the one Needs-you count (shared/needs-count.ts) for an
// admin and a member, the navigation's closed groups never adding up overlapping counts, why the live preview
// isn't showing the app (a failed build vs stopped vs never started: shared/liveapp/not-running.ts, drawn in the
// Developer view's canvas and docked chat header), and why a business status is unknown with what would make
// it known (shared/business-status.ts UNKNOWN_WHY).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './support/fakedom.js';
import { needsCount, countWords, bannerWords, canAct } from '../src/shared/needs-count.js';
import type { NeedItem } from '../src/shared/needsyou.js';
import { foldedBadge } from '../src/client/ui/portal/nav-logic.js';
import { previewOff, shortReason } from '../src/shared/liveapp/not-running.js';
import { businessStatus, businessChip, summaryOf, unknownLine } from '../src/shared/business-status.js';
import type { LiveAppState } from '../src/shared/protocol/liveapp.js';

const item = (kind: NeedItem['kind'], level: NeedItem['level'] = 'warn'): NeedItem => ({ key: `${kind}-${Math.random()}`, kind, icon: '', text: kind, level, action: 'Go', target: { to: 'approvals' } });
const ITEMS = [item('escalation', 'block'), item('escalation'), item('approval'), item('asking', 'block'), item('finished'), item('fyi', 'info'), item('live', 'info'), item('floor', 'block')];
const FLOORS = [{ id: 'f1', waiting: 2 }, { id: 'f2', waiting: 3 }, { id: 'f3', waiting: 1, cloning: true }, { id: 'f4', waiting: 0 }];

test('the one count: an admin acts on every decision and action here; info rows and other projects never count', () => {
  const c = needsCount(ITEMS, { admin: true, floor: 'f1', floors: FLOORS });
  assert.deepEqual(c, { forYou: 5, forPm: 0, elsewhere: 3, elsewhereProjects: 1, admin: true });
  assert.equal(countWords(c), '5 for you in this project · 3 agents waiting in another project');
  assert.equal(bannerWords(c), '5 waiting on you');
});

test('a member is counted only what they can act on; the rest is said as waiting on the Project Manager', () => {
  const c = needsCount(ITEMS, { admin: false, floor: 'f1', floors: FLOORS });
  assert.deepEqual([c.forYou, c.forPm], [2, 3], 'the agent asking and the finished turn are theirs; escalations and the approval are the PM’s');
  assert.equal(countWords(c), '2 for you in this project · 3 waiting on the Project Manager · 3 agents waiting in another project');
  assert.equal(canAct({ kind: 'escalation' }, false), false);
  assert.equal(canAct({ kind: 'lost' }, false), true);
  const none = needsCount([item('approval')], { admin: false });
  assert.equal(bannerWords(none), '1 waiting on the Project Manager', 'a member with nothing of their own sees whose it is');
  assert.equal(countWords(none), '1 waiting on the Project Manager');
  assert.equal(countWords(needsCount([], { admin: true })), '0 for you in this project');
});

test('a closed group never adds up its tabs’ counts: the Overview’s group shows the one count, the others a dot or “!”', () => {
  const three = { text: '3', kind: 'count' as const };
  const six = { text: '6', kind: 'count' as const };
  assert.deepEqual(foldedBadge([six, three], three), three, 'the Overview’s count, not 9');
  assert.deepEqual(foldedBadge([six], null), { text: '', kind: 'dot' }, 'Overview at 0: a dot for the rest');
  assert.deepEqual(foldedBadge([six, three]), { text: '', kind: 'dot' }, 'a group without the Overview: a dot, not 9');
  assert.deepEqual(foldedBadge([six, { text: '!', kind: 'bang' }]), { text: '!', kind: 'bang' });
  assert.equal(foldedBadge([null, null]), null);
});

const base: LiveAppState = { floor: 'f1', status: 'stopped', log: [], available: true };

test('the preview not running: a failed build names its commit and short reason; stopped and never started say so, never “failed”', () => {
  const failed = previewOff({ ...base, status: 'failed', failure: { kind: 'build', at: 1, why: 'mxcli build: CE1613 The selected attribute no longer exists.\nmore lines', lines: [], sha: '1a2b3c4d5e6f' } })!;
  assert.equal(failed.kind, 'failed');
  assert.equal(failed.line, 'Preview not running: the last build failed at 1a2b3c4: mxcli build: CE1613 The selected attribute no longer exists. (details on the Live app page)');
  assert.equal(failed.short, 'build failed');
  // The target names the commit when the failure doesn't.
  assert.match(previewOff({ ...base, status: 'failed', target: { sha: 'abcdef0123' } as never, failure: { kind: 'build', at: 1, why: 'x', lines: [] } })!.line, /failed at abcdef0: x/);
  assert.match(previewOff({ ...base, status: 'failed', failure: { kind: 'crash', at: 1, why: 'OutOfMemoryError', lines: [], sha: 'ffff0000aa' } })!.line, /^Preview not running: the app stopped by itself at ffff000: OutOfMemoryError/);
  assert.match(previewOff({ ...base, status: 'failed', failure: { kind: 'timeout', at: 1, why: 'no answer on 8080 in 5 minutes', lines: [] } })!.line, /never answered: no answer on 8080/);
  const stopped = previewOff({ ...base, started: true, by: 'Pat', lastServed: { sha: '9999999aaaa', builtAt: 1, until: 2 } as never })!;
  assert.deepEqual([stopped.kind, stopped.line], ['stopped', 'Preview not running: it was stopped by Pat. It last ran 9999999. Start it on the Live app page.']);
  assert.doesNotMatch(stopped.line, /fail/);
  const never = previewOff(base)!;
  assert.deepEqual([never.kind, never.line], ['never', 'Preview not running: the app hasn’t been started yet. Start it on the Live app page.']);
  assert.equal(previewOff({ ...base, lastServed: { sha: '1234567zz', builtAt: 1, until: 2 } as never })!.kind, 'never', 'not started since the office started, though it ran before');
  assert.equal(previewOff({ ...base, available: false })!.kind, 'unavailable');
  assert.equal(previewOff({ ...base, status: 'starting' })!.kind, 'starting');
  assert.equal(previewOff({ ...base, status: 'running', served: { sha: 'a', builtAt: 1 } as never }), undefined, 'serving: nothing to explain');
  assert.equal(previewOff(null)!.kind, 'checking');
  assert.equal(shortReason('x'.repeat(200)).length, 140);
});

test('the Developer view canvas and the docked chat header say the failed build’s reason, not a bare “not running”', async () => {
  installFakeDom();
  const { workspaceCanvas } = await import('../src/client/ui/app-workspace/canvas.js');
  const c = workspaceCanvas({ open: () => {} });
  const d = { floor: 'f1', live: { ...base, status: 'failed', started: true, failure: { kind: 'build', at: 1, why: 'CE1613 attribute gone', lines: [], sha: '1a2b3c4d5e' } }, milestones: [], others: 0, admin: true } as never;
  c.draw(d, 'building' as never);
  assert.match(c.el.textContent ?? '', /Preview not running: the last build failed at 1a2b3c4: CE1613 attribute gone \(details on the Live app page\)/);
  c.draw({ floor: 'f1', live: { ...base, started: true, by: 'Pat' }, milestones: [], others: 0, admin: true } as never, 'building' as never);
  assert.match(c.el.textContent ?? '', /it was stopped by Pat/);
  assert.doesNotMatch(c.el.textContent ?? '', /failed/);
});

test('Status unknown says why and what would make it known, with one action each', () => {
  const s = businessStatus({});
  assert.equal(s.state, 'unknown');
  assert.deepEqual(s.unknown?.map((u) => [u.why, u.action?.tab]), [['main-unread', 'git'], ['never-ran', 'live']]);
  const sum = summaryOf(s);
  assert.equal(sum.unknown?.length, 2, 'Home, the phone and the Teams digest get the reasons too');
  assert.match(unknownLine(sum), /^Why it's unknown: Main's head couldn't be read .*\(Check the folder on Git\); The live app hasn't run .*\(Start the app\)$/);
  assert.match(businessChip(sum).title, /Why it's unknown/);
  // A milestone the build plan doesn't have.
  const m = businessStatus({ milestone: 'phase-9', main: { sha: 'aaaaaaa1' }, live: { running: true, served: 'aaaaaaa1' }, readiness: { sha: 'aaaaaaa1', milestones: [{ id: 'phase-1', title: 'One', state: 'ready', journeys: [], rows: [1], inLive: [1] }] } });
  assert.equal(m.state, 'unknown');
  assert.deepEqual(m.unknown?.map((u) => [u.why, u.action?.tab]), [['no-plan', 'documents']]);
  assert.match(m.unknown![0].text, /phase-9 isn't in the build plan/);
  // Known statuses carry no reasons; main read without the live app is work in progress, not unknown.
  const wip = businessStatus({ main: { sha: 'bbbbbbb2' } });
  assert.equal(wip.state, 'work-in-progress');
  assert.equal(wip.unknown, undefined);
  assert.equal(unknownLine(summaryOf(wip)), '');
});

test('the server reads main from the project folder when the live app never ran: the status is about what is merged, not unknown', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { businessViewOf } = await import('../src/server/business-status/index.js');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'biz-main-'));
  try {
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-b', 'main');
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    git('add', '-A');
    git('commit', '-m', 'one');
    const head = git('rev-parse', 'HEAD');
    const floor = { id: 'biz-main', dir, def: { name: 'Shop' }, workers: { list: () => [] }, github: { pulls: { items: [] } } } as never;
    const ctx = { cfg: { dataDir: path.join(dir, '.data') }, floors: new Map([['biz-main', floor]]) } as never;
    const v = await businessViewOf(ctx, floor);
    assert.equal(v?.project.state, 'work-in-progress');
    assert.equal(v?.project.revision, head);
    assert.match(v?.project.missing[0] ?? '', /hasn't run since the office started/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('“Before you accept”: the enforced gates first with what refuses, then the informational ones, each said as such', async () => {
  installFakeDom();
  const { gatesSection } = await import('../src/client/ui/progress/gates.js');
  const opened: string[] = [];
  const el = gatesSection(
    [
      { id: 'admin', label: 'The Project Manager accepts', enforced: true, state: 'pass', text: 'You are an admin: you can accept' },
      { id: 'security', label: 'Security baseline and mx check at the delivery commit', enforced: true, state: 'fail', text: 'Accepting this delivery needs the project’s security baseline met at 1a2b3c4. Missing: No mx check at 1a2b3c4 yet.', action: { label: 'Open Security', tab: 'security' } },
      { id: 'testing', label: 'Testing policy', enforced: false, state: 'info', text: 'No required check has a result at the delivery commit (recorded, not a refusal)', action: { label: 'Open Testing', tab: 'testing' } },
    ],
    (t) => opened.push(t),
  );
  const text = el.textContent ?? '';
  assert.match(text, /Accept will be refused until this is met/);
  assert.ok(text.indexOf('Enforced by the office') < text.indexOf('Security baseline') && text.indexOf('Security baseline') < text.indexOf('Informational'), 'enforced first, then informational');
  assert.match(text, /Missing: No mx check at 1a2b3c4 yet/);
  const buttons = (el as unknown as { querySelectorAll(s: string): ArrayLike<{ textContent: string; click(): void }> }).querySelectorAll('button');
  assert.deepEqual(Array.from(buttons).map((b) => b.textContent), ['Open Security', 'Open Testing'], 'no action on a gate that passes');
  Array.from(buttons)[0].click();
  assert.deepEqual(opened, ['security']);
});
