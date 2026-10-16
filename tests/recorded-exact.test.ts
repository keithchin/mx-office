// The exact-answer rule of Recorded as given (reliability pass on Slice 1B-2): the office never claims a
// decision was faithfully recorded without the evidence. A citation only locates a record; the answer value
// on the citation's line (or a BRD question's answer field) must be exactly the decision, normalised only as
// shared/recorded-answer.ts documents. Negations, conditions, quotations, paraphrases, commentary and legacy
// lines need review and never settle anything. No LLM judge, no list of negation words. Real git for the
// settlement path end to end; no office, no Claude, no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { answerKey, answerPart, sameAnswer } from '../src/shared/recorded-answer.js';
import { escalationExpected, faithful, followLevel, primaryAnswer, recordedWords } from '../src/shared/followthrough.js';
import { citations, judgeCitation, judgeQuestion } from '../src/server/followthrough/judge.js';
import { auditEscalation, auditQuestion, questionFromText } from '../src/server/followthrough/audit.js';
import { settleJudged } from '../src/server/questions/book.js';
import { escalationAnswerPrompt } from '../src/server/roster/prompts.js';
import { detectStuck } from '../src/server/stuck/detect.js';
import { STUCK_DEFAULTS } from '../src/shared/stuck.js';
import type { PmAnswer, Question } from '../src/shared/questions.js';
import { git, journal, JOURNAL, team } from './followthrough-helpers.js';

const exp = (text: string, kind: 'reply' | 'approve' | 'reject' = 'reply') => escalationExpected({ text, kind });
const recordedAs = (answer: string, expected: string) => exp(expected).some((e) => sameAnswer(answer, e));
const judge = (line: string, history: { rev: number; kind: 'reply' | 'approve' | 'reject' | 'accept-as-recorded'; text: string; supersedes?: number }[]) => {
  const c = citations(line)[0];
  return judgeCitation(c, history);
};

test("the reviewer's false positives: a negated or signed answer is never the answer", () => {
  assert.ok(!sameAnswer('Do not merge now', 'Merge now'));
  assert.ok(!sameAnswer('Not approved', 'Approved'));
  assert.ok(!sameAnswer('5', '-5'));
  assert.ok(!sameAnswer('-5', '5'));
  assert.ok(sameAnswer('-5', '-5'));
  assert.ok(sameAnswer('−5', '-5'), 'a Unicode minus is a minus');
  // The same through the whole judge: the record cites the decision, but its answer isn't it.
  const h = [{ rev: 1, kind: 'reply' as const, text: 'Merge now' }];
  assert.notEqual(judge('Decided per ESC-ab12 rev 1: Do not merge now', h)?.outcome, 'recorded');
  assert.notEqual(judge('Decided per ESC-ab12 rev 1: Not approved', [{ rev: 1, kind: 'reply', text: 'Approved' }])?.outcome, 'recorded');
  assert.notEqual(judge('Decided per ESC-ab12 rev 1: 5', [{ rev: 1, kind: 'reply', text: '-5' }])?.outcome, 'recorded');
});

test('negated, conditional and quoted occurrences need review, never recorded as given', () => {
  const h = [{ rev: 1, kind: 'reply' as const, text: 'Go with: Merge now' }];
  for (const line of ['Decided per ESC-ab12 rev 1: Do not merge now', 'Decided per ESC-ab12 rev 1: If CI passes, merge now', 'Decided per ESC-ab12 rev 1: "Merge now" was rejected', 'Decided per ESC-ab12 rev 1: Merge now? No.', 'Decided per ESC-ab12 rev 1: Merge now, unless QA objects']) {
    const j = judge(line, h);
    assert.equal(j?.outcome, 'needs-review', line);
    assert.equal(followLevel(j!), 'warn');
  }
  assert.equal(judge('Decided per ESC-ab12 rev 1: Wait for QA', h)?.outcome, 'recorded-differently', 'not even mentioned: plainly different');
  assert.equal(recordedWords({ outcome: 'needs-review' }), 'Needs review: not worded exactly as given');
});

test('only whitespace, Unicode quotes and dashes, case, wrapping quotes and a final full stop are normalised', () => {
  assert.equal(answerKey('  Use  SSO.  '), 'use sso');
  assert.equal(answerKey('“Use SSO”'), 'use sso');
  assert.equal(answerKey('`Use SSO`'), 'use sso');
  assert.equal(answerKey("We’ll use SSO – staff only"), "we'll use sso - staff only");
  assert.equal(answerKey('Wait...'), 'wait...', 'an ellipsis keeps its dots');
  assert.ok(!sameAnswer('Use SSO!', 'Use SSO'), 'other punctuation is meaning-bearing');
  assert.ok(!sameAnswer('Use SSO (Entra)', 'Use SSO'));
  assert.ok(!sameAnswer('x²', 'x2'), 'no NFKC folding');
  assert.ok(!sameAnswer('', ''), 'an empty answer never matches');
  assert.ok(!sameAnswer(undefined, 'Use SSO'));
  // The verdict word of an approval without words, in any case.
  assert.ok(exp('', 'approve').some((e) => sameAnswer('APPROVED', e)));
  assert.ok(!exp('', 'approve').some((e) => sameAnswer('NOT APPROVED', e)));
  // An option key and the office's own "Go with:" may be left out.
  assert.ok(recordedAs('Use SSO', 'Go with: (A) Use SSO'));
  assert.ok(recordedAs('Go with: Use SSO', 'Go with: Use SSO'));
});

test("the answer part: after the citation's colon, to the end of the line or the table cell", () => {
  const at = (line: string) => {
    const m = /Decided per ESC-\w+ rev \d+/i.exec(line)!;
    return answerPart(line, m.index, m.index + m[0].length);
  };
  assert.equal(at('Decided per ESC-ab12 rev 2: Merge now'), 'Merge now');
  assert.equal(at('- **Decided per ESC-ab12 rev 2:** Merge now'), 'Merge now');
  assert.equal(at('**Decided per ESC-ab12 rev 2**: Merge now'), 'Merge now');
  assert.equal(at('`Decided per ESC-ab12 rev 2: Merge now`'), 'Merge now');
  assert.equal(at('| D-4 | Decided per ESC-ab12 rev 2: Merge now | CI green, Keith |'), 'Merge now');
  assert.equal(at('| D-4 | Decided per ESC-ab12 rev 2: A \\| B | x |'), 'A | B');
  assert.equal(at('Decided per ESC-ab12 rev 2 — Merge now'), undefined, 'no colon: no answer part (a legacy line)');
  assert.equal(at('Decided per ESC-ab12 rev 2:'), '');
  // The next line is commentary, never the answer.
  const c = citations('Decided per ESC-ab12 rev 2: Merge now\nBecause CI is green.');
  assert.deepEqual([c[0].answer, c[0].block], ['Merge now', 'Decided per ESC-ab12 rev 2: Merge now\nBecause CI is green.']);
});

test('an exact current-revision answer passes; an exact older-revision answer does not count for the current one', () => {
  const h = [
    { rev: 1, kind: 'reply' as const, text: 'Go with: Use SSO' },
    { rev: 2, kind: 'reply' as const, text: 'Go with: Use magic links', supersedes: 1 },
  ];
  assert.deepEqual([judge('Decided per ESC-ab12 rev 2: Use magic links.', h)?.outcome, judge('Decided per ESC-ab12 rev 2: Use magic links.', h)?.rev], ['recorded', 2]);
  // Rev 1's exact answer, cited as rev 1: recorded for rev 1, not as given for rev 2.
  const older = judge('Decided per ESC-ab12 rev 1: Use SSO', h);
  assert.deepEqual([older?.outcome, older?.rev], ['recorded-older-rev', 1]);
  // Rev 1's answer under rev 2's citation: not the current decision.
  assert.notEqual(judge('Decided per ESC-ab12 rev 2: Use SSO', h)?.outcome, 'recorded');
  // A question: rev 1's exact answer is recorded for rev 1, never as given for rev 2.
  const q = { key: 'k', id: 'OQ-1', file: 'F.brd.json', question: 'x', state: 'ANSWERED', rawStatus: 'ANSWERED', answer: 'Weekly', source: { where: 'main', committed: true } } as Question;
  assert.equal(judgeQuestion(q, { answerRev: 2, expected: [{ rev: 1, state: 'ANSWERED', answer: 'Weekly' }, { rev: 2, state: 'ANSWERED', answer: 'Daily' }] }).outcome, 'recorded-older-rev');
});

test('commentary cannot substitute for the answer', () => {
  const h = [{ rev: 1, kind: 'reply' as const, text: 'Merge now' }];
  assert.notEqual(judge('Decided per ESC-ab12 rev 1: see below\nMerge now', h)?.outcome, 'recorded');
  assert.notEqual(judge('Decided per ESC-ab12 rev 1:\nMerge now', h)?.outcome, 'recorded', 'an empty answer part');
  assert.notEqual(judge('Decided per ESC-ab12 rev 1 (Merge now)', h)?.outcome, 'recorded', 'no colon');
  assert.notEqual(judge('| D-1 | Decided per ESC-ab12 rev 1: per Keith | Merge now |', h)?.outcome, 'recorded', 'another cell');
  assert.notEqual(judge('Decided per ESC-ab12 rev 1: Merge now. CI is green, Keith agreed.', h)?.outcome, 'recorded', 'commentary on the answer line');
});

test('questions: the BRD field is the answer value, compared exactly', () => {
  const q = (answer: string) => ({ key: 'k', id: 'OQ-1', file: 'F.brd.json', question: 'x', state: 'ANSWERED', rawStatus: 'ANSWERED', answer, source: { where: 'main', committed: true } }) as Question;
  const a = (answer: string) => ({ answerRev: 1, expected: [{ rev: 1, state: 'ANSWERED' as const, answer }] });
  assert.equal(judgeQuestion(q('Not approved'), a('Approved')).outcome, 'needs-review');
  assert.equal(judgeQuestion(q('5'), a('-5')).outcome, 'needs-review');
  assert.equal(judgeQuestion(q('Weekly, on Mondays, unless it is a holiday'), a('Weekly, on Mondays.')).outcome, 'needs-review');
  assert.equal(judgeQuestion(q('weekly, on Mondays'), a('Weekly, on Mondays.')).outcome, 'recorded');
  // MOOT's status is "MOOT - <reason>".
  const moot = { ...q(''), state: 'MOOT', rawStatus: 'MOOT - out of scope' } as Question;
  assert.equal(judgeQuestion(moot, { answerRev: 1, expected: [{ rev: 1, state: 'MOOT', reason: 'out of scope' }] }).outcome, 'recorded');
  assert.equal(judgeQuestion({ ...moot, rawStatus: 'MOOT - not out of scope' } as Question, { answerRev: 1, expected: [{ rev: 1, state: 'MOOT', reason: 'out of scope' }] }).outcome, 'needs-review');
});

test('a question recorded not exactly, even merged, is never marked recorded (settleJudged)', () => {
  const q = { key: 'k', id: 'OQ-1', file: 'F.brd.json', question: 'x', state: 'ANSWERED', rawStatus: 'ANSWERED', answer: 'Not approved', source: { where: 'main', committed: true } } as Question;
  const a = { key: 'k', id: 'OQ-1', file: 'F.brd.json', kind: 'answer', text: 'Approved', by: 'Keith', at: 1, status: 'sent', answerRev: 1, expected: [{ rev: 1, state: 'ANSWERED', answer: 'Approved' }] } as PmAnswer;
  const j = judgeQuestion(q, a);
  a.recording = { outcome: j.outcome, rev: j.rev, text: j.text, location: { path: 'x', where: 'merged-into-main' }, at: 1 };
  assert.deepEqual(settleJudged([{ a, q }], 2), []);
  assert.equal(a.status, 'sent');
});

test('the instruction: the exact line to write, the answer alone after the colon, commentary on the next line', async () => {
  const t = await team('Release: merge now?', 'Merge now');
  const typed = t.floor.prompts.map((p) => p.text).join('\n');
  assert.ok(typed.includes(`\n    Decided per ESC-${t.e.id} rev 1: Merge now\n`), typed);
  assert.match(typed, /Put those on the next line/);
  assert.ok(escalationAnswerPrompt(t.e, 'approve', '', 'Keith', undefined, 3).includes(`Decided per ESC-${t.e.id} rev 3: APPROVED`));
  assert.ok(escalationAnswerPrompt(t.e, 'reply', 'Go with: Use\n  SSO', 'Keith', undefined, 2).includes(`Decided per ESC-${t.e.id} rev 2: Use SSO`));
  assert.equal(primaryAnswer({ text: '', kind: 'reject' }), 'REJECTED');
  // The line the office asks for is one the office reads as given.
  journal(t.repo.dir, `Decided per ESC-${t.e.id} rev 1: Merge now\nCI is green; Keith confirmed at standup.`);
  assert.equal((await t.scan())?.outcome, 'recorded');
});

test('settlement end to end: a mismatching record, merged into main, cannot settle dependent work; the exact one does', async () => {
  const t = await team('OW-1: Merge now?', 'Merge now');
  assert.equal(t.e.refs?.decisionId, 'OW-1');
  const project = { file: 'PROJECT.md', text: '## Open questions\n\n| ID | Question | Owner | Status |\n| --- | --- | --- | --- |\n| OW-1 | Merge now? | PM | open since 2026-10-01 |\n\n## Decisions\n\n| ID | Decision | Status |\n| --- | --- | --- |\n| D-1 | OW-1: merge | CONFIRMED 2026-10-14 |\n' };
  const base = { now: Date.parse('2026-10-15T12:00:00Z'), settings: { ...STUCK_DEFAULTS, on: true }, pulls: [], files: { project, reports: [] }, firstSeen: () => Date.parse('2026-10-01T00:00:00Z') };
  for (const wrong of ['Do not merge now', 'If CI passes, merge now', '"Merge now" was rejected']) {
    writeFileSync(path.join(t.repo.dir, JOURNAL), `# Development team journal\n\nDecided per ESC-${t.e.id} rev 1: ${wrong}\n`);
    git(t.repo.dir, 'commit', '-qam', `journal: ${wrong}`);
    git(t.repo.dir, 'push', '-q', 'origin', 'main');
    const r = await t.scan();
    assert.deepEqual([r?.outcome, r?.location?.where, r?.answer], ['needs-review', 'merged-into-main', wrong]);
    assert.ok(!faithful(r, 1));
    const check = await t.ft.settledFor(t.floor.id);
    assert.equal(check('OW-1'), 'pending', wrong);
    assert.ok(detectStuck({ ...base, settled: check }).some((x) => x.id === 'decision-OW-1'), `still open: ${wrong}`);
    const it = (await t.ft.view(t.floor.id, true)).items.find((i) => i.decision === `esc:${t.e.id}`);
    assert.equal(it?.recording.outcome, 'needs-review', 'shown to the person');
  }
  // The person may still act on it (Accept as recorded / Send correction are offered for needs review).
  writeFileSync(path.join(t.repo.dir, JOURNAL), `# Development team journal\n\nDecided per ESC-${t.e.id} rev 1: Merge now\nCI passed first.\n`);
  git(t.repo.dir, 'commit', '-qam', 'journal: exact');
  git(t.repo.dir, 'push', '-q', 'origin', 'main');
  assert.equal((await t.scan())?.outcome, 'recorded');
  const now = await t.ft.settledFor(t.floor.id);
  assert.equal(now('OW-1'), 'faithful');
  assert.equal(detectStuck({ ...base, settled: now }).find((x) => x.id === 'decision-OW-1'), undefined);
});

test('a needs-review record can be accepted as recorded by the person (a new revision), and then reads as given', async () => {
  const t = await team('Release: merge now?', 'Merge now');
  journal(t.repo.dir, `Decided per ESC-${t.e.id} rev 1: Merge now, after the demo`);
  assert.equal((await t.scan())?.outcome, 'needs-review');
  const r = await t.ft.act(t.floor.id, `esc:${t.e.id}`, 'accept-as-recorded', { by: 'Keith', expectedRev: 1 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([(await t.scan())?.outcome, t.e.resolution?.answerRev], ['recorded', 2]);
});

test('historical check: automatic findings that relied on the old match are listed; a person acceptance is skipped; nothing is written', () => {
  const hist = [{ rev: 1, kind: 'reply' as const, text: 'Go with: Merge now' }];
  const rec = (text: string, where: 'merged-into-main' | 'committed-on-branch' = 'merged-into-main') => ({ outcome: 'recorded' as const, rev: 1, text, location: { path: JOURNAL, commitSha: 'a'.repeat(40), where }, at: 1 });
  // Re-read from the committed file: the old match said as given, the exact rule says needs review.
  const bad = auditEscalation('esc:ab12', rec('Do not merge now'), hist, '# J\n\nDecided per ESC-ab12 rev 1: Do not merge now\n');
  assert.ok(bad && 'finding' in bad);
  assert.deepEqual([bad.finding.now, bad.finding.settled, bad.finding.answer, bad.finding.basis], ['needs-review', true, 'Do not merge now', 'committed-file']);
  // Still exact: nothing to report.
  assert.equal(auditEscalation('esc:ab12', rec('Merge now'), hist, 'Decided per ESC-ab12 rev 1: Merge now\nCI green.\n'), undefined);
  // Not a "recorded as given" finding: nothing to report.
  assert.equal(auditEscalation('esc:ab12', { outcome: 'recorded-differently', rev: 1, at: 1 }, hist, ''), undefined);
  // On a branch, never settled, but it read as given: listed, not settled.
  const branch = auditEscalation('esc:ab12', rec('Merge now, unless QA objects', 'committed-on-branch'), hist, 'Decided per ESC-ab12 rev 1: Merge now, unless QA objects\n');
  assert.ok(branch && 'finding' in branch && !branch.finding.settled);
  // A person's acceptance is never re-judged.
  const accepted = auditEscalation('esc:ab12', { ...rec('anything'), rev: 2 }, [...hist, { rev: 2, kind: 'accept-as-recorded', text: 'anything', supersedes: 1 }], 'Decided per ESC-ab12 rev 1: anything');
  assert.ok(accepted && 'skip' in accepted);
  // No file to read: from the text the office kept (approximate).
  const kept = auditEscalation('esc:ab12', rec('Do not merge now'), hist);
  assert.ok(kept && 'finding' in kept && kept.finding.basis === 'stored-text');
  // Questions: the kept "ANSWERED: …" read back and compared exactly.
  const a = { key: 'k', id: 'OQ-1', file: 'F.brd.json', kind: 'answer', by: 'K', at: 1, status: 'recorded', answerRev: 1, expected: [{ rev: 1, state: 'ANSWERED', answer: 'Approved' }], recording: { outcome: 'recorded', rev: 1, text: 'ANSWERED: Not approved', at: 1 } } as PmAnswer;
  const qa = auditQuestion('q:k', a, [{ rev: 1, kind: 'answer', text: 'Approved' }]);
  assert.ok(qa && 'finding' in qa);
  assert.deepEqual([qa.finding.now, qa.finding.settled], ['needs-review', true]);
  assert.equal(auditQuestion('q:k', { ...a, recording: { ...a.recording!, text: 'ANSWERED: approved.' } }, []), undefined);
  assert.equal(questionFromText(a, 'ASSUMED: Site setting (consent: Keith, 2026-10-15T09:00Z)')?.consentAt, '2026-10-15T09:00Z');
  assert.equal(a.status, 'recorded', 'the audit changes nothing');
});
