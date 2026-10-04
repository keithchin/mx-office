import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { slugify, slugProblem, ownerProblem } from '../src/shared/wizard.js';
import { existingAnswers, isAnswerLine, parseIntakeTemplate, unansweredQuestions, writeIntakeAnswers } from '../src/server/wizard/intake.js';
import { openQuestions, recordDecisions, registerField } from '../src/server/wizard/register.js';
import { cleanPlan } from '../src/server/wizard/plan.js';
import { setupView } from '../src/server/wizard/setup.js';
import { decisions, intakeGoal } from '../src/server/summary/project.js';

test('a new project name has to be a repository slug: lower case, digits and single hyphens', () => {
  assert.equal(slugProblem('travel-approval'), undefined);
  assert.equal(slugProblem('a1'), undefined);
  assert.match(slugProblem('') ?? '', /name/);
  assert.match(slugProblem('x') ?? '', /two/);
  assert.match(slugProblem('Travel') ?? '', /Lower/);
  assert.match(slugProblem('travel approval') ?? '', /spaces/);
  assert.ok(slugProblem('-travel'));
  assert.ok(slugProblem('travel-'));
  assert.ok(slugProblem('travel_approval'));
  assert.match(slugProblem('travel--approval') ?? '', /double/);
  assert.ok(slugProblem('a'.repeat(65)));
  assert.equal(slugify('  Travel Approval! (v2) '), 'travel-approval-v2');
  assert.equal(slugify('Café Ünïcode'), 'cafe-unicode');
  assert.equal(ownerProblem('AI-Taskforce-Labs'), undefined);
  assert.ok(ownerProblem('bad owner'));
});

// The toolkit's template, cut down to three questions (the real one is a heredoc in intake-template.sh).
const TEMPLATE = `mxtk_intake_template() {
  cat <<'MXTK_INTAKE_EOF'
# intake.md — Stage P Kickoff Interview

Replace each "_Not yet asked._" line below with a real answer.

## 1. Entry mode: migration, requirements-driven, greenfield, or change an existing app?

_Not yet asked._ The agent proposes with evidence and the user confirms.

## 2. What is this project, and what is driving it?

_Not yet asked._ Sets stakes, urgency and the default for Q3 in one answer.
(a) POC/demo.

## 3. Fidelity: port as-is, or improve as we go?

_Not yet asked._ Default inherited from Q2.
MXTK_INTAKE_EOF
}`;
const INTAKE = /<<'MXTK_INTAKE_EOF'\n([\s\S]*?)\nMXTK_INTAKE_EOF/.exec(TEMPLATE)![1] + '\n';

test("the intake questions are read from the toolkit's template, placeholder stripped", () => {
  const qs = parseIntakeTemplate(TEMPLATE);
  assert.deepEqual(
    qs.map((q) => [q.n, q.title]),
    [
      [1, 'Entry mode: migration, requirements-driven, greenfield, or change an existing app?'],
      [2, 'What is this project, and what is driving it?'],
      [3, 'Fidelity: port as-is, or improve as we go?'],
    ],
  );
  assert.equal(qs[1].help, 'Sets stakes, urgency and the default for Q3 in one answer. (a) POC/demo.');
  const real = path.join(os.homedir(), 'agent-spike', 'mxcli-project-toolkit', 'bin', 'lib', 'intake-template.sh');
  if (existsSync(real)) {
    const all = parseIntakeTemplate(readFileSync(real, 'utf8'));
    assert.ok(all.length >= 11, `the real template has ${all.length} questions`);
    assert.equal(all.find((q) => q.n === 9)?.title.startsWith('Interview mode'), true);
  }
});

test("intake answers are written in Stage P's markers, idempotently, and blank ones stay for the interview", () => {
  assert.equal(unansweredQuestions(INTAKE).length, 3, 'a fresh scaffold passes nothing');
  const once = writeIntakeAnswers(INTAKE, [
    { n: 1, kind: 'answered', text: 'greenfield' },
    { n: 2, kind: 'answered', text: 'A travel approval app for the Q3 demo.\n\nEmployees request, managers approve.' },
    { n: 3, kind: 'answered', text: '   ' },
  ]);
  assert.match(once, /^## 1\..*\n\nAnswered \(CONFIRMED\): greenfield\n\nThe agent proposes with evidence/m);
  assert.match(once, /Answered \(CONFIRMED\): A travel approval app for the Q3 demo\.\nEmployees request, managers approve\./);
  assert.doesNotMatch(once.split('## 1.')[1].split('## 3.')[0], /_Not yet asked\._/, 'the placeholder goes where an answer went');
  assert.deepEqual(unansweredQuestions(once).map((q) => q.n), [3]);
  assert.equal(intakeGoal(once), 'A travel approval app for the Q3 demo. Employees request, managers approve.');
  assert.equal(writeIntakeAnswers(once, [{ n: 1, kind: 'answered', text: 'greenfield' }]), once, 'writing the same answer again changes nothing');

  const twice = writeIntakeAnswers(once, [
    { n: 2, kind: 'assumed', text: 'POC, you decide the rest' },
    { n: 3, kind: 'unverified', text: 'ask the sponsor on Monday' },
  ]);
  assert.equal((twice.match(/^Answered \(CONFIRMED\): A travel/gm) ?? []).length, 0, 'an answer is replaced, not added to');
  assert.match(twice, /^Assumed: POC, you decide the rest$/m);
  assert.match(twice, /^Unverified — how to verify: ask the sponsor on Monday$/m);
  assert.equal(unansweredQuestions(twice).length, 0, 'every section now carries a marker');
  assert.deepEqual(existingAnswers(twice), [
    { n: 1, kind: 'answered', text: 'greenfield' },
    { n: 2, kind: 'assumed', text: 'POC, you decide the rest' },
    { n: 3, kind: 'unverified', text: 'ask the sponsor on Monday' },
  ]);
  // CRLF files keep their line endings.
  const crlf = writeIntakeAnswers(INTAKE.replace(/\n/g, '\r\n'), [{ n: 1, kind: 'answered', text: 'migration' }]);
  assert.ok(!/[^\r]\n/.test(crlf));
});

test('the answer markers are the ones gate-check accepts, and not the ones it rejects', () => {
  for (const ok of ['Answered (CONFIRMED): x', 'answered: x', 'Assumed: x', 'Decision: x', '> **Answered:** x', 'Unverified — how to verify: ask']) assert.ok(isAnswerLine(ok), ok);
  for (const no of ['- Status: Not Answered', 'Unverified.', '_Not yet asked._ how to verify: ...', 'The answer is x']) assert.ok(!isAnswerLine(no), no);
});

const REGISTER = `# PROJECT.md — demo Decision Register

## Current stage

**Stage P — Kickoff**, needs attention — gates passed: none yet (derived by gate-check on 2026-10-04; re-run it rather than editing this line).

Toolkit commit: 8abd614
Exec approval: auto

<!-- The bold line above is a READOUT.
     Entry mode: this is an example inside a comment and must never be read
-->

## Decisions

| Stage | Decision | Status | Notes |
|---|---|---|---|

## Open questions

| # | Question | Raised at | Status |
|---|---|---|---|
| 1 | Who signs off travel over 5k? | P | open |
| 2 | Which SSO? | P | resolved |

## Assumptions (ASSUMED, unresolved)

None yet.
`;

test("kickoff decisions go into PROJECT.md as flat lines gate-check reads and as Decisions rows, once", () => {
  assert.equal(registerField(REGISTER, 'Entry mode'), undefined, 'a label in a comment is not a value');
  const rows = [
    { stage: 'P', decision: 'Entry mode: Greenfield', status: 'CONFIRMED 2026-10-04', notes: 'Chosen by Probe | in the wizard' },
    { stage: 'P', decision: 'Size tier: small', status: 'CONFIRMED 2026-10-04', notes: 'declared' },
  ];
  const once = recordDecisions(REGISTER, [['Entry mode', 'greenfield'], ['Size tier', 'small — declared'], ['Exec approval', 'ask']], rows);
  assert.equal(registerField(once, 'Entry mode'), 'greenfield');
  assert.equal(registerField(once, 'Size tier'), 'small — declared');
  assert.equal(registerField(once, 'Exec approval'), 'ask');
  assert.match(once, /Exec approval: ask\nEntry mode: greenfield\nSize tier: small — declared\n\n<!--/, 'under the header lines, before the comment');
  assert.deepEqual(decisions(once).map((d) => [d.stage, d.decision, d.status]), [
    ['P', 'Entry mode: Greenfield', 'CONFIRMED 2026-10-04'],
    ['P', 'Size tier: small', 'CONFIRMED 2026-10-04'],
  ]);
  assert.match(once, /Chosen by Probe \\\| in the wizard/, 'a pipe in a cell is escaped');
  assert.equal(recordDecisions(once, [['Entry mode', 'greenfield']], rows), once, 'recording the same again changes nothing');
  const changed = recordDecisions(once, [['Entry mode', 'migration']], [{ ...rows[0], decision: 'Entry mode: Migration' }]);
  assert.equal(registerField(changed, 'Entry mode'), 'migration');
  assert.equal(decisions(changed).filter((d) => d.decision.startsWith('Entry mode')).length, 1, 'the row is replaced, not added');
  assert.deepEqual(openQuestions(once), ['Who signs off travel over 5k?']);
});

test('a plan from the browser is cleaned: slug, known choices, and change mode forces the existing-app path', () => {
  const versions = ['11.6.4', '11.12.4'];
  assert.match(cleanPlan({ name: 'Bad Name', entry: 'greenfield', mendix: '11.6.4' }, versions, 'Org') as string, /Lower|spaces/);
  assert.match(cleanPlan({ name: 'good', entry: 'nope', mendix: '11.6.4' }, versions, 'Org') as string, /entry mode/);
  assert.match(cleanPlan({ name: 'good', entry: 'greenfield', mendix: '9.0.0' }, versions, 'Org') as string, /isn't installed/);
  const p = cleanPlan({ name: 'good', entry: 'greenfield', mendix: '11.6.4', roles: ['pm', 'hacker', 'pm'], clients: 'Acme, Jane ', discovery: { issue: false, queue: true }, intake: [{ n: 2, text: 'x'.repeat(5000) }, { n: 99, text: 'y' }] }, versions, 'Org');
  assert.ok(typeof p !== 'string');
  assert.equal(p.owner, 'Org');
  assert.equal(p.private, true, 'private unless asked otherwise');
  assert.deepEqual(p.roles, ['pm']);
  assert.deepEqual(p.clients, ['Acme', 'Jane']);
  assert.equal(p.discovery.queue, false, 'nothing to queue without the issue');
  assert.equal(p.intake.length, 1);
  assert.equal(p.intake[0].text.length, 4000);
  const change = cleanPlan({ kind: 'change', owner: 'Org', name: 'Legacy_App', entry: 'greenfield', mendix: '11.6.4' }, versions, 'Org');
  assert.ok(typeof change !== 'string');
  assert.equal(change.entry, 'existing-app-change');
});

test("the setup panel reads a project's stages from its files, and goes once Stage 4 is confirmed", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wizard-setup-'));
  try {
    assert.equal(setupView(dir).show, false, 'not a toolkit project');
    const register = recordDecisions(REGISTER, [['Entry mode', 'greenfield'], ['Size tier', 'small — declared']], []);
    writeFileSync(path.join(dir, 'PROJECT.md'), register);
    writeFileSync(path.join(dir, 'intake.md'), writeIntakeAnswers(INTAKE, [{ n: 1, kind: 'answered', text: 'greenfield' }]));
    writeFileSync(
      path.join(dir, 'index.html'),
      '<table><tr><th>Stage</th><th>Title</th><th>Status</th><th>Detail</th></tr><tr><td>P</td><td>Kickoff</td><td><span class="status FAIL">FAIL</span></td><td>old</td></tr><tr><td>0</td><td>Triage</td><td><span class="status FAIL">FAIL</span></td><td>sign-off missing</td></tr></table>',
    );
    const v = setupView(dir);
    assert.equal(v.show, true);
    assert.equal(v.entry, 'greenfield');
    assert.equal(v.tier, 'small');
    assert.deepEqual(v.stages.map((s) => s.id), ['P', '0', '1', '2', '3', '4']);
    assert.equal(v.stages[0].status, 'PENDING', 'Stage P is worked out afresh from intake.md');
    assert.match(v.stages[0].detail ?? '', /Q2, Q3/);
    assert.equal(v.stages[1].status, 'FAIL');
    assert.match(v.next ?? '', /^Stage P/);
    assert.ok(v.questions.includes('Who signs off travel over 5k?'));
    // Greenfield: the entry mode waives 1–4, but Stage 0 still has to be signed off before the panel goes.
    const row = (id: string, s: string) => `<tr><td>${id}</td><td>t</td><td><span class="status ${s}">${s}</span></td><td>d</td></tr>`;
    writeFileSync(path.join(dir, 'intake.md'), writeIntakeAnswers(INTAKE, [1, 2, 3].map((n) => ({ n, kind: 'answered' as const, text: 'x' }))));
    writeFileSync(path.join(dir, 'index.html'), `<table>${row('P', 'PASS')}${row('0', 'FAIL')}${['1', '2', '3', '4'].map((s) => row(s, 'WAIVED')).join('')}</table>`);
    assert.equal(setupView(dir).show, true, 'mode-waived stages are not a confirmed build plan');
    // (one byte longer, so the cache can't mistake it for the last write in the same millisecond)
    writeFileSync(path.join(dir, 'index.html'), ` <table>${row('P', 'PASS')}${row('0', 'PASS')}${['1', '2', '3', '4'].map((s) => row(s, 'WAIVED')).join('')}</table>`);
    assert.equal(setupView(dir).show, false, 'every stage up to the build plan settled');
    writeFileSync(path.join(dir, 'index.html'), '');
    writeFileSync(path.join(dir, 'PROJECT.md'), recordDecisions(register, [], [{ stage: '4', decision: 'Build plan', status: 'CONFIRMED 2026-11-01', notes: 'client said go' }]) + '\n');
    assert.equal(setupView(dir).show, false, 'past the build plan: no panel');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
