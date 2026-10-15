// A decision card's buttons (server/decisions/, POST /api/decisions/action): Separate, Noted, I've done it,
// Can't now, Resolved, Still needed, and an answer that answers every escalation the card folds. Admins
// only (the server checks); what comes back is the floor's decision view, handed to the feed.

import { store } from '../../state';
import { toast } from '../dom';
import { setDecisionsView } from './feed';

export interface DecisionActBody {
  action: 'separate' | 'answer' | 'noted' | 'done' | 'cant-now' | 'resolved' | 'still-needed';
  escalation?: string;
  others?: string[];
  verdict?: 'reply' | 'approve' | 'reject';
  text?: string;
  cardId?: string;
  sourceId?: string;
}

/** Sends a card's button; true when the office did it (a refusal is toasted). */
export async function decisionAct(floor: string, body: DecisionActBody): Promise<boolean> {
  try {
    const res = await fetch('/api/decisions/action', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor, by: store.me.account?.name ?? store.profile.name, ...body }) });
    const out = (await res.json().catch(() => ({}))) as { error?: string; floor?: string };
    if (!res.ok) {
      toast(out.error ?? 'The office could not do that just now', 'warn');
      return false;
    }
    if (out.floor) setDecisionsView(out as never);
    return true;
  } catch {
    toast('The office could not be reached', 'warn');
    return false;
  }
}
