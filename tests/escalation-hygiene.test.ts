// Escalation hygiene (project audit 16 Oct 2026, findings 2 and 3; shapes from its roster, synthetic text):
// an ask naming an open escalation (ESC-<id>, `escalation <id>`) or the same decision id folds into it; one
// naming an answered escalation tells the agent the answer and raises nothing; an AWAITING-PM qualifier
// ("not blocking rows 15-20") is not an item; chat lines that only report a state are not asks; a denial by
// Claude Code's permission layer is a settings card that an Approve never resolves, that folds repeats with a
// count, and that closes only once the command is seen to run (or the person keeps it blocked). Ordinary and
// office-filed escalations are unaffected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { AuditInput } from '../src/shared/audit.js';
import type { EscalationAsk } from '../src/shared/roster/escalation.js';
import type { RosterView } from '../src/shared/roster/types.js';
import { collectDecisions } from '../src/shared/needsyou.js';
import { permissionDenial, ranDenied, sameDenied } from '../src/shared/roster/permission-denial.js';
import { Roster } from '../src/server/roster/index.js';
import type { TeamFloor } from '../src/server/roster/types.js';
import { useAudit } from '../src/server/audit/index.js';
import { answeredNote, findFold, foldOfficeAsk, referencedIds, sawCommandRun } from '../src/server/roster/escalation-fold.js';
import { allowCommand, keepBlocked, withAllowRule } from '../src/server/decisions/permission.js';
import { escalateNote } from '../src/server/hooks/office-escalate.js';
import { awaitingItems, awaitingKey, planAwaiting, type Waits } from '../src/server/asks/awaiting.js';
import { splitAwaitingLine } from '../src/server/asks/split.js';
import { realAsk } from '../src/server/roster/jeff-ask.js';

const events: AuditInput[] = [];
useAudit({ append: (e: AuditInput) => (events.push(e), { ...e, id: String(events.length), at: Date.now(), prev: '', hash: '' }) } as never);

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'hyg-floor-'));
  map = new Map<string, WorkerInfo>();
  typed: { id: string; text: string }[] = [];
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  hire = async () => 'no';
  stop = async () => {};
  prompt = (id: string, text: string) => void this.typed.push({ id, text });
  wake = () => undefined;
  rename = () => {};
  cwdOf = () => this.dir;
  openPulls = () => [];
  toast = () => {};
  changed = () => {};
  activity = () => {};
  judged = () => {};
}

function setup() {
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'hyg-data-')), floors: () => [floor], makeIssue: async () => ({ number: 7 }), analysis: () => '', now: () => Date.now() }, 0);
  const sophie = { id: 'w1', kind: 'agent', name: 'Sophie', status: 'idle', viewers: [] } as unknown as WorkerInfo;
  const kath = { id: 'w2', kind: 'agent', name: 'Katherine', status: 'idle', viewers: [] } as unknown as WorkerInfo;
  floor.map.set(sophie.id, sophie);
  floor.map.set(kath.id, kath);
  const ask = (title: string, o: Partial<EscalationAsk> = {}): EscalationAsk => ({ urgency: 'important', title, details: `About ${title}.`, options: [], ...o });
  const all = () => roster.data(floor.id).escalations;
  const view = () => ({ floor: floor.id, admin: true, escalations: roster.escalations.view(floor), approvals: [], members: [], settings: {} }) as unknown as RosterView;
  return { floor, roster, sophie, kath, ask, all, view };
}

// Sophie's scratch-copy exec (ESC-2a9ed73eca, then 04e8b0c899), in synthetic words of the same shape.
const DENIED_1 = 'Build-plan row 3 must run MDL against a scratch copy. `mxcli check` passes for the P-1 probe, but the permission layer denied `cd /tmp/probe; mxcli exec s/p1.mdl -p Demo.mpr` (a bare exec). I will not work around that denial, so the probes are paused.';
const DENIED_2 = 'Thanks for the "allow" (ESC-86357719ea). The command `cd /tmp/probe && mxcli exec s/p1.mdl -p Demo.mpr` was denied again by Claude Code\'s permission prompt, so your answer in the office did not change the terminal rule. Or add Bash(mxcli exec * -p /tmp/probe/*) to .claude/settings.local.json.';

// ---- A: duplicates ------------------------------------------------------------------------------------

test('hygiene-esc-id: an AWAITING-PM item naming an open escalation is folded into it, once, and the role hears its answer', () => {
  const t = setup();
  const { escalation: cac } = t.roster.escalations.raiseOrJoin(t.floor, t.kath, t.ask('CAC-3: sign off BRD F001 and answer 8 open points before design', { options: ['Approve all defaults', 'Not yet'] }));
  assert.deepEqual(referencedIds(`CAC-3 sign-off of BRD F001 (escalation ${cac.id}, filed as FYI)`), [cac.id]);
  const item = `CAC-3 sign-off of BRD F001 (escalation ${cac.id}, filed as FYI)`;
  const key = awaitingKey('chief-analyst', item);
  const before = t.all().length;
  assert.equal(foldOfficeAsk(t.roster, t.floor, { workerId: t.kath.id, by: 'Katherine' }, t.ask(item), key), true);
  assert.equal(t.all().length, before, 'nothing filed');
  assert.deepEqual(cac.foldedKeys, [key]);
  assert.ok(events.some((e) => e.action === 'escalation.folded' && e.target?.id === cac.id));
  // The next look doesn't plan it again (its key is kept on the escalation).
  const w: Waits = { team: 'analysis', entry: { heading: '2026-10-16 12:48 — Handoff', date: '2026-10-16', body: `AWAITING-PM: ${item}` }, at: Date.now() - 60_000, items: [item], where: 'the project folder' };
  assert.deepEqual(planAwaiting([w], () => 'chief-analyst', t.all()).raise, []);
  // Another role's ask naming it: linked, it hears the answer too.
  assert.equal(foldOfficeAsk(t.roster, t.floor, { workerId: t.sophie.id, by: 'Sophie' }, t.ask(`waiting on ESC-${cac.id}`), 'lead-developer:x'), true);
  assert.ok(cac.also?.some((a) => a.workerId === t.sophie.id));
});

test('hygiene-decision-id: an agent escalation with the same decision id as an open one joins it; a different id is raised', () => {
  const t = setup();
  const { escalation: a } = t.roster.escalations.raiseOrJoin(t.floor, t.kath, t.ask('CAC-3: sign off BRD F001', { options: ['Approve', 'Not yet'] }));
  const r = t.roster.escalations.raiseOrJoin(t.floor, t.sophie, t.ask('Need the CAC-3 sign-off before row 4', { options: ['Approve'] }));
  assert.equal(r.joined, true);
  assert.equal(r.escalation.id, a.id);
  const other = t.roster.escalations.raiseOrJoin(t.floor, t.sophie, t.ask('OI-2: retention period for sheet photos?', { options: ['30 days', '1 year'] }));
  assert.equal(other.joined, false);
  assert.notEqual(other.escalation.id, a.id);
});

test('hygiene-answered: naming an answered escalation tells the agent the answer and raises nothing; a Follow-up is raised', async () => {
  const t = setup();
  const { escalation: e } = t.roster.escalations.raiseOrJoin(t.floor, t.sophie, t.ask('Allow the seed rebuild on the dev database?', { options: ['Yes', 'No'] }));
  assert.equal(await t.roster.escalations.resolve(t.floor, e.id, 'approve', 'Go with: Yes', 'Keith'), undefined);
  const before = t.all().length;
  const r = t.roster.escalations.raiseOrJoin(t.floor, t.sophie, t.ask(`answer to escalation ${e.id} (seed rebuild)`));
  assert.equal(r.answered, true);
  assert.equal(t.all().length, before);
  assert.match(answeredNote(r.escalation), new RegExp(`already answered as ESC-${e.id} rev 1: APPROVED — Go with: Yes \\(Keith\\)`));
  // The office path: told in the terminal, nothing filed.
  t.floor.typed.length = 0;
  assert.equal(foldOfficeAsk(t.roster, t.floor, { workerId: t.sophie.id, by: 'Sophie' }, t.ask(`ESC-${e.id} (seed rebuild)`), 'lead-developer:esc'), true);
  assert.equal(t.all().length, before);
  assert.match(t.floor.typed.at(-1)?.text ?? '', new RegExp(`already answered as ESC-${e.id} rev 1: APPROVED`));
  // The same decision id answered within a day stands for the office's asks (an AWAITING-PM item)…
  const { escalation: d } = t.roster.escalations.raiseOrJoin(t.floor, t.kath, t.ask('CAC-3: sign off BRD F001', { options: ['Approve', 'Not yet'] }));
  await t.roster.escalations.resolve(t.floor, d.id, 'approve', '', 'Keith');
  assert.equal(foldOfficeAsk(t.roster, t.floor, { workerId: t.kath.id, by: 'Katherine' }, t.ask('CAC-3 sign-off of BRD F001 (filed as FYI)'), 'chief-analyst:cac-3'), true);
  assert.equal(t.all().length, before + 1);
  // …but an agent's own new round of the same checkpoint is raised (equipment-loan-desk's "CAC-3 (architecture)").
  const round = t.roster.escalations.raiseOrJoin(t.floor, t.kath, t.ask('Client checkpoint CAC-3 (architecture): 2 questions', { options: ['A', 'B'] }));
  assert.equal(round.answered, undefined);
  assert.equal(round.joined, false);
  // A genuinely new question says so, and is raised.
  const f = t.roster.escalations.raiseOrJoin(t.floor, t.sophie, t.ask(`Follow-up to ESC-${e.id}: the rebuild needs the prod snapshot too`));
  assert.equal(f.answered, undefined);
  assert.equal(f.joined, false);
  assert.equal(t.all().length, before + 3);
});

test('hygiene-noted-not-answer: a noted FYI or a closed duplicate is not an answer; the ask is raised', async () => {
  const t = setup();
  const fyi = t.roster.escalations.raiseFyi(t.floor, t.sophie, { urgency: 'info', title: 'Row 7 applied', details: '', options: [] });
  await t.roster.escalations.resolve(t.floor, fyi.id, 'dismiss', '', 'Keith', 'noted');
  assert.equal(findFold(t.all(), t.ask(`question about ESC-${fyi.id}`), Date.now()), undefined);
});

// ---- A: fragments and chat junk -------------------------------------------------------------------------

test('hygiene-fragment: a qualifier after a semicolon stays with its item; real list separators still split', () => {
  assert.deepEqual(splitAwaitingLine('ESC-04e8b0c899 (terminal permission for scratch exec on /tmp/probe); not blocking rows 15-20'), ['ESC-04e8b0c899 (terminal permission for scratch exec on /tmp/probe); not blocking rows 15-20']);
  assert.deepEqual(awaitingItems('Doing: row 17.\nAWAITING-PM: ESC-04e8b0c899 (scratch exec); not blocking rows 15-20'), ['ESC-04e8b0c899 (scratch exec); not blocking rows 15-20']);
  for (const tail of ['no rush', 'blocks row 3 only', 'but only after PR #3 merges', 'which unblocks the photo row', "doesn't block the build"]) assert.equal(splitAwaitingLine(`merge PR #5; ${tail}`).length, 1, tail);
  assert.deepEqual(splitAwaitingLine('OK to install sqlite3; merge PR #51'), ['OK to install sqlite3', 'merge PR #51']);
  assert.deepEqual(awaitingItems('AWAITING-PM:\n- merge #51\n- not blocking: the logo'), ['merge #51', 'not blocking: the logo']);
});

test('hygiene-chat-junk: a denied wait and a relayed ask are not asks; a real request still is', () => {
  // d12213cfb0's line and 60646a6a5e's line, in the shape they had.
  assert.equal(realAsk("I can't find a Stage 5 sign-off on my side.\n\n- **Escalations:** I haven't filed any, so none of mine is waiting on you.\n- **Workers:** Sophie finished only her kickoff.\n\nIf you tell me what the item says, I can work out the cause."), undefined);
  assert.equal(realAsk("Elsa's BRD sync passes my review.\n\nI'm waiting on two things: Sophie's progress. I'm still waiting on your decision on Sophie's `mxcli exec` request for the scratch copy (row 3). That is blocking her probes."), undefined);
  assert.match(realAsk("Row 3 is done.\n\nI'm waiting on your merge of PR #2.") ?? '', /waiting on your merge/);
  assert.match(realAsk('**Waiting on the PM:** merging #35.') ?? '', /Waiting on the PM/);
  assert.match(realAsk("Could you approve Sophie's request for the scratch copy?") ?? '', /Could you approve/);
});

// ---- B: permission denials ---------------------------------------------------------------------------------

test('hygiene-permission-detect: the denied command is read off the words; app permissions and ordinary escalations are not denials', () => {
  assert.deepEqual(permissionDenial({ title: 'Allow `mxcli exec` on a scratch copy of the .mpr', details: DENIED_1 }), { command: 'cd /tmp/probe; mxcli exec s/p1.mdl -p Demo.mpr', rule: 'Bash(cd /tmp/probe; mxcli exec s/p1.mdl -p Demo.mpr)' });
  const two = permissionDenial({ title: 'Exec on /tmp/probe is still denied by the terminal permission layer', details: DENIED_2 })!;
  assert.equal(two.command, 'cd /tmp/probe && mxcli exec s/p1.mdl -p Demo.mpr');
  assert.equal(two.suggested, 'Bash(mxcli exec * -p /tmp/probe/*)');
  assert.ok(sameDenied(two.command, 'cd /tmp/probe; mxcli exec s/p1.mdl -p Demo.mpr'));
  assert.ok(ranDenied(two.command, 'cd /tmp/probe && mxcli exec s/p1.mdl -p Demo.mpr 2>&1 | tail -5'));
  assert.ok(!ranDenied(two.command, 'mxcli check s/p1.mdl -p Demo.mpr'));
  assert.equal(permissionDenial({ title: 'Guest role is denied the Admin page', details: 'The `Guest role` permission rules deny access; is that intended?' }), undefined);
  assert.equal(permissionDenial({ title: 'Merge PR #5?', details: 'Checks green. Run `git push origin main` after?' }), undefined);
});

test('hygiene-permission-card: an Approve never resolves it; repeats fold with a count; Allow writes exactly the rule; a seen run closes it', async () => {
  const t = setup();
  const { escalation: e } = t.roster.escalations.raiseOrJoin(t.floor, t.sophie, t.ask('Allow `mxcli exec` on a scratch copy of the .mpr for the row 3 probes', { details: DENIED_1, trigger: 'needs-human', options: ['Allow exec on /tmp/probe (recommended)', 'Skip probes'] }));
  assert.equal(e.permission?.command, 'cd /tmp/probe; mxcli exec s/p1.mdl -p Demo.mpr');
  assert.equal(e.permission?.count, 1);
  assert.deepEqual(e.options, ['Allow this command for Sophie on this project', 'Keep blocked']);
  assert.match(escalateNote(e, false, 'Sophie'), /permission card/);
  // The card in Needs you: a settings action, with the command and the rule.
  const card = collectDecisions({ floor: t.floor.id, workers: [], pulls: [], floors: [], now: Date.now(), roster: t.view() }).cards.find((c) => c.escalation === e.id)!;
  assert.equal(card.permission?.rule, 'Bash(cd /tmp/probe; mxcli exec s/p1.mdl -p Demo.mpr)');
  assert.match(card.after, /doesn't change Claude Code's permission settings/);
  // Approve (or a reply, or "I've done it") doesn't resolve it.
  assert.match((await t.roster.escalations.resolve(t.floor, e.id, 'approve', 'Go with: Allow this command for Sophie on this project', 'Keith')) ?? '', /permission block/);
  assert.match((await t.roster.escalations.resolve(t.floor, e.id, 'reply', 'allow', 'Keith')) ?? '', /permission block/);
  assert.match((await t.roster.escalations.resolve(t.floor, e.id, 'reply', '', 'Keith', 'done')) ?? '', /permission block/);
  assert.equal(e.status, 'open');
  // The agent's repeat (other words, the same command) and its AWAITING-PM line naming it fold in with a count.
  const before = t.all().length;
  const again = t.roster.escalations.raiseOrJoin(t.floor, t.sophie, t.ask('Exec on /tmp/probe is still denied by the terminal permission layer, despite "allow"', { details: DENIED_2, options: ['Approve at terminal'] }));
  assert.equal(again.joined, true);
  assert.equal(again.escalation.id, e.id);
  assert.match(escalateNote(again.escalation, true, 'Sophie'), /Already open as a permission card .*asked 2 times/);
  assert.equal(foldOfficeAsk(t.roster, t.floor, { workerId: t.sophie.id, by: 'Sophie' }, t.ask(`ESC-${e.id} (terminal permission for scratch exec on /tmp/probe); not blocking rows 15-20`), 'lead-developer:esc-x'), true);
  assert.equal(e.permission?.count, 3);
  assert.equal(t.all().length, before);
  // Allow: exactly the rule in the folder's settings.local.json, the rest of it kept; the card stays open.
  mkdirSync(path.join(t.floor.dir, '.claude'), { recursive: true });
  writeFileSync(path.join(t.floor.dir, '.claude/settings.local.json'), JSON.stringify({ permissions: { deny: ['Agent(old)'], allow: ['Bash(ls)'] }, model: 'x' }));
  t.floor.typed.length = 0;
  assert.equal(await allowCommand(t.roster, t.floor, e, 'Keith'), undefined);
  const cfg = JSON.parse(readFileSync(path.join(t.floor.dir, '.claude/settings.local.json'), 'utf8'));
  assert.deepEqual(cfg, { permissions: { deny: ['Agent(old)'], allow: ['Bash(ls)', 'Bash(cd /tmp/probe; mxcli exec s/p1.mdl -p Demo.mpr)'] }, model: 'x' });
  assert.equal(e.status, 'open');
  assert.ok(e.permission?.allowed);
  assert.match(t.floor.typed.at(-1)?.text ?? '', /Run the command again/);
  assert.ok(events.some((x) => x.action === 'escalation.permission-allowed' && x.target?.id === e.id));
  // Another command, or another worker's run, doesn't close it; the denied one run by Sophie does.
  assert.deepEqual(sawCommandRun(t.roster, t.floor, t.sophie.id, 'mxcli check s/p1.mdl -p Demo.mpr'), []);
  assert.deepEqual(sawCommandRun(t.roster, t.floor, t.kath.id, 'cd /tmp/probe && mxcli exec s/p1.mdl -p Demo.mpr'), []);
  assert.equal(e.status, 'open');
  assert.deepEqual(sawCommandRun(t.roster, t.floor, t.sophie.id, 'cd /tmp/probe && mxcli exec s/p1.mdl -p Demo.mpr'), [e.id]);
  assert.equal(e.status, 'resolved');
  assert.equal(e.resolution?.verdict, 'dismiss');
  assert.equal(e.resolution?.by, 'The office');
  assert.equal(t.roster.escalations.owedTo(t.floor, t.sophie).lines.length, 0, 'nothing typed to the agent for it');
});

test('hygiene-permission-keep: Keep blocked rejects it; the same denial again is told it is kept blocked, not raised', async () => {
  const t = setup();
  const { escalation: e } = t.roster.escalations.raiseOrJoin(t.floor, t.sophie, t.ask('Scratch exec denied', { details: DENIED_1 }));
  const r = await keepBlocked(t.roster, t.floor, e, 'Keith', '');
  assert.equal(r.ok, true);
  assert.equal(e.status, 'resolved');
  assert.equal(e.resolution?.verdict, 'reject');
  assert.ok(e.permission?.kept);
  const again = t.roster.escalations.raiseOrJoin(t.floor, t.sophie, t.ask('Exec on /tmp/probe still denied', { details: DENIED_2 }));
  assert.equal(again.answered, true);
  assert.match(answeredNote(again.escalation), /kept `cd \/tmp\/probe; mxcli exec s\/p1.mdl -p Demo.mpr` blocked/);
});

test('hygiene-permission-safety: a wildcard command or a broken settings file is refused, nothing written; nobody away is allowed for', async () => {
  assert.deepEqual(withAllowRule('{ not json', 'Bash(x y)').hasOwnProperty('error'), true);
  assert.equal(withAllowRule('{"permissions":{"allow":["Bash(x y)"]}}', 'Bash(x y)'), 'same');
  const t = setup();
  const { escalation: e } = t.roster.escalations.raiseOrJoin(t.floor, t.sophie, t.ask('Denied', { details: 'The permission layer denied `rm -f build/*.tmp` in my folder.' }));
  assert.match((await allowCommand(t.roster, t.floor, e, 'Keith')) ?? '', /wildcard/);
  assert.equal(e.permission?.allowed, undefined);
  const { escalation: f } = t.roster.escalations.raiseOrJoin(t.floor, t.sophie, t.ask('Denied again', { details: 'The permission layer denied `mxcli docker build -p Demo.mpr` here.' }));
  mkdirSync(path.join(t.floor.dir, '.claude'), { recursive: true });
  writeFileSync(path.join(t.floor.dir, '.claude/settings.local.json'), '{ broken');
  assert.match((await allowCommand(t.roster, t.floor, f, 'Keith')) ?? '', /left alone/);
  assert.equal(readFileSync(path.join(t.floor.dir, '.claude/settings.local.json'), 'utf8'), '{ broken');
  t.floor.map.delete(t.sophie.id);
  writeFileSync(path.join(t.floor.dir, '.claude/settings.local.json'), '{}');
  assert.match((await allowCommand(t.roster, t.floor, f, 'Keith')) ?? '', /isn't at work/);
});

// ---- Unaffected ------------------------------------------------------------------------------------------

test('hygiene-unaffected: ordinary and office-filed escalations are raised and answered as before', async () => {
  const t = setup();
  const a = t.roster.escalations.raiseOrJoin(t.floor, t.sophie, t.ask('Which login screen?', { options: ['SSO', 'Local'] }));
  assert.equal(a.joined, false);
  assert.equal(a.escalation.permission, undefined);
  assert.deepEqual(a.escalation.options, ['SSO', 'Local']);
  const office = t.roster.escalations.raiseFor(t.floor, { workerId: 'office-testing', by: 'Testing' }, t.ask('3 acceptance criteria have no linked test'));
  assert.equal(office.status, 'open');
  assert.equal(foldOfficeAsk(t.roster, t.floor, { workerId: t.sophie.id, by: 'Sophie' }, t.ask('restart the preview'), 'lead-developer:restart'), false);
  // An item the office files reads its own words only: the entry it quotes may mention a denial (or another escalation).
  const { escalation: perm } = t.roster.escalations.raiseOrJoin(t.floor, t.sophie, t.ask('Scratch exec denied', { details: DENIED_1 }));
  assert.ok(perm.permission);
  assert.equal(foldOfficeAsk(t.roster, t.floor, { workerId: t.sophie.id, by: 'Sophie' }, t.ask('merge PR #3', { details: `The entry:\n\n${DENIED_1}\nAlso see ESC-${perm.id}.` }), 'lead-developer:merge'), false);
  const filed = t.roster.escalations.raiseFor(t.floor, { workerId: t.sophie.id, by: 'Sophie' }, t.ask('merge PR #3', { details: `The entry:\n\n${DENIED_1}` }));
  assert.equal(filed.permission, undefined);
  assert.equal(perm.permission?.count, 1);
  assert.equal(await t.roster.escalations.resolve(t.floor, a.escalation.id, 'approve', 'Go with: SSO', 'Keith'), undefined);
  assert.equal(a.escalation.status, 'resolved');
});

test('hygiene-command-run: a PostToolUse Bash payload is heard as the command it ran; other tools are not', async () => {
  const { noteCommandRun, onCommandRun } = await import('../src/server/workers/tool-runs.js');
  const heard: string[] = [];
  const stop = onCommandRun((w, c) => heard.push(`${w}:${c}`));
  assert.equal(noteCommandRun('w1', { tool_name: 'Bash', tool_input: { command: 'mxcli exec s/p1.mdl -p Demo.mpr' } }), true);
  assert.equal(noteCommandRun('w1', { tool_name: 'Edit', tool_input: { file_path: 'x' } }), false);
  stop();
  assert.deepEqual(heard, ['w1:mxcli exec s/p1.mdl -p Demo.mpr']);
});
