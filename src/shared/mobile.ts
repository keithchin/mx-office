// The phone version (/m, client/mobile/, server/mobile/): its tabs, what each project's compact status
// line says, the actions a phone may take and which of them are risky. A risky one needs a second tap
// and a fresh sign-in: the password typed again, or a sign-in within the last REAUTH_MS. Pure: the
// page, the server and the tests read the same rules.

import type { Escalation } from './roster/escalation.js';
import type { RoleId } from './roster/roles.js';
import type { WorkerStatus } from './protocol.js';

export type MobileTab = 'needs' | 'projects' | 'dms' | 'activity' | 'status';
export const MOBILE_TABS: readonly { id: MobileTab; label: string; icon: string }[] = [
  { id: 'needs', label: 'Needs you', icon: '🔴' },
  { id: 'projects', label: 'Projects', icon: '#' },
  { id: 'dms', label: 'DMs', icon: '💬' },
  { id: 'activity', label: 'Activity', icon: '⚡' },
  { id: 'status', label: 'Status', icon: '📊' },
];
export const isMobileTab = (v: unknown): v is MobileTab => MOBILE_TABS.some((t) => t.id === v);

/** How long a re-typed password (or a fresh sign-in) lets risky actions through. */
export const REAUTH_MS = 10 * 60_000;

/** What the phone can do (POST /api/m/act). Pause and resume answer "not yet" until the office has them. */
export type MobileAction =
  | { do: 'escalation'; floor: string; escalation: string; verdict: 'approve' | 'reject' | 'reply'; text?: string }
  | { do: 'raise-cap'; floor: string; amount: number }
  | { do: 'hire'; floor: string; role: RoleId; task?: string }
  | { do: 'merge'; floor: string; number: number }
  | { do: 'pause' | 'resume'; floor: string };

export type MobileActionKind = MobileAction['do'];

const RISKY_TRIGGERS = new Set(['budget-overrun', 'security', 'data-loss']);

/** An escalation about the order PRs merge in (or a merge at all): approving it lets code land. */
export const isMergeOrder = (e: Pick<Escalation, 'title' | 'details' | 'options' | 'recommendation'>) => /\bmerg(e|es|ed|ing)\b/i.test([e.title, e.recommendation ?? '', ...(e.options ?? [])].join(' '));

/** Whether an action needs the second tap and a fresh sign-in. `esc`: the escalation it answers, when it's one. */
export function isRisky(a: Pick<MobileAction, 'do'> & { verdict?: string }, esc?: Pick<Escalation, 'title' | 'details' | 'options' | 'recommendation' | 'trigger'>): boolean {
  if (a.do === 'merge' || a.do === 'hire' || a.do === 'raise-cap') return true;
  if (a.do === 'escalation') return a.verdict === 'approve' && !!esc && (isMergeOrder(esc) || RISKY_TRIGGERS.has(esc.trigger ?? ''));
  return false;
}

/** A sign-in counts as fresh this long: a password typed at `reauthAt`, or the session issued at `issuedAt`. */
export function freshAuth(now: number, reauthAt: number | undefined, issuedAt: number | undefined): boolean {
  return [reauthAt, issuedAt].some((t) => t !== undefined && now - t >= 0 && now - t < REAUTH_MS);
}

// ---- The compact Status tab ------------------------------------------------------------------------------

export interface ProjectStatus {
  floor: string;
  name: string;
  working: number;
  asleep: number;
  asking: number;
  idle: number;
  /** The toolkit gate or stage it's at ("Stage 3 · Design ✋ waiting for sign-off"), when it has one. */
  stage?: string;
  /** The floor's daily team cap reached: why. */
  paused?: string;
  /** Today's team spend and the cap (once the Budget feature lands, its chip goes here). */
  spend?: { usd: number; cap?: number };
  /** Open escalations that aren't FYI. */
  escalations: number;
  /** Paused by the Pause project feature, when the office has it (a slot until then). */
  projectPaused?: boolean;
}

/** Worker statuses counted into a status line. */
export function countStatuses(statuses: readonly WorkerStatus[]): Pick<ProjectStatus, 'working' | 'asleep' | 'asking' | 'idle'> {
  const c = { working: 0, asleep: 0, asking: 0, idle: 0 };
  for (const s of statuses) {
    if (s === 'working' || s === 'starting') c.working++;
    else if (s === 'needs_input') c.asking++;
    else if (s === 'exited' || s === 'offline') c.asleep++;
    else c.idle++;
  }
  return c;
}

/** The stage a toolkit project is at, in a few words: the first one that isn't passed. */
export function stageLine(stages: readonly { id: string; title: string; status: string }[] | undefined): string | undefined {
  if (!stages?.length) return undefined;
  const at = stages.find((s) => s.status !== 'PASS' && s.status !== 'WAIVED');
  if (!at) return 'All stages passed';
  return `Stage ${at.id} · ${at.title}${at.status === 'MANUAL' ? ' ✋ waiting for your sign-off' : at.status === 'FAIL' ? ' ❌ gate failing' : ''}`;
}

/** The words of a status line: "2 working · 1 asking · 3 asleep". */
export function statusWords(p: Pick<ProjectStatus, 'working' | 'asleep' | 'asking' | 'idle'>): string {
  const bits = [p.asking ? `${p.asking} asking` : '', p.working ? `${p.working} working` : '', p.idle ? `${p.idle} idle` : '', p.asleep ? `${p.asleep} asleep` : ''].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'No agents';
}

/** Where a push notification's tap lands: /m on that item. */
export const mobileItemUrl = (floor: string, key: string) => `/m?floor=${encodeURIComponent(floor)}&item=${encodeURIComponent(key)}`;
