// What the first real Chief Analyst run (2026-10-12, Sonnet 5.5, one workshop PDF) showed, kept as
// fixtures (tests/fixtures/planner-real/: the three calls' structured answers, fictional sample data) and
// replayed with no model call: a confirmation said in the chat is recorded and highlighted, PROJECT.md's
// own sections agree with its Decisions rows, an "assumption" that only says something isn't known is
// an open question, role statements the model wrote say so, open questions keep their source, joined
// lines have no double punctuation, and the start page's estimate is priced as the meter books it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { changedIds, cleanBrief, cleanDomains, counts, DRAFTED, mergeTurn, sourceText, whenDrafted, applyOp, type Brief, type PlanBrief } from '../src/shared/brief.js';
import { briefAssumptions, briefAsText, briefDecisionRows, briefForDiscovery, briefMarkdown, briefOpenQuestions, intakeFromBrief } from '../src/shared/brief-map.js';
import { recordBriefRegister, recordDecisions, openQuestions } from '../src/server/wizard/register.js';
import { Planner, type PlannerConfig } from '../src/server/wizard/planner/index.js';
import type { PlannerEngine } from '../src/server/wizard/planner/engine.js';
import { priceOf, resolvedModel } from '../src/server/usage.js';
import { BRIEF_SCHEMA } from '../src/shared/brief-schema.js';

const FIX = path.join(import.meta.dirname, 'fixtures', 'planner-real');
const raw = (name: string) => JSON.parse(readFileSync(path.join(FIX, name), 'utf8')) as Record<string, unknown>;
const who = { name: 'Alex Lee', at: '2026-10-12T13:21:56.000Z' };
const briefCall = () => cleanBrief(raw('call1-brief-structured.json'))!;
const chatCall = () => cleanBrief(raw('call2-chat-structured.json'))!;
const item = (b: Brief, id: string) => Object.values(b.sections).flat().find((x) => x.id === id)!;

/** PROJECT.md as the toolkit's bin/init-project.sh writes it (its last three sections). */
const REGISTER = [
  '# PROJECT.md — visitor-registration Decision Register',
  '',
  '## Decisions',
  '',
  '| Stage | Decision | Status | Notes |',
  '|---|---|---|---|',
  '',
  '## Open questions',
  '',
  '| # | Question | Raised at | Status |',
  '|---|---|---|---|',
  '',
  '## Assumptions (ASSUMED, unresolved)',
  '',
  'None yet.',
  '',
].join('\r\n');

test('real run: a chat turn that only re-sources items to the chat is the person confirming them, highlighted, and the version goes up', () => {
  const before = briefCall();
  const next = chatCall();
  // The real answer: r4 and i5 were already in the brief from the PDF; only their source now starts "from the chat".
  assert.equal(item(next, 'r4').text, item(before, 'r4').text);
  assert.match(item(next, 'r4').source, /^from the chat; /);
  const merged = cleanBrief(mergeTurn(before, next, who))!;
  for (const id of ['r4', 'i5']) {
    assert.equal(item(merged, id).by?.how, 'chat-confirmed', id);
    assert.equal(item(merged, id).tag, 'answered');
    assert.equal(sourceText(item(merged, id), 'Alex Lee'), 'confirmed by you in the chat · 13:21');
  }
  assert.deepEqual(changedIds(before, merged), ['r4', 'i5'], 'exactly the two items the reply says it marked');
  // Saved and cleaned again, it stays the person's; a second identical turn changes nothing.
  const again = cleanBrief(mergeTurn(merged, next, who))!;
  assert.deepEqual(changedIds(merged, again), []);
  // An Assumed item confirmed this way becomes Answered.
  const s3 = structuredClone(next);
  s3.sections.success[2] = { ...s3.sections.success[2], source: 'from the chat' };
  const m3 = mergeTurn(before, s3, who);
  assert.equal(item(m3, 's3').tag, 'answered');
  assert.equal(item(m3, 's3').by?.how, 'chat-confirmed');
  assert.equal(counts(m3).assumed, counts(before).assumed - 1);
  // An item the person had confirmed with the button keeps that record.
  const confirmed = applyOp(before, { op: 'confirm', id: 's6' }, who) as Brief;
  const s6 = structuredClone(next);
  s6.sections.success[5] = { ...s6.sections.success[5], tag: 'answered', source: 'from the chat' };
  assert.equal(item(mergeTurn(confirmed, s6, who), 's6').by?.how, 'confirmed');
});

test('real run, through the planner: the chat confirmation bumps the draft version and highlights both items', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-planner-real-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const chat = raw('call2-chat-structured.json');
  const engine: PlannerEngine = {
    kind: 'cli',
    model: 'sonnet',
    why: () => undefined,
    brief: async () => ({ value: { brief: briefCall(), filesRead: [] }, cost: 0.049 }),
    chat: async () => ({ value: { brief: chatCall(), reply: String(chat.reply) }, cost: 0.047 }),
    domains: async () => ({ value: cleanDomains(raw('call3-domains-structured.json'))!, cost: 0.029 }),
  };
  const cfg: PlannerConfig = { mode: 'auto', model: 'sonnet', capUsd: 2, timeoutMs: 1000, perHour: 20 };
  const p = new Planner(dir, { engine, config: cfg });
  const me = { id: 'u1', name: 'Alex Lee' };
  const d = p.create(me, { prompt: 'Visitor Registration: an office visitor sign-in app.' });
  assert.equal(p.draft(d, me), undefined);
  await p.running.get(d.id);
  assert.equal(d.version, 1);
  assert.equal(p.chat(d, 'We also have a security desk that checks visitors against a watch list.', me), undefined);
  await p.running.get(d.id);
  assert.equal(d.version, 2, 'the brief changed: DRAFT v2');
  assert.deepEqual(d.chat.at(-1)!.changed, ['r4', 'i5']);
  assert.equal(item(d.brief!, 'r4').by?.how, 'chat-confirmed');
});

test('real run: an "assumption" that only says something is not stated is an open question', () => {
  const b = briefCall();
  // c6 in the real answer: "The host notification channel, the badge printer models and the kiosk hardware are not stated." tagged assumed.
  assert.ok(!b.sections.constraints.some((x) => /not stated/.test(x.text)), 'not left in the constraints');
  const q = b.sections.questions.find((x) => /not stated/.test(x.text))!;
  assert.equal(q.tag, 'unverified');
  assert.equal(q.source, 'open question');
  assert.equal(q.id, 'q9', 'numbered after the questions the model wrote');
  assert.deepEqual(counts(b), { assumed: 3, open: 9, answered: 24 });
  // A concrete default stays an assumption, and so does an item a person settled.
  assert.equal(item(b, 'c5').tag, 'assumed');
  const kept = cleanBrief({ constraints: [{ text: 'The printer model is unknown.', tag: 'assumed', source: 'inferred', by: { name: 'Alex Lee', at: who.at, how: 'edited' } }] })!;
  assert.equal(kept.sections.constraints.length, 1);
  const scope = cleanBrief({ scope: [{ side: 'in', text: 'Kiosk hardware: unclear.', tag: 'assumed', source: 'inferred' }] })!;
  assert.equal(scope.sections.scope.length, 0);
  assert.equal(scope.sections.questions[0].side, undefined, 'a question has no scope side');
});

test('real run: role statements the model wrote say "drafted by the Chief Analyst", whatever the role’s own tag', () => {
  const b = briefCall();
  const r1 = item(b, 'r1');
  assert.equal(r1.tag, 'answered', 'the role itself is from the PDF');
  assert.equal(r1.whenSource, DRAFTED, 'the real answer gave no source for the statement');
  assert.ok(whenDrafted(r1));
  const sourced = cleanBrief({ roles: [{ name: 'Host', text: 'Employee', when: 'When my visitor arrives, I need to approve.', whenSource: 'from notes.pdf p.1', tag: 'answered', source: 'from notes.pdf p.1' }] })!;
  assert.ok(!whenDrafted(sourced.sections.roles[0]), 'a statement a document gives is not drafted');
  // A person who edits the role makes the statement theirs.
  const edited = applyOp(b, { op: 'edit', id: 'r1', when: 'When I arrive, I need to sign in fast.' }, who) as Brief;
  assert.ok(!whenDrafted(item(edited, 'r1')));
  // The files say it too, and the model is told which statements are its own.
  const pb: PlanBrief = { brief: b, attachments: [] };
  assert.match(briefMarkdown(pb, { repo: 'org/visitor-registration', entry: 'Requirements-driven' }), /_When I arrive at an office, .*_ \(drafted by the Chief Analyst\) _\(Answered · from visitor-process-workshop\.pdf p\.1\)_/);
  assert.match(briefAsText(b), /"whenSource":"drafted"/);
  assert.ok((BRIEF_SCHEMA.properties.roles.items as { required: string[] }).required.includes('whenSource'), 'the schema asks for it');
});

test('open questions keep the document they came from', () => {
  const b = cleanBrief({ questions: [{ text: 'Does Harbour Point need an NDA?', tag: 'unverified', source: 'open question (from visitor-process-workshop.pdf p.2)' }, { text: 'Which printers?', tag: 'unverified', source: 'from visitor-process-workshop.pdf p.3' }, { text: 'SSO?', tag: 'unverified', source: 'inferred from nothing' }] })!;
  assert.deepEqual(b.sections.questions.map((q) => q.source), ['open question (from visitor-process-workshop.pdf p.2)', 'open question (from visitor-process-workshop.pdf p.3)', 'open question']);
  assert.equal(sourceText(b.sections.questions[0]), 'open question (from visitor-process-workshop.pdf p.2)', 'what the page shows');
});

test('real run: PROJECT.md lists the assumptions and the open questions, and the office reads them back', () => {
  const brief = cleanBrief(mergeTurn(briefCall(), chatCall(), who))!;
  brief.sections.questions[1] = { ...brief.sections.questions[1], source: 'open question (from visitor-process-workshop.pdf p.2)' };
  const pb: PlanBrief = { brief, attachments: [], approved: { by: 'Alex Lee', at: '2026-10-12T13:22:00.000Z', assumed: counts(brief).assumed } };
  const rows = briefDecisionRows(pb, '2026-10-12');
  const md = recordBriefRegister(recordDecisions(REGISTER, [], rows), briefOpenQuestions(pb), briefAssumptions(pb));
  assert.ok(md.includes('\r\n') && !/[^\r]\n/.test(md), 'the file keeps its CRLF line ends');
  const text = md.replace(/\r/g, '');
  const assumptions = /## Assumptions \(ASSUMED, unresolved\)\n([\s\S]*)$/.exec(text)![1];
  assert.ok(!/None yet/.test(assumptions), 'no "None yet." beside ASSUMED rows');
  const assumedRows = rows.filter((r) => r.status.startsWith('ASSUMED')).map((r) => r.decision.split(':')[0]);
  assert.deepEqual(assumedRows, ['Brief assumption s3', 'Brief assumption s6', 'Brief assumption c5']);
  for (const id of ['s3', 's6', 'c5']) assert.match(assumptions, new RegExp(`^- Brief assumption ${id}: .*Recorded as an ASSUMED Stage 0 row`, 'm'));
  const open = openQuestions(md);
  assert.equal(open.length, 9, 'the eight the model wrote and the "not stated" one');
  assert.match(open[0], /^Should the watch-list check be automatic/);
  assert.match(open[1], /\(from visitor-process-workshop\.pdf p\.2\)$/);
  assert.match(text, /^\| OQ-01 \| Should the watch-list check .* \| Stage 0: project brief q1 \(docs\/project-brief\.md\) \| OPEN \|$/m);
  assert.match(text, /^\| OQ-09 \| /m);
  // Again: nothing changes; a question someone added by hand stays and the numbers go on after it.
  assert.equal(recordBriefRegister(md, briefOpenQuestions(pb), briefAssumptions(pb)), md);
  const hand = md.replace('| OQ-09 |', '| OQ-10 | Who signs off the kiosk? | Stage 0 | OPEN |\r\n| OQ-09 |');
  const more = recordBriefRegister(hand, [...briefOpenQuestions(pb), { question: 'A new one?', raised: 'Stage 0', status: 'OPEN' }], briefAssumptions(pb));
  assert.match(more, /\| OQ-11 \| A new one\? \|/);
  assert.equal(openQuestions(more).length, 11);
  // Nothing approved, nothing written.
  assert.equal(recordBriefRegister(REGISTER, briefOpenQuestions({ ...pb, approved: undefined }), briefAssumptions({ ...pb, approved: undefined })), REGISTER);
});

test('real run: joined lines have no double punctuation (intake Q4 and Q5, the Discovery issue)', () => {
  const b = briefCall();
  const pb: PlanBrief = { brief: b, attachments: [{ name: 'visitor-process-workshop.pdf', size: 56060, read: 'read' }], approved: { by: 'Alex Lee', at: '2026-10-12T13:22:00.000Z', assumed: 3 } };
  const a = intakeFromBrief(pb);
  const heads = [a.find((x) => x.n === 4)!.text.split('\n')[0], a.find((x) => x.n === 5)!.text.split('\n')[0], ...briefForDiscovery(pb)];
  for (const h of heads) assert.ok(!/[.;:]\s*[.;]|\.\./.test(h), h);
  assert.match(heads[0], /^In scope: Visitor sign-in at reception and on a kiosk; Host notification/);
  assert.match(heads[1], /90 days; The facilities manager|after 90 days\. The facilities manager and the data protection officer decided this; Badges expire/);
});

test('the estimate is priced as the meter books the call: sonnet runs claude-sonnet-5-5 at $2/$10, about $0.15 for the real draft', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-planner-est-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(resolvedModel('sonnet'), 'claude-sonnet-5-5');
  assert.deepEqual(priceOf(resolvedModel('sonnet')), [2, 10, 0.1], 'the documented price (checked 2026-10-16), cache reads included');
  const engine = { kind: 'cli', model: 'sonnet', why: () => undefined } as unknown as PlannerEngine;
  const s = new Planner(dir, { engine, config: { mode: 'auto', model: 'sonnet', capUsd: 2, timeoutMs: 1000, perHour: 20 } }).status();
  const real = 0.049 + 0.047 + 0.029; // brief (with the 0.056 MB PDF), one chat turn, the domains
  const shown = s.estimateUsd + s.perMbUsd * 0.05606;
  assert.ok(shown >= real, `on the safe side: ${shown} against ${real}`);
  assert.ok(shown <= real * 1.3, `but not twice it any more: ${shown}`);
  // As the start page rounds it: to the next 5 cents.
  assert.equal(Math.max(0.05, Math.ceil(shown * 20) / 20), 0.15);
});
