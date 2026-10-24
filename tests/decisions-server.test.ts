// Decision cards on the server (Slice 1A): the outcomes Noted and I've done it with a legacy verdict beside
// them (so release 46 still renders them), "I've done it" asking the agent to re-check (never APPROVED), an
// AWAITING-PM line gone kept open, failed reads keeping items, dismissed ≠ resolved, one issue per
// human-action approval plus its hands-on card, Separate stored and audited, and every new action
// admin-only on the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { AuditInput } from '../src/shared/audit.js';
import type { EscalationAsk } from '../src/shared/roster/escalation.js';
import type { Proposal, RosterView } from '../src/shared/roster/types.js';
import { collectDecisions } from '../src/shared/needsyou.js';
import { cardActs } from '../src/shared/decisions/words.js';
import { Roster } from '../src/server/roster/index.js';
import type { TeamFloor } from '../src/server/roster/types.js';
import { useAudit } from '../src/server/audit/index.js';
import { SplitsStore } from '../src/server/decisions/store.js';
import { DecisionsService } from '../src/server/decisions/index.js';
import { checkFor, runCheck } from '../src/server/decisions/check.js';
import { decisionRoutes } from '../src/server/http/routes/decisions.js';
import { StuckService, type StuckDeps, type StuckFloor } from '../src/server/stuck/service.js';
import { STUCK_DEFAULTS } from '../src/shared/stuck.js';
import { readEverywhere } from '../src/server/asks/sources.js';

const events: AuditInput[] = [];
useAudit({ append: (e: AuditInput) => (events.push(e), { ...e, id: String(events.length), at: Date.now(), prev: '', hash: '' }) } as never);

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'dec-floor-'));
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

function setup(makeIssue: () => Promise<{ number?: number; dryRun?: boolean }> = async () => ({ number: 7 })) {
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'dec-data-')), floors: () => [floor], makeIssue, analysis: () => '', now: () => Date.now() }, 0);
  const w = { id: 'w1', kind: 'agent', name: 'Ada', status: 'idle', viewers: [] } as unknown as WorkerInfo;
  floor.map.set(w.id, w);
  const ask = (title: string, o: Partial<EscalationAsk> = {}): EscalationAsk => ({ urgency: 'important', title, details: `About ${title}.`, options: [], ...o });
  const raise = (title: string, o: Partial<EscalationAsk> = {}) => roster.escalations.raise(floor, w, ask(title, o));
  const view = () => ({ floor: floor.id, admin: true, escalations: roster.escalations.view(floor), approvals: [], members: [], settings: {} }) as unknown as RosterView;
  return { floor, roster, raise, view };
}

test('decisions-done-message: I\'ve done it tells the agent "<person> says it\'s done: please re-check", never APPROVED; the audit says done', async () => {
  const t = setup();
  const e = t.raise('Sign in to the Marketplace: mxcli auth login', { trigger: 'needs-human' });
  assert.equal(await t.roster.escalations.resolve(t.floor, e.id, 'approve', '', 'Keith', 'done'), undefined);
  const sent = t.floor.typed.at(-1)!.text;
  assert.match(sent, /Keith says it's done: please re-check/);
  assert.doesNotMatch(sent, /APPROVED/);
  const a = events.filter((x) => x.action === 'escalation.answer' && x.target?.id === e.id).at(-1)!;
  assert.equal(a.details?.verdict, 'done');
});

test('decisions-rollback-verdicts: Noted writes verdict dismiss and done writes reply "Done", beside the new outcome; Noted never resolves a decision, done never an approval', async () => {
  const t = setup();
  const hands = t.raise('Paste the SMTP password', { trigger: 'needs-human' });
  await t.roster.escalations.resolve(t.floor, hands.id, 'reply', '', 'Keith', 'done');
  assert.deepEqual({ v: hands.resolution!.verdict, t: hands.resolution!.text, o: hands.resolution!.outcome }, { v: 'reply', t: 'Done', o: 'done' });
  const fyi = t.roster.escalations.raiseFyi(t.floor, t.floor.map.get('w1')!, { urgency: 'info', title: 'Merged #97 after review', details: '', options: [] });
  assert.equal(await t.roster.escalations.resolve(t.floor, fyi.id, 'reply', 'x', 'Keith', 'noted'), undefined);
  assert.deepEqual({ v: fyi.resolution!.verdict, t: fyi.resolution!.text, o: fyi.resolution!.outcome }, { v: 'dismiss', t: '', o: 'noted' });
  const dec = t.raise('Which login screen?', { options: ['SSO', 'Local'] });
  assert.match(await t.roster.escalations.resolve(t.floor, dec.id, 'dismiss', '', 'Keith', 'noted')!, /only for an FYI/);
  assert.match(await t.roster.escalations.resolve(t.floor, dec.id, 'approve', '', 'Keith', 'done')!, /only for a hands-on action/);
  assert.equal(dec.status, 'open');
});

test('decisions-source-gone: a gone AWAITING-PM line keeps the escalation open; its card offers Resolved / Still needed', async () => {
  const t = setup();
  const e = t.raise('merge PR #51');
  e.from = { kind: 'awaiting', key: 'pm:merge pr #51' };
  assert.ok(t.roster.escalations.markGone(t.floor, e.id, "The AWAITING-PM line is gone from Ada's newest entry"));
  assert.equal(e.status, 'open');
  const { cards } = collectDecisions({ floor: t.floor.id, workers: [], pulls: [], floors: [], roster: t.view() });
  const c = cards.find((x) => x.escalation === e.id)!;
  assert.match(c.gone!.what, /The AWAITING-PM line is gone from Ada's newest entry/);
  assert.deepEqual(cardActs(c), ['resolved', 'still-needed']);
  // Still needed: Ada is asked, it stays open.
  assert.equal(await t.roster.escalations.tell(t.floor, e.id, 'still needed', 'Keith says this is still needed', 'Keith'), undefined);
  assert.equal(e.status, 'open');
  assert.ok(e.sourceGone!.asked);
  // The line back: an ask like before.
  t.roster.escalations.markGone(t.floor, e.id, undefined);
  assert.equal(e.sourceGone, undefined);
});

function stuckHarness() {
  const state = { now: Date.parse('2026-10-04T12:00:00Z'), failRepo: false };
  const floor: StuckFloor = { id: 'sf', name: 'sf', dir: '/nowhere', pulls: () => [], working: () => false };
  const plan = '| ID | Question | Raised | Blocks (rows) | Build proceeds on |\n|---|---|---|---|---|\n| OW-1 | Named owners | 2026-09-27 | 59 | stubs |\n\n| # | Produces | State |\n|---|---|---|\n| 59 | mail | blocked - OW-1 |\n';
  const deps: StuckDeps = {
    dataDir: mkdtempSync(path.join(os.tmpdir(), 'dec-stuck-')),
    floors: () => [floor],
    now: () => state.now,
    settings: () => STUCK_DEFAULTS,
    readRepo: async () => (state.failRepo ? undefined : { sha: 'a', plan: { file: 'architecture/build-plan.md', text: plan }, reports: [] }),
    runs: async () => [],
    spendSince: () => undefined,
    lead: () => ({ name: 'Ada', working: false }),
    tell: () => undefined,
    record: (e) => void events.push(e),
  };
  return { state, floor, svc: new StuckService(deps) };
}

test('decisions-read-failure: a failing git read keeps stuck items open, marked as not re-read; a failed branch read is "failed", never "missing"', async () => {
  const h = stuckHarness();
  await h.svc.look(h.floor);
  assert.ok((await h.svc.view(h.floor, true)).items.some((i) => i.id === 'decision-OW-1'));
  h.state.failRepo = true;
  h.state.now += 3_600_000;
  const ev = await h.svc.look(h.floor);
  assert.ok(!ev.some((e) => e.action === 'resolved'), 'nothing resolves on a failed read');
  const item = (await h.svc.view(h.floor, true)).items.find((i) => i.id === 'decision-OW-1')!;
  assert.equal(item.unreadAt, h.state.now);
  const { cards } = collectDecisions({ floor: 'sf', workers: [], pulls: [], floors: [], stuck: { floor: 'sf', items: [item] }, now: h.state.now });
  assert.ok(cards[0].notes.some((n) => /couldn't re-read the source at/.test(n)));
  // Read again: found, the mark goes.
  h.state.failRepo = false;
  await h.svc.look(h.floor);
  assert.equal((await h.svc.view(h.floor, true)).items.find((i) => i.id === 'decision-OW-1')!.unreadAt, undefined);
  // asks/sources: git failing on a branch read is a failed read, not a missing file.
  const reads = await readEverywhere(mkdtempSync(path.join(os.tmpdir(), 'dec-nogit-')), [{ kind: 'branch', who: 'x', branch: 'office/x', sha: 'deadbeef' }], ['docs/team/development.md']);
  assert.equal(reads[0].outcome.get('docs/team/development.md'), 'failed');
  // And an AWAITING item from a failed read is kept with a note on its card.
  const asks = collectDecisions({ floor: 'f', workers: [], pulls: [], floors: [], asks: { floor: 'f', items: [{ id: 'a1', kind: 'advisory', text: 'Gate advisory', level: 'warn', acts: [{ act: 'seen', label: 'Seen' }] }], unreadAt: Date.UTC(2026, 9, 14, 14, 2) } });
  assert.ok(asks.cards[0].notes.some((n) => /couldn't re-read at 14:02 UTC/.test(n)));
});

test('decisions-dismissed-not-resolved: dismissing hides a stuck item (listed apart as hidden) and leaves it open', async () => {
  const h = stuckHarness();
  await h.svc.look(h.floor);
  assert.equal(await h.svc.act(h.floor, 'decision-OW-1', 'dismiss', { by: 'Keith' }), undefined);
  const v = await h.svc.view(h.floor, true);
  assert.equal(v.items.some((i) => i.id === 'decision-OW-1'), false);
  assert.deepEqual(v.dismissed?.map((d) => d.id), ['decision-OW-1']);
  assert.ok(v.dismissed![0].dismissedAt);
  assert.equal((await h.svc.book('sf')).data.items['decision-OW-1'].status, 'open');
  assert.match(events.filter((e) => e.action === 'stuck.dismissed').at(-1)!.summary, /hidden, not resolved/);
});

test('decisions-human-action-proposal: two approvals at once make one issue, and the approval puts a hands-on card in Needs you, open until I\'ve done it', async () => {
  let issues = 0;
  const t = setup(async () => {
    issues++;
    await new Promise((r) => setTimeout(r, 30));
    return { number: 41 };
  });
  const p: Proposal = { id: 'px', standup: '2026-10-14', role: 'lead-developer', team: 'development', by: 'Dylan', kind: 'human-action', title: 'Merge PR #98 on GitHub', detail: 'Only a person can merge it.', status: 'pending' };
  t.roster.data(t.floor.id).proposals.push(p);
  const [a, b] = await Promise.all([t.roster.standups.decide(t.floor, 'px', 'approve', 'Keith'), t.roster.standups.decide(t.floor, 'px', 'approve', 'Keith')]);
  assert.equal(issues, 1, 'one issue');
  assert.deepEqual([a, b].sort(), [undefined, 'Already being approved'].sort());
  assert.equal(p.status, 'approved');
  const hands = t.roster.data(t.floor.id).escalations.filter((e) => e.from?.kind === 'proposal' && e.from.key === 'px');
  assert.equal(hands.length, 1);
  assert.equal(hands[0].trigger, 'needs-human');
  const { cards } = collectDecisions({ floor: t.floor.id, workers: [], pulls: [], floors: [], roster: t.view() });
  const c = cards.find((x) => x.escalation === hands[0].id)!;
  assert.equal(c.kind, 'hands-on');
  assert.deepEqual(cardActs(c), ['done', 'cant-now', 'ask']);
  // Approving again (already approved) changes nothing; I've done it closes it.
  assert.match((await t.roster.standups.decide(t.floor, 'px', 'approve', 'Keith'))!, /Already/);
  await t.roster.escalations.resolve(t.floor, hands[0].id, 'reply', '', 'Keith', 'done');
  assert.equal(hands[0].status, 'resolved');
});

test('decisions-separate: Separate splits a group, survives a reload, and is audited', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'dec-split-'));
  const svc = new DecisionsService({ cfg: { dataDir, testMode: true } } as never);
  const floor = { id: 'f1' } as never;
  assert.equal(await svc.act(floor, { action: 'separate', cardId: 'esc:e51', sourceId: 'stuck:pr-51' }, 'Keith'), undefined);
  assert.equal(events.filter((e) => e.action === 'decisions.separate').at(-1)!.target?.id, 'esc:e51');
  // A new store (the office restarted) reads it back.
  const splits = await new SplitsStore(dataDir).get('f1');
  assert.deepEqual(splits.map((s) => [s.cardId, s.sourceId]), [['esc:e51', 'stuck:pr-51']]);
  const r = { floor: 'f1', admin: true, escalations: [{ id: 'e51', at: 1, workerId: 'w', by: 'Ada', urgency: 'important', fyi: false, level: 2, title: 'PR #51 needs your review', details: '', options: [], status: 'open', refs: { pr: 51 } }], approvals: [] } as unknown as RosterView;
  const st = { floor: 'f1', items: [{ id: 'pr-51', kind: 'stale-pr', since: 1, blocks: [], evidence: [], pr: { number: 51, title: 'x' }, raisedAt: 1 }] } as never;
  assert.equal(collectDecisions({ floor: 'f1', workers: [], pulls: [], floors: [], roster: r, stuck: st }).cards.length, 1);
  assert.equal(collectDecisions({ floor: 'f1', workers: [], pulls: [], floors: [], roster: r, stuck: st, splits }).cards.length, 2);
});

test('the status check after I\'ve done it: only where one exists, labelled as a check, faked in test mode', async () => {
  assert.equal(checkFor('Sign in to the Marketplace on this machine: mxcli auth login'), 'mxcli');
  assert.equal(checkFor('Run gh auth login so the agents can open PRs'), 'gh');
  assert.equal(checkFor('Paste the SMTP password'), undefined);
  const r = await runCheck('gh', { dataDir: os.tmpdir(), testMode: true, now: () => 5 });
  assert.deepEqual(r, { kind: 'gh', label: 'Check: gh auth status', ok: true, text: 'Test mode: the check was not run (a fake result).', at: 5, faked: true });
});

test('decisions-perms: every new action (Separate, Noted, I\'ve done it, Resolved…) is refused on the server unless you are an admin', async () => {
  for (const action of ['separate', 'noted', 'done', 'resolved', 'still-needed', 'cant-now', 'answer']) {
    let status = 0;
    let body = '';
    const res = { writeHead: (s: number) => (status = s), end: (b: string) => (body = b) } as never;
    const req = { headers: { 'content-type': 'application/json', host: 'office.test', origin: 'http://office.test' } } as never;
    const ctx = { cfg: {}, meOf: () => ({ admin: false }), floors: new Map() } as never;
    await decisionRoutes.act.handle(ctx, { req, res, session: { account: { id: 'u1', name: 'Guest' } } } as never);
    assert.equal(status, 403, action);
    assert.match(body, /Only the Project Manager \(an admin\)/);
  }
});
