// Nothing waits on the PM unseen, S7: assumptions without your consent. PROJECT.md Decisions rows marked
// ASSUMED whose notes say the client or the PM wasn't asked, or record no consent (the toolkit's
// consentBy/consentAt, or plain words for it: "you decide", "the PM chose"), become one Needs-you warn row
// with Agree (your consent goes to the lead to record) and Discuss. Read from main and the worktrees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { actMessage, assumptions, assumptionsWithoutConsent, hasConsent } from '../src/server/asks/detect.js';
import { AsksService, type AsksDeps, type AsksFloor } from '../src/server/asks/service.js';
import { collectNeeds, hereCount } from '../src/shared/needsyou.js';
import type { Read } from '../src/server/asks/sources.js';

// Rows shaped like the live projects' (2026-10-13).
const PROJECT = `# PROJECT.md

## Decisions

| Stage | Decision | Status | Notes |
|---|---|---|---|
| P | Entry mode: requirements-driven | CONFIRMED | Keith, 2026-10-05 |
| P | Exec approval: auto | ASSUMED 2026-10-05 | Default stated in chat; no objection. Irrelevant until Stage 5. |
| 0 | >3-day rule (conflict C2) is NOT a rule in this app | ASSUMED 2026-10-05 | Keith was told in the CAC-1 summary and did not object; he has not answered this directly. |
| 1 | Extraction scope: whole BRD, no change against Stage 0 scope | ASSUMED 2026-10-13 | Delta against Stage 0 is empty; client not asked separately |
| 2 | NFRs: use the POC-level assumptions | ASSUMED | PM via Ada in chat 2026-10-08 ("use assumption"); the PM explicitly chose the assumption |
| 3 | Values the BRD omits (provider deadline draft 8 s) | ASSUMED 2026-10-13 | CAC-3 Q5 "you decide"; architect's draft values stand |
| 4 | Retention: 7 years | ASSUMED | consentBy: Maurits Visser, consentAt: 2026-10-12 |
| 4 | Data volumes for slice 1 | ASSUMED | architect's estimate |

## Open questions

| # | Question | Raised at | Status |
|---|---|---|---|
| OQ-1 | ASSUMED-looking text here is not a decision | x | RAISED |
`;

test('consent in the notes: consentBy/consentAt or plain words; "no objection" or "not asked" is no consent', () => {
  assert.ok(hasConsent('consentBy: Maurits Visser, consentAt: 2026-10-12'));
  assert.ok(hasConsent('CAC-3 Q5 "you decide"'));
  assert.ok(hasConsent('the PM explicitly chose the assumption'));
  assert.ok(!hasConsent('Default stated in chat; no objection.'));
  assert.ok(!hasConsent('client not asked separately'));
  assert.ok(!hasConsent("architect's estimate"));
});

test('ASSUMED decision rows without consent, and only in the Decisions table', () => {
  assert.deepEqual(assumptionsWithoutConsent(PROJECT).map((a) => `${a.stage}: ${a.decision}`), ['P: Exec approval: auto', '0: >3-day rule (conflict C2) is NOT a rule in this app', '1: Extraction scope: whole BRD, no change against Stage 0 scope', '4: Data volumes for slice 1']);
});

const read = (who: string, text: string): Read => ({ place: { kind: 'worktree', who, dir: '/x' }, files: new Map([['PROJECT.md', text]]) });

test('one warn row listing them, with Agree and Discuss; a worktree that recorded consent settles a row, and its new rows count', () => {
  const it = assumptions(PROJECT, [])!;
  assert.equal(it.kind, 'assumption');
  assert.equal(it.level, 'warn');
  assert.match(it.text, /^4 assumptions made without your consent: Stage P: Exec approval: auto; Stage 0: >3-day rule/);
  assert.deepEqual(it.acts.map((a) => [a.act, a.label]), [['agree', 'Agree'], ['discuss', 'Discuss']]);
  // A worktree's copy records consent for one and adds a new assumption.
  const wt = PROJECT.replace('| P | Exec approval: auto | ASSUMED 2026-10-05 | Default stated in chat; no objection. Irrelevant until Stage 5. |', '| P | Exec approval: auto | ASSUMED 2026-10-05 | consentBy: Keith, consentAt: 2026-10-13 |').replace("| 4 | Data volumes for slice 1 | ASSUMED | architect's estimate |", "| 4 | Data volumes for slice 1 | ASSUMED | architect's estimate |\n| 5 | Seed data names | ASSUMED 2026-10-13 | stubs until the client sends them; not asked yet |");
  const both = assumptions(PROJECT, [read('Dylan', wt)])!;
  assert.match(both.text, /^4 assumptions made without your consent/);
  assert.ok(!both.text.includes('Exec approval'));
  assert.ok(both.text.includes('Seed data names'));
  assert.equal(assumptions(undefined, []), undefined);
  // In Needs you: worth a look, and counted.
  const needs = collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], asks: { floor: 'f1', items: [it] } });
  assert.deepEqual(needs.map((n) => [n.kind, n.level, n.action, n.alt?.action]), [['assumption', 'warn', 'Agree', 'Discuss']]);
  assert.equal(hereCount(needs), 1);
});

test('Agree sends your consent to the lead to record (consentBy/consentAt); Discuss asks for an escalation; both are audited', async () => {
  const it = assumptions(PROJECT, [])!;
  assert.match(actMessage('agree', it, 'Keith', Date.parse('2026-10-13T12:00:00Z')) ?? '', /add consentBy: Keith and consentAt: 2026-10-13 to its notes/);
  assert.match(actMessage('discuss', it, 'Keith') ?? '', /Raise them with office-workers escalate/);
  const told: string[] = [];
  const audits: string[] = [];
  const floor: AsksFloor = { id: 'f1', name: 'p', dir: mkdtempSync(path.join(os.tmpdir(), 'asks-c-')), people: () => [] };
  const deps: AsksDeps = { dataDir: mkdtempSync(path.join(os.tmpdir(), 'asks-cd-')), floors: () => [floor], now: () => Date.parse('2026-10-13T12:00:00Z'), writerOf: () => undefined, escalations: () => [], raise: () => {}, markGone: () => {}, detectInput: async () => ({ mainProject: PROJECT }), lead: () => ({ name: 'Ada' }), tell: (_f, text) => (told.push(text), undefined), record: (e) => void audits.push(e.action) };
  const svc = new AsksService(deps);
  await svc.look(floor, 'test');
  const v = await svc.view(floor, true);
  assert.equal(v.items.length, 1);
  assert.equal(await svc.act(floor, v.items[0].id, 'discuss', { by: 'Keith' }), undefined);
  assert.equal((await svc.view(floor, true)).items.length, 1, 'still shown: nothing agreed yet');
  assert.equal(await svc.act(floor, v.items[0].id, 'agree', { by: 'Keith' }), undefined);
  assert.equal((await svc.view(floor, true)).items.length, 0, 'hidden once agreed, until the set changes');
  assert.equal(told.length, 2);
  assert.match(told[1], /The Project Manager \(Keith\) agrees with these assumptions/);
  assert.deepEqual(audits, ['asks.discuss', 'asks.agree']);
  assert.equal(await svc.act(floor, 'nope', 'agree', { by: 'Keith' }), 'That item is no longer there');
});
