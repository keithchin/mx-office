// Agent profiles' calls (server/http/routes/profiles.ts): the list, and an admin's change. A hire of a
// profile linked elsewhere answers `needsMove` until the Move is confirmed.

import type { MoveOp, NeedsMove, ProfilesView } from '../../../shared/profiles';

export interface ProfileActResult {
  error?: string;
  needsMove?: NeedsMove;
  op?: MoveOp;
  view?: ProfilesView;
}

export async function profilesView(): Promise<ProfilesView> {
  const res = await fetch('/api/profiles', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ProfilesView;
}

export async function profileAct(body: { action: 'hire' | 'rename' | 'notes' | 'retry' | 'cancel'; profile?: string; floor?: string; role?: string; task?: string; move?: boolean; name?: string; text?: string; move_id?: string }): Promise<ProfileActResult> {
  try {
    const res = await fetch('/api/profiles/action', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as ProfileActResult;
    return res.ok ? out : { error: out.error ?? `HTTP ${res.status}`, ...(out.needsMove ? { needsMove: out.needsMove } : {}) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** The address of a profile's page on Home › Agents. */
export const profileHref = (id: string) => `/home?tab=agents&profile=${encodeURIComponent(id)}`;
