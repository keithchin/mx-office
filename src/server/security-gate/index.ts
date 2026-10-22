// The security baseline and the Mendix check gate (E2), the office's side ([Security baseline](../../../
// docs/site/using-the-office/security-baseline.md)). What it does:
//   * reads the app's security at main's head from the commit's units (read.ts), once per commit, and keeps
//     each revision's read in the project's record (store.ts);
//   * runs Mendix's own `mx check` at a commit when someone asks (Run mx check) or when a gated sign-off or
//     acceptance finds none at its commit (check.ts), one at a time, off the event loop, kept per commit;
//   * judges the project's policy against both (shared/security.ts judgeGate) where the office controls the
//     flow: the Project Manager's sign-off of Stage 4 or later (http/routes/signoff.ts) and ✅ Accept
//     (acceptance/index.ts) are refused, with what's missing, unless the policy is advisory;
//   * says what's missing in Needs you once the build has started (securityItemsOf, through the asks look);
//   * hands the policy to the Playbooks (playbook.ts) and keeps it per project, changed by an admin with a
//     reason when it isn't the default (audited).

import { createHash } from 'node:crypto';
import path from 'node:path';
import { audit, office } from '../audit/index.js';
import type { AuditActor } from '../../shared/audit.js';
import type { Floor } from '../floor.js';
import { modelOf } from '../model/index.js';
import type { Ctx } from '../office/context.js';
import { onForgetFloor } from '../office/forget.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { mainOf, type MainRef } from '../testing/repo.js';
import { wizardIfMade } from '../wizard/index.js';
import { ROLES } from '../../shared/roster/roles.js';
import { deriveStage } from '../../shared/stage-derive.js';
import type { AskItem } from '../../shared/asks.js';
import { DEFAULT_POLICY, gatePointOfStage, gateRefusal, judgeGate, policyProblem, type GatePoint, type GateResult, type MxCheckResult, type SecurityPolicy, type SecurityState, type SecurityView } from '../../shared/security.js';
import { machineCheckDeps, runMxCheck, type CheckDeps } from './check.js';
import { useSecurityPolicy } from './playbook.js';
import { SecurityReader } from './read.js';
import { SecurityStore } from './store.js';

type FloorRef = Pick<Floor, 'id' | 'dir'>;

export interface GateDeps {
  dataDir: string;
  store: SecurityStore;
  reader: Pick<SecurityReader, 'read'>;
  check: CheckDeps;
  main(dir: string): Promise<MainRef | undefined>;
  now(): number;
}

/** What reading a commit gave: the state, or why there's none (no app at all, or it couldn't be read). */
export interface StateAt {
  state?: SecurityState;
  why?: string;
  noApp?: boolean;
}

const NO_MPR = /no Mendix project \(\.mpr\)/i;

export class SecurityGate {
  /** mx checks running: `${floor}|${commit}` → its promise. */
  private running = new Map<string, { since: number; done: Promise<MxCheckResult> }>();
  constructor(readonly d: GateDeps) {}

  /** The state at `sha`: the record's when it was read there before, else read now (and kept). */
  async stateAt(floor: FloorRef, sha: string): Promise<StateAt> {
    const rec = await this.d.store.get(floor.id);
    const had = rec.reads.find((r) => r.commit === sha);
    if (had) return { state: had };
    try {
      const s = await this.d.reader.read(floor.dir, sha);
      if (!s) return { why: "The office can't read the model's units here (it needs node:sqlite); Run mx check reads the security with mxcli instead" };
      await this.d.store.addRead(floor.id, s).catch(() => undefined);
      return { state: s };
    } catch (err) {
      const msg = (err as Error).message;
      if (NO_MPR.test(msg)) return { noApp: true };
      return { why: `Couldn't read the app's security: ${msg}` };
    }
  }

  /** The mx check of `sha`, when one ran there. */
  async checkAt(floorId: string, sha: string): Promise<MxCheckResult | undefined> {
    return (await this.d.store.get(floorId)).checks.find((c) => c.commit === sha);
  }

  runningOn(floorId: string): { commit: string; since: number } | undefined {
    for (const [k, v] of this.running) if (k.startsWith(`${floorId}|`)) return { commit: k.slice(floorId.length + 1), since: v.since };
    return undefined;
  }

  /** Starts an mx check of `sha` (or joins the one running there); resolves with its result, kept in the record. */
  startCheck(floor: FloorRef, sha: string, by: string, actor?: AuditActor): Promise<MxCheckResult> {
    const key = `${floor.id}|${sha}`;
    const had = this.running.get(key);
    if (had) return had.done;
    const done = (async () => {
      const read = await this.stateAt(floor, sha).catch((): StateAt => ({}));
      const out = await runMxCheck(this.d.check, floor, sha, by, !read.state && !read.noApp);
      await this.d.store.addCheck(floor.id, out.result).catch(() => undefined);
      if (out.state) await this.d.store.addRead(floor.id, out.state).catch(() => undefined);
      const r = out.result;
      audit.record({ floor: floor.id, actor: actor ?? office(), action: 'security.mxcheck', target: { kind: 'commit', id: r.commit, label: `mx check at ${r.commit.slice(0, 7)}` }, summary: r.status === 'pass' ? `mx check passed at ${r.commit.slice(0, 7)} (0 errors)` : r.status === 'fail' ? `mx check found ${r.errors} error(s) at ${r.commit.slice(0, 7)}` : `mx check didn't finish at ${r.commit.slice(0, 7)}: ${r.why ?? ''}`, details: { status: r.status, errors: r.errors ?? null, codes: (r.codes ?? []).slice(0, 5), ms: r.ms }, severity: r.status === 'pass' ? 'info' : 'notice' });
      return r;
    })().finally(() => this.running.delete(key));
    this.running.set(key, { since: this.d.now(), done });
    return done;
  }

  /** The gate at `commit` (main's head when not said). */
  async gate(floor: FloorRef, point: GatePoint, commit?: string): Promise<GateResult & { noApp?: boolean }> {
    const sha = commit ?? (await this.d.main(floor.dir))?.sha;
    const policy = await this.d.store.policy(floor.id);
    if (!sha) return judgeGate(policy, point, undefined, undefined, undefined);
    const at = await this.stateAt(floor, sha);
    if (at.noApp) return { point, commit: sha, meets: true, missing: [], flags: ['No Mendix app (.mpr) at this commit: nothing to check'], enforced: policy.enforce, noApp: true };
    return judgeGate(policy, point, sha, at.state, await this.checkAt(floor.id, sha));
  }

  /**
   * Why a gated step at `commit` is refused, or undefined when it may go ahead (met, advisory, or nothing to
   * check). A release step with no mx check at that commit starts one, so trying again later can pass.
   */
  async refusal(floor: FloorRef, point: GatePoint, what: string, commit?: string): Promise<string | undefined> {
    const g = await this.gate(floor, point, commit);
    if (g.meets || !g.enforced) return undefined;
    let extra = '';
    if (point === 'release' && g.commit && g.missing.some((m) => m.startsWith('No mx check'))) {
      void this.startCheck(floor, g.commit, 'Mx Office (gate)').catch(() => undefined);
      extra = ` The office has started an mx check at ${g.commit.slice(0, 7)} (it takes a few minutes): try again when it has finished.`;
    } else if (point === 'release' && g.commit && this.runningOn(floor.id)?.commit === g.commit) extra = ` An mx check at ${g.commit.slice(0, 7)} is running now: try again when it has finished.`;
    return `${gateRefusal(g, what)}${extra}`;
  }

  /** What the Security card shows. */
  async view(floor: FloorRef, admin: boolean): Promise<SecurityView> {
    const [rec, main] = await Promise.all([this.d.store.get(floor.id), this.d.main(floor.dir)]);
    const policy = rec.policy ?? DEFAULT_POLICY;
    const at = main ? await this.stateAt(floor, main.sha) : {};
    const check = rec.checks.length ? rec.checks.reduce((a, b) => (b.at > a.at ? b : a)) : undefined;
    const atMain = main ? rec.checks.find((c) => c.commit === main.sha) : undefined;
    const gates = {
      build: at.noApp && main ? { point: 'build' as const, commit: main.sha, meets: true, missing: [], flags: [], enforced: policy.enforce } : judgeGate(policy, 'build', main?.sha, at.state, atMain),
      release: at.noApp && main ? { point: 'release' as const, commit: main.sha, meets: true, missing: [], flags: [], enforced: policy.enforce } : judgeGate(policy, 'release', main?.sha, at.state, atMain),
    };
    const running = this.runningOn(floor.id);
    return {
      floor: floor.id,
      admin,
      policy,
      ...(main ? { main: { branch: main.branch, commit: main.sha } } : {}),
      ...(at.noApp ? { noApp: true } : {}),
      ...(at.state ? { state: at.state } : {}),
      ...(at.why ? { stateWhy: at.why } : {}),
      ...(check ? { check } : {}),
      ...(running ? { running } : {}),
      gates,
    };
  }

  /** Sets the project's policy (an admin's act, audited). An error, or undefined when saved. */
  async setPolicy(floor: FloorRef, p: SecurityPolicy, actor: AuditActor): Promise<string | undefined> {
    const bad = policyProblem(p);
    if (bad) return bad;
    const before = await this.d.store.policy(floor.id);
    const next: SecurityPolicy = { ...p, by: actor.name, at: this.d.now() };
    await this.d.store.update(floor.id, (r) => ({ ...r, policy: next }));
    audit.record({ floor: floor.id, actor, action: 'security.policy', target: { kind: 'settings', id: floor.id, label: 'Security policy' }, summary: `Set the security policy: ${p.level === 'production' ? 'Production before the build' : 'Prototype only'}, strict mode ${p.strict}, ${p.enforce ? 'enforced' : 'advisory'}${p.reason ? ` (${p.reason})` : ''}`, details: { before: { level: before.level, strict: before.strict, enforce: before.enforce }, after: { level: p.level, strict: p.strict, enforce: p.enforce }, reason: p.reason ?? null }, severity: p.enforce && p.level === 'production' ? 'notice' : 'warning' });
    return undefined;
  }
}

const offices = new WeakMap<object, SecurityGate>();

/** The office's one gate. */
export function securityOf(ctx: Ctx): SecurityGate {
  let g = offices.get(ctx.cfg);
  if (!g) {
    const dataDir = ctx.cfg.dataDir;
    const model = modelOf(ctx);
    g = new SecurityGate({ dataDir, store: new SecurityStore(path.join(dataDir, 'security')), reader: new SecurityReader((dir, sha) => model.units.commit(dir, sha)), check: machineCheckDeps(dataDir), main: mainOf, now: Date.now });
    offices.set(ctx.cfg, g);
  }
  return g;
}

/** A gate that couldn't be checked refuses (it fails closed): the policy can be made advisory, with a reason. */
const couldntCheck = (what: string) => (err: Error) => `${what} needs the project's security baseline, and the office couldn't check it (${err.message}). Try again, or make the project's security policy advisory on App Insights › Security, with a reason.`;

/** The refusal of signing off `stage` on `floor`, or undefined (the sign-off's guard, signoff/index.ts). */
export async function signoffRefusal(ctx: Ctx, floor: Floor, stage: string): Promise<string | undefined> {
  const point = gatePointOfStage(stage);
  if (!point) return undefined;
  const what = `Signing off Stage ${stage.toUpperCase()}`;
  return securityOf(ctx).refusal(floor, point, what).catch(couldntCheck(what));
}

/** The refusal of accepting the delivery at `commit` on `floor`, or undefined (acceptance/index.ts). */
export function acceptanceRefusal(ctx: Ctx, floor: Floor, commit: string): Promise<string | undefined> {
  const what = 'Accepting this delivery';
  return securityOf(ctx).refusal(floor, 'release', what, commit).catch(couldntCheck(what));
}

/** Stages at which the build has started: the Needs-you item applies from here. */
const BUILDING = new Set(['5', '6', '7', 'all']);

/** The Needs-you card (through the asks look, asks/main.ts): the baseline not met on main once the build has started. */
export async function securityItemsOf(ctx: Ctx, floorId: string, main: MainRef | undefined, lead?: string): Promise<AskItem[]> {
  const floor = ctx.floors.get(floorId);
  if (!floor || !main) return [];
  const setup = await wizardIfMade(ctx)
    ?.setup(floor)
    .catch(() => undefined);
  const stage = setup?.verdicts?.length ? deriveStage(setup.verdicts, setup.decisions) : undefined;
  if (!stage || !BUILDING.has(stage.id)) return [];
  const gate = securityOf(ctx);
  const it = securityItem(stage.id, await gate.gate(floor, 'build', main.sha), await gate.checkAt(floor.id, main.sha), lead);
  return it ? [it] : [];
}

/**
 * The card at stage `stage` (an id from deriveStage), from the build gate at main and main's mx check: what's
 * missing, a failing check too, or nothing once the build hasn't started or nothing is missing.
 */
export function securityItem(stage: string, g: GateResult, check: MxCheckResult | undefined, lead?: string): AskItem | undefined {
  if (!BUILDING.has(stage) || !g.commit) return undefined;
  const lines = [...g.missing];
  if (check?.commit === g.commit && check.status === 'fail') lines.push(`mx check at ${g.commit.slice(0, 7)} found ${check.errors} error${check.errors === 1 ? '' : 's'}${check.codes?.length ? ` (${check.codes.slice(0, 3).map((x) => x.code).join(', ')})` : ''}`);
  if (!lines.length) return undefined;
  // Stable while the same things are missing (a new commit with the same gaps stays hidden after Hide).
  const id = `security:${createHash('sha1').update(lines.map((l) => l.replace(/\b[0-9a-f]{7}\b/g, '')).join('|')).digest('hex').slice(0, 12)}`;
  return { id, kind: 'security', text: `Security baseline not met on main (${stage === 'all' ? 'all gates passed' : `Stage ${stage}`}): ${lines[0]}${lines.length > 1 ? ` and ${lines.length - 1} more` : ''}`, level: g.enforced ? 'warn' : 'info', lines, acts: [{ act: 'ask-lead', label: lead ? `Ask ${lead} to fix` : 'Ask the lead to fix' }, { act: 'seen', label: 'Hide' }] };
}

/** Rewrites the hired team's Playbooks (the policy is in them). */
function rewritePlaybooks(ctx: Ctx, floor: Floor) {
  try {
    const roster = rosterOf(ctx);
    for (const r of ROLES) roster.members.rewrite(teamFloor(ctx, floor), r.id);
  } catch (err) {
    console.warn(`agent-office: security: couldn't rewrite the Playbooks: ${(err as Error).message}`);
  }
}

/** An admin sets a project's policy; the Playbooks follow. */
export async function setProjectPolicy(ctx: Ctx, floor: Floor, p: SecurityPolicy, actor: AuditActor): Promise<string | undefined> {
  const err = await securityOf(ctx).setPolicy(floor, p, actor);
  if (!err) {
    policies.set(floor.id, (await securityOf(ctx).d.store.policy(floor.id)));
    rewritePlaybooks(ctx, floor);
  }
  return err;
}

/** The policies known so far, for the Playbooks' synchronous read (a default policy needs no entry). */
const policies = new Map<string, SecurityPolicy>();

/** At start: each project's policy loaded for the Playbooks, and the record let go of with a deleted project. */
export function startSecurityGate(ctx: Ctx): () => void {
  const gate = securityOf(ctx);
  for (const f of ctx.floors.values()) void gate.d.store.policy(f.id).then((p) => void policies.set(f.id, p), () => undefined);
  useSecurityPolicy((floorId) => policies.get(floorId) ?? DEFAULT_POLICY);
  const off = onForgetFloor((f) => {
    policies.delete(f.id);
    gate.d.store.forget(f.id);
  });
  return () => {
    off();
    useSecurityPolicy(undefined);
  };
}
