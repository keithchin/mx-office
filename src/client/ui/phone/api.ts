// The team phone's calls to the office (server/phone/, http/routes/phone.ts), and the one way other
// parts of a page open it (a team page's "Team chatter" link, the Command Center's Needs-you row),
// without importing the phone itself.

import type { ChatterFilter } from '../../../shared/chatter';
import type { PhonePlace } from '../../../shared/phone';
import type { EscalationVerdict } from '../../../shared/roster/escalation';
import type { TeamId } from '../../../shared/roster/roles';
import { store } from '../../state';

export interface SendReply {
  ok: true;
  thread: string;
  to: { workerId: string; name: string; status: 'sent' | 'held' | 'woke' }[];
  note?: string;
  resolved?: string;
}

export interface PendingReply {
  workerId: string;
  thread: string;
  since: number;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin', ...init });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
  return j as T;
}

export function sendMessage(floor: string, text: string, place: PhonePlace, verdict?: EscalationVerdict): Promise<SendReply> {
  const body = { floor, text, place, by: store.profile.name, ...(verdict ? { verdict } : {}) };
  return call<SendReply>('/api/phone/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

export const pendingOn = (floor: string) => call<{ pending: PendingReply[] }>(`/api/phone/state?floor=${encodeURIComponent(floor)}`).then((j) => j.pending);

/** What to show when the phone is opened from somewhere else. */
export interface PhoneOpen {
  /** The pinned Needs you section. */
  needs?: boolean;
  /** A project channel, filtered (a team page: that team's members). */
  floor?: string;
  filter?: ChatterFilter;
  team?: TeamId;
}

let opener: ((o: PhoneOpen) => void) | undefined;

/** The page's phone says how to open it (ui/phone/index.ts). */
export const setPhoneOpener = (fn: (o: PhoneOpen) => void) => void (opener = fn);

/** Opens the team phone, if this page has one; false when it hasn't. */
export function openPhone(o: PhoneOpen = {}): boolean {
  if (!opener) return false;
  opener(o);
  return true;
}

export const hasPhone = () => !!opener;
