// The phone version (/m, client/mobile/, server/mobile/): its tabs, what each project's compact status
// line says, the actions a phone may take and which of them are risky. A risky one needs a second tap
// and a fresh sign-in: the password typed again, or a sign-in within the last REAUTH_MS. Pure: the
// page, the server and the tests read the same rules.

import type { Escalation } from './roster/escalation.js';
import type { RoleId } from './roster/roles.js';
import type { WorkerStatus } from './protocol.js';
import type { PauseInfo, ResumeChoice, RestartPhase, RunProgress } from './project-run.js';

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

/** What the phone can do (POST /api/m/act). Pause and resume go through ⏸ / ▶ project (server/project-run/). */
export type MobileAction =
  | { do: 'escalation'; floor: string; escalation: string; verdict: 'approve' | 'reject' | 'reply'; text?: string }
  | { do: 'raise-cap'; floor: string; amount: number }
  | { do: 'hire'; floor: string; role: RoleId; task?: string }
  | { do: 'merge'; floor: string; number: number }
  | { do: 'pause'; floor: string }
  /** Resume: "those with work" unless the choice says otherwise (shared/project-run.ts). */
  | { do: 'resume'; floor: string; choice?: ResumeChoice };

export type MobileActionKind = MobileAction['do'];

const RISKY_TRIGGERS = new Set(['budget-overrun', 'security', 'data-loss']);

/** An escalation about the order PRs merge in (or a merge at all): approving it lets code land. */
export const isMergeOrder = (e: Pick<Escalation, 'title' | 'details' | 'options' | 'recommendation'>) => /\bmerg(e|es|ed|ing)\b/i.test([e.title, e.recommendation ?? '', ...(e.options ?? [])].join(' '));

/** Whether an action needs the second tap and a fresh sign-in. `esc`: the escalation it answers, when it's one. */
export function isRisky(a: Pick<MobileAction, 'do'> & { verdict?: string }, esc?: Pick<Escalation, 'title' | 'details' | 'options' | 'recommendation' | 'trigger'>): boolean {
  // Pausing stops a whole floor; resuming wakes agents, and their turns cost money.
  if (a.do === 'merge' || a.do === 'hire' || a.do === 'raise-cap' || a.do === 'pause' || a.do === 'resume') return true;
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
  /** Paused with ⏸ Pause project: by whom, when, who's left waiting on you. */
  pause?: PauseInfo;
  /** Its latest resume or pause run, while one is going (or just finished). */
  run?: RunProgress;
}

/** 🔁 Restart safely, read-only on the phone: while one is going. */
export interface RestartLine {
  phase: RestartPhase;
  by?: string;
  waitingOn: string[];
}

/** GET /api/m/status. */
export interface StatusView {
  projects: ProjectStatus[];
  restart?: RestartLine;
}

/** A restart is worth showing while it's under way (not idle, done or called off). */
export const restartShown = (phase: RestartPhase) => phase !== 'idle' && phase !== 'cancelled';

/** "Restarting safely: waiting on 2", for the Status tab. */
export function restartWords(r: RestartLine): string {
  switch (r.phase) {
    case 'pausing':
      return `🔁 Restarting safely: pausing every project${r.by ? ` (${r.by})` : ''}`;
    case 'waiting':
      return `🔁 Restarting safely: waiting on ${r.waitingOn.length}${r.waitingOn.length ? ` (${r.waitingOn.slice(0, 3).join(', ')}${r.waitingOn.length > 3 ? '…' : ''})` : ''}`;
    case 'timed-out':
      return `🔁 Restart safely timed out waiting on ${r.waitingOn.length}: decide on a computer`;
    case 'building':
      return '🔁 Restarting safely: building the new version';
    case 'exiting':
      return '🔁 Restarting now: back in a minute';
    case 'failed':
      return '🔁 Restart safely failed: see Settings on a computer';
    default:
      return `🔁 Restart safely: ${r.phase}`;
  }
}

/** A run's progress in a line: "Waking 1 of 3 · Ada starting". */
export function runWords(r: RunProgress): string {
  const done = r.agents.filter((a) => a.status === 'woken' || a.status === 'asleep' || a.status === 'sent-home' || a.status === 'skipped' || a.status === 'waiting-on-you').length;
  const now = r.agents.find((a) => a.status === 'starting' || a.status === 'finishing' || a.status === 'handoff');
  const failed = r.agents.filter((a) => a.status === 'failed').length;
  const verb = r.kind === 'pause' ? 'Pausing' : 'Waking';
  if (r.finishedAt || (r.status !== 'running' && r.status !== 'waiting')) return `${r.kind === 'pause' ? '⏸ Paused' : '▶ Resumed'}: ${done} of ${r.agents.length}${failed ? ` · ${failed} failed` : ''}`;
  return `${verb} ${done} of ${r.agents.length}${now ? ` · ${now.name} ${now.status === 'starting' ? 'starting' : now.status === 'handoff' ? 'writing its handoff' : 'finishing its turn'}` : ''}${failed ? ` · ${failed} failed` : ''}`;
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
