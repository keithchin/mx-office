// The check before something the Project Manager starts reaches agents in the middle of a turn (a
// standup, a team question like "What's blocking?"): who is ready and who is working, on what and for
// how long, and for each busy one what to do: interrupt now, after their current turn (the default: the
// office holds it and types it once that turn is over, roster/deliver.ts), or, for a standup, skip them
// and read their journal. Pure, so the page (client/ui/roster/interrupt-check.ts) and the server agree
// and the tests can walk it.

import type { WorkerInfo } from '../protocol.js';
import { isRoleId, type RoleId } from './roles.js';
import type { MemberView } from './types.js';

export type InterruptChoice = 'interrupt' | 'after' | 'journal';

export const INTERRUPT_CHOICES: readonly InterruptChoice[] = ['interrupt', 'after', 'journal'];

/** The choice's words on the check's buttons. */
export const CHOICE_LABEL: Record<InterruptChoice, string> = { interrupt: 'Interrupt now', after: 'After their current turn', journal: 'Skip: use their journal' };

export const isInterruptChoice = (v: unknown): v is InterruptChoice => typeof v === 'string' && (INTERRUPT_CHOICES as readonly string[]).includes(v);

/** What the check is for: a standup may read a busy member's journal instead; a question can't. */
export type CheckKind = 'standup' | 'ask';

/** The choices a busy member has for this kind of check. */
export const choicesFor = (kind: CheckKind): InterruptChoice[] => (kind === 'standup' ? ['interrupt', 'after', 'journal'] : ['interrupt', 'after']);

/** Choices as sent: one per role, only ones this kind allows. */
export function cleanChoices(raw: unknown, kind: CheckKind): Partial<Record<RoleId, InterruptChoice>> {
  const out: Partial<Record<RoleId, InterruptChoice>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [role, c] of Object.entries(raw as Record<string, unknown>)) if (isRoleId(role) && isInterruptChoice(c) && choicesFor(kind).includes(c)) out[role] = c;
  return out;
}

export interface TeamRow {
  role: RoleId;
  name: string;
  icon: string;
  /** ready: between turns, a message goes in now; working: mid-turn; asking: a question open in its terminal (it waits for that either way); away: asleep, benched or not hired. */
  state: 'ready' | 'working' | 'asking' | 'away';
  /** What it's on, while it's working. */
  what?: string;
  /** Since when it has been working (ms). */
  since?: number;
}

/** Each member as the check shows it, in the team's order; `roles` keeps only those it would reach. */
export function teamRows(members: readonly MemberView[], worker: (id: string) => WorkerInfo | undefined, roles?: readonly RoleId[]): TeamRow[] {
  return members
    .filter((m) => !roles || roles.includes(m.role))
    .map((m) => {
      const w = m.workerId ? worker(m.workerId) : undefined;
      const state: TeamRow['state'] = m.status === 'working' || m.status === 'benching' ? 'working' : m.status === 'needs-you' ? 'asking' : m.status === 'idle' ? 'ready' : 'away';
      const what = state === 'working' ? (m.activity ?? w?.task?.name ?? m.task) : undefined;
      return { role: m.role, name: m.name, icon: m.icon, state, ...(what ? { what } : {}), ...(state === 'working' && w?.workingSince ? { since: w.workingSince } : {}) };
    });
}

/** Whether a row needs a choice: it's mid-turn or asking. */
export const isBusyRow = (r: TeamRow) => r.state === 'working' || r.state === 'asking';

/** The choices to send: each busy row's pick, else the "same for all" one, else after their turn. */
export function resolveChoices(rows: readonly TeamRow[], picked: Partial<Record<RoleId, InterruptChoice>>, same?: InterruptChoice): Partial<Record<RoleId, InterruptChoice>> {
  const out: Partial<Record<RoleId, InterruptChoice>> = {};
  for (const r of rows.filter(isBusyRow)) out[r.role] = same ?? picked[r.role] ?? 'after';
  return out;
}

/** "working 12 min", from a start time. */
export function workingFor(since: number | undefined, now: number): string {
  if (since === undefined) return 'working';
  const min = Math.max(0, Math.round((now - since) / 60_000));
  return min < 1 ? 'working, just started' : min < 60 ? `working ${min} min` : `working ${Math.floor(min / 60)} h ${min % 60} min`;
}
