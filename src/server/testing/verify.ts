// Testing release 2 on a floor (docs/site/using-the-office/testing.md, "Verification"): after each
// look at the pull requests, every member's integrated task is judged on its merge commit against the
// policy (its own, else the project's, else the default), and the test-first prompt is raised once when
// it applies. Also the policy and waiver changes (each audited) and the Verification panel's data.
// Everything here reads what the office already has: the floor's PR list, the test-run records and the
// files at main. The office's wiring (ctx) is verify-office.ts.

import { coversLinks } from '../../shared/testing/links.js';
import { DEFAULT_POLICY, evaluatePolicy, LINKED, policyFor, policyWords, waiverProblem, cleanPolicy, type AnyCheckKey, type Criterion, type PolicyEval, type VerificationPolicy, type Waiver } from '../../shared/testing/policy.js';
import { verifyIntegrated, type VerificationTask, type VerificationView } from '../../shared/testing/verify.js';
import type { GhPull } from '../../shared/protocol.js';
import type { RoleId } from '../../shared/roster/roles.js';
import { audit, human } from '../audit/index.js';
import type { Roster } from '../roster/index.js';
import { applyVerification } from '../roster/task-verify.js';
import { staleDone } from '../roster/task-reopen.js';
import type { TeamFloor } from '../roster/types.js';
import path from 'node:path';
import { testingStore } from './index.js';
import { VerifyStore } from './policy-store.js';
import { mergedAtOf } from './switches.js';

const stores = new Map<string, VerifyStore>();

export function verifyStore(dataDir: string, floorId: string): VerifyStore {
  const key = path.join(dataDir, 'testing', floorId);
  let s = stores.get(key);
  if (!s) stores.set(key, (s = new VerifyStore(path.join(dataDir, 'testing'), floorId)));
  return s;
}

export const forgetVerifyStores = (floorId: string) => {
  for (const k of [...stores.keys()]) if (path.basename(k) === floorId) stores.delete(k);
};

export interface PullsLike {
  id: string;
  github: { pulls: { items: readonly GhPull[] } };
}

/** The criteria a PR says it covers ("Covers: AC-04, J-02"), each with its journeys from the AC table when known. */
export function criteriaOf(pull: Pick<GhPull, 'body' | 'number'> | undefined, journeys?: ReadonlyMap<string, string[]>): Criterion[] {
  if (!pull) return [];
  return coversLinks(pull.body, `PR #${pull.number}`)
    .filter((l) => l.target.startsWith('AC-'))
    .map((l) => ({ id: l.target, ...(journeys?.get(l.target)?.length ? { journeys: journeys.get(l.target) } : {}) }));
}

/**
 * Judges every member's integrated task on its merge commit; how many changed. `since` (the judging
 * switch's time, testing/switches.ts): only PRs merged from then on are judged, older ones never.
 */
export async function verifyTasks(dataDir: string, roster: Roster, team: TeamFloor, floor: PullsLike, journeys?: ReadonlyMap<string, string[]>, since?: number): Promise<number> {
  const d = roster.data(floor.id);
  const work = Object.entries(d.members).filter(([, m]) => m.task?.outcome === 'integrated' && m.task.doneAt !== undefined && m.task.pr !== undefined && !staleDone(m.task, { pulls: floor.github.pulls.items }));
  if (!work.length) return 0;
  const [file, records] = await Promise.all([verifyStore(dataDir, floor.id).read(), testingStore(dataDir, floor.id).all()]);
  let n = 0;
  for (const [role, m] of work) {
    const t = m.task!;
    const pull = floor.github.pulls.items.find((p) => p.number === t.pr);
    // Fell off the list (or not loaded): what it was judged last stands.
    if (!pull || pull.state !== 'MERGED') continue;
    if (since !== undefined && (mergedAtOf(pull, t.doneAt) ?? 0) < since) continue;
    const policy = policyFor(file.policy, t.policy);
    const criteria = criteriaOf(pull, journeys);
    const r = verifyIntegrated({ policy, records, head: pull.headRefOid, merge: pull.mergeCommit, criteria, waivers: file.waivers });
    if (applyVerification(roster, team, { workerId: m.workerId ?? '', by: m.name, role: role as RoleId }, t, r, policy, { pr: t.pr!, head: pull.headRefOid, criteria: criteria.map((c) => c.id) })) n++;
  }
  return n;
}

/** The project's policy now, and whether it is the default. */
export async function projectPolicy(dataDir: string, floorId: string): Promise<{ policy: VerificationPolicy; from: 'default' | 'project'; by?: string; at?: number }> {
  const f = await verifyStore(dataDir, floorId).read();
  return f.policy ? { policy: { v: 1, required: f.policy.required, linkedCriteria: f.policy.linkedCriteria }, from: 'project', ...(f.policy.by ? { by: f.policy.by } : {}), ...(f.policy.at ? { at: f.policy.at } : {}) } : { policy: DEFAULT_POLICY, from: 'default' };
}

export interface Who {
  name: string;
  accountId?: string;
}

/** Sets (or, with null, resets to the default) the project's policy. Audited as testing.policy. */
export async function setProjectPolicy(dataDir: string, floorId: string, raw: unknown, who: Who, now = Date.now()): Promise<VerificationPolicy | string> {
  const policy = raw === null ? null : cleanPolicy(raw);
  if (policy === undefined) return 'Send the policy: { required: [...], linkedCriteria: true|false }';
  const before = await projectPolicy(dataDir, floorId);
  await verifyStore(dataDir, floorId).change((f) => {
    if (policy) f.policy = { ...policy, by: who.name, at: now };
    else delete f.policy;
  });
  const after = policy ?? DEFAULT_POLICY;
  audit.record({
    floor: floorId,
    actor: human(who.name, who.accountId),
    action: 'testing.policy',
    target: { kind: 'policy', id: `${floorId}:project`, label: 'Verification policy' },
    summary: policy ? `Set the project's verification policy: ${policyWords(after)}` : `Reset the project's verification policy to the default: ${policyWords(after)}`,
    details: { before: before.policy, after, scope: 'project' },
    severity: 'notice',
  });
  return after;
}

/** Sets (or, with null, clears) one member's task policy. Audited as testing.policy. */
export function setTaskPolicy(roster: Roster, team: TeamFloor, role: string, raw: unknown, who: Who): VerificationPolicy | null | string {
  const m = (roster.data(team.id).members as Record<string, { task?: { text: string; policy?: VerificationPolicy } } | undefined>)[role];
  if (!m?.task) return 'That member has no task';
  const policy = raw === null ? null : cleanPolicy(raw);
  if (policy === undefined) return 'Send the policy: { required: [...], linkedCriteria: true|false }, or null to clear it';
  const before = m.task.policy ?? null;
  if (policy) m.task.policy = policy;
  else delete m.task.policy;
  roster.touch(team, true);
  audit.record({
    floor: team.id,
    actor: human(who.name, who.accountId),
    action: 'testing.policy',
    target: { kind: 'task', id: `${team.id}:${role}`, label: m.task.text },
    summary: policy ? `Set a verification policy for the task "${m.task.text}": ${policyWords(policy)}` : `Cleared the task "${m.task.text}"'s own verification policy (the project's applies)`,
    details: { before, after: policy, scope: 'task', role },
    severity: 'notice',
  });
  return policy;
}

/** Records a waiver: a named person, a reason, one check on one revision. Audited as testing.waive. */
export async function waive(dataDir: string, floorId: string, body: { check?: unknown; revision?: unknown; reason?: unknown; task?: unknown }, who: Who, now = Date.now()): Promise<Waiver | string> {
  const bad = waiverProblem({ ...body, by: who.name });
  if (bad) return bad;
  const w: Waiver = {
    check: body.check as AnyCheckKey,
    revision: String(body.revision).toLowerCase(),
    by: who.name.trim().slice(0, 80),
    ...(who.accountId ? { accountId: who.accountId } : {}),
    reason: String(body.reason).trim().slice(0, 1000),
    at: now,
    ...(typeof body.task === 'string' && body.task.trim() ? { task: body.task.trim().slice(0, 120) } : {}),
  };
  await verifyStore(dataDir, floorId).change((f) => void f.waivers.push(w));
  audit.record({
    floor: floorId,
    actor: human(who.name, who.accountId),
    action: 'testing.waive',
    target: { kind: 'check', id: `${w.check}@${w.revision.slice(0, 12)}`, label: w.check === LINKED ? 'linked criteria' : w.check },
    summary: `Waived the required check ${w.check} on ${w.revision.slice(0, 7)}${w.task ? ` (${w.task})` : ''}: ${w.reason}`,
    details: { check: w.check, revision: w.revision, reason: w.reason, ...(w.task ? { task: w.task } : {}) },
    severity: 'notice',
  });
  return w;
}

/** The Verification panel's data. */
export async function verificationView(dataDir: string, roster: Roster | undefined, floor: PullsLike): Promise<VerificationView> {
  const [p, file, records] = await Promise.all([projectPolicy(dataDir, floor.id), verifyStore(dataDir, floor.id).read(), testingStore(dataDir, floor.id).all()]);
  const merged = floor.github.pulls.items.filter((x) => x.state === 'MERGED' && x.mergeCommit).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || b.number - a.number)[0];
  const newest = merged ? { pr: merged.number, url: merged.url, title: merged.title, revision: merged.mergeCommit!, eval: evaluatePolicy(p.policy, records, merged.mergeCommit, { waivers: file.waivers }) } : undefined;
  const tasks: VerificationTask[] = [];
  if (roster)
    for (const [role, m] of Object.entries(roster.data(floor.id).members)) {
      const t = m.task;
      if (!t || t.outcome !== 'integrated' || t.pr === undefined) continue;
      const state = t.unreviewed ? 'unreviewed' : t.claimUnverified ? 'claim-unverified' : (t.verify?.state ?? 'integrated');
      if (state === 'verified') continue;
      const pull = floor.github.pulls.items.find((x) => x.number === t.pr);
      tasks.push({ role, name: m.name, task: t.text, pr: t.pr, ...(pull ? { url: pull.url } : {}), state, ...(t.verify?.revision ? { revision: t.verify.revision } : {}), ...(t.verify?.head ? { head: t.verify.head } : {}), checks: t.verify?.checks ?? [] });
    }
  return { ...p, words: policyWords(p.policy), ...(newest ? { newest } : {}), tasks, waivers: file.waivers.slice(-20).reverse() };
}

// ---- The test-first prompt -----------------------------------------------------------------------

export interface StageLook {
  /** The build plan (Stage 4) passed. */
  stage4: boolean;
  /** Stage 5 confirmed (passed, waived, or a confirmed decision row). */
  stage5: boolean;
}

export const TEST_FIRST_BY = 'The office (Testing)';

export function testFirstAsk(n: number) {
  return {
    urgency: 'info' as const,
    title: `${n} acceptance criteri${n === 1 ? 'on has' : 'a have'} no linked test`,
    details: [
      `The build plan (Stage 4) has passed and Stage 5 isn't confirmed yet, and ${n} acceptance criteri${n === 1 ? 'on has' : 'a have'} no linked test (App Insights › Testing shows which).`,
      'Test first: ask the Tester Lead to write or extend the tests for them, and to name the criteria each covers (a journey in the AC table, or "Covers: AC-xx" in the test or the PR).',
      'This is a prompt, not a block: nothing waits on it. The office updates the count here as tests are linked.',
    ].join('\n\n'),
    options: [],
  };
}

/** Raises the test-first item once, then keeps its count up to date. Returns what it did. */
export async function testFirst(dataDir: string, roster: Roster, team: TeamFloor, stage: StageLook | undefined, none: number | undefined): Promise<'raised' | 'updated' | 'none'> {
  if (!stage?.stage4 || stage.stage5 || none === undefined) return 'none';
  const store = verifyStore(dataDir, team.id);
  const f = await store.read();
  const d = roster.data(team.id);
  if (f.testFirst) {
    const e = d.escalations.find((x) => x.id === f.testFirst!.escalationId);
    if (!e || e.status !== 'open' || f.testFirst.n === none) return 'none';
    const ask = testFirstAsk(none);
    e.title = ask.title;
    e.details = ask.details;
    roster.touch(team);
    await store.change((x) => (x.testFirst = { ...x.testFirst!, n: none }));
    return 'updated';
  }
  if (!none) return 'none';
  const e = roster.escalations.raiseFor(team, { workerId: 'office-testing', by: TEST_FIRST_BY }, testFirstAsk(none), `🧪 ${none} acceptance criteri${none === 1 ? 'on has' : 'a have'} no linked test: the office asked for the tests first (a prompt, nothing blocks)`);
  await store.change((x) => (x.testFirst = { escalationId: e.id, n: none, at: roster.deps.now() }));
  return 'raised';
}

/** Stage 4 passed and Stage 5 confirmed, from the setup panel's reading of the project. */
export function stageLookOf(v: { toolkit?: boolean; show: boolean; stages: { id: string }[]; verdicts?: { id: string; status: string }[]; decisions?: { stage: string; status: string }[] }): StageLook | undefined {
  if (!v.toolkit || !v.stages.length) return undefined;
  const stage5 = !!v.verdicts?.some((x) => x.id === '5' && (x.status === 'PASS' || x.status === 'WAIVED')) || !!v.decisions?.some((x) => x.stage === '5' && /^confirmed/i.test(x.status));
  return { stage4: !v.show, stage5 };
}
