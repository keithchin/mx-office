// Skills per agent and the subagent track record, against a fake floor (fake workers, no Claude
// sessions): the default gates per autonomy level, overrides and their revival, the gate the office
// enforces for each mode, what warn / bench / swap-model / reinstate do to the files in a Lead's folder,
// the cool-down, the scorer's thresholds, the nudge about an underperformer, runs from the hooks, and
// the command's arguments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RosterAlert, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import type { AutonomyLevel } from '../src/shared/roster/autonomy.js';
import { ROLES } from '../src/shared/roster/roles.js';
import { cleanOverrides, craftOn, defaultGate, effectiveSkill, effectiveSkills, skillOf, skillsBrief, skillsFor } from '../src/shared/roster/skills.js';
import { gradeOf, scoreSubagent, type SubagentRun } from '../src/shared/roster/subagents.js';
import { Roster } from '../src/server/roster/index.js';
import { NUDGE_GRACE_MS } from '../src/server/roster/nudge.js';
import { playbook } from '../src/server/roster/playbooks.js';
import { reviveRoster } from '../src/server/roster/store.js';
import { subagentReviews } from '../src/server/roster/subagent-store.js';
import { changeSkill } from '../src/server/roster/skills.js';
import { withStanding } from '../src/server/roster/subagent-files.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { parseSubagent } from '../bin/office-subagent.js';
import { UsageError } from '../bin/office-workers.js';

const LEVELS: AutonomyLevel[] = [1, 2, 3, 4];

// ---- The catalogue --------------------------------------------------------------------------------

test('default gates per autonomy level', () => {
  const row = (key: string) => LEVELS.map((l) => defaultGate(skillOf('lead-developer', key)!, l));
  assert.deepEqual(row('bench'), ['ask', 'propose', 'tell', 'fyi']);
  assert.deepEqual(row('warn'), ['propose', 'tell', 'tell', 'fyi']);
  assert.deepEqual(row('swap-model'), ['ask', 'propose', 'tell', 'fyi']);
  assert.deepEqual(row('reinstate'), ['tell', 'tell', 'tell', 'tell']);
  assert.deepEqual(row('dispatch'), ['tell', 'tell', 'tell', 'tell']);
  assert.deepEqual(row('review'), ['tell', 'tell', 'tell', 'tell']);
  assert.deepEqual(row('escalate'), [undefined, undefined, undefined, undefined], 'escalating is always allowed');
});

test('Leads get all three groups; the Coordinator manages up and lists the Leads, never benches them', () => {
  for (const r of ROLES) {
    const keys = skillsFor(r.id).map((s) => s.key);
    assert.ok(['report', 'propose', 'escalate', 'ask-client'].every((k) => keys.includes(k)), r.id);
    assert.equal(keys.filter((k) => k.startsWith('craft:')).length, r.toolkitSkills.length);
    if (r.id === 'pm') {
      assert.ok(keys.includes('nudge-lead') && keys.includes('reassign-lead'));
      assert.ok(!keys.includes('bench') && !keys.includes('warn'));
    } else assert.ok(['dispatch', 'review', 'warn', 'bench', 'swap-model', 'reinstate'].every((k) => keys.includes(k)), r.id);
  }
});

test('overrides change the gate or turn a skill off, survive a level change, and are cleaned and revived', () => {
  const o = cleanOverrides('lead-tester', { bench: { gate: 'tell' }, warn: { enabled: false }, escalate: { gate: 'ask' }, nope: { gate: 'tell' }, swap: 'x', 'swap-model': { gate: 'maybe' } });
  assert.deepEqual(o, { bench: { gate: 'tell' }, warn: { enabled: false } }, 'an ungated skill has no gate; unknown keys and bad gates go');
  for (const l of LEVELS) assert.equal(effectiveSkill('lead-tester', l, 'bench', o)?.gate, 'tell');
  const bench = effectiveSkill('lead-tester', 2, 'bench', o)!;
  assert.equal(bench.defaultGate, 'propose');
  assert.equal(bench.overridden, true);
  assert.equal(effectiveSkill('lead-tester', 2, 'warn', o)?.enabled, false);
  assert.equal(effectiveSkill('lead-tester', 2, 'swap-model', o)?.overridden, false);
  const r = reviveRoster({ members: { 'lead-tester': { name: 'Ada', model: 'sonnet', phase: 'none', skills: { bench: { gate: 'fyi' }, bogus: { enabled: false } } } } });
  assert.deepEqual(r.members['lead-tester'].skills, { bench: { gate: 'fyi' } });
  assert.equal(r.settings.subagentCooldownHours, 24, 'a roster saved before has the 24 h cool-down');
  assert.deepEqual(r.subagents, {});
  assert.deepEqual(reviveRoster({ subagents: { x: { name: 'tester', lead: 'lead-tester', state: 'zzz', runs: [{ at: 5, outcome: 'accept', model: 'haiku' }, { nope: 1 }] }, y: { name: '../evil', lead: 'lead-tester' } } }).subagents, {
    'lead-tester/tester': { name: 'tester', lead: 'lead-tester', state: 'active', warnings: [], runs: [{ id: 'run-5', at: 5, model: 'haiku', outcome: 'accept' }] },
  });
});

test('the Playbook lists the enabled skills with their gate in plain words, and only the craft skills that are on', () => {
  const brief = skillsBrief('lead-developer', 2, { warn: { enabled: false } }).join('\n');
  assert.match(brief, /\*\*Bench a subagent\*\* — you propose it, the Project Manager approves \(in their approvals\) \(`office-workers subagent bench <name> --reason "…"`\)/);
  assert.match(brief, /\*\*Escalate to the Project Manager\*\* — always allowed/);
  assert.match(brief, /Not yours on this project .*: Put a subagent on warning/);
  assert.doesNotMatch(brief, /\*\*Put a subagent on warning\*\*/);
  assert.match(skillsBrief('lead-developer', 4).join('\n'), /\*\*Bench a subagent\*\* — you decide; the Project Manager gets an FYI/);
  assert.match(skillsBrief('lead-developer', 1).join('\n'), /\*\*Bench a subagent\*\* — ask the Project Manager first/);
  const names = Object.fromEntries(ROLES.map((r) => [r.id, r.title])) as Record<(typeof ROLES)[number]['id'], string>;
  const pb = playbook('lead-developer', { project: 'p', name: 'Hedy', level: 2, lessons: 'L.md', names, skills: { 'craft:walking-skeleton': { enabled: false } } });
  assert.match(pb, /## Your skills/);
  assert.doesNotMatch(pb, /walking-skeleton/);
  assert.match(pb, /architecture-blueprint/);
  assert.deepEqual(craftOn('lead-developer', { 'craft:walking-skeleton': { enabled: false } }).includes('walking-skeleton'), false);
});

// ---- The scorer -----------------------------------------------------------------------------------

const runs = (outcomes: string, model = 'sonnet', ci: ('pass' | 'fail' | undefined)[] = []): SubagentRun[] =>
  [...outcomes].map((c, i) => ({ id: `r${i}`, at: i + 1, model, outcome: c === 'a' ? 'accept' : c === 'r' ? 'rework' : c === 'f' ? 'failed' : 'pending', ...(ci[i] ? { ci: ci[i] } : {}) }) as SubagentRun);

test('the scorer grades the last 5 reviewed runs per model, from 3, and flags underperformers', () => {
  assert.deepEqual([95, 90, 89, 80, 79, 70, 69, 60, 59, 0].map(gradeOf), ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'F', 'F']);
  const two = scoreSubagent(runs('aa'), 'sonnet');
  assert.equal(two.grade, undefined, 'fewer than 3 reviewed runs: ungraded');
  assert.equal(two.underperforming, false);
  assert.equal(scoreSubagent(runs('aaaaa'), 'sonnet').grade, 'A');
  assert.equal(scoreSubagent(runs('raaaa'), 'sonnet').grade, 'B');
  assert.equal(scoreSubagent(runs('rraaaaa'), 'sonnet').grade, 'A', 'only the last 5 count');
  assert.equal(scoreSubagent(runs('aaaa?p'), 'sonnet').reviewed, 4, 'pending runs are not reviewed');
  const bad = scoreSubagent(runs('araar'), 'sonnet');
  assert.equal(bad.grade, 'D', '3 of 5: 60%');
  assert.equal(bad.underperforming, true);
  assert.match(bad.why!, /2 reworks in 5 runs/);
  assert.equal(scoreSubagent(runs('rr'), 'sonnet').underperforming, true, '2 reworks flag it even ungraded');
  const d = scoreSubagent(runs('aaaa', 'haiku', [undefined, 'fail', 'fail', 'fail']), 'haiku');
  assert.equal(d.score, 63, 'an accepted run whose PR failed CI counts half');
  assert.equal(d.underperforming, true, 'below C');
  assert.equal(scoreSubagent(runs('rrrrr', 'haiku'), 'sonnet').runs, 0, 'per model');
});

// ---- A fake floor ---------------------------------------------------------------------------------

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'probe';
  dir = mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  map = new Map<string, WorkerInfo>();
  prompts: { id: string; text: string }[] = [];
  toasts: string[] = [];
  feed: string[] = [];
  roster!: Roster;
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk) {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', model: ask.model, deskId: 'd', name: ask.name, color: '#fff', status: 'starting', acked: true, createdBy: ask.by, createdAt: 0, prompt: ask.prompt, cols: 80, rows: 24, viewers: [], viewerIds: [], worktree: { path: `wt/${id}`, branch: `agent/${id}` } } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop(id: string) {
    this.map.delete(id);
    this.roster.onWorkerGone(this, id);
  }
  prompt(id: string, text: string) {
    if (!this.map.has(id)) return 'Worker is not running';
    this.prompts.push({ id, text });
    return undefined;
  }
  wake() {
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = (text: string) => void this.toasts.push(text);
  changed = (_alert?: RosterAlert) => undefined;
  activity = (text: string) => void this.feed.push(text);
  set(id: string, status: WorkerStatus) {
    Object.assign(this.map.get(id)!, { status });
    this.roster.onWorker(this, this.map.get(id)!);
  }
}

function setup(level: AutonomyLevel = 2) {
  const clock = { now: Date.UTC(2026, 9, 5, 9, 0) };
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'skills-data-')), floors: () => [floor], makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => clock.now }, 0);
  floor.roster = roster;
  roster.data(floor.id).settings.autonomy = level;
  roster.data(floor.id).settings.schedule.enabled = false;
  return { clock, floor, roster, data: () => roster.data(floor.id) };
}

async function hireAt(t: ReturnType<typeof setup>, role: 'pm' | 'lead-developer') {
  assert.equal(await t.roster.members.hire(t.floor, role, 'Probe'), undefined);
  const id = t.data().members[role].workerId!;
  t.floor.set(id, 'working');
  t.floor.set(id, 'done');
  t.floor.prompts.length = 0;
  return { id, w: t.floor.worker(id)!, cwd: t.floor.cwdOf(t.floor.worker(id)!) };
}

/** A run of `name` the hooks report: start, stop, the Agent call's result. */
function hookRun(t: ReturnType<typeof setup>, workerId: string, name: string, ms = 30_000, task = 'draft the Orders MDL') {
  const s = t.roster.subagents;
  s.onEvent(t.floor, workerId, { kind: 'start', at: t.clock.now, agentId: `a${t.clock.now}`, agent: name });
  t.clock.now += ms;
  s.onEvent(t.floor, workerId, { kind: 'stop', at: t.clock.now, agentId: `a${t.clock.now - ms}`, agent: name });
  s.onEvent(t.floor, workerId, { kind: 'result', at: t.clock.now + 5, agent: name, task, failed: false, background: false });
}

test('runs from the hooks: start + stop + the Agent result make one run with its duration, task and model', async () => {
  const t = setup(2);
  const { id } = await hireAt(t, 'lead-developer');
  hookRun(t, id, 'developer', 42_000);
  const rec = t.data().subagents['lead-developer/developer'];
  assert.equal(rec.runs.length, 1);
  assert.deepEqual({ d: rec.runs[0].durationMs, task: rec.runs[0].task, model: rec.runs[0].model, o: rec.runs[0].outcome }, { d: 42_000, task: 'draft the Orders MDL', model: 'sonnet', o: 'pending' }, 'the model is its definition’s');
  // An older Claude Code without SubagentStop: the result alone is a run.
  t.roster.subagents.onEvent(t.floor, id, { kind: 'result', at: t.clock.now + 600_000, agent: 'developer', task: 'x', model: 'haiku', failed: true, background: false, durationMs: 9000 });
  assert.equal(rec.runs.length, 2);
  assert.deepEqual({ m: rec.runs[1].model, o: rec.runs[1].outcome, d: rec.runs[1].durationMs }, { m: 'haiku', o: 'failed', d: 9000 });
  // Not a team member's: not recorded.
  t.roster.subagents.onEvent(t.floor, 'stranger', { kind: 'stop', at: 1, agent: 'developer' });
  assert.equal(rec.runs.length, 2);
  // The review verdict lands on the newest unreviewed run, with its time, for the rankings.
  t.clock.now += 700_000;
  const run = t.roster.subagents.review(t.floor, 'lead-developer', 'developer', 'rework', 'missing validation');
  assert.notEqual(typeof run, 'string');
  const reviews = subagentReviews(t.data(), t.floor.id, 'lead-developer');
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].verdict, 'rework');
  assert.equal(reviews[0].note, 'missing validation');
  assert.ok(reviews[0].turnaroundMs! > 0);
  assert.deepEqual(t.roster.subagents.reviews(t.floor.id), reviews);
});

test('the gates: ask raises an escalation and approving it benches; propose waits in the approvals', async () => {
  const t = setup(1);
  const { id, w, cwd } = await hireAt(t, 'lead-developer');
  const asked = t.roster.subagents.request(t.floor, 'lead-developer', w, 'bench', 'developer', { reason: '3 reworks in 5 runs' });
  assert.equal(asked.outcome, 'asked');
  const e = t.data().escalations.at(-1)!;
  assert.match(e.title, /asks to bench [A-Z][a-z]+ \(developer\)/);
  assert.equal(t.data().subagents['lead-developer/developer']?.state ?? 'active', 'active', 'nothing happens before the answer');
  assert.equal(t.roster.escalations.resolve(t.floor, e.id, 'approve', '', 'Keith'), undefined);
  assert.equal(t.data().subagents['lead-developer/developer'].state, 'benched');
  assert.ok(existsSync(path.join(cwd, '.claude/agents.benched/developer.md')));
  assert.equal(t.data().subagentActions.at(-1)!.status, 'approved');

  // Level 2: propose. The approval card, then the Project Manager's decision does it and tells the Lead.
  t.data().settings.autonomy = 2;
  const p = t.roster.subagents.request(t.floor, 'lead-developer', w, 'swap-model', 'developer', { model: 'haiku' });
  assert.equal(p.outcome, 'proposed');
  const view = t.roster.view(t.floor, true);
  const card = view.approvals.find((a) => a.kind === 'subagent')!;
  assert.match(card.title, /proposes to swap the model of subagent [A-Z][a-z]+ \(developer\) to Haiku/);
  assert.equal(card.actionId, p.actionId);
  t.floor.prompts.length = 0;
  assert.equal(t.roster.subagents.decide(t.floor, p.actionId!, true, 'Keith'), undefined);
  assert.equal(t.data().subagents['lead-developer/developer'].model, 'haiku');
  assert.match(t.floor.prompts.find((x) => x.id === id)!.text, /approved your request to swap the model of [A-Z][a-z]+ \(developer\)/);
  assert.match(String(t.roster.subagents.decide(t.floor, p.actionId!, false, 'Keith')), /Already approved/);
  assert.equal(t.roster.view(t.floor, true).approvals.filter((a) => a.kind === 'subagent').length, 0);
  const rej = t.roster.subagents.request(t.floor, 'lead-developer', w, 'warn', 'developer', { reason: 'sloppy' });
  assert.equal(rej.outcome, 'done', 'warn is tell at level 2');
});

test('the gates: tell does it and tells the Coordinator; fyi does it and files an FYI; off refuses', async () => {
  const t = setup(3);
  const pm = await hireAt(t, 'pm');
  const { w } = await hireAt(t, 'lead-developer');
  const told = t.roster.subagents.request(t.floor, 'lead-developer', w, 'warn', 'developer', { reason: 'skipped mxcli check' });
  assert.equal(told.outcome, 'done');
  assert.match(told.message, /Coordinator is told/);
  assert.equal(t.data().subagents['lead-developer/developer'].state, 'warning');
  assert.match(t.floor.feed.join('\n'), /⚠️ .* \(Lead Developer\) put on warning subagent [A-Z][a-z]+ \(developer, Sonnet\): skipped mxcli check/);
  t.clock.now += 61_000;
  assert.equal(t.roster.subagents.flushNews(t.floor, t.clock.now), true);
  assert.match(t.floor.prompts.find((x) => x.id === pm.id)!.text, /put on warning subagent [A-Z][a-z]+ \(developer\)/);

  t.data().settings.autonomy = 4;
  const fyi = t.roster.subagents.request(t.floor, 'lead-developer', w, 'bench', 'developer', { reason: '3 reworks' });
  assert.match(fyi.message, /FYI/);
  const e = t.data().escalations.at(-1)!;
  assert.equal(e.fyi, true);
  assert.match(e.title, /benched subagent [A-Z][a-z]+ \(developer\)/);

  assert.equal(changeSkill(t.roster, t.floor, 'lead-developer', { skill: 'reinstate', enabled: false }), undefined);
  const off = t.roster.subagents.request(t.floor, 'lead-developer', w, 'reinstate', 'developer', {});
  assert.equal(off.ok, false);
  assert.match(off.message, /turned "Reinstate a subagent" off/);
  assert.match(t.roster.subagents.request(t.floor, 'lead-developer', w, 'bench', 'nobody', { reason: 'x' }).message, /No subagent called nobody/);
  assert.match(t.roster.subagents.request(t.floor, 'lead-developer', w, 'warn', 'developer', {}).message, /Say why/);
});

test('warn, bench, swap-model and reinstate change the files in the Lead’s folder', async () => {
  const t = setup(2);
  const { cwd } = await hireAt(t, 'lead-developer');
  const file = path.join(cwd, '.claude/agents/developer.md');
  const benched = path.join(cwd, '.claude/agents.benched/developer.md');
  const settings = path.join(cwd, '.claude/settings.local.json');
  const pbFile = path.join(cwd, '.ai-context/skills/team-lead-developer/SKILL.md');
  assert.ok(existsSync(file));
  assert.match(readFileSync(pbFile, 'utf8'), /## Your skills/);
  const run = (op: 'warn' | 'bench' | 'swap-model' | 'reinstate', args = {}) => assert.equal(t.roster.subagents.run(t.floor, 'lead-developer', op, 'developer', args, 'Keith', 'pm'), undefined);
  run('warn', { reason: 'ran mxcli exec' });
  assert.match(readFileSync(file, 'utf8'), /## ⚠️ Warning \(2026-10-05\): ran mxcli exec/);
  run('swap-model', { model: 'haiku' });
  assert.match(readFileSync(file, 'utf8'), /^model: haiku$/m);
  assert.doesNotMatch(readFileSync(file, 'utf8'), /^model: sonnet$/m);
  run('bench', { reason: '3 reworks in 5 runs' });
  assert.ok(!existsSync(file) && existsSync(benched), 'out of .claude/agents/');
  assert.deepEqual(JSON.parse(readFileSync(settings, 'utf8')).permissions.deny, ['Agent(developer)', 'Task(developer)']);
  assert.match(readFileSync(pbFile, 'utf8'), /\(developer\) is benched\*\* until .*: don't dispatch developer; do the work yourself or use another subagent/);
  assert.match(t.floor.feed.join('\n'), /🪑 Keith \(Project Manager\) benched .*'s subagent [A-Z][a-z]+ \(developer, Haiku\): 3 reworks in 5 runs/);
  // A hire while benched writes it benched again, not back into .claude/agents/.
  t.roster.members.rewrite(t.floor, 'lead-developer');
  assert.ok(!existsSync(file));
  run('reinstate');
  assert.ok(existsSync(file) && !existsSync(benched));
  assert.match(readFileSync(file, 'utf8'), /Warning \(2026-10-05\): ran mxcli exec/, 'the warning notes stay');
  assert.match(readFileSync(file, 'utf8'), /^model: haiku$/m);
  assert.equal(JSON.parse(readFileSync(settings, 'utf8')).permissions, undefined, 'the deny rule is gone');
  assert.equal(t.data().subagents['lead-developer/developer'].state, 'active');
  assert.equal(withStanding(withStanding('---\nname: x\n---\nbody\n', { warnings: [{ at: 0, reason: 'r', by: 'b' }] }), { warnings: [] }), '---\nname: x\n---\nbody\n', 'the warnings block is replaced, not stacked');
});

test('a benched subagent is reinstated once its cool-down is over', async () => {
  const t = setup(2);
  await hireAt(t, 'lead-developer');
  t.data().settings.subagentCooldownHours = 2;
  assert.equal(t.roster.subagents.run(t.floor, 'lead-developer', 'bench', 'developer', { reason: 'r' }, 'Keith', 'pm'), undefined);
  const rec = t.data().subagents['lead-developer/developer'];
  assert.equal(rec.benchedUntil, t.clock.now + 2 * 3_600_000);
  t.roster.tick(t.clock.now + 3_600_000);
  assert.equal(rec.state, 'benched');
  t.clock.now += 2 * 3_600_000;
  t.roster.tick(t.clock.now);
  assert.equal(rec.state, 'active');
  assert.match(t.floor.feed.at(-1)!, /The office reinstated .*'s subagent [A-Z][a-z]+ \(developer, Sonnet\): its cool-down is over/);
  // 0 hours: only by hand.
  t.data().settings.subagentCooldownHours = 0;
  t.roster.subagents.run(t.floor, 'lead-developer', 'bench', 'developer', { reason: 'r' }, 'Keith', 'pm');
  t.roster.tick(t.clock.now + 1000 * 3_600_000);
  assert.equal(rec.state, 'benched');
});

test('an underperforming subagent gets its idle Lead one nudge, with its skills', async () => {
  const t = setup(2);
  const { id } = await hireAt(t, 'lead-developer');
  for (const v of ['accept', 'rework', 'accept', 'rework'] as const) {
    hookRun(t, id, 'developer');
    t.roster.subagents.review(t.floor, 'lead-developer', 'developer', v);
  }
  const rec = t.data().subagents['lead-developer/developer'];
  assert.ok(rec.flaggedAt, 'flagged at 3 reviewed runs, below C');
  assert.match(t.floor.feed.join('\n'), /📉 [A-Z][a-z]+ \(developer, Sonnet\) on .*'s team is underperforming: grade D \(67% accepted\) over 3 runs/);
  t.floor.prompts.length = 0;
  t.floor.set(id, 'working');
  t.roster.tick(t.clock.now);
  assert.equal(t.floor.prompts.length, 0, 'never while it works');
  t.floor.set(id, 'done');
  t.roster.tick(t.clock.now + 1000);
  assert.equal(t.floor.prompts.length, 0, 'a grace after its turn');
  t.clock.now += NUDGE_GRACE_MS + 1000;
  t.roster.tick(t.clock.now);
  assert.equal(t.floor.prompts.length, 1);
  assert.match(t.floor.prompts[0].text, /[A-Z][a-z]+ \(`developer`, Sonnet\) is underperforming: 2 reworks in 4 runs/);
  assert.match(t.floor.prompts[0].text, /Bench a subagent — you propose it/);
  t.roster.tick(t.clock.now + 600_000);
  assert.equal(t.floor.prompts.length, 1, 'once per finding');
});

test('changing a skill rewrites the Playbook and tells an idle Lead', async () => {
  const t = setup(2);
  const { id, cwd } = await hireAt(t, 'lead-developer');
  assert.equal(changeSkill(t.roster, t.floor, 'lead-developer', { skill: 'bench', gate: 'tell' }), undefined);
  assert.match(readFileSync(path.join(cwd, '.ai-context/skills/team-lead-developer/SKILL.md'), 'utf8'), /\*\*Bench a subagent\*\* — you decide, then the office tells the Project Coordinator/);
  assert.match(t.floor.prompts.find((p) => p.id === id)!.text, /changed your skills[\s\S]*Bench a subagent\*\*: you decide/);
  assert.equal(t.roster.view(t.floor, true).skills['lead-developer']!.find((s) => s.key === 'bench')!.overridden, true);
  assert.equal(changeSkill(t.roster, t.floor, 'lead-developer', { skill: 'bench', reset: true }), undefined);
  assert.equal(t.data().members['lead-developer'].skills?.bench, undefined);
  assert.match(String(changeSkill(t.roster, t.floor, 'lead-developer', { skill: 'escalate', gate: 'ask' })), /always allowed/);
  assert.match(String(changeSkill(t.roster, t.floor, 'pm', { skill: 'bench', gate: 'ask' })), /No such skill/);
  t.floor.set(id, 'working');
  t.floor.prompts.length = 0;
  changeSkill(t.roster, t.floor, 'lead-developer', { skill: 'warn', enabled: false });
  assert.equal(t.floor.prompts.length, 0, 'a Lead at work is not interrupted');
  assert.deepEqual(effectiveSkills('lead-developer', 2, t.data().members['lead-developer'].skills).filter((s) => !s.enabled).map((s) => s.key), ['warn']);
});

test('office-workers subagent: its arguments', () => {
  assert.deepEqual(parseSubagent(['list'], UsageError), { cmd: 'subagent', op: 'list' });
  assert.deepEqual(parseSubagent(['review', 'tester', '--verdict', 'rework', '--note=flaky'], UsageError), { cmd: 'subagent', op: 'review', verdict: 'rework', note: 'flaky', name: 'tester' });
  assert.deepEqual(parseSubagent(['swap-model', 'tester', '--model', 'haiku'], UsageError), { cmd: 'subagent', op: 'swap-model', model: 'haiku', name: 'tester' });
  assert.throws(() => parseSubagent(['review', 'tester'], UsageError), /--verdict accept or rework/);
  assert.throws(() => parseSubagent(['bench', 'tester'], UsageError), /--reason/);
  assert.throws(() => parseSubagent(['fire', 'tester'], UsageError), /one of list/);
  assert.throws(() => parseSubagent(['warn'], UsageError), /one subagent/);
});
