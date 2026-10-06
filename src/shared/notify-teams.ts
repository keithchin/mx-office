// Microsoft Teams notifications (server/notify-teams/): what ⚙️ Settings shows and sends, and which
// "Needs you" items are red enough to post. The items themselves come from shared/needsyou.ts, the
// same rules as the strip on the Command Center, so the two never disagree.

import type { NeedItem } from './needsyou.js';

/** Only the red items, or those and a daily digest per floor after its standup. */
export type TeamsLevel = 'needs' | 'digest';

/** Hours when nothing is posted, in the office's own clock ("22:00" to "07:00" spans midnight). */
export interface QuietHours {
  start: string;
  end: string;
}

/** What an admin sets. The webhook URL itself is never sent back: only `hint`. */
export interface TeamsSettingsView {
  /** A webhook is saved. */
  on: boolean;
  /** Where it goes without its secret parts: "prod-12.westeurope.logic.azure.com/…/aB3x". */
  hint?: string;
  /** Where the URL is kept: the office's settings file for now (see server/notify-teams/secret.ts). */
  storedIn?: 'settings-file' | 'credential-store';
  /** 'all', or the floor ids that post. */
  floors: 'all' | string[];
  level: TeamsLevel;
  quiet?: QuietHours;
  /** Nothing is posted until then (ms); a catch-up card follows. */
  pausedUntil?: number;
  /** The office's address from outside (the coming Phone access feature fills it): each card's Open button goes there. */
  publicUrl?: string;
  by?: string;
  at?: number;
  /** Why the last post failed, until one gets through. */
  error?: string;
  lastSentAt?: number;
  /** Items waiting to be posted (the 60 s batch) and held back (quiet hours, paused). */
  pending: number;
  held: number;
  /** The floors there are, to pick from. */
  allFloors: { id: string; name: string }[];
  /** Whoever's looking can change it. */
  admin: boolean;
}

/** What a POST to /api/notify/teams may change; a missing field stays as it is. */
export interface TeamsSettingsPatch {
  /** A new webhook URL ('' removes it). */
  url?: string;
  floors?: 'all' | string[];
  level?: TeamsLevel;
  /** null takes quiet hours off. */
  quiet?: QuietHours | null;
  /** Minutes to pause for (0 resumes). */
  pauseMinutes?: number;
  publicUrl?: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHhmm = (s: unknown): s is string => typeof s === 'string' && HHMM.test(s);

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether `now` is inside quiet hours, by the clock `minuteOfDay` reads (the office's local time unless a test says). */
export function inQuietHours(q: QuietHours | undefined, minuteOfDay: number): boolean {
  if (!q || !isHhmm(q.start) || !isHhmm(q.end)) return false;
  const s = minutesOf(q.start);
  const e = minutesOf(q.end);
  if (s === e) return false;
  return s < e ? minuteOfDay >= s && minuteOfDay < e : minuteOfDay >= s || minuteOfDay < e;
}

/**
 * The "Needs you" items Teams hears about: a person is the only way forward. An agent asking in its
 * terminal, an escalation, the spend cap, a PR's checks failing, a Firm report in, a toolkit gate to sign
 * off, and Studio Pro changes to commit. Not a finished turn (the office's own quiet turns end the same
 * way, and nobody needs a phone buzz for one), a lost worktree, a proposal, the live app, a stale folder
 * or the Firm's budget warning: those wait for the Command Center.
 */
export function isRedNeed(n: Pick<NeedItem, 'kind' | 'key'>): boolean {
  switch (n.kind) {
    case 'asking':
    case 'escalation':
    case 'paused':
    case 'pr':
    case 'studio':
      return true;
    case 'setup':
      return n.key !== 'setup-stale';
    case 'audit':
      return !n.key.startsWith('audit-budget-');
    default:
      return false;
  }
}
