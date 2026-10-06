// What the phone version does (POST /api/m/act): answer an escalation, raise the floor's daily cap, hire a
// role, open a PR to merge it on GitHub, and pause or resume a project (server/project-run/). Each
// goes through the same roster calls the Team tab makes; risky ones only with a fresh sign-in
// (reauth.ts), checked here on the server whatever the page says; every one in the audit log as phone.*.

import { capAt } from '../../shared/roster/autonomy.js';
import { isEscalationVerdict } from '../../shared/roster/escalation.js';
import { isRoleId } from '../../shared/roster/roles.js';
import { isRisky, type MobileAction } from '../../shared/mobile.js';
import type { Ctx } from '../office/context.js';
import { audit, human } from '../audit/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { projectRunsOf } from '../project-run/adapter.js';
import type { ProjectRuns } from '../project-run/index.js';
import type { ResumeAction, ResumeChoice, RunProgress } from '../../shared/project-run.js';

export type ActResult = { ok: true; summary: string; url?: string; run?: RunProgress } | { ok: false; status: number; error: string; reauth?: boolean };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN);
const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** What the page sent, checked. */
export function actionOf(b: Record<string, unknown>): MobileAction | string {
  const floor = txt(b.floor, 120);
  if (!floor) return 'Which project?';
  switch (b.do) {
    case 'escalation':
      if (b.verdict !== 'approve' && b.verdict !== 'reject' && b.verdict !== 'reply') return 'approve, reject or reply';
      return { do: 'escalation', floor, escalation: txt(b.escalation, 120), verdict: b.verdict, text: txt(b.text, 4000) };
    case 'raise-cap': {
      const amount = num(b.amount);
      return amount > 0 && amount <= 100_000 ? { do: 'raise-cap', floor, amount: Math.round(amount * 100) / 100 } : 'A cap in dollars, more than 0';
    }
    case 'hire':
      return isRoleId(b.role) ? { do: 'hire', floor, role: b.role, ...(b.task ? { task: txt(b.task, 4000) } : {}) } : 'Which role?';
    case 'merge': {
      const n = num(b.number);
      return Number.isInteger(n) && n > 0 ? { do: 'merge', floor, number: n } : 'Which PR?';
    }
    case 'pause':
      return { do: 'pause', floor };
    case 'resume':
      return { do: 'resume', floor, choice: choiceOf(b.choice) };
    default:
      return 'Unknown action';
  }
}

const RESUME_ACTIONS = new Set<ResumeAction>(['wake', 'rehire', 'send-home', 'skip']);

/** A resume's choice as the page sent it: those with work unless it says everyone, or picks. */
export function choiceOf(v: unknown): ResumeChoice {
  const c = (v && typeof v === 'object' ? v : {}) as { mode?: unknown; picks?: unknown };
  const mode = c.mode === 'all' || c.mode === 'pick' ? c.mode : 'work';
  const picks: Record<string, ResumeAction> = {};
  for (const [k, a] of Object.entries(c.picks && typeof c.picks === 'object' ? c.picks : {})) if (k.length < 80 && RESUME_ACTIONS.has(a as ResumeAction)) picks[k] = a as ResumeAction;
  return mode === 'pick' ? { mode, picks } : { mode };
}

/** What runAction reaches for besides the floor (the tests hand in their own). */
export interface ActDeps {
  runs(): Pick<ProjectRuns, 'pause' | 'resume'>;
}

export interface Actor {
  name: string;
  id?: string;
  admin: boolean;
  /** Signed in (or the password typed again) within the last 10 minutes. */
  fresh: boolean;
}

/** Runs one action; never throws. */
export async function runAction(ctx: Ctx, a: MobileAction, who: Actor, deps: ActDeps = { runs: () => projectRunsOf(ctx) }): Promise<ActResult> {
  const floor = ctx.floors.get(a.floor);
  if (!floor) return { ok: false, status: 404, error: 'No such project' };
  if (!who.admin) return { ok: false, status: 403, error: 'Only the Project Manager (an admin) can do that' };
  // The team only when the action needs it (opening a PR doesn't).
  const roster = () => rosterOf(ctx);
  const team = () => teamFloor(ctx, floor);
  const esc = a.do === 'escalation' ? roster().escalations.view(team()).find((e) => e.id === a.escalation) : undefined;
  if (a.do === 'escalation' && !esc) return { ok: false, status: 404, error: 'That escalation is gone' };
  if (isRisky(a.do === 'escalation' ? { do: a.do, verdict: a.verdict } : a, esc) && !who.fresh) return { ok: false, status: 401, error: 'Confirm with your password first', reauth: true };
  const record = (summary: string, details: Record<string, unknown> = {}) =>
    audit.record({ floor: floor.id, actor: human(who.name, who.id), action: `phone.${a.do}`, target: { kind: 'phone', label: 'Phone version' }, summary: `${summary} (from the phone)`, details: { ...details, risky: isRisky(a, esc) }, severity: isRisky(a, esc) ? 'notice' : 'info' });
  try {
    switch (a.do) {
      case 'escalation': {
        if (!isEscalationVerdict(a.verdict)) return { ok: false, status: 400, error: 'approve, reject or reply' };
        if ((a.verdict === 'reject' || a.verdict === 'reply') && !a.text?.trim()) return { ok: false, status: 400, error: a.verdict === 'reject' ? 'Say why it is rejected: the agent is told' : 'Write a reply' };
        const err = roster().escalations.resolve(team(), a.escalation, a.verdict, a.text ?? '', who.name);
        if (err) return { ok: false, status: 400, error: err };
        const summary = `${a.verdict === 'approve' ? 'Approved' : a.verdict === 'reject' ? 'Rejected' : 'Answered'} ${esc!.by}'s escalation: ${esc!.title}`;
        record(summary, { escalation: a.escalation, verdict: a.verdict });
        return { ok: true, summary };
      }
      case 'raise-cap': {
        const d = roster().data(floor.id);
        const level = d.settings.autonomy;
        const was = capAt(d.settings.costCaps, level);
        if (was !== undefined && a.amount <= was) return { ok: false, status: 400, error: `The cap is $${was.toFixed(2)} already: raise it above that` };
        const err = roster().members.settings(team(), { costCaps: { ...d.settings.costCaps, [level]: a.amount } }, who.name, who.id);
        if (err) return { ok: false, status: 400, error: err };
        const summary = `Raised ${floor.def.name}'s daily team cap to $${a.amount.toFixed(2)}${was !== undefined ? ` (was $${was.toFixed(2)})` : ''}`;
        record(summary, { before: { cap: was ?? null }, after: { cap: a.amount }, level });
        return { ok: true, summary };
      }
      case 'hire': {
        const err = await roster().members.hire(team(), a.role, who.name, who.id, a.task);
        if (err) return { ok: false, status: 400, error: err };
        const summary = `Hired the ${a.role} role on ${floor.def.name}`;
        record(summary, { role: a.role });
        return { ok: true, summary };
      }
      case 'merge': {
        const pr = floor.github.pulls.items.find((p) => p.number === a.number);
        if (!pr) return { ok: false, status: 404, error: `PR #${a.number} isn't open on ${floor.def.name}` };
        const summary = `Opened PR #${pr.number} on GitHub to merge it: ${pr.title}`;
        record(summary, { pr: pr.number });
        return { ok: true, summary, url: pr.url };
      }
      case 'pause': {
        // Every agent finishes its turn, writes a handoff and sleeps; the office's own prompts hold (project-run/flows.ts).
        const run = deps.runs().pause(floor.id, who.name, who.id);
        if (typeof run === 'string') return { ok: false, status: 400, error: run };
        const summary = `Pausing ${floor.def.name}: ${run.agents.length} agent${run.agents.length === 1 ? '' : 's'} finish their turn and go to sleep`;
        record(summary, { runId: run.runId });
        return { ok: true, summary, run };
      }
      case 'resume': {
        const choice = a.choice ?? { mode: 'work' };
        const run = await deps.runs().resume(floor.id, choice, who.name, who.id);
        if (typeof run === 'string') return { ok: false, status: 400, error: run };
        const summary = `Resuming ${floor.def.name}: ${run.agents.length ? `waking ${run.agents.length} agent${run.agents.length === 1 ? '' : 's'}` : 'nobody to wake'}`;
        record(summary, { runId: run.runId, mode: choice.mode });
        return { ok: true, summary, run };
      }
    }
  } catch (err) {
    return { ok: false, status: 500, error: (err as Error).message };
  }
}
