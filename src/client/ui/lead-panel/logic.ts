// What the team-lead panel (./index.ts) decides, worked out without the page so the tests can check every
// case: who leads the conversation (whoever covers Management on this team's shape), the line under its
// name, what it keeps for you between visits, when its terminal may be attached, what a send while the
// lead is mid-turn does, and how many of its messages you haven't seen. Pure: no DOM.

import type { ConvoMsg } from '../../../shared/protocol/convo';
import { managerOf, TEAM_OWNER } from '../../../shared/roster/coverage';
import type { MemberView, RosterView } from '../../../shared/roster/types';
import type { PmState } from '../pm/state';

// ---- Who leads -------------------------------------------------------------------------------------

/**
 * The panel's agent: whoever covers Management (shared/roster/coverage.ts), so an Enterprise team's
 * Project Coordinator, a Startup's Chief Analyst or a Solo team's Solo Lead. `none` when that member isn't
 * hired (the panel offers to hire it), `benched` when its session was cleared (its handoff note and Hire
 * again). Undefined while the team hasn't come in.
 */
export type Lead =
  | { kind: 'lead'; member: MemberView; name: string; title: string }
  | { kind: 'benched'; member: MemberView; name: string; title: string }
  | { kind: 'none'; member?: MemberView; title: string };

export function leadOf(r: Pick<RosterView, 'members' | 'coverage'> | undefined): Lead | undefined {
  if (!r) return undefined;
  const role = managerOf(r.coverage ?? TEAM_OWNER);
  const m = r.members.find((x) => x.role === role);
  if (!m) return { kind: 'none', title: 'Project Coordinator' };
  if (m.status === 'not-hired') return { kind: 'none', member: m, title: m.title };
  if (m.status === 'benched') return { kind: 'benched', member: m, name: m.name, title: m.title };
  return { kind: 'lead', member: m, name: m.name, title: m.title };
}

/** "Ada · Project Coordinator", or what the header says with nobody to name. */
export function leadHeading(l: Lead | undefined): { name: string; role: string } {
  if (!l) return { name: 'Team lead', role: 'Loading the team…' };
  if (l.kind === 'none') return { name: 'No one leads the team yet', role: `No ${l.title} hired` };
  return { name: l.name, role: l.title };
}

/** The initials on the lead's avatar ("AL" for Ada Lovelace, "A" for Ada). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toUpperCase();
}

// ---- The status line --------------------------------------------------------------------------------

export type Dot = 'work' | 'idle' | 'wait' | 'off';

/** The dot and the words under the lead's name: "Working: reviewing PR #81". */
export function statusLine(l: Lead | undefined, state: PmState, activity?: string): { dot: Dot; text: string } {
  if (!l) return { dot: 'off', text: 'Loading…' };
  if (l.kind === 'none') return { dot: 'off', text: 'No one leads the team yet' };
  if (l.kind === 'benched') return { dot: 'off', text: 'Benched: session cleared' };
  const what = activity?.replace(/\s+/g, ' ').trim();
  switch (state) {
    case 'working':
      return { dot: 'work', text: what ? `Working: ${lower(what)}` : 'Working' };
    case 'starting':
      return { dot: 'work', text: 'Starting up' };
    case 'needs-you':
      return { dot: 'wait', text: what ? `Asking you: ${lower(what)}` : 'Asking you something' };
    case 'asleep':
      return { dot: 'off', text: 'Asleep: Wake carries its session on' };
    case 'benching':
      return { dot: 'wait', text: 'Writing its handoff note' };
    case 'benched':
      return { dot: 'off', text: 'Benched: session cleared' };
    case 'not-hired':
      return { dot: 'off', text: 'No one leads the team yet' };
    default:
      return { dot: 'idle', text: 'Ready: waiting for work' };
  }
}

/** A sentence's first letter in lower case, unless it's a name or an acronym ("Reviewing" → "reviewing", "PR #8" stays). */
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

// ---- What the panel keeps for you ------------------------------------------------------------------

/** Kept in this browser, per viewer: whether it's collapsed, and per project what you were typing and where you'd scrolled. */
export interface PanelState {
  collapsed: boolean;
  drafts: Record<string, string>;
  scroll: Record<string, number>;
  /** The last of the lead's messages you saw, by worker, for the unread badge. */
  seen: Record<string, string>;
}

export const PANEL_KEY = 'agent-office.lead-panel';
/** Whether the panel shows at all (⚙️ Settings › You); on unless turned off. */
export const PANEL_SHOW_KEY = 'agent-office.lead-panel-show';

const empty = (): PanelState => ({ collapsed: false, drafts: {}, scroll: {}, seen: {} });

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const rec = (v: unknown, kind: 'string' | 'number'): Record<string, never> => {
  const out: Record<string, unknown> = {};
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (typeof x === kind) out[k] = x;
  return out as Record<string, never>;
};

/** What this browser kept; the defaults when nothing was, it's garbled, or storage is blocked. */
export function readPanelState(storage: StorageLike | undefined): PanelState {
  try {
    const raw = JSON.parse(storage?.getItem(PANEL_KEY) ?? 'null') as Partial<PanelState> | null;
    if (!raw || typeof raw !== 'object') return empty();
    return { collapsed: raw.collapsed === true, drafts: rec(raw.drafts, 'string'), scroll: rec(raw.scroll, 'number'), seen: rec(raw.seen, 'string') };
  } catch {
    return empty();
  }
}

/** Keeps `s` (the drafts and scroll positions of at most a dozen projects); quietly nothing when storage is blocked. */
export function writePanelState(storage: StorageLike | undefined, s: PanelState): void {
  const trim = <T>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).slice(-12));
  try {
    storage?.setItem(PANEL_KEY, JSON.stringify({ collapsed: s.collapsed, drafts: trim(Object.fromEntries(Object.entries(s.drafts).filter(([, v]) => v))), scroll: trim(s.scroll), seen: trim(s.seen) }));
  } catch {
    // Only this visit, then.
  }
}

/** Whether the panel is turned on in this browser (on unless "Show the team-lead panel" was turned off). */
export function panelShown(storage: StorageLike | undefined): boolean {
  try {
    return storage?.getItem(PANEL_SHOW_KEY) !== '0';
  } catch {
    return true;
  }
}

// ---- When the terminal is attached -----------------------------------------------------------------

export interface TermLook {
  /** The panel is open (not collapsed, not turned off) and, on a phone, its sheet is up. */
  open: boolean;
  /** A phone: the panel is a bottom sheet with the chat only. */
  phone: boolean;
  view: 'chat' | 'terminal';
  /** The wide overlay is up (⤢ Expand, or Open terminal on a phone). */
  expanded: boolean;
  /** The browser tab is hidden. */
  pageHidden: boolean;
  /** The lead has a live worker on this floor (not asleep, not benched). */
  live: boolean;
  /** The chat can't read a transcript (not Claude Code): it shows the terminal's text instead, which needs it. */
  fallback: boolean;
}

/**
 * Whether the lead's terminal is attached now: only while something on screen shows it (the Terminal
 * tab, the expanded overlay, or the chat's terminal-text fallback), the panel is open and the page is
 * visible. Collapsed, on another view or in a hidden tab it's let go, so a collapsed panel costs nothing.
 */
export function terminalWanted(t: TermLook): boolean {
  if (!t.live || t.pageHidden) return false;
  if (t.expanded) return true;
  if (!t.open) return false;
  if (t.view === 'terminal' && !t.phone) return true;
  return t.view === 'chat' && t.fallback;
}

// ---- Sending while the lead is mid-turn ------------------------------------------------------------

/** How a message goes: typed in now (worker.prompt), or held by the office until the lead's turn ends (the team's "tell … after"). */
export type SendPlan = { via: 'prompt' } | { via: 'tell'; when: 'after' };

/**
 * What a send does. Idle, it goes in now. Mid-turn, the note offers both: Send now types it in now, After
 * their turn (and Enter, the default) hands it to the office's existing "after their turn" hold.
 */
export function sendPlan(midTurn: boolean, choice: 'now' | 'after' | 'enter'): SendPlan {
  if (!midTurn || choice === 'now') return { via: 'prompt' };
  return { via: 'tell', when: 'after' };
}

/** The note over the box while the lead is mid-turn. */
export const midTurnText = (name: string, minutes: string) => `${name} is mid-turn (${minutes}): send now or after their turn?`;

// ---- Unread ---------------------------------------------------------------------------------------

/** The id of the lead's newest message, if it has said anything. */
export function lastAgentId(messages: readonly ConvoMsg[] | undefined): string | undefined {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) if (messages![i].kind === 'agent') return messages![i].id;
  return undefined;
}

/**
 * How many of the lead's messages came after the one you last saw. Never seen any (`seen` undefined):
 * none, the conversation so far counts as read; a `seen` no longer in the list (it scrolled out of what
 * the page keeps): every agent message there.
 */
export function unreadSince(messages: readonly ConvoMsg[] | undefined, seen: string | undefined): number {
  if (!messages?.length || seen === undefined) return 0;
  const at = messages.findIndex((m) => m.id === seen);
  let n = 0;
  for (let i = at + 1; i < messages.length; i++) if (messages[i].kind === 'agent') n++;
  return n;
}

// ---- Quick actions -----------------------------------------------------------------------------------

/** The quick actions under the box; `standup` runs the team's standup (with the "OK to interrupt?" check) instead of a prompt. */
export const QUICK: readonly { id: string; label: string; prompt?: string; standup?: true }[] = [
  { id: 'status', label: 'Status update', prompt: "Give me a short status update on the project: what's done, what's in progress and who's on it, and anything that needs me." },
  { id: 'standup', label: 'Run standup', standup: true },
  { id: 'blocked', label: "What's blocked?", prompt: "What's blocking the team right now? For each blocker: who it affects and what would unblock it, including anything you need from me." },
  { id: 'plan', label: 'Plan next steps', prompt: 'Plan the next steps: the next 3 to 5 tasks in priority order, which Lead should take each, and why.' },
];
