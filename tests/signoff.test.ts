// A ✋ MANUAL toolkit stage waits for your sign-off only once it is in play (shared/gate-play.ts): gate-check
// reports Stage 5 (Build) MANUAL from a project's very first run, which used to put a "Stage 5 (Build)
// waits for your sign-off" card on a brand-new project whose Sign off did nothing. Now: no card before
// every earlier stage passed (Needs you, the progress bar, the Teams digest and the phone agree); in play,
// Sign off opens a dialog whose one action tells the lead "Signed off: Stage N" with the toolkit's CONFIRMED
// Decisions row (server/signoff/), and the card can never be answered through an escalation's free text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectDecisions, collectNeeds, type NeedsInput } from '../src/shared/needsyou.js';
import { manualInPlay, manualStageInPlay, MANUAL_LATER_TEXT, signoffMessage, signoffRow, signoffState } from '../src/shared/gate-play.js';
import { derivePhases } from '../src/shared/progress.js';
import { stageLine } from '../src/shared/mobile.js';
import { buildDigest } from '../src/server/notify-teams/digest.js';
import { signOff, signoffRequests, withSignoffs, type SignoffDeps } from '../src/server/signoff/index.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import type { RosterView } from '../src/shared/roster/types.js';
import type { SetupView } from '../src/shared/wizard.js';
import type { Floor } from '../src/server/floor.js';

const NOW = Date.parse('2026-10-16T09:00:00Z');
const v = (id: string, title: string, status: string, detail?: string) => ({ id, title, status, ...(detail ? { detail } : {}) });
/** The live packtrack project's dashboard on day one (the rows that aren't stages included). */
const FRESH = [
  v('⟳', 'Protocol freshness', 'PASS'),
  v('?', 'Open questions raised', 'MANUAL'),
  v('⚑', 'Report disposition (Stage 5/6)', 'MANUAL'),
  v('P', 'Kickoff', 'FAIL'),
  v('0', 'Triage', 'FAIL'),
  v('1', 'Analysis', 'PENDING'),
  v('2', 'Requirements', 'PENDING'),
  v('3', 'Architecture & Design', 'PENDING'),
  v('4', 'Build Plan', 'PENDING'),
  v('5', 'Build', 'MANUAL', 'not file-existence-checkable — fill in status manually'),
  v('6', 'Test', 'PENDING'),
  v('7', 'Cutover', 'PENDING'),
];
const AT_BUILD = FRESH.map((x) => (/^[P0-4]$/.test(x.id) ? { ...x, status: 'PASS' } : x));
const setup = (o: Partial<SetupView>): SetupView => ({ show: false, stages: [], questions: [], checking: false, toolkit: true, ...o });
const input = (o: Partial<NeedsInput>): NeedsInput => ({ floor: 'f1', workers: [], pulls: [], floors: [], now: NOW, ...o });

test('in play: a MANUAL stage only once every earlier stage passed or was waived, and nothing later has started', () => {
  assert.equal(manualInPlay(FRESH, '5'), false);
  assert.equal(manualInPlay(AT_BUILD, '5'), true);
  assert.equal(manualInPlay(AT_BUILD.map((x) => (x.id === '2' ? { ...x, status: 'WAIVED' } : x)), '5'), true);
  // gate-check's own rule: the MANUAL stage holds the position only until a later stage has something in it.
  assert.equal(manualInPlay(AT_BUILD.map((x) => (x.id === '6' ? { ...x, status: 'PASS' } : x)), '5'), false);
  assert.equal(manualInPlay(AT_BUILD.map((x) => (x.id === '6' ? { ...x, status: 'FAIL' } : x)), '5'), false);
  // Rows that aren't stages are never in play.
  assert.equal(manualInPlay(AT_BUILD, '?'), false);
  assert.equal(manualStageInPlay(FRESH), undefined);
  assert.equal(manualStageInPlay(AT_BUILD)?.id, '5');
});

test('a brand-new project (P/0 FAIL, 1–4 PENDING, 5 MANUAL): no sign-off card, on Needs you, the phone line or the Teams digest', () => {
  const s = setup({ verdicts: FRESH });
  const needs = collectNeeds(input({ setup: s }));
  assert.equal(needs.filter((n) => n.kind === 'setup').length, 0, JSON.stringify(needs));
  const { cards } = collectDecisions(input({ setup: s }));
  assert.equal(cards.filter((c) => c.sources.some((x) => x.type === 'signoff')).length, 0);
  // The panel's stages (P to 4, shown) with 5 MANUAL as gate-check has it: not waiting.
  const shown = setup({ show: true, stages: FRESH.filter((x) => /^[P0-5]$/.test(x.id)), verdicts: FRESH });
  const digest = buildDigest({ floor: 'f1', project: 'PackTrack', now: NOW, pulls: [], needs: collectNeeds(input({ setup: shown })), setup: shown });
  assert.deepEqual(digest.stages?.waiting, []);
  assert.equal(stageLine(shown.stages), 'Stage P · Kickoff ❌ gate failing');
});

test('every earlier stage passed: the card is there, its Sign off opens the sign-off dialog (not the setup panel), and it explains what signing off means', () => {
  const s = setup({ verdicts: AT_BUILD });
  const { cards } = collectDecisions(input({ setup: s }));
  const c = cards.find((x) => x.id === 'stage:5')!;
  assert.ok(c, 'a sign-off card');
  assert.equal(c.question, 'Stage 5 (Build) waits for your sign-off');
  assert.equal(c.kind, 'decision');
  assert.deepEqual(c.need.target, { to: 'signoff', stage: '5', title: 'Build' });
  assert.equal(c.need.action, 'Sign off');
  assert.match(c.detail ?? '', /can't certify it from files/);
  assert.match(c.after, /Signed off/);
  assert.equal(c.escalation, undefined);
  // The digest and the phone line agree.
  const shown = setup({ show: true, stages: AT_BUILD.filter((x) => /^[P0-5]$/.test(x.id)), verdicts: AT_BUILD });
  assert.deepEqual(buildDigest({ floor: 'f1', project: 'PackTrack', now: NOW, pulls: [], needs: [], setup: shown }).stages?.waiting, ['Stage 5']);
  assert.match(stageLine(shown.stages) ?? '', /Stage 5 · Build ✋ waiting for your sign-off/);
});

test('signed off in the office: a status line waiting for the lead; once PROJECT.md has the CONFIRMED row, gone', () => {
  const req = { stage: '5', by: 'Keith', at: NOW - 60_000, lead: 'Ada' };
  const asked = collectDecisions(input({ setup: setup({ verdicts: AT_BUILD, signoffs: [req] }) })).cards.find((x) => x.id === 'stage:5')!;
  assert.equal(asked.kind, 'status');
  assert.equal(asked.level, 'info');
  assert.match(asked.question, /signed off by Keith: waiting for Ada to record it in PROJECT\.md/);
  // Not red for Teams: nothing waits on you.
  const askedSetup = setup({ verdicts: AT_BUILD, signoffs: [req] });
  assert.deepEqual(buildDigest({ floor: 'f1', project: 'P', now: NOW, pulls: [], needs: collectNeeds(input({ setup: askedSetup })), setup: askedSetup }).red, []);
  const decisions = [{ stage: '5', decision: 'Stage 5 (Build) signed off by the Project Manager', status: 'CONFIRMED 2026-10-16' }];
  assert.deepEqual(signoffState({ decisions, signoffs: [req] }, '5'), { state: 'recorded' });
  assert.equal(collectNeeds(input({ setup: setup({ verdicts: AT_BUILD, signoffs: [req], decisions }) })).filter((n) => n.kind === 'setup').length, 0);
  const shown = setup({ show: true, stages: AT_BUILD.filter((x) => /^[P0-5]$/.test(x.id)), verdicts: AT_BUILD, decisions });
  assert.deepEqual(buildDigest({ floor: 'f1', project: 'P', now: NOW, pulls: [], needs: [], setup: shown }).stages?.waiting, []);
});

test("a sign-off card never dispatches its title as an escalation answer: it leads any card it folds into, so its only way out is the dialog", () => {
  // The lead escalating about the same sign-off (it names Stage 5): one card, led by the sign-off.
  const e = { id: 'd12213cfb0', at: NOW - 3_600_000, workerId: 'w', by: 'Ada', role: 'pm', urgency: 'important', fyi: false, level: 2, title: 'Stage 5 (Build) waits for your sign-off', details: '', options: ['Approve', 'Reject'], status: 'open', refs: { stageId: '5' } } as unknown as Escalation;
  const roster = { floor: 'f1', admin: true, escalations: [e], approvals: [], members: [], settings: {} } as unknown as RosterView;
  const { cards } = collectDecisions(input({ setup: setup({ verdicts: AT_BUILD }), roster }));
  const c = cards.find((x) => x.sources.some((s) => s.id === 'esc:d12213cfb0'))!;
  assert.equal(c.id, 'stage:5');
  assert.equal(c.need.target.to, 'signoff');
  assert.equal(c.escalation, undefined, 'no escalation answer path on the card');
  assert.equal(c.options, undefined, 'no options to send as an answer');
  // A non-escalation card (a failing PR check, status) has no escalation either.
  const pr = collectDecisions(input({ pulls: [{ number: 7, title: 'x', state: 'OPEN', isDraft: false, checks: 'fail', updatedAt: new Date(NOW).toISOString() }] as never })).cards[0];
  assert.equal(pr.escalation, undefined);
  assert.equal(pr.need.target.to, 'pr');
});

test('the progress bar: Stage 5 is "not started, checked by hand later" on a new project, waiting in play, done once the row is there', () => {
  const acceptance = { cycle: 1, version: 'v1', earlier: [] } as never;
  const fresh = derivePhases({ toolkit: true, verdicts: FRESH, decisions: [], acceptance }).find((p) => p.id === '5')!;
  assert.equal(fresh.status, 'pending');
  assert.ok(fresh.measures[0].includes(MANUAL_LATER_TEXT), fresh.measures[0]);
  const at = derivePhases({ toolkit: true, verdicts: AT_BUILD, decisions: [], acceptance }).find((p) => p.id === '5')!;
  assert.equal(at.status, 'waiting');
  const signed = derivePhases({ toolkit: true, verdicts: AT_BUILD, decisions: [{ stage: '5', decision: 'Build signed off', status: 'CONFIRMED 2026-10-16' }], acceptance }).find((p) => p.id === '5')!;
  assert.equal(signed.status, 'done');
});

test('the lead is told "Signed off: Stage 5" with the exact row the toolkit reads, a CONFIRMED Decisions row', () => {
  const row = signoffRow('5', 'Build', 'Keith', '2026-10-16');
  assert.equal(row, '| 5 | Stage 5 (Build) signed off by the Project Manager | CONFIRMED 2026-10-16 | Signed off in Mx Office by Keith |');
  // gate-check's has_confirmed_decision: col 2 the stage, a field starting CONFIRMED.
  const cells = row.split('|').map((c) => c.trim());
  assert.equal(cells[1], '5');
  assert.match(cells[3], /^CONFIRMED\b/);
  const msg = signoffMessage('5', 'Build', 'Keith', '2026-10-16');
  assert.match(msg, /^Signed off: Stage 5 \(Build\)\./);
  assert.ok(msg.includes(row));
  assert.match(signoffRow('5', 'Build', 'K|eith\nx', 'd'), /by K eith x \|$/);
});

const floor = { id: 'f1' } as Floor;
function deps(o: Partial<SignoffDeps> & { verdicts?: SetupView['verdicts']; decisions?: SetupView['decisions'] } = {}) {
  const told: { text: string; decision: string }[] = [];
  const answered: { ids: readonly string[]; text: string }[] = [];
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'signoff-'));
  const d: SignoffDeps = {
    dataDir,
    now: () => NOW,
    setup: async () => setup({ verdicts: o.verdicts ?? AT_BUILD, decisions: o.decisions }),
    lead: () => 'Ada',
    tell: async (_f, text, _by, _owner, decision) => void told.push({ text, decision }),
    answerFolded: async (_f, ids, text) => void answered.push({ ids, text }),
    ...o,
  };
  return { d, told, answered, dataDir };
}

test('Sign off does something verifiable: the lead is told through the durable tell, the sign-off is kept, Needs you then waits for the lead', async () => {
  const { d, told, answered, dataDir } = deps();
  const r = await signOff(d, floor, '5', 'Keith', 'acct-1', ['d12213cfb0']);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(told.length, 1);
  assert.equal(told[0].decision, 'tell:signoff-stage-5');
  assert.match(told[0].text, /^Signed off: Stage 5 \(Build\)/);
  assert.ok(told[0].text.includes('| 5 | Stage 5 (Build) signed off by the Project Manager | CONFIRMED 2026-10-16 |'));
  // The folded escalation is answered with the same explicit words, never the card's title.
  assert.deepEqual(answered[0].ids, ['d12213cfb0']);
  assert.match(answered[0].text, /^Signed off: Stage 5/);
  assert.notEqual(answered[0].text.trim(), 'Stage 5 (Build) waits for your sign-off');
  // Kept on disk and on the setup view.
  assert.deepEqual(signoffRequests(dataDir, 'f1').map((x) => [x.stage, x.by, x.lead]), [['5', 'Keith', 'Ada']]);
  const file = JSON.parse(readFileSync(path.join(dataDir, 'signoff', 'f1.json'), 'utf8'));
  assert.equal(file.requests[0].stage, '5');
  const view = withSignoffs(dataDir, 'f1', setup({ verdicts: AT_BUILD }));
  assert.equal(collectNeeds(input({ setup: view })).find((n) => n.key === 'setup-5')?.level, 'info');
});

test('Sign off is refused when the stage is not in play, already recorded, or there is no lead at work', async () => {
  const fresh = deps({ verdicts: FRESH });
  const r1 = await signOff(fresh.d, floor, '5', 'Keith', undefined);
  assert.equal(r1.ok, false);
  assert.equal(fresh.told.length, 0);
  const rec = deps({ decisions: [{ stage: '5', decision: 'x', status: 'CONFIRMED' }] });
  assert.equal((await signOff(rec.d, floor, '5', 'Keith', undefined)).ok, false);
  const nolead = deps({ lead: () => undefined });
  const r3 = await signOff(nolead.d, floor, '5', 'Keith', undefined);
  assert.equal(r3.ok, false);
  assert.match(r3.ok ? '' : r3.error, /team lead/);
  assert.deepEqual(signoffRequests(nolead.dataDir, 'f1'), []);
});

test('the page: the Needs-you button opens the sign-off dialog, which posts /api/signoff with Not yet beside it; the route is registered', () => {
  const read = (f: string) => readFileSync(path.join(import.meta.dirname, '..', f), 'utf8');
  assert.match(read('src/client/lite.ts'), /t\.to === 'signoff'\) return void goSignoff\(/);
  const dlg = read('src/client/ui/signoff/dialog.ts');
  assert.match(dlg, /'\/api\/signoff'/);
  assert.match(dlg, /'Not yet'/);
  assert.match(dlg, /openModal\(content, \{ onClose: \(\) => back\?\.focus\?\.\(\) \}\)/);
  assert.match(read('src/server/http/routes/index.ts'), /signoffRoutes\.act/);
});
