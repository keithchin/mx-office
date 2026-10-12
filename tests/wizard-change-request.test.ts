// Creation rehearsal 2's blockers: "Change an existing app" on a live toolkit project must never rewrite it
// (no init-project.sh re-run, its confirmed intake answers and Decisions rows byte-identical, its stage
// unchanged: the brief goes in as an appended Stage 0b change request), and an answer holding an Unverified
// item is never written CONFIRMED (those items go to Q8 and the register's open questions).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyOp, type Brief, type PlanBrief } from '../src/shared/brief.js';
import { briefDecisionRows, briefMarkdown, briefOpenQuestions, intakeFromBrief } from '../src/shared/brief-map.js';
import { fakeBrief } from '../src/server/wizard/planner/fake.js';
import { appendDecisionRows, openQuestions, recordBriefRegister } from '../src/server/wizard/register.js';
import { newJob, type JobState } from '../src/server/wizard/job.js';
import type { WizardConfig } from '../src/server/wizard/config.js';
import { setupSteps, type SetupDeps } from '../src/server/wizard/steps.js';
import { integrationsOf } from '../src/shared/roster/recommend.js';
import type { ProjectPlan } from '../src/shared/wizard.js';

const approved = { by: 'Alex Lee', at: '2026-10-12T10:45:00.000Z', assumed: 2 };

/** The test planner's brief with one Unverified item in scope and one in the success criteria, beside Answered ones. */
function mixedBrief(): Brief {
  const { brief } = fakeBrief([]);
  brief.sections.scope.push({ id: 'i9', side: 'in', text: 'Badge printer model per office', tag: 'unverified', source: 'not stated' });
  brief.sections.success = brief.sections.success.filter((x) => x.tag === 'answered');
  brief.sections.success.push({ id: 's9', text: 'Hosts answer within 2 minutes', tag: 'unverified', source: 'not stated' });
  return brief;
}

test('an answer with an Unverified item is never CONFIRMED: those items go to Q8 and the open questions, the kind comes from the rest', () => {
  const pb: PlanBrief = { brief: mixedBrief(), attachments: [], approved };
  const a = intakeFromBrief(pb);
  const q2 = a.find((x) => x.n === 2)!;
  const q4 = a.find((x) => x.n === 4)!;
  assert.equal(q2.kind, 'answered', 'what is left of Q2 is all Answered');
  assert.ok(!q2.text.includes('Hosts answer within 2 minutes'), 'the Unverified success criterion is not part of Q2');
  assert.equal(q4.kind, 'answered');
  assert.ok(!q4.text.includes('Badge printer model'), 'the Unverified scope item is not part of Q4');
  const q8 = a.find((x) => x.n === 8)!;
  assert.equal(q8.kind, 'unverified');
  assert.match(q8.text, /\(3\) Hosts answer within 2 minutes \(4\) Badge printer model per office/);
  const oq = briefOpenQuestions(pb).map((q) => q.question);
  assert.ok(oq.some((q) => q.startsWith('Badge printer model per office (Scope; not stated)')), oq.join('\n'));
  assert.ok(oq.some((q) => q.startsWith('Hosts answer within 2 minutes (Success criteria')));
  // Every item of a section Unverified: the question isn't answered from it at all.
  const allOpen = mixedBrief();
  allOpen.sections.scope = allOpen.sections.scope.map((x) => ({ ...x, tag: 'unverified' as const }));
  assert.equal(intakeFromBrief({ brief: allOpen, attachments: [] }).find((x) => x.n === 4), undefined);
  // No answer holding an Unverified item says CONFIRMED.
  for (const ans of a) if (ans.kind === 'answered') assert.ok(!/\[Unverified/.test(ans.text), `Q${ans.n} holds an Unverified item`);
});

test('greenfield: the constraints don’t answer Q5 (nothing exists to stay); the goal’s sources are named once', () => {
  const { brief } = fakeBrief([]);
  brief.sections.goal.push({ id: 'g2', text: 'Retire the paper book.', tag: 'answered', source: 'from your description' });
  const pb: PlanBrief = { brief, attachments: [], approved };
  assert.ok(intakeFromBrief(pb).some((x) => x.n === 5));
  assert.ok(!intakeFromBrief(pb, { entry: 'greenfield' }).some((x) => x.n === 5));
  const goal = briefDecisionRows(pb, '2026-10-12').find((r) => r.decision.startsWith('Goal:'))!;
  assert.equal(goal.notes, 'From the project brief (from your description)');
  assert.match(intakeFromBrief(pb).find((x) => x.n === 2)!.text, /\[Answered, from your description\] \(docs/);
  // Distinct integration words, not list items: three constraints naming one integration are "some".
  assert.equal(integrationsOf('Visitors sign in at a kiosk; data stays in the EU; email to the host'), 'some');
  assert.equal(integrationsOf('the SAP interface, the HR feed and the SSO login'), 'many');
});

const REGISTER = [
  '# PROJECT.md — travel Decision Register',
  '',
  '## Current stage',
  '',
  '**Stage 5 — Build**, in progress — gates passed: P, 0, 1, 2, 3, 4 (derived by gate-check on 2026-10-07; re-run it rather than editing this line).',
  '',
  'Toolkit commit: 8abd614',
  'Exec approval: auto',
  '',
  '## Decisions',
  '',
  '| Stage | Decision | Status | Notes |',
  '|---|---|---|---|',
  '| P | Entry mode: requirements-driven (intake Q1) | CONFIRMED | Keith, 2026-10-05 |',
  '| P | Scope: request, approve, status (Q4) | CONFIRMED | Keith, 2026-10-05 |',
  '| 0 | Goal / first-slice scope: submit and approve | CONFIRMED | PM, 2026-10-05 |',
  '',
  '## Toolkit position',
  '',
  'Entry mode: requirements-driven',
  '',
  '## Open questions',
  '',
  '| # | Question | Raised at | Status |',
  '|---|---|---|---|',
  '| OQ-07 | Seed data names | Stage 4 | OPEN |',
  '',
  '## Assumptions (ASSUMED, unresolved)',
  '',
  'None yet.',
  '',
].join('\r\n');

const INTAKE = '# intake.md\r\n\r\n## 1. Entry mode?\r\n\r\nAnswered (CONFIRMED 2026-10-05, Keith): **Requirements-driven.**\r\n\r\n## 4. What are we working on?\r\n\r\nAnswered (CONFIRMED 2026-10-05, Keith): Travel request approval app.\r\n';

const plan = (over: Partial<ProjectPlan> = {}): ProjectPlan => ({
  kind: 'change',
  owner: 'Test-Org',
  name: 'travel-approval',
  description: 'Withdraw requests',
  private: true,
  mendix: '11.12.2',
  entry: 'existing-app-change',
  tier: 'small',
  interview: 'assist',
  execApproval: 'auto',
  intake: [],
  clients: ['Acme'],
  operators: ['Probe'],
  roles: ['pm', 'chief-analyst'],
  discovery: { issue: true, queue: true, model: 'opus' },
  createdByHand: false,
  ...over,
});

function steps(root: string) {
  // A bash that doesn't exist: any toolkit script the steps tried to run (init-project.sh) would fail the test.
  const cfg: WizardConfig = { toolkitDir: path.join(root, 'no-toolkit'), bash: path.join(root, 'no-bash.exe'), mendixDir: root, org: 'Test-Org', adminTokenFile: path.join(root, 'none') };
  const deps: SetupDeps = { cfg, projectsDir: () => root, floorOf: () => undefined, addFloor: async () => 'unused', adoptFloor: () => 'unused', queue: () => 'unused', hired: () => false, known: () => false, hire: async () => 'unused', pinToolkit: async () => { throw new Error('a live project is never re-pinned by the wizard'); } };
  return setupSteps(deps);
}
const io = { log: () => undefined };

test('change mode on a live toolkit project: no init, intake.md byte-identical, PROJECT.md only appended to (stage line, flat lines and rows unchanged)', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wizard-change-'));
  try {
    const dir = path.join(root, 'repo');
    mkdirSync(path.join(dir, 'bin'), { recursive: true });
    writeFileSync(path.join(dir, 'intake.md'), INTAKE);
    writeFileSync(path.join(dir, 'PROJECT.md'), REGISTER);
    writeFileSync(path.join(dir, 'bin', 'install-project-hooks.sh'), '#!/bin/sh\n');
    // A fresh clone: the git-ignored machine-local files are missing, which used to re-run init-project.sh.
    assert.ok(!existsSync(path.join(dir, '.claude', 'settings.local.json')));
    const brief = applyOp(mixedBrief(), { op: 'confirm', id: 'r3' }, { name: 'Alex Lee', at: approved.at }) as Brief;
    const job: JobState = Object.assign(newJob(plan({ brief: { brief, attachments: [], approved } }), 'Alex Lee'), { dir, floor: 'travel-approval' });
    const s = steps(root);
    const init = await s.init(job, io);
    assert.equal(init.status, 'skipped');
    assert.match(init.detail!, /existing toolkit project/);
    assert.equal(job.existingProject, true);
    const intake = await s.intake(job, io);
    assert.equal(readFileSync(path.join(dir, 'intake.md'), 'utf8'), INTAKE, 'the confirmed answers are byte-identical');
    assert.match(intake.detail!, /intake\.md kept as it is.*docs\/project-brief\.md/);
    assert.match(readFileSync(path.join(dir, 'docs', 'project-brief.md'), 'utf8'), /Stage 0b change request approved\*\* by Alex Lee/);
    await s.decisions(job, io);
    const md = readFileSync(path.join(dir, 'PROJECT.md'), 'utf8');
    const before = REGISTER.split('\r\n');
    const after = md.split('\r\n');
    assert.ok(md.includes('\r\n') && !/[^\r]\n/.test(md), 'the line endings are kept');
    for (const l of before.filter((x) => x && x !== 'None yet.')) assert.ok(after.includes(l), `kept: ${l}`);
    assert.equal(after.find((l) => l.startsWith('**Stage')), before.find((l) => l.startsWith('**Stage')), 'the stage line');
    assert.ok(!after.some((l) => /^(Size tier|Mendix version|Interview mode):/.test(l)), 'no flat kickoff lines');
    assert.deepEqual(after.filter((l) => l.startsWith('Entry mode:')), ['Entry mode: requirements-driven']);
    const added = after.filter((l) => !before.includes(l) && l.trim());
    assert.ok(added.every((l) => /^\| (0b|OQ-\d+) \|/.test(l) || l.startsWith('- Change assumption')), added.join('\n'));
    assert.ok(added.some((l) => /^\| 0b \| Change request: Give each office .* \| CONFIRMED 2026-\d\d-\d\d \| Raised and approved by Alex Lee/.test(l)));
    assert.ok(added.some((l) => /^\| 0b \| Change assumption c3: .* \| ASSUMED /.test(l)));
    assert.ok(!added.some((l) => /^\| (P|0) \|/.test(l)), 'no Stage P or Stage 0 rows on a project at Stage 5');
    // The open questions carry on from OQ-07, raised at Stage 0b.
    assert.ok(after.some((l) => /^\| OQ-08 \| .* \| Stage 0b: change request q\d \(docs\/project-brief\.md\) \| OPEN \|$/.test(l)));
    assert.ok(openQuestions(md).some((q) => q.startsWith('Badge printer model')));
    // A Retry changes nothing, and still never runs init.
    assert.equal((await s.decisions(job, io)).status, 'skipped');
    assert.equal((await s.init(job, io)).status, 'skipped');
    assert.equal(readFileSync(path.join(dir, 'PROJECT.md'), 'utf8'), md);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a scaffold is judged by its committed files: a fresh clone of a scaffolded new project is not re-scaffolded', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wizard-scaffold-'));
  try {
    const dir = path.join(root, 'repo');
    mkdirSync(path.join(dir, 'bin'), { recursive: true });
    for (const f of ['intake.md', 'PROJECT.md', 'bin/install-project-hooks.sh']) writeFileSync(path.join(dir, f), 'x');
    const job: JobState = Object.assign(newJob(plan({ kind: 'new', entry: 'greenfield' }), 'Alex Lee'), { dir });
    const r = await steps(root).init(job, io);
    assert.deepEqual([r.status, r.detail], ['skipped', 'already scaffolded']);
    assert.equal(job.existingProject, false, 'a new project is never an existing one');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('appendDecisionRows never replaces a row with the same key, adds a row once, and keeps the rest of the register', () => {
  const rows = [{ stage: 'P', decision: 'Entry mode: Change an existing app', status: 'CONFIRMED', notes: 'wizard' }];
  const once = appendDecisionRows(REGISTER, rows);
  assert.ok(once.includes('| P | Entry mode: requirements-driven (intake Q1) | CONFIRMED | Keith, 2026-10-05 |'), 'the old row stays');
  assert.ok(once.includes('| P | Entry mode: Change an existing app | CONFIRMED | wizard |'));
  assert.equal(appendDecisionRows(once, rows), once, 'again: nothing added');
  assert.equal(appendDecisionRows(REGISTER, []), REGISTER);
  // The change request's markdown still lists every item with its tag.
  const pb: PlanBrief = { brief: mixedBrief(), attachments: [], approved };
  assert.match(briefMarkdown(pb, { repo: 'o/r', entry: 'Change an existing app', change: true }), /Badge printer model per office _\(Unverified/);
  assert.equal(recordBriefRegister(once, [], []), once);
});
