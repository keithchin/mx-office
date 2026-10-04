// The Team tab's calls to the office (server/http/routes/roster.ts): what the floor's team looks like,
// one standup in full, and what the CTO does. Every action answers with the team as it is after it.

import type { RosterView, Standup } from '../../../shared/roster/types';
import { toast } from '../dom';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const fetchRoster = (floor: string) => fetch(`/api/roster?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' }).then((r) => json<RosterView>(r));

export const fetchStandup = (floor: string, id?: string) =>
  fetch(`/api/roster/standup?${new URLSearchParams(id ? { floor, id } : { floor })}`, { credentials: 'same-origin' }).then((r) => json<Standup>(r));

/** Your name as this browser has it, for the record of who decided what (an account's name wins on the server). */
function myName(): string | undefined {
  try {
    return JSON.parse(localStorage.getItem('agent-office.profile') ?? 'null')?.name;
  } catch {
    return undefined;
  }
}

/** Does `action` on the floor's team; the team after it, or undefined (with a toast saying why) when it was refused. */
export async function act(floor: string, action: string, extra: Record<string, unknown> = {}): Promise<RosterView | undefined> {
  try {
    const res = await fetch('/api/roster/action', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ floor, action, by: myName(), ...extra }),
    });
    return await json<RosterView>(res);
  } catch (err) {
    toast((err as Error).message, 'warn');
    return undefined;
  }
}
