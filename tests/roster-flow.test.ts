// The project team end to end against a fake floor: fake workers instead of Claude sessions (they cost
// money), a stub instead of GitHub. Hiring with fixed names and Playbooks, benching idle Leads with a
// handoff note and re-hiring them fresh, the standup with live and journal reports, the Project Manager's
// decisions, the autonomy level and the cost cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import type { IssueDraft } from '../src/shared/roster/journal.js';
import { Roster } from '../src/server/roster/index.js';
import { floorLedger, floorPause } from '../src/server/roster/pause.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import type { Ledger } from '../src/server/usage.js';

const MIN = 60_000;
// Monday 2026-10-05 09:05 in Singapore.
const MON_0905 = Date.UTC(2026, 9, 5, 1, 5);

class FakeFloor implements TeamFloor {
  id: string;
  name = 'mx-spike';
  dir: string;
  map = new Map<string, WorkerInfo>();
  hires: HireAsk[] = [];
  prompts: { id: string; text: string }[] = [];
  wakes: { id: string; text?: string }[] = [];
  stopped: string[] = [];
  toasts: string[] = [];
  changes = 0;
  roster!: Roster;
  private n = 0;

  constructor(id: string) {
    this.id = id;
    this.dir = mkdtempSync(path.join(os.tmpdir(), 'roster-'));
  }
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk): Promise<WorkerInfo | string> {
    this.hires.push(ask);
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', model: ask.model, deskId: 'd', name: ask.name, color: '#fff', status: 'starting', acked: true, createdBy: ask.by, createdAt: this.roster.deps.now(), prompt: ask.prompt, cols: 80, rows: 24, viewers: [], viewerIds: [] } as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop(id: string) {
    this.stopped.push(id);
    this.map.delete(id);
    this.roster.onWorkerGone(this, id);
  }
  prompt(id: string, text: string) {
    const w = this.map.get(id);
    if (!w || w.status === 'exited' || w.status === 'offline') return 'Worker is not running';
    this.prompts.push({ id, text });
    return undefined;
  }
  wake(id: string, text?: string) {
    const w = this.map.get(id);
    if (!w) return 'No such worker';
    this.wakes.push({ id, text });
    this.set(id, 'starting');
    return undefined;
  }
  rename(id: string, name: string) {
    const w = this.map.get(id);
    if (w) w.name = name;
  }
  cwdOf = (w: WorkerInfo) => path.join(this.dir, '.agent-office', 'worktrees', w.id);
  openPulls = () => [];
  toast = (text: string) => void this.toasts.push(text);
  changed = () => void this.changes++;

  /** The worker's status changes, as the worker manager would report it. */
  set(id: string, status: WorkerStatus, patch: Partial<WorkerInfo> = {}) {
    const w = this.map.get(id)!;
    Object.assign(w, { status, ...patch });
    this.roster.onWorker(this, w);
  }
  /** A worker (or the project) writes to a team journal. */
  journal(team: string, text: string, w?: WorkerInfo) {
    const file = path.join(w ? this.cwdOf(w) : this.dir, 'docs', 'team', `${team}.md`);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, text);
  }
}

function setup(start = MON_0905) {
  const clock = { now: start };
  const issues: IssueDraft[] = [];
  const floor = new FakeFloor(`f${Math.random().toString(36).slice(2, 8)}`);
  const roster = new Roster(
    {
      dataDir: mkdtempSync(path.join(os.tmpdir(), 'roster-data-')),
      floors: () => [floor],
      makeIssue: async (_dir, draft) => {
        issues.push(draft);
        return { number: 100 + issues.length, url: `https://github.com/o/r/issues/${100 + issues.length}` };
      },
      analysis: () => '- 3 recorded runs, 1 merged, $1.20 in all',
      now: () => clock.now,
    },
    0,
  );
  floor.roster = roster;
  return { clock, issues, floor, roster, data: () => roster.data(floor.id) };
}

test('hiring a role uses its fixed name, model and Playbook, and writes the team files into its folder', async () => {
  const { floor, roster, data } = setup();
  writeFileSync(path.join(floor.dir, 'marker'), '');
  mkdirSync(path.join(floor.dir, '.ai-context/skills/mxcli-field-lessons'), { recursive: true });
  writeFileSync(path.join(floor.dir, '.ai-context/skills/mxcli-field-lessons/SKILL.md'), '# lessons\n');
  assert.equal(await roster.members.rename(floor, 'lead-tester', 'Rosalind'), undefined);
  assert.equal(await roster.members.hire(floor, 'lead-tester', 'Keith', undefined, 'Set up e2e'), undefined);
  const ask = floor.hires[0];
  assert.equal(ask.name, 'Rosalind');
  assert.equal(ask.model, 'sonnet');
  assert.match(ask.prompt, /You are Rosalind, the Lead Tester/);
  assert.match(ask.prompt, /\.ai-context\/skills\/team-lead-tester\/SKILL\.md/);
  assert.match(ask.prompt, /Autonomy level 2 \(Guided\)/);
  assert.match(ask.prompt, /first session/);
  assert.match(ask.prompt, /Your task from the Project Manager: Set up e2e/);
  const w = floor.workers()[0];
  const cwd = floor.cwdOf(w);
  const pb = readFileSync(path.join(cwd, '.ai-context/skills/team-lead-tester/SKILL.md'), 'utf8');
  assert.equal(readFileSync(path.join(cwd, '.claude/skills/team-lead-tester/SKILL.md'), 'utf8'), pb);
  assert.match(pb, /^---\nname: team-lead-tester/);
  assert.match(pb, /Autonomy level 2/);
  assert.match(pb, /only the Lead Developer runs `mxcli exec`/);
  assert.match(pb, /mxcli-field-lessons\/SKILL\.md/);
  assert.match(pb, /mxcli brain capture/);
  assert.match(readFileSync(path.join(cwd, '.claude/agents/tester.md'), 'utf8'), /tools: Read, Grep, Glob, Bash, Write, Edit/);
  assert.ok(existsSync(path.join(cwd, 'docs/team/testing.md')));
  assert.equal(data().members['lead-tester'].phase, 'active');
  // Hiring again while it's at work is refused; renaming carries on to the worker.
  assert.match(String(await roster.members.hire(floor, 'lead-tester', 'Keith')), /already at work/);
  roster.members.rename(floor, 'lead-tester', 'Ros');
  assert.equal(w.name, 'Ros');
  assert.match(String(roster.members.rename(floor, 'pm', 'ros')), /already on the team/);
});

test('an idle Lead is benched after the idle minutes: handoff note first, then stopped, then re-hired fresh from it', async () => {
  const { clock, floor, roster, data } = setup();
  roster.members.settings(floor, { idleMinutes: 30, schedule: { enabled: false } });
  await roster.members.hire(floor, 'lead-developer', 'Keith');
  const w = floor.workers()[0];
  floor.set(w.id, 'working');
  floor.set(w.id, 'done');
  clock.now += 29 * MIN;
  roster.tick();
  assert.equal(floor.prompts.length, 0, 'not yet');
  clock.now += MIN;
  roster.tick();
  assert.equal(data().members['lead-developer'].phase, 'benching');
  const ask = floor.prompts.at(-1)!;
  assert.equal(ask.id, w.id);
  assert.match(ask.text, /benching you/);
  assert.match(ask.text, /## 2026-10-05 \d\d:\d\d — Handoff/);
  assert.match(ask.text, /project-lessons\/SKILL\.md/);
  assert.match(ask.text, /mxcli brain capture/);
  // It works on the handoff; the minute's look doesn't stop it meanwhile.
  floor.set(w.id, 'working');
  clock.now += 10 * MIN;
  roster.tick();
  assert.deepEqual(floor.stopped, []);
  floor.journal('development', '\n## 2026-10-05 09:50 — Handoff\n**What I know** Orders module half built.\n**Next steps** Finish OrderLine.\n', w);
  floor.set(w.id, 'done');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(floor.stopped, [w.id]);
  const m = data().members['lead-developer'];
  assert.equal(m.phase, 'benched');
  assert.equal(m.workerId, undefined);
  assert.match(m.handoff!.text, /Orders module half built/);
  assert.equal(roster.view(floor, true).members.find((x) => x.role === 'lead-developer')!.status, 'benched');
  // Re-hired: a new worker, a fresh session primed with the handoff, never a wake/resume.
  await roster.members.hire(floor, 'lead-developer', 'Keith');
  assert.equal(floor.hires.length, 2);
  assert.equal(floor.wakes.length, 0);
  assert.match(floor.hires[1].prompt, /fresh session/);
  assert.match(floor.hires[1].prompt, /Finish OrderLine/);
});

test('a Lead mid-task or waiting on a person is never benched, by the clock or by hand', async () => {
  const { clock, floor, roster, data } = setup();
  roster.members.settings(floor, { schedule: { enabled: false } });
  await roster.members.hire(floor, 'lead-designer', 'Keith');
  const w = floor.workers()[0];
  for (const status of ['working', 'needs_input', 'starting'] as WorkerStatus[]) {
    floor.set(w.id, status);
    clock.now += 3 * 60 * MIN;
    roster.tick();
    assert.equal(data().members['lead-designer'].phase, 'active', status);
    assert.match(String(roster.members.bench(floor, 'lead-designer', 'Keith')), /Can't bench/);
  }
  // Someone has its terminal open: not idle either.
  floor.set(w.id, 'done', { viewers: ['Keith'] });
  clock.now += 3 * 60 * MIN;
  roster.tick();
  assert.equal(data().members['lead-designer'].phase, 'active');
  assert.equal(floor.prompts.length, 0);
  // Asked for its handoff, then it stops on a question: it waits for the person, however long.
  floor.set(w.id, 'done', { viewers: [] });
  assert.equal(roster.members.bench(floor, 'lead-designer', 'Keith'), undefined);
  floor.set(w.id, 'needs_input');
  clock.now += 5 * 60 * MIN;
  roster.tick();
  assert.equal(data().members['lead-designer'].phase, 'benching');
  assert.deepEqual(floor.stopped, []);
});

test('a standup asks the Leads at work, reads the rest from their journals, and hands the page to the PM', async () => {
  const { clock, floor, roster, data, issues } = setup();
  await roster.members.hire(floor, 'pm', 'Keith');
  await roster.members.hire(floor, 'lead-tester', 'Keith');
  await roster.members.hire(floor, 'lead-designer', 'Keith');
  const [pm, tester, designer] = floor.workers();
  for (const w of [pm, tester, designer]) floor.set(w.id, 'done');
  // The Chief Analyst isn't hired: its journal in the project has a standup with proposals.
  floor.journal('analysis', '# Analysis\n\n## 2026-10-02 17:00 — Standup\n### Done\n- BRD v1\n### Proposals\n- [architecture] Split Orders into its own module — it is 60% of the model\n- Track lead time per PR\n');
  const s = roster.standups.run(floor, 'Keith');
  assert.equal(typeof s, 'object');
  if (typeof s === 'string') return;
  assert.deepEqual(s.waiting.sort(), ['lead-designer', 'lead-tester']);
  assert.ok(floor.prompts.some((p) => p.id === tester.id && /Standup 2026-10-05/.test(p.text) && /### Proposals/.test(p.text)));
  assert.ok(!floor.prompts.some((p) => p.id === pm.id), 'the PM runs it, it does not report');
  const analyst = s.reports.find((r) => r.role === 'chief-analyst')!;
  assert.equal(analyst.source, 'journal');
  assert.deepEqual(analyst.done, ['BRD v1']);
  // The tester answers.
  floor.set(tester.id, 'working');
  floor.journal('testing', '\n## 2026-10-05 09:06 — Standup\n### Done\n- 3 unit tests\n### Next\n- e2e checkout\n### Blockers\n- none\n### Proposals\n- [merge] Merge PR #12 — tests green\n', tester);
  floor.set(tester.id, 'done');
  assert.deepEqual(s.waiting, ['lead-designer']);
  assert.equal(s.reports.find((r) => r.role === 'lead-tester')!.source, 'live');
  // The designer never answers: after 20 minutes the page is compiled without it.
  clock.now += 20 * MIN;
  roster.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(s.status, 'compiled');
  assert.match(s.page!, /Lead Tester — /);
  assert.match(s.page!, /- 3 unit tests/);
  // Its page went to the PM's folder, and the PM was asked to summarise and commit it.
  assert.equal(s.savedTo, 'docs/standups/2026-10-05.md');
  assert.ok(existsSync(path.join(floor.cwdOf(pm), 'docs/standups/2026-10-05.md')));
  assert.ok(floor.prompts.some((p) => p.id === pm.id && /Summary/.test(p.text)));
  // At level 2: the architecture change and the merge wait for the Project Manager; the task is the team's (an issue already).
  const props = data().proposals;
  assert.deepEqual(props.map((p) => [p.title, p.status]).sort(), [
    ['Merge PR #12', 'pending'],
    ['Split Orders into its own module', 'pending'],
    ['Track lead time per PR', 'auto'],
  ]);
  assert.deepEqual(issues.map((i) => [i.title, i.labels]), [['Track lead time per PR', ['team:analysis']]]);
  assert.equal(roster.view(floor, true).approvals.filter((a) => a.kind === 'proposal').length, 2);
  // The Project Manager decides.
  const split = props.find((p) => p.title.startsWith('Split'))!;
  const merge = props.find((p) => p.title.startsWith('Merge'))!;
  assert.match(String(await roster.standups.decide(floor, merge.id, 'reject', 'Keith')), /Say why/);
  assert.equal(await roster.standups.decide(floor, split.id, 'approve', 'Keith', 'Go'), undefined);
  assert.equal(await roster.standups.decide(floor, merge.id, 'reject', 'Keith', 'Wait for the design review'), undefined);
  assert.deepEqual(issues.at(-1)!.labels, ['team:analysis']);
  assert.equal(split.status, 'approved');
  assert.equal(split.issue?.number, 102);
  assert.equal(merge.reason, 'Wait for the design review');
  assert.match(String(await roster.standups.decide(floor, split.id, 'reject', 'Keith', 'x')), /Already approved/);
  assert.match(s.page!, /approved by Keith → #102/);
  assert.match(s.page!, /rejected by Keith: Wait for the design review/);
  assert.equal(roster.view(floor, true).approvals.length, 0);
  // The PM hears the outcomes, in one message.
  const before = floor.prompts.length;
  assert.equal(roster.standups.flushPm(floor), true);
  assert.equal(floor.prompts.length, before + 1);
  assert.match(floor.prompts.at(-1)!.text, /APPROVED → issue #102[\s\S]*REJECTED: Wait for the design review/);
  // The next standup doesn't ask the Project Manager about the analyst's same old proposals again.
  clock.now += 60 * MIN;
  const again = roster.standups.run(floor, 'Keith');
  if (typeof again === 'string') return assert.fail(again);
  assert.equal(again.id, '2026-10-05-2');
  assert.equal(data().proposals.filter((p) => p.role === 'chief-analyst').length, 2);
});

test('a dry run records an approval without asking GitHub', async () => {
  const { floor, roster, data, issues } = setup();
  roster.members.settings(floor, { dryRunIssues: true, autonomy: 1 });
  floor.journal('design', '## 2026-10-05 08:00 — Standup\n### Proposals\n- New logo\n');
  const s = roster.standups.run(floor, 'Keith');
  if (typeof s === 'string') return assert.fail(s);
  await new Promise((r) => setImmediate(r));
  const p = data().proposals[0];
  assert.equal(p.status, 'pending', 'level 1: every task needs the Project Manager');
  await roster.standups.decide(floor, p.id, 'approve', 'Keith');
  assert.deepEqual(p.issue, { dryRun: true });
  assert.equal(issues.length, 0);
});

test('the scheduled standup runs at 09:00 on a weekday only when the floor was busy since the last', async () => {
  const { clock, floor, roster, data } = setup(Date.UTC(2026, 9, 5, 0, 55));
  await roster.members.hire(floor, 'lead-tester', 'Keith');
  const w = floor.workers()[0];
  data().lastStandupAt = Date.UTC(2026, 9, 2, 1, 0);
  data().lastActivityAt = Date.UTC(2026, 9, 2, 0, 0);
  floor.set(w.id, 'done');
  clock.now = MON_0905;
  roster.tick();
  assert.equal(data().standups.length, 0, 'no activity since Friday: skipped');
  floor.set(w.id, 'working');
  floor.set(w.id, 'done');
  roster.tick();
  assert.equal(data().standups.length, 1);
  assert.equal(data().standups[0].by, 'schedule');
  clock.now += 2 * MIN;
  floor.set(w.id, 'working');
  roster.tick();
  assert.equal(data().standups.length, 1, 'once per slot');
});

test('a new autonomy level is written into the Playbooks and told to the Leads at work', async () => {
  const { floor, roster } = setup();
  await roster.members.hire(floor, 'lead-designer', 'Keith');
  const w = floor.workers()[0];
  floor.set(w.id, 'done');
  roster.members.settings(floor, { autonomy: 3 });
  assert.match(floor.prompts.at(-1)!.text, /Autonomy level 3 \(Delegated\)/);
  assert.match(readFileSync(path.join(floor.cwdOf(w), '.ai-context/skills/team-lead-designer/SKILL.md'), 'utf8'), /Autonomy level 3 \(Delegated\)/);
});

test("the floor's daily cost cap at its level pauses hiring there, and lifts the next day", async () => {
  const { clock, floor, roster } = setup();
  roster.members.settings(floor, { costCaps: { 2: 1, 3: 50 } });
  await roster.members.hire(floor, 'lead-tester', 'Keith');
  const w = floor.workers()[0];
  floor.set(w.id, 'working', { usage: { cost: 0.4 } as WorkerInfo['usage'] });
  assert.equal(floorPause(floor.id), undefined);
  floor.set(w.id, 'done', { usage: { cost: 1.2 } as WorkerInfo['usage'] });
  assert.match(String(floorPause(floor.id)), /\$1\.00 daily team cap/);
  assert.match(String(await roster.members.hire(floor, 'pm', 'Keith')), /daily team cap/);
  const v = roster.view(floor, true);
  assert.equal(v.spentToday, 1.2);
  assert.ok(v.approvals.some((a) => a.kind === 'cap'));
  // Every way of hiring on the floor sees it through its ledger; the office's own budget still counts too.
  const ledger = floorLedger({ hiringPaused: undefined, overBudget: false } as unknown as Ledger, floor.id);
  assert.match(String(ledger.hiringPaused), /daily team cap/);
  // A more autonomous level with a looser cap: hiring again.
  roster.members.settings(floor, { autonomy: 3 });
  assert.equal(floorPause(floor.id), undefined);
  roster.members.settings(floor, { autonomy: 2 });
  assert.ok(floorPause(floor.id));
  // Tomorrow, in Singapore.
  clock.now += 24 * 60 * MIN;
  roster.tick();
  assert.equal(floorPause(floor.id), undefined);
  floor.set(w.id, 'working', { usage: { cost: 1.5 } as WorkerInfo['usage'] });
  assert.equal(roster.view(floor, true).spentToday, 0.3);
});
