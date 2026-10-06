// What an agent woken by ▶ Resume project is told, instead of the generic "carry on": what happened
// while it slept (kept short), what it's still waiting on (don't ask again), the state of its branch,
// what it's owed (answers, notes) in the same message, and at a careful autonomy a plan before acting.
// And what ⏸ Pause project asks of an agent before it sleeps. Pure.

import { journalPath, ROLE_BY_ID, type RoleId } from '../../shared/roster/roles.js';
import type { WorkReason } from '../../shared/project-run.js';

/** The "while you slept" part is cut to this many characters. */
export const SLEPT_MAX = 1500;

export interface BriefFacts {
  name: string;
  role?: RoleId;
  autonomy: number;
  by: string;
  /** Commit subjects that landed on the default branch since its last turn. */
  merges: string[];
  base?: string;
  /** Escalations that involve it, answered or raised while it slept ("“Title”: approved — text"). */
  escalations: string[];
  /** A few lines of the floor's chatter that involve it. */
  chatter: string[];
  /** Its open escalations: still with the Project Manager. */
  open: string[];
  behind: number;
  dirty: number;
  cutOff: boolean;
  /** Answers it's owed, as lines ("- “Title”: Approved — …"). */
  owed: string[];
  /** Notes queued for it (a Lead's), as lines. */
  notes: string[];
  /** The Coordinator only: what the outbox held for it (relays.ts), in the same message. */
  relays?: string;
  reasons: WorkReason[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The "while you slept" lines, cut to SLEPT_MAX characters in all (whole lines, then a "…"). */
export function sleptPart(f: Pick<BriefFacts, 'merges' | 'base' | 'escalations' | 'chatter'>): string {
  const lines = [
    ...f.merges.map((m) => `- Merged on ${f.base ?? 'the default branch'}: ${clip(m, 160)}`),
    ...f.escalations.map((e) => `- Escalation: ${clip(e, 240)}`),
    ...f.chatter.map((c) => `- ${clip(c, 200)}`),
  ];
  const out: string[] = [];
  let n = 0;
  for (const l of lines) {
    if (n + l.length + 1 > SLEPT_MAX - 2) {
      out.push('- …');
      break;
    }
    out.push(l);
    n += l.length + 1;
  }
  return out.join('\n');
}

/** The resume brief for one agent. */
export function resumeBrief(f: BriefFacts): string {
  const parts: string[] = [`${f.by} resumed the project (▶ Resume project) and woke you${f.cutOff ? ': you were cut off mid-turn, so pick up where you left off' : ''}.`];
  const slept = sleptPart(f);
  if (slept) parts.push(`While you were asleep:\n${slept}`);
  if (f.open.length) parts.push(`Still open with the Project Manager — don't raise these again, their answer comes to you as a prompt:\n${f.open.slice(0, 8).map((t) => `- “${clip(t, 160)}”`).join('\n')}`);
  const branch: string[] = [];
  if (f.behind > 0) branch.push(`Your branch is ${f.behind} commit${f.behind === 1 ? '' : 's'} behind ${f.base ?? 'the default branch'}: rebase first and re-run the checks.`);
  if (f.dirty > 0) branch.push(`You have ${f.dirty} uncommitted change${f.dirty === 1 ? '' : 's'}: look at them before anything else; commit or drop them on purpose.`);
  if (branch.length) parts.push(branch.join(' '));
  if (f.owed.length) parts.push(`Answers to your escalations:\n${f.owed.join('\n')}`);
  if (f.notes.length) parts.push(`Notes for you:\n${f.notes.join('\n')}`);
  if (f.relays) parts.push(`Relayed while you were asleep:\n\n${f.relays}`);
  const why = f.reasons.filter((r) => r.kind !== 'owed' && r.kind !== 'outbox' && r.kind !== 'cut-off');
  if (why.length) parts.push(`Waiting for you: ${why.map((r) => r.text).join('; ')}.`);
  parts.push(f.autonomy <= 2 ? 'Before acting, post a 2-line plan (what you will do next, and why), then carry on.' : 'Carry on with your work.');
  return parts.join('\n\n');
}

/** What ⏸ Pause project asks of an agent between turns: a handoff note, then stop. */
export function handoffPrompt(by: string, role: RoleId | undefined, stamp: string): string {
  const where = role ? `Append a handoff entry to \`${journalPath(ROLE_BY_ID.get(role)!.team)}\`, headed \`## ${stamp} — Handoff\`` : 'Write a short handoff note as your reply';
  return [
    `${by} is pausing the project (⏸ Pause project). Your session is kept, and you'll be woken with it later. Do only this:`,
    `1. ${where}: what you were doing, the next step, and any open questions. If you are waiting on the Project Manager for something that isn't in an open escalation, end it with \`AWAITING-PM: <one line>\`.`,
    '2. Commit what you have (unfinished work too) so nothing is lost; push if you normally would.',
    "Don't start anything new. When it's written, reply `handoff written` and stop.",
  ].join('\n');
}
