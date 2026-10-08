// The Team tab's calls to the office (server/http/routes/roster.ts): what the floor's team looks like,
// one standup in full, and what the Project Manager does. Every action answers with the team as it is after it.

import type { RosterView, Standup } from '../../../shared/roster/types';
import { toast } from '../dom';
import { PAUSED_HIRES } from '../../../shared/project-run';
import { confirmHireAnyway } from '../project-run';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** The fetches of each floor's team still on their way: everyone asking meanwhile shares the one answer. */
const inFlight = new Map<string, Promise<RosterView>>();

/**
 * What the floor's team looks like now. A project switch had four parts of the page (Needs you, the
 * team tab, the phone, the boards) each fetch the same roster at the same moment; they share one fetch.
 */
export function fetchRoster(floor: string): Promise<RosterView> {
  const going = inFlight.get(floor);
  if (going) return going;
  const p = fetch(`/api/roster?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' }).then((r) => json<RosterView>(r));
  inFlight.set(floor, p);
  const done = () => inFlight.get(floor) === p && inFlight.delete(floor);
  p.then(done, done);
  return p;
}

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

/** Needs you's Nudge: an idle team member is told to carry on with its open task, or escalate. */
export async function nudgeMember(floor: string | null | undefined, role: string): Promise<void> {
  if (!floor) return;
  const r = await act(floor, 'nudge', { role });
  const m = r?.members.find((x) => x.role === role);
  if (r) toast(`🔁 Nudged ${m?.name ?? 'them'} back to work`);
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
    // A paused floor hires nobody: the Project Manager may hire this one anyway, after a confirm.
    if (action === 'hire' && !extra.override && (err as Error).message === PAUSED_HIRES) return (await confirmHireAnyway()) ? act(floor, action, { ...extra, override: true }) : undefined;
    toast((err as Error).message, 'warn');
    return undefined;
  }
}
