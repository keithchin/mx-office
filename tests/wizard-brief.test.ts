// The New project flow's project brief (shared/brief.ts, shared/brief-map.ts): its shape, the honesty rules
// (inferred is Assumed until a person confirms it; open questions are Unverified), and what it becomes in
// the project: intake.md answers, PROJECT.md's Stage 0 rows, docs/project-brief.md and the Discovery issue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyOp, attachProblem, changedIds, cleanBrief, cleanDomains, counts, honestItem, mergeTurn, safeFileName, sourceText, type PlanBrief } from '../src/shared/brief.js';
import { briefDecisionRows, briefForDiscovery, briefMarkdown, intakeFromBrief } from '../src/shared/brief-map.js';
import { BRIEF_SCHEMA, CHAT_SCHEMA, DOMAINS_SCHEMA } from '../src/shared/brief-schema.js';
import { fakeBrief, fakeDomains } from '../src/server/wizard/planner/fake.js';
import { cleanPlan, cleanPlanBrief } from '../src/server/wizard/plan.js';
import { decisionsOf, intakeAnswersOf } from '../src/server/wizard/steps.js';
import { discoveryBrief } from '../src/server/wizard/brief.js';
import { writeBriefFiles } from '../src/server/wizard/brief-files.js';
import { writeIntakeAnswers, isAnswerLine } from '../src/server/wizard/intake.js';
import { recordDecisions } from '../src/server/wizard/register.js';
import type { JobState } from '../src/server/wizard/job.js';
import type { ProjectPlan } from '../src/shared/wizard.js';

const who = { name: 'Alex Lee', at: '2026-10-12T10:42:00.000Z' };

test('a brief is cleaned: not an object is none, ids are filled in and unique, lengths are cut', () => {
  assert.equal(cleanBrief(null), undefined);
  assert.equal(cleanBrief('a brief'), undefined);
  const b = cleanBrief({ title: 'X'.repeat(300), goal: [{ text: 'Do it', tag: 'answered', source: 'from your description' }, { text: 'Again', tag: 'answered', source: 'from your description', id: 'g1' }], scope: [{ side: 'out', text: 'Parking', tag: 'answered', source: 'from your description' }], questions: [{ text: 'NDA?' }] })!;
  assert.equal(b.title.length, 100);
  const ids = [...b.sections.goal, ...b.sections.scope, ...b.sections.questions].map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  assert.equal(b.sections.scope[0].id, 'o1', 'an out-of-scope item gets an o id');
  assert.deepEqual(BRIEF_SCHEMA.required.sort(), ['constraints', 'description', 'filesRead', 'goal', 'questions', 'roles', 'scope', 'success', 'title'].sort());
  assert.ok(CHAT_SCHEMA.required.includes('reply'));
  assert.ok(DOMAINS_SCHEMA.required.includes('domains'));
});

test('the honesty rules: inferred or unsourced is Assumed, open questions are Unverified, what a person settled is Answered', () => {
  assert.equal(honestItem({ id: 'a', text: 't', tag: 'answered', source: 'inferred from "fast"' }, 'success').tag, 'assumed');
  assert.equal(honestItem({ id: 'a', text: 't', tag: 'answered', source: '' }, 'success').tag, 'assumed');
  assert.equal(honestItem({ id: 'a', text: 't', tag: 'answered', source: '' }, 'success').source, 'inferred (no source given)');
  assert.equal(honestItem({ id: 'a', text: 't', tag: 'answered', source: 'from notes.pdf p.2' }, 'success').tag, 'answered');
  assert.equal(honestItem({ id: 'a', text: 't', tag: 'answered', source: 'from your description' }, 'questions').tag, 'unverified');
  assert.equal(honestItem({ id: 'a', text: 't', tag: 'assumed', source: 'inferred', by: { ...who, how: 'confirmed' } }, 'roles').tag, 'answered');
  // The model can't sneak a by-you through: cleanBrief keeps it only as data, and the rules still apply.
  const b = cleanBrief({ success: [{ text: 'Under a minute', tag: 'answered', source: 'a common target' }] })!;
  assert.equal(b.sections.success[0].tag, 'assumed');
});

test('Confirm turns an assumed item into answered, "confirmed by you · time"; edits and additions are the person’s too', () => {
  const { brief } = fakeBrief([]);
  const s2 = brief.sections.success.find((x) => x.tag === 'assumed')!;
  const after = applyOp(brief, { op: 'confirm', id: s2.id }, who);
  assert.ok(typeof after !== 'string');
  const it = after.sections.success.find((x) => x.id === s2.id)!;
  assert.equal(it.tag, 'answered');
  assert.equal(sourceText(it, 'Alex Lee'), 'confirmed by you · 10:42');
  assert.equal(sourceText(it, 'Someone else'), 'confirmed by Alex Lee · 10:42');
  assert.equal(counts(after).assumed, counts(brief).assumed - 1);
  const q = brief.sections.questions[0];
  assert.match(String(applyOp(brief, { op: 'confirm', id: q.id }, who)), /answered in the chat/);
  const edited = applyOp(brief, { op: 'edit', id: 'c3', text: 'Deleted after 90 days' }, who);
  assert.ok(typeof edited !== 'string');
  assert.equal(edited.sections.constraints.find((x) => x.id === 'c3')!.tag, 'answered');
  assert.equal(edited.sections.constraints.find((x) => x.id === 'c3')!.by?.how, 'edited');
  const added = applyOp(brief, { op: 'add', section: 'roles', name: 'Security officer', text: 'Watches the door', when: 'When…' }, who);
  assert.ok(typeof added !== 'string');
  const role = added.sections.roles.at(-1)!;
  assert.equal(role.name, 'Security officer');
  assert.equal(role.tag, 'answered');
  assert.equal(sourceText(role, 'Alex Lee'), 'added by you · 10:42');
  assert.match(String(applyOp(brief, { op: 'edit', id: 'g1', text: '  ' }, who)), /can’t be empty/);
  assert.match(String(applyOp(brief, { op: 'remove', id: 'nope' }, who)), /isn’t in the brief/);
});

test('a chat turn keeps what the person settled, and what they said in the chat is theirs', () => {
  const { brief } = fakeBrief([]);
  const confirmed = applyOp(brief, { op: 'confirm', id: 'r3' }, who) as typeof brief;
  // The model "forgets" the confirmation and rewords it; and adds a role from the chat.
  const next = structuredClone(confirmed);
  next.sections.roles[2] = { ...next.sections.roles[2], text: 'Reworded', tag: 'assumed', by: undefined, source: 'inferred from kiosk' };
  next.sections.roles.push({ id: 'r9', name: 'Security officer', text: 'Watches the door', when: 'When…', tag: 'answered', source: 'from the chat' });
  const merged = mergeTurn(confirmed, next, who);
  assert.equal(merged.sections.roles[2].text, confirmed.sections.roles[2].text, 'the confirmed item is kept');
  assert.equal(merged.sections.roles[2].tag, 'answered');
  assert.equal(merged.sections.roles.at(-1)!.by?.how, 'chat');
  assert.deepEqual(changedIds(confirmed, merged), ['r9']);
});

test('the brief becomes intake answers Q2, Q4, Q5 and Q8, each item with its tag and source', () => {
  const { brief } = fakeBrief([{ name: 'workshop.md', path: '', text: 'notes' }]);
  const pb: PlanBrief = { brief, attachments: [{ name: 'workshop.md', size: 10, read: 'text' }] };
  const a = intakeFromBrief(pb);
  assert.deepEqual(a.map((x) => x.n), [2, 4, 5, 8]);
  const q2 = a.find((x) => x.n === 2)!;
  assert.equal(q2.kind, 'assumed', 'one assumed success criterion makes Q2 Assumed');
  assert.match(q2.text, /Hosts approve or decline within 5 minutes .*\[ASSUMED, inferred from "hosts respond fast"\]/);
  assert.match(q2.text, /sign visitors in, .*\[Answered, from your description\] \(docs\/project-brief\.md\)/);
  assert.match(q2.text, /\[Answered, from workshop\.md p\.2\]/);
  const q4 = a.find((x) => x.n === 4)!;
  assert.equal(q4.kind, 'answered');
  assert.match(q4.text, /^In scope: Visitor check-in and check-out;.*Out of scope: Parking reservations; Contractor safety inductions\. Input documents: workshop\.md \(in sources\/\)\./);
  assert.equal(a.find((x) => x.n === 5)!.kind, 'assumed');
  const q8 = a.find((x) => x.n === 8)!;
  assert.equal(q8.kind, 'unverified');
  assert.match(q8.text, /\(1\) Do visitors need to accept an NDA/);
  // Written into the toolkit's intake.md, every answer passes gate-check's Stage P marker rule.
  const md = '# intake\n\n## 2. What is this project?\n\n_Not yet asked._ guidance\n\n## 4. Scope\n\n_Not yet asked._\n\n## 5. Must stay\n\n_Not yet asked._\n\n## 8. Anything else\n\n_Not yet asked._\n';
  const out = writeIntakeAnswers(md, a);
  assert.ok(out.includes('Assumed: Give each office'), out);
  assert.ok(out.includes('Unverified — how to verify: ask the client'));
  assert.equal(out.split('\n').filter(isAnswerLine).length, 4);
});

test('approving with items still Assumed records the Stage 0 scope decision CONFIRMED and each assumption as ASSUMED', () => {
  const { brief } = fakeBrief([]);
  const confirmed = applyOp(brief, { op: 'confirm', id: 's2' }, who) as typeof brief;
  const pb: PlanBrief = { brief: confirmed, attachments: [], approved: { by: 'Alex Lee', at: '2026-10-12T10:45:00.000Z', assumed: counts(confirmed).assumed } };
  const rows = briefDecisionRows(pb, '2026-10-12');
  assert.equal(rows[0].stage, '0');
  assert.equal(rows[0].status, 'CONFIRMED 2026-10-12');
  assert.match(rows[0].notes, /Approved by Alex Lee .* at 10:45; 2 items still Assumed, recorded as ASSUMED rows below; triage\.md/);
  assert.match(rows[1].decision, /^Goal: Give each office/);
  assert.equal(rows[1].status, 'CONFIRMED 2026-10-12');
  const assumed = rows.filter((r) => r.status.startsWith('ASSUMED'));
  assert.deepEqual(assumed.map((r) => r.decision.split(':')[0]), ['Brief assumption r3', 'Brief assumption c3']);
  assert.match(assumed[0].notes, /User roles; inferred from "or on a kiosk"; approved with the scope but not yet confirmed/);
  assert.equal(briefDecisionRows({ ...pb, approved: undefined }, '2026-10-12').length, 0, 'nothing before the approval');
  // Into PROJECT.md: every row lands (the decision keys are unique, so none overwrites another), and again changes nothing.
  const reg = '# PROJECT\n\n## Decisions\n\n| Stage | Decision | Status | Notes |\n|---|---|---|---|\n';
  const once = recordDecisions(reg, [], rows);
  assert.equal(once.split('\n').filter((l) => l.startsWith('| 0 |')).length, rows.length);
  assert.equal(recordDecisions(once, [], rows), once);
  assert.match(once, /\| 0 \| Brief assumption c3: Visitor personal data is deleted after 30 days \(GDPR\)\. \| ASSUMED 2026-10-12 \|/);
});

test('the approve copy is honest: it records the Stage 0 scope decision; Stage 0 passes on the triage sign-off', () => {
  // gate-check passes Stage 0 on triage.md's `## Sign-off` (and its capability map), not on a PROJECT.md row.
  const plan = readFileSync(new URL('../src/client/ui/wizard/new/plan.ts', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../src/client/ui/wizard/new/brief-view.ts', import.meta.url), 'utf8');
  const docs = readFileSync(new URL('../docs/site/get-started/first-project.md', import.meta.url), 'utf8');
  for (const src of [plan, docs]) assert.ok(src.includes('Approving records your scope decision for ✋ Stage 0 in PROJECT.md. Stage 0 passes when the Chief Analyst’s triage is signed off.'));
  assert.ok(plan.includes('Stage 0 passes when its triage is signed off.'), 'the approve dialog says when Stage 0 passes');
  assert.ok(view.includes('✋ Stage 0 scope · approved by '));
  for (const src of [plan, view, docs]) {
    assert.doesNotMatch(src, /Stage 0 decision as CONFIRMED|Stage 0 recorded as confirmed|Stage 0 · confirmed by/);
  }
});

test('docs/project-brief.md and the Discovery issue carry the brief, its tags, the domains and what Stage 0 still needs', () => {
  const { brief } = fakeBrief([]);
  const pb: PlanBrief = { brief, domains: fakeDomains(), attachments: [{ name: 'spec.pdf', size: 99, read: 'read' }], approved: { by: 'Alex Lee', at: '2026-10-12T10:45:00.000Z', assumed: 3 } };
  const md = briefMarkdown(pb, { repo: 'org/visitor-registration', entry: 'Requirements-driven' });
  assert.match(md, /^# Project brief: Visitor Registration/);
  assert.match(md, /✋ Stage 0 scope approved\*\* by Alex Lee on 2026-10-12 10:45, with 3 items still \*\*ASSUMED\*\*/);
  assert.match(md, /Hosts approve or decline within 5 minutes during office hours\. _\(ASSUMED · inferred from "hosts respond fast"\)_/);
  assert.match(md, /### VIS: Visitor check-in/);
  assert.match(md, /\*\*VIS-1 Register a walk-in visitor\*\*/);
  assert.match(md, /spec\.pdf: read by the Chief Analyst/);
  const issue = briefForDiscovery(pb).join('\n');
  assert.match(issue, /docs\/project-brief\.md/);
  assert.match(issue, /Still ASSUMED \(confirm these with the client first\):.*Visitor: Signs in on a self-service kiosk/);
  assert.match(issue, /triage\.md/);
  assert.match(issue, /\*\*HST Host approval\*\*/);
});

test('the setup writes the brief: intake answers merged with typed ones, Stage 0 rows, the brief file and sources/', () => {
  const { brief } = fakeBrief([]);
  const plan = cleanPlan(
    {
      kind: 'new', owner: 'org', name: 'visitor-registration', mendix: '11.12.4', entry: 'requirements-driven', tier: 'standard', interview: 'assist',
      intake: [{ n: 7, kind: 'answered', text: 'Jane, weekly' }, { n: 2, kind: 'answered', text: '' }],
      roles: ['chief-analyst', 'lead-developer'], discovery: { issue: true },
      brief: { draftId: 'd-abc123-0a1b2c', brief, domains: fakeDomains(), approved: { by: 'Alex Lee', at: '2026-10-12T10:45:00.000Z', assumed: 99 }, attachments: [{ name: '../notes.md', size: 5, read: 'text' }] },
    },
    ['11.12.4'],
    'org',
  ) as ProjectPlan;
  assert.ok(typeof plan !== 'string');
  assert.equal(plan.brief!.approved!.assumed, 3, 'the count is the brief’s own, not what was sent');
  assert.equal(plan.brief!.attachments[0].name, 'notes.md', 'no folders in a file name');
  const job = { plan, by: 'Alex Lee' } as JobState;
  const ns = intakeAnswersOf(job).map((a) => a.n);
  assert.deepEqual(ns, [1, 2, 4, 5, 7, 8, 9, 11]);
  assert.equal(intakeAnswersOf(job).find((a) => a.n === 7)!.text, 'Jane, weekly');
  const typed = intakeAnswersOf({ ...job, plan: { ...plan, intake: [{ n: 2, kind: 'answered', text: 'POC for the board' }] } } as JobState);
  assert.equal(typed.find((a) => a.n === 2)!.text, 'POC for the board', 'what was typed wins over the brief');
  const { rows } = decisionsOf(job);
  assert.ok(rows.some((r) => r.stage === 'P' && r.decision.startsWith('Entry mode')));
  assert.ok(rows.some((r) => r.stage === '0' && r.status.startsWith('CONFIRMED') && r.decision.startsWith('Scope: project brief approved')));
  assert.equal(rows.filter((r) => r.status.startsWith('ASSUMED')).length, 3);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-brief-'));
  try {
    const src = path.join(dir, 'draft-notes.md');
    writeFileSync(src, '# notes');
    const did = writeBriefFiles(path.join(dir, 'proj'), plan, [{ name: 'notes.md', path: src }, { name: 'other.md', path: src }]);
    assert.deepEqual(did, ['docs/project-brief.md', 'sources/notes.md']);
    assert.ok(existsSync(path.join(dir, 'proj', 'sources', 'notes.md')));
    assert.ok(!existsSync(path.join(dir, 'proj', 'sources', 'other.md')), 'only the brief’s own attachments');
    assert.match(readFileSync(path.join(dir, 'proj', 'docs', 'project-brief.md'), 'utf8'), /Visitor Registration/);
    assert.deepEqual(writeBriefFiles(path.join(dir, 'proj'), plan, [{ name: 'notes.md', path: src }]), [], 'again: nothing to do');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const issue = discoveryBrief(plan, '/tk');
  assert.match(issue, /\*\*What the project is:\*\* Give each office a fast, paperless way/);
  assert.match(issue, /## The project brief \(approved in the wizard\)/);
  mkdirSync(os.tmpdir(), { recursive: true });
});

test('a plan without a brief is as it was; a brief that isn’t one is dropped', () => {
  const base = { kind: 'new', owner: 'org', name: 'leave-app', mendix: '11.12.4', entry: 'greenfield' };
  assert.equal((cleanPlan(base, ['11.12.4'], 'org') as ProjectPlan).brief, undefined);
  assert.equal((cleanPlan({ ...base, brief: { brief: 'nope' } }, ['11.12.4'], 'org') as ProjectPlan).brief, undefined);
  assert.equal(cleanPlanBrief({ brief: { title: 'T', goal: [] }, approved: { by: 'x', at: 'yesterday' } })!.approved, undefined, 'an approval needs a real time');
});

test('attachments: .pdf .docx .md .txt only, 5 MB each, five at most, and names made safe', () => {
  assert.equal(attachProblem('brd.pdf', 1000, 0), undefined);
  assert.equal(attachProblem('Notes.DOCX', 1000, 4), undefined);
  assert.match(attachProblem('image.png', 1000, 0)!, /only \.pdf, \.docx, \.md, \.txt/);
  assert.match(attachProblem('sheet.xlsx', 1000, 0)!, /only/);
  assert.match(attachProblem('big.pdf', 5 * 1024 * 1024 + 1, 0)!, /at most 5 MB/);
  assert.match(attachProblem('empty.txt', 0, 0)!, /empty/);
  assert.match(attachProblem('six.md', 10, 5)!, /At most 5 files/);
  assert.equal(safeFileName('..\\..\\evil\\x.md'), 'x.md');
  assert.equal(safeFileName('a/b/<c>.txt'), '_c_.txt');
  assert.equal(safeFileName('...'), 'file');
});

test('domains are cleaned: three-letter codes, unique, stories numbered CODE-n', () => {
  const d = cleanDomains({ domains: [{ code: 'vis', name: 'Visitors', roles: ['R'], description: '', stories: [{ title: 'A', text: 'As a…', ac: 40 }, { title: 'B', text: 'As a…', ac: 0 }] }, { code: 'VIS', name: 'Visits again', roles: [], description: '', stories: [] }], tier: 'small' })!;
  assert.equal(d.domains[0].code, 'VIS');
  assert.deepEqual(d.domains[0].stories.map((s) => [s.id, s.ac]), [['VIS-1', 9], ['VIS-2', 1]]);
  assert.notEqual(d.domains[1].code, 'VIS');
  assert.equal(d.tier, 'small');
  assert.equal(cleanDomains({ domains: [] }), undefined);
});
