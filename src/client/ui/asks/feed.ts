// The floor's surfaced asks for Needs you (server/asks/, shared/asks.ts): work not on main, assumptions
// without your consent, gate advisories and what's ready for your review, from GET /api/asks, fetched for
// the floor on first use, again when the audit log says one was acted on ({t:'audit.new'}, asks.*), and
// every few minutes. Their buttons: Documents opens the page; the rest go to POST /api/asks/act (a message
// to whoever covers Management, after their turn, or "seen").

import type { AskAct, AsksNeed, AsksView } from '../../../shared/asks';
import type { ServerMsg } from '../../../shared/protocol';
import { store } from '../../state';
import { toast } from '../dom';
import { openDocuments } from '../deliverables/open';

const POLL_MS = 5 * 60_000;

let view: AsksView | undefined;
let asked: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
const subs = new Set<() => void>();

async function refresh(floor: string) {
  try {
    const res = await fetch(`/api/asks?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    if (!res.ok || floor !== asked) return;
    const next = (await res.json()) as AsksView;
    if (JSON.stringify(next) === JSON.stringify(view)) return;
    setAsksView(next);
  } catch {
    // Next time.
  }
}

/** Replaces the view (what an action answered) and tells Needs you. */
export function setAsksView(v: AsksView) {
  if (v.floor !== asked) return;
  view = v;
  for (const fn of subs) fn();
}

/** The floor's items as last fetched, for collectNeeds (the first call for a floor starts fetching). */
export function asksNeed(floor: string | null | undefined): AsksNeed | undefined {
  if (!floor || typeof fetch !== 'function') return undefined;
  if (floor !== asked) {
    asked = floor;
    view = undefined;
    void refresh(floor);
    if (!polling) {
      polling = true;
      setInterval(() => asked && void refresh(asked), POLL_MS);
    }
  }
  return view && view.floor === floor && view.items.length ? { floor, items: view.items, ...(view.unreadAt ? { unreadAt: view.unreadAt } : {}) } : undefined;
}

export function onAsksChanged(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Every message from the office: an ask was acted on when the audit log says so. */
export function asksFeedMessage(msg: ServerMsg) {
  if (!asked || msg.t !== 'audit.new' || !msg.event.action.startsWith('asks.') || (msg.floor !== asked && msg.event.floor !== asked)) return;
  clearTimeout(timer);
  const f = asked;
  timer = setTimeout(() => void refresh(f), 300);
}

/** A row's button: the Documents page, or the office acts on it. */
export async function goAsk(t: { id: string; act: AskAct }): Promise<void> {
  const floor = asked;
  if (t.act === 'documents') return openDocuments(floor);
  if (!floor) return;
  const res = await fetch('/api/asks/act', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ floor, id: t.id, act: t.act, by: store.me.account?.name ?? store.profile.name }),
  }).catch(() => undefined);
  const out = (await res?.json().catch(() => ({}))) as (AsksView & { error?: string; sent?: string }) | undefined;
  if (!res?.ok || !out?.items) return void toast(`Not done: ${out?.error ?? 'the office could not be reached'}`, 'warn');
  setAsksView(out);
  if (out.sent) toast(out.sent);
}
