// The team phone's notifications: each Needs-you item (ui/needsyou/logic.ts, the one place its rules
// live) as a message in the floor's channel and the pinned Needs you section, said by the right voice
// (Jeff for escalations, which he ranks; the office for everything else) with the buttons that act on
// it. Pure: the tests import it.

import type { NeedItem, NeedKind, NeedTarget } from '../needsyou/logic';

export type NoteVoice = 'jeff' | 'office';

/** What a button on a notification does. */
export type NoteAction =
  /** Answer the escalation: reply in its thread, or approve / reject it there (Escalations.resolve). */
  | { do: 'reply' | 'approve' | 'reject'; escalation: string; label: string }
  /** Go where the Needs-you item's own button goes (its terminal, the PR window, Settings…). */
  | { do: 'go'; target: NeedTarget; label: string };

export interface PhoneNote {
  key: string;
  kind: NeedKind;
  voice: NoteVoice;
  /** The speaker's name as the message shows it. */
  who: string;
  text: string;
  tag?: string;
  rank?: NeedItem['rank'];
  since?: number;
  /** Red (blocks something) or worth a look. */
  level: NeedItem['level'];
  actions: NoteAction[];
}

/** The words of each item's main button, as the phone puts it. */
const GO_LABEL: Partial<Record<NeedKind, string>> = { asking: 'Open terminal', finished: 'Review', lost: 'Fix', approval: 'Review', paused: 'Raise cap', setup: 'Review', live: 'Live app', studio: 'Commit', audit: 'Read', floor: 'Go there' };

/** One item as a notification. `admin`: may answer escalations (the Project Manager). */
export function noteOf(n: NeedItem, admin: boolean): PhoneNote {
  const base = { key: n.key, kind: n.kind, text: n.text, level: n.level, ...(n.tag ? { tag: n.tag } : {}), ...(n.rank ? { rank: n.rank } : {}), ...(n.since ? { since: n.since } : {}) };
  if (n.kind === 'escalation' && n.target.to === 'escalation') {
    const id = n.target.id;
    const actions: NoteAction[] = admin
      ? [
          { do: 'reply', escalation: id, label: 'Reply' },
          { do: 'approve', escalation: id, label: 'Approve' },
          { do: 'reject', escalation: id, label: 'Reject' },
        ]
      : [{ do: 'reply', escalation: id, label: 'View' }];
    const ranked = n.rank ? (n.rank.n === 1 ? ' — answer this one first' : ` — #${n.rank.n} on my list`) : '';
    return { ...base, voice: 'jeff', who: 'Jeff', text: `${n.text}${ranked}`, actions };
  }
  if (n.kind === 'asking' && n.target.to === 'worker') {
    const name = n.text.split(' is asking')[0];
    const what = n.text.slice(name.length + ' is asking: '.length);
    return { ...base, voice: 'office', who: 'The office', text: `${name} is asking in its terminal: ${what}`, actions: [{ do: 'go', target: n.target, label: 'Open terminal' }] };
  }
  const label = n.kind === 'pr' ? 'Merge…' : (GO_LABEL[n.kind] ?? n.action);
  const actions: NoteAction[] = [{ do: 'go', target: n.target, label }];
  // A failing PR: its window has the checks and the merge, and Review opens the same.
  if (n.kind === 'pr') actions.push({ do: 'go', target: n.target, label: 'Review' });
  // A second button of the item's own (the budget's Resume beside Raise budget).
  if (n.alt) actions.push({ do: 'go', target: n.alt.target, label: n.alt.action });
  return { ...base, voice: 'office', who: 'The office', actions };
}

export const notesOf = (items: readonly NeedItem[], admin: boolean) => items.map((n) => noteOf(n, admin));

/** The red count: what needs the person on this floor, and everyone waiting on other floors. */
export function redCount(items: readonly NeedItem[], floors: readonly { id: string; waiting: number; cloning?: boolean }[], here: string | undefined): number {
  const mine = items.filter((n) => n.kind !== 'floor').length;
  const elsewhere = floors.filter((f) => f.id !== here && !f.cloning && f.waiting > 0).reduce((s, f) => s + f.waiting, 0);
  return mine + elsewhere;
}

/**
 * The kinds the phone sends a desktop alert for itself: the others already have theirs (a worker
 * asking or done, from shared/session.ts; an urgent escalation, from the office), so they aren't sent twice.
 */
const OWN_ALERT: ReadonlySet<NeedKind> = new Set(['escalation', 'approval', 'paused', 'pr', 'setup', 'live', 'studio', 'audit', 'lost', 'floor']);

/** Items new since `seen` that the phone alerts for (a loud escalation already alerted on its own). */
export function newAlerts(items: readonly NeedItem[], seen: ReadonlySet<string>): NeedItem[] {
  return items.filter((n) => !seen.has(n.key) && OWN_ALERT.has(n.kind) && !(n.kind === 'escalation' && n.level === 'block'));
}
