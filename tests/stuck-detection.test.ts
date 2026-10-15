// Stuck detection (server/stuck/, shared/stuck.ts): fixtures shaped like the travel-approval incident
// (a fix PR open for days with nobody on it, "J-08 fails on #51" in the build plan, decision OW-1
// parking rows 59–62 on stubs), with fictional content and fake GitHub data. No office, no gh, no git.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanStuckSettings, leadMessage, STUCK_DEFAULTS, stuckTitle, type StuckSettings } from '../src/shared/stuck.js';
import { collectNeeds } from '../src/shared/needsyou.js';
import { isRedNeed } from '../src/shared/notify-teams.js';
import { detectStuck, failingStreaks, MIN_ACTIVE_MS, type PullFacts } from '../src/server/stuck/detect.js';
import { StuckBook } from '../src/server/stuck/book.js';
import { StuckService, type StuckDeps, type StuckFloor } from '../src/server/stuck/service.js';
import { openQuestions, pendingDecisions, prRefs, planRows, projectFacts, rowNumbers } from '../src/server/stuck/parse.js';
import type { RepoRead } from '../src/server/stuck/repo.js';
import type { AuditInput } from '../src/shared/audit.js';
import { compilePage } from '../src/server/roster/standup.js';

const H = 3_600_000;
const NOW = Date.parse('2026-10-04T12:00:00Z');

const PLAN = `# Build plan - expense-claims (ExpenseClaims)

Stage 4. Author: developer subagent for the Lead Developer, 2026-09-25.

## Pending decisions (promoted to the top)

Still pending. Nothing here blocks rows 1 to 57: they build on stubs and fictional demo data.

| ID | Question | Raised | Blocks (rows) | Build proceeds on |
|---|---|---|---|---|
| OW-1 | Named owners, not yet named: the SSO IdP registration and test tenant, and the SMTP host and account (LS01, LS03) | PROJECT.md OI-1 | 59, 60, 61, 62 (Phase 9 wiring, blocked on "owner not yet named") | stubs |
| OI-2 | Volumes and retention. DECIDED 2026-09-28: the PM chose the POC assumptions | CAC-3 NFR question | none (65 measures against them) | POC numbers ASSUMED |
| OI-7 | Real names for the approver table (LS05) | Stage 5 seeding | 21 real-name replacement only | fictional names |

## Script sequence

### Phase 2 - Seed data

| # | Kind | Step | Produces / Proves | Depends on | Skills | State |
|---|---|---|---|---|---|---|
| 21 | BUILD | \`22-seed-people.mdl\` | 9 profiles | 20 | demo-data | built - fictional names |
| 27 | BUILD | \`33-access-flows.mdl\` | 6 microflows | 24 | xpath-constraints | partial - DS_Claim_Team throws for every manager; blocked on #51 (open, with the PM) |
| 41 | BUILD | \`53-list-pages.mdl\`: Claims_My, Claims_Inbox, Team_Claims | 3 overview pages | 37 | overview-pages | partial - Claims_My green (J-01 to J-04); Team_Claims fails for every manager (N1; J-08 44/2) and its filters are not built: both blocked on #51 |

### Phase 9 - Real integrations

| # | Kind | Step | Produces / Proves | Depends on | Skills | State |
|---|---|---|---|---|---|---|
| 58 | BRIEF | integration contracts | brief | 57 | module-brief | blocked - OW-1 |
| 59 | BUILD | install Email Connector | real mail | 58 | constants | blocked - OW-1 (SMTP owner); STUB_SUB_Mail_Send in use |
| 60 | BUILD | install OIDC SSO | J-09 | 58 | constants | blocked - OW-1 (IdP owner); J-09 not written |
| 61 | BUILD | assistant | real assistant | 58 | agents | blocked - OW-1 |
| 62 | PROVE | trace shape | failures visible | 59, 60, 61 | testing-shape | blocked - OW-1 (needs rows 59 to 61) |
| 64 | HARNESS | run J-01 to J-08 | journeys pass | 57 | journey-proof | partial - J-01 to J-07 green; J-08 fails on #51; J-09 blocked (row 60) |
`;

const PROJECT = `# PROJECT.md — expense-claims Decision Register

## Current stage

Stage 5 (build), slice 1.

## Decisions

| Stage | Decision | Status | Notes |
|---|---|---|---|
| 3 | Role model: Claimant / Approver / Finance | CONFIRMED | PM, 2026-09-26 |
| 4 | Integration owners (OW-1): named when known; build-plan rows 59–62 stay parked on stubs until then | CONFIRMED | PM, escalation 1a2b Q4, 2026-09-30 |

## Open questions

| # | Question | Raised at | Status |
|---|---|---|---|
| OQ-1 | Which AI provider? | CAC-1 | ANSWERED 2026-09-26 — PM approved |
| OQ-9 | Which cost centres can claim travel? | Stage 3 gate 2026-09-29 | Open, waiting on the client |

### Dependencies and open issues carried into the build plan

| ID | Item | Type | Resolution / owner |
|---|---|---|---|
| OI-1 | SSO and mail owners | Decided | PM approved 2026-09-27. Still open inside it: the named owners |
| OI-4 | Marketplace Buy | Dependency | pending OQ-5 |
| OI-7 | Seed data names | Decision needed (deferred by the PM, 2026-09-30; stubs remain) | PM at Stage 5 seeding |
`;

/**
 * The register with OW-1 still pending. In PROJECT, OW-1's row is CONFIRMED "for now" (parked on stubs):
 * since decision cards (the OW-1 bug, slice 0 baseline) that is accepted, not waiting on you, so the tests
 * that need OW-1 waiting use this one.
 */
const OPEN_PROJECT = PROJECT.replace('stay parked on stubs until then | CONFIRMED |', 'stay parked on stubs until then | PROPOSED |');

const files = (plan = PLAN, project = OPEN_PROJECT): RepoRead => ({ sha: 'abc', plan: { file: 'architecture/build-plan.md', text: plan }, project: { file: 'PROJECT.md', text: project }, reports: [], planChangedAt: '2026-10-01T08:00:00Z' });

const pr51 = (over: Partial<PullFacts> = {}): PullFacts => ({ number: 51, title: 'Fix: Team_Claims errors for every manager (scoped Responsibility read)', state: 'OPEN', isDraft: false, url: 'https://github.example/acme/expense-claims/pull/51', createdAt: '2026-09-30T09:28:00Z', updatedAt: '2026-09-30T09:28:00Z', ...over });

const settings = (over: Partial<StuckSettings> = {}): StuckSettings => ({ ...STUCK_DEFAULTS, ...over });

const detect = (o: { pulls?: PullFacts[]; plan?: string; project?: string; s?: Partial<StuckSettings>; now?: number } = {}) =>
  detectStuck({ now: o.now ?? NOW, settings: settings(o.s), pulls: o.pulls ?? [pr51()], files: files(o.plan, o.project), firstSeen: () => o.now ?? NOW });

// ---- A fake office for the service -----------------------------------------------------------------

function harness(o: { pulls?: PullFacts[]; plan?: string; project?: string; working?: boolean; s?: Partial<StuckSettings>; dir?: string } = {}) {
  const state = { now: NOW, pulls: o.pulls ?? [pr51()], plan: o.plan ?? PLAN, project: o.project ?? OPEN_PROJECT, working: o.working ?? false, s: settings(o.s), leadWorking: true };
  const audits: AuditInput[] = [];
  const told: { text: string; when: string; by: string }[] = [];
  const floor: StuckFloor = { id: 'expense', name: 'expense-claims', dir: '/nowhere', pulls: () => state.pulls, working: () => state.working };
  const dataDir = o.dir ?? mkdtempSync(path.join(os.tmpdir(), 'stuck-'));
  const deps: StuckDeps = {
    dataDir,
    floors: () => [floor],
    now: () => state.now,
    settings: () => state.s,
    readRepo: async () => files(state.plan, state.project),
    runs: async () => [],
    spendSince: () => ({ spend: 12.5, currency: 'USD' }),
    lead: () => ({ name: 'Ada', working: state.leadWorking }),
    tell: (_f, text, by, when) => void told.push({ text, when, by }),
    openEscalations: () => [],
    record: (e) => void audits.push(e),
  };
  return { state, audits, told, floor, dataDir, svc: new StuckService(deps), deps };
}

// ---- 1. Stale PR -------------------------------------------------------------------------------------

test('a stale PR named in the build plan raises one item that blocks J-08 and Team_Claims, with the failing journey on the same card', () => {
  const items = detect();
  const prs = items.filter((d) => d.kind === 'stale-pr');
  assert.equal(prs.length, 1);
  const d = prs[0];
  assert.equal(d.id, 'pr-51');
  assert.deepEqual(d.blocks, ['J-08', 'Team_Claims']);
  assert.equal(stuckTitle(d, NOW), "PR #51 has had no activity for 4 days. It blocks J-08 and 'Team_Claims' (build plan).");
  // Failing for days with the same cause is linked, not a second card.
  assert.equal(items.filter((x) => x.kind === 'failing').length, 0);
  assert.deepEqual(d.failing?.map((f) => f.name), ['J-08']);
  // Evidence: the PR's link and file:line at main.
  assert.ok(d.evidence.some((e) => e.url?.endsWith('/pull/51')));
  assert.ok(d.evidence.some((e) => e.label === `architecture/build-plan.md:${PLAN.split('\n').findIndex((l) => l.startsWith('| 41 ')) + 1}`));
});

test('a PR with recent activity, a draft, or under the threshold is not stale', () => {
  assert.equal(detect({ pulls: [pr51({ updatedAt: '2026-10-04T08:00:00Z' })] }).filter((d) => d.kind === 'stale-pr').length, 0);
  assert.equal(detect({ pulls: [pr51({ isDraft: true })] }).filter((d) => d.kind === 'stale-pr').length, 0);
  assert.equal(detect({ s: { prHours: 24 * 5 } }).filter((d) => d.kind === 'stale-pr').length, 0);
});

test('merging or closing the PR resolves its item, and the history goes to the audit log', async () => {
  for (const state of ['MERGED', 'CLOSED']) {
    const h = harness();
    await h.svc.look(h.floor);
    assert.equal((await h.svc.view(h.floor, true)).items.filter((i) => i.id === 'pr-51').length, 1);
    h.state.pulls = [pr51({ state, mergedAt: state === 'MERGED' ? '2026-10-04T12:30:00Z' : undefined })];
    h.state.now += 10 * 60_000;
    const events = await h.svc.look(h.floor);
    assert.ok(events.some((e) => e.action === 'resolved' && e.record.id === 'pr-51'), state);
    assert.equal((await h.svc.view(h.floor, true)).items.filter((i) => i.id === 'pr-51').length, 0);
    assert.deepEqual(h.audits.filter((a) => a.target?.id === 'pr-51').map((a) => a.action), ['stuck.raised', 'stuck.resolved']);
  }
});

test('snooze hides an item until the time passes; dismiss only hides it (it stays open and still resolves by itself)', async () => {
  const h = harness();
  await h.svc.look(h.floor);
  assert.equal(await h.svc.act(h.floor, 'pr-51', 'snooze', { by: 'Keith' }), undefined);
  assert.equal((await h.svc.view(h.floor, true)).items.some((i) => i.id === 'pr-51'), false);
  h.state.now += 23 * H;
  await h.svc.look(h.floor);
  assert.equal((await h.svc.view(h.floor, true)).items.some((i) => i.id === 'pr-51'), false);
  h.state.now += 2 * H;
  await h.svc.look(h.floor);
  assert.equal((await h.svc.view(h.floor, true)).items.some((i) => i.id === 'pr-51'), true, 'back after a day');

  assert.equal(await h.svc.act(h.floor, 'pr-51', 'dismiss', { by: 'Keith' }), undefined);
  const v = await h.svc.view(h.floor, true);
  assert.equal(v.items.some((i) => i.id === 'pr-51'), false);
  assert.ok(v.hidden >= 1);
  const book = await h.svc.book('expense');
  assert.equal(book.data.items['pr-51'].status, 'open', 'dismiss never resolves');
  h.state.pulls = [pr51({ state: 'MERGED', mergedAt: '2026-10-05T14:00:00Z' })];
  await h.svc.look(h.floor);
  assert.equal(book.data.items['pr-51'].status, 'resolved');
  assert.deepEqual(h.audits.filter((a) => a.target?.id === 'pr-51').map((a) => a.action), ['stuck.raised', 'stuck.snoozed', 'stuck.dismissed', 'stuck.resolved']);
});

test('Ask the lead sends one message through the team tell, after their turn by default; the office writes nothing to GitHub', async () => {
  const h = harness();
  await h.svc.look(h.floor);
  assert.equal(await h.svc.act(h.floor, 'pr-51', 'ask-lead', { by: 'Keith' }), undefined);
  assert.equal(h.told.length, 1);
  assert.equal(h.told[0].when, 'after');
  assert.match(h.told[0].text, /PR #51 .* has had no activity for 4 days/);
  assert.match(h.told[0].text, /Rebase it .* or close it/);
  assert.match(h.told[0].text, /J-08/);
  assert.equal(await h.svc.act(h.floor, 'pr-51', 'ask-lead', { by: 'Keith', when: 'now' }), undefined);
  assert.equal(h.told[1].when, 'now');
  // The item is not resolved by asking: only the PR merging or closing does that.
  assert.equal((await h.svc.view(h.floor, true)).items.some((i) => i.id === 'pr-51'), true);
  assert.equal(await h.svc.act(h.floor, 'pr-51', 'answer', { by: 'Keith', text: 'x' }), '"answer" isn\'t an action of this item');
});

// ---- 2. Decisions waiting on the PM --------------------------------------------------------------------

test('a pending decision that blocks rows 59–62 and proceeds on stubs raises one item; decided or deferred rows do not', () => {
  const ds = detect().filter((d) => d.kind === 'decision');
  assert.deepEqual(ds.map((d) => d.id).sort(), ['decision-OQ-9', 'decision-OW-1']);
  const d = ds.find((x) => x.id === 'decision-OW-1')!;
  assert.equal(d.decision?.rows, 'rows 59–62');
  assert.deepEqual(d.decision?.journeys, ['J-09']);
  assert.equal(d.decision?.workaround, 'stubs');
  assert.equal(stuckTitle(d, NOW), 'Decision waiting on you: OW-1 Named owners, not yet named: the SSO IdP registration and test tenant, and the SMTP host and account. Blocks build-plan rows 59–62 (J-09). Build continues on stubs.');
  // Raised from PROJECT.md OI-1's date (2026-09-27).
  assert.equal(d.since, Date.parse('2026-09-27T00:00:00Z'));
});

test('recording the decision in PROJECT.md as CONFIRMED resolves it', async () => {
  const h = harness();
  await h.svc.look(h.floor);
  assert.ok((await h.svc.view(h.floor, true)).items.some((i) => i.id === 'decision-OW-1'));
  h.state.project = PROJECT.replace('| 4 | Integration owners (OW-1): named when known', '| 5 | Integration owners (OW-1): SSO = Grace Hopper (IdP), SMTP = Alan Turing | CONFIRMED | PM, 2026-10-04 |\n| 4 | Integration owners (OW-1): named when known');
  h.state.now += H;
  const events = await h.svc.look(h.floor);
  assert.ok(events.some((e) => e.action === 'resolved' && e.record.id === 'decision-OW-1'));
});

test('stuck-no-reraise-confirmed: a register row CONFIRMED "for now" (accepted) or CONFIRMED is not waiting on you (the OW-1 bug)', () => {
  // OW-1 on Travel Approval: PROJECT.md's row is CONFIRMED with "parked on stubs until then" (accepted for now 2026-09-30).
  assert.ok(projectFacts(PROJECT, 'OW-1').accepted);
  assert.equal(detect({ project: PROJECT }).some((d) => d.id === 'decision-OW-1'), false, 'accepted for now: not re-raised from its own evidence');
  const answered = OPEN_PROJECT.replace('| 4 | Integration owners (OW-1): named when known', '| 5 | Integration owners (OW-1): SSO = Grace Hopper | CONFIRMED | PM, 2026-10-04 |\n| 4 | Integration owners (OW-1): named when known');
  assert.equal(detect({ project: answered }).some((d) => d.id === 'decision-OW-1'), false, 'CONFIRMED');
  assert.ok(detect().some((d) => d.id === 'decision-OW-1'), 'still pending: raised');
  // An open question in the register answered in the Decisions table, or marked "accepted for now", isn't either.
  const oq = OPEN_PROJECT.replace('| OQ-9 | Which cost centres can claim travel? | Stage 3 gate 2026-09-29 | Open, waiting on the client |', '| OQ-9 | Which cost centres can claim travel? | Stage 3 gate 2026-09-29 | Open, accepted for now 2026-10-01 |');
  assert.equal(detect({ project: oq }).some((d) => d.id === 'decision-OQ-9'), false);
  const oq2 = OPEN_PROJECT.replace('| 3 | Role model', '| 4 | Cost centres (OQ-9): all of them | CONFIRMED | PM, 2026-10-02 |\n| 3 | Role model');
  assert.equal(detect({ project: oq2 }).some((d) => d.id === 'decision-OQ-9'), false);
});

test('a decision under its threshold, or with every blocked row built, raises nothing', () => {
  const young = PLAN.replace('| PROJECT.md OI-1 |', '| Stage 4 gate 2026-10-04 |');
  assert.equal(detect({ plan: young, project: OPEN_PROJECT.replace(/OW-1/g, 'XX-9') }).some((d) => d.id === 'decision-OW-1'), false);
  const built = PLAN.replace(/\| blocked - OW-1[^|]*\|/g, '| built - done |');
  assert.equal(detect({ plan: built }).some((d) => d.id === 'decision-OW-1'), false);
});

test('Accept the current workaround sends "PM accepts stubs for this slice; record as CONFIRMED" to the lead and quiets the item', async () => {
  const h = harness();
  await h.svc.look(h.floor);
  assert.equal(await h.svc.act(h.floor, 'decision-OW-1', 'accept', { by: 'Keith' }), undefined);
  assert.equal(h.told.length, 1);
  assert.match(h.told[0].text, /^PM accepts stubs for this slice; record as CONFIRMED\./);
  assert.match(h.told[0].text, /rows 59–62/);
  assert.equal((await h.svc.view(h.floor, true)).items.some((i) => i.id === 'decision-OW-1'), false);
  assert.equal(h.audits.at(-1)?.action, 'stuck.accept');
});

test('Answer needs words, and tells the lead to record it as CONFIRMED by the PM and unblock the rows', async () => {
  const h = harness();
  await h.svc.look(h.floor);
  assert.equal(await h.svc.act(h.floor, 'decision-OW-1', 'answer', { by: 'Keith', text: '  ' }), 'Write the answer first');
  assert.equal(await h.svc.act(h.floor, 'decision-OW-1', 'answer', { by: 'Keith', text: 'SSO: Grace (IdP team); SMTP: Alan' }), undefined);
  assert.match(h.told[0].text, /answers decision OW-1 .*"SSO: Grace \(IdP team\); SMTP: Alan"\. Record it in PROJECT\.md's Decisions as CONFIRMED by the Project Manager on 2026-10-04, mark OW-1 decided .*unblock rows 59–62/);
  // Still open until the file says so.
  assert.ok((await h.svc.view(h.floor, true)).items.some((i) => i.id === 'decision-OW-1'));
});

// ---- 3. Failing for days --------------------------------------------------------------------------------

test('failing for days links to the stale PR instead of duplicating; with the PR active it is a card of its own', () => {
  assert.equal(detect().filter((d) => d.kind === 'failing').length, 0);
  const active = detect({ pulls: [pr51({ updatedAt: '2026-10-04T10:00:00Z' })] });
  const f = active.filter((d) => d.kind === 'failing');
  assert.equal(f.length, 1);
  assert.equal(stuckTitle(f[0], NOW), 'J-08 has failed for 4 days: waits on PR #51');
  // With the PR merged, the build plan's claim no longer counts.
  assert.equal(detect({ pulls: [pr51({ state: 'MERGED', mergedAt: '2026-10-04T10:00:00Z' })] }).filter((d) => d.kind === 'failing').length, 0);
});

test("Testing's records: a test failing the same way on main for 48 h is a streak; a PR's own runs and a new failure are not", () => {
  const run = (at: string, status: string, detail = 'SecurityRuntimeException on Responsibility', pr?: number) => ({ suite: 'journeys', finishedAt: at, ...(pr ? { pr } : {}), results: [{ name: 'J-10 team view', status, detail }] });
  const streak = failingStreaks([run('2026-09-30T10:00:00Z', 'passed'), run('2026-10-01T10:00:00Z', 'failed'), run('2026-10-03T10:00:00Z', 'failed'), run('2026-10-04T10:00:00Z', 'failed', 'SecurityRuntimeException on Responsibility', 77)]);
  assert.deepEqual(streak.map((s) => [s.name, s.since]), [['J-10', Date.parse('2026-10-01T10:00:00Z')]]);
  const changed = failingStreaks([run('2026-10-01T10:00:00Z', 'failed', 'timeout'), run('2026-10-04T10:00:00Z', 'failed', 'assertion')]);
  assert.equal(changed[0].since, Date.parse('2026-10-04T10:00:00Z'));
  const items = detectStuck({ now: NOW, settings: settings(), pulls: [], failing: streak, firstSeen: () => NOW });
  assert.equal(items.filter((d) => d.kind === 'failing').length, 1);
  assert.equal(detectStuck({ now: NOW, settings: settings(), pulls: [], failing: changed, firstSeen: () => NOW }).length, 0);
});

// ---- 4. Going in circles -------------------------------------------------------------------------------

test('going in circles fires only after the threshold and with real agent activity, and progress starts it again', () => {
  const book = new StuckBook();
  const sig = { merged: '50@2026-10-01', rows: 'r1', stage: 's1' };
  const step = 5 * 60_000;
  let t = NOW;
  book.track(t, true, sig, {}, 2 * step, { at: t, what: 'PR #50 merged' });
  const activity = () => ({ lastProgressAt: book.data.activity.lastProgressAt!, activeMs: book.data.activity.activeMs, lastProgress: book.data.activity.lastProgress });
  const circles = () => detectStuck({ now: t, settings: settings(), pulls: [], activity: activity(), firstSeen: () => t }).filter((d) => d.kind === 'circles');
  // Idle agents for three days: no activity, nothing raised.
  for (let i = 0; i < (72 * H) / step; i++) book.track((t += step), false, sig, {}, 2 * step);
  assert.equal(circles().length, 0);
  // Working for the next 10 hours (still past 48 h without progress): raised, with the facts.
  for (let i = 0; i < (10 * H) / step; i++) book.track((t += step), true, sig, {}, 2 * step);
  const c = circles();
  assert.equal(c.length, 1);
  assert.ok(c[0].circles!.activeMs >= MIN_ACTIVE_MS);
  assert.match(stuckTitle(c[0], t), /^The team has been working for 10 hours over 3 days with no progress/);
  // A build-plan row changes: the window starts again.
  book.track((t += step), true, { ...sig, rows: 'r2' }, {}, 2 * step);
  assert.equal(circles().length, 0);
  // Under the threshold even with constant work.
  const b2 = new StuckBook();
  let u = NOW;
  b2.track(u, true, sig, {}, 2 * step, { at: u, what: 'x' });
  for (let i = 0; i < (40 * H) / step; i++) b2.track((u += step), true, sig, {}, 2 * step);
  assert.equal(detectStuck({ now: u, settings: settings(), pulls: [], activity: { lastProgressAt: b2.data.activity.lastProgressAt!, activeMs: b2.data.activity.activeMs }, firstSeen: () => u }).length, 0);
});

// ---- Raised once, OFF, the inbox -------------------------------------------------------------------------

test('raised once and updated in place: never duplicated across looks or a restart', async () => {
  const h = harness();
  for (let i = 0; i < 4; i++) {
    await h.svc.look(h.floor);
    h.state.now += 5 * 60_000;
  }
  const raised = () => h.audits.filter((a) => a.action === 'stuck.raised').map((a) => a.target?.id).sort();
  assert.deepEqual(raised(), ['decision-OQ-9', 'decision-OW-1', 'pr-51']);
  // A day later the age moves on, but nothing is raised again or "updated" for the age alone.
  h.state.now += 24 * H;
  await h.svc.look(h.floor);
  assert.equal(h.audits.filter((a) => a.action === 'stuck.updated').length, 0);
  // A new fact (the plan now also names Claims_Export as waiting on #51): updated in place, same id.
  h.state.plan = PLAN.replace('J-09 blocked (row 60) |', 'J-09 blocked (row 60); Claims_Export waits on #51 |');
  await h.svc.look(h.floor);
  assert.equal(h.audits.filter((a) => a.action === 'stuck.updated' && a.target?.id === 'pr-51').length, 1);
  const v = await h.svc.view(h.floor, true);
  assert.equal(v.items.filter((i) => i.id === 'pr-51').length, 1);
  assert.ok(v.items.find((i) => i.id === 'pr-51')!.blocks.includes('Claims_Export'));
  // Restart: a new service on the same data folder raises nothing new.
  const again = harness({ dir: h.dataDir, plan: h.state.plan });
  again.state.now = h.state.now + 5 * 60_000;
  await again.svc.look(again.floor);
  assert.equal(again.audits.filter((a) => a.action === 'stuck.raised').length, 0);
});

test('detection OFF raises nothing and shows nothing', async () => {
  assert.deepEqual(detect({ s: { on: false } }), []);
  const h = harness({ s: { on: false } });
  assert.deepEqual(await h.svc.look(h.floor), []);
  assert.equal(h.audits.length, 0);
  assert.deepEqual((await h.svc.view(h.floor, true)).items, []);
  assert.equal(cleanStuckSettings(undefined).on, true, 'on by default');
  assert.deepEqual(cleanStuckSettings({ on: false, prHours: 0, failingHours: 72 }), { on: false, prHours: 24, decisionHours: 24, failingHours: 72, circlesHours: 48 });
});

test('an open escalation about the same thing no longer hides the item: it is listed, and groups with it on one decision card (Slice 1A)', async () => {
  const h = harness();
  h.deps.openEscalations = () => [{ title: 'PR #51 needs your review', details: 'Team_Claims' }];
  await h.svc.look(h.floor);
  const v = await h.svc.view(h.floor, true);
  // Was hidden ("covered"); now shown, so the card can list it as a source.
  assert.equal(v.items.some((i) => i.id === 'pr-51'), true);
  assert.ok(v.items.some((i) => i.id === 'decision-OW-1'));
});

test('stuck items are actionable Needs-you items (counted by the strip and the Overview, pushed as red)', async () => {
  const h = harness();
  await h.svc.look(h.floor);
  const v = await h.svc.view(h.floor, true);
  const needs = collectNeeds({ floor: 'expense', workers: [], pulls: [], floors: [], stuck: { floor: 'expense', items: v.items }, now: NOW });
  const stuck = needs.filter((n) => n.kind === 'stuck');
  assert.equal(stuck.length, 3);
  const pr = stuck.find((n) => n.key === 'stuck-pr-51')!;
  assert.equal(pr.action, 'Ask Ada');
  assert.equal(pr.level, 'block');
  assert.deepEqual(pr.target, { to: 'stuck', id: 'pr-51' });
  assert.equal(stuck.find((n) => n.key === 'stuck-decision-OW-1')!.action, 'Answer');
  assert.ok(stuck.every(isRedNeed));
  // Another floor's items never show here.
  assert.equal(collectNeeds({ floor: 'other', workers: [], pulls: [], floors: [], stuck: { floor: 'expense', items: v.items } }).length, 0);
});

test('the standup page gets a "Blocked on you" section: the office\'s stuck items and the Leads\' blockers only the PM can clear', () => {
  const page = compilePage(
    { id: '2026-10-04', date: '2026-10-04', startedAt: 0, by: 'schedule', status: 'compiled', waiting: [], proposalIds: [], reports: [{ role: 'lead-developer', name: 'Dylan', source: 'live', done: [], next: [], blockers: ['Team_Claims waits on #51, a review from the PM', 'flaky CI'] }] },
    [],
    2,
    'expense-claims',
    ['Decision waiting on you: OW-1 integration owners.'],
  );
  const part = page.split('## Blocked on you')[1].split('## Needs the Project Manager')[0];
  assert.match(part, /- Decision waiting on you: OW-1 integration owners\./);
  assert.match(part, /- Dylan: Team_Claims waits on #51, a review from the PM/);
  assert.doesNotMatch(part, /flaky CI/);
});

// ---- The parsers on their own -----------------------------------------------------------------------------

test('parsers: row numbers, pending decisions, PR mentions, PROJECT.md facts, open questions', () => {
  assert.deepEqual(rowNumbers('59, 60, 61, 62 (Phase 9 wiring)'), ['59', '60', '61', '62']);
  assert.deepEqual(rowNumbers('rows 59–62'), ['59', '60', '61', '62']);
  assert.deepEqual(rowNumbers('none (65 measures)'), []);
  assert.deepEqual(pendingDecisions(PLAN).map((p) => p.id), ['OW-1', 'OI-7']);
  const refs = prRefs(51, [{ file: 'architecture/build-plan.md', text: PLAN }], planRows(PLAN));
  assert.deepEqual(refs.rows.sort(), ['27', '41', '64']);
  assert.equal(prRefs(5, [{ file: 'architecture/build-plan.md', text: PLAN }]).lines.length, 0, '#5 is not #51');
  assert.equal(projectFacts(PROJECT, 'OW-1').confirmed, undefined);
  assert.ok(projectFacts(PROJECT, 'OW-1').accepted);
  assert.deepEqual(openQuestions(PROJECT).map((q) => q.id), ['OQ-9']);
  assert.match(leadMessage('blockers', { id: 'circles', kind: 'circles', since: NOW - 72 * H, blocks: [], evidence: [], circles: { activeMs: 10 * H } }, NOW)!, /blockers summary/);
});

// ---- The rules of the road -----------------------------------------------------------------------------

test('no new gh calls, no GitHub writes, no synchronous fs or child processes in stuck detection', () => {
  const dir = path.join(process.cwd(), 'src', 'server', 'stuck');
  const src = readdirSync(dir).map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n') + readFileSync(path.join(process.cwd(), 'src', 'server', 'http', 'routes', 'stuck.ts'), 'utf8');
  assert.doesNotMatch(src, /\b(readFileSync|writeFileSync|existsSync|mkdirSync|execSync|execFileSync|spawnSync)\b/);
  assert.doesNotMatch(src, /node:child_process|from '\.\.\/github\.js'|gh\(\[|api\.github\.com|octokit/i);
  assert.match(src, /from '\.\.\/testing\/repo\.js'/, 'repo reads go through the off-loop git reader');
});

test('the Overview Needs you card shows stuck items as actionable rows tagged Stuck, counted in "N waiting on you"', async () => {
  const { rowModel } = await import('../src/client/ui/portal/needs-logic.js');
  const { waitingCount } = await import('../src/client/ui/needsyou/feed.js');
  const h = harness();
  await h.svc.look(h.floor);
  const v = await h.svc.view(h.floor, true);
  const needs = collectNeeds({ floor: 'expense', workers: [], pulls: [], floors: [], stuck: { floor: 'expense', items: v.items }, now: NOW });
  const row = rowModel(needs.find((n) => n.key === 'stuck-pr-51')!);
  assert.equal(row.tag, 'Stuck');
  assert.equal(row.tone, 'block');
  assert.equal(waitingCount(needs), 3);
});
