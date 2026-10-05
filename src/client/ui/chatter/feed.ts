// What the page keeps of each floor's team chatter: the messages fetched (GET /api/chatter, newest
// first, a page at a time) and the ones that came in since (chatter.new). The Command Center's panel
// and the team pages' compact ones both listen here, so one fetch serves them all. No three.js.

import type { ChatterMessage, ChatterPage } from '../../../shared/chatter';
import type { ServerMsg } from '../../../shared/protocol';

export type FeedEvent = { t: 'reset' } | { t: 'new'; m: ChatterMessage } | { t: 'older'; list: ChatterMessage[] };

interface Feed {
  /** Newest first. */
  messages: ChatterMessage[];
  ids: Set<string>;
  cursor?: string;
  loaded: boolean;
  loading?: Promise<void>;
  error?: string;
  listeners: Set<(ev: FeedEvent) => void>;
}

const PAGE = 60;
const feeds = new Map<string, Feed>();

function feedOf(floor: string): Feed {
  let f = feeds.get(floor);
  if (!f) {
    f = { messages: [], ids: new Set(), loaded: false, listeners: new Set() };
    feeds.set(floor, f);
  }
  return f;
}

const tell = (f: Feed, ev: FeedEvent) => {
  for (const l of f.listeners) l(ev);
};

async function fetchPage(floor: string, cursor?: string): Promise<ChatterPage> {
  const q = new URLSearchParams({ floor, limit: String(PAGE) });
  if (cursor) q.set('cursor', cursor);
  const r = await fetch(`/api/chatter?${q}`, { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return (await r.json()) as ChatterPage;
}

/** The floor's messages so far (newest first), fetching the first page the first time. */
export function messages(floor: string): { list: readonly ChatterMessage[]; loaded: boolean; error?: string; more: boolean } {
  const f = feedOf(floor);
  if (!f.loaded && !f.loading) {
    f.loading = fetchPage(floor)
      .then((p) => {
        // Live ones that came in while it was being fetched stay on top.
        const fresh = f.messages.filter((m) => !p.messages.some((x) => x.id === m.id));
        f.messages = [...fresh, ...p.messages];
        f.ids = new Set(f.messages.map((m) => m.id));
        f.cursor = p.cursor;
        f.error = undefined;
      })
      .catch((err: Error) => void (f.error = err.message))
      .finally(() => {
        f.loaded = true;
        f.loading = undefined;
        tell(f, { t: 'reset' });
      });
  }
  return { list: f.messages, loaded: f.loaded, error: f.error, more: !!f.cursor };
}

/** The next page back; what it added, oldest last. */
export async function loadOlder(floor: string): Promise<ChatterMessage[]> {
  const f = feedOf(floor);
  if (!f.cursor) return [];
  try {
    const p = await fetchPage(floor, f.cursor);
    const add = p.messages.filter((m) => !f.ids.has(m.id));
    for (const m of add) f.ids.add(m.id);
    f.messages.push(...add);
    f.cursor = p.cursor;
    tell(f, { t: 'older', list: add });
    return add;
  } catch {
    return [];
  }
}

export function onFeed(floor: string, l: (ev: FeedEvent) => void): () => void {
  const f = feedOf(floor);
  f.listeners.add(l);
  return () => void f.listeners.delete(l);
}

export const hasMore = (floor: string) => !!feedOf(floor).cursor;

/** Every server message: a new one goes on top of its floor's thread. */
export function routeChatter(msg: ServerMsg) {
  if (msg.t !== 'chatter.new') return;
  const f = feedOf(msg.floor);
  if (f.ids.has(msg.message.id)) return;
  f.ids.add(msg.message.id);
  f.messages.unshift(msg.message);
  tell(f, { t: 'new', m: msg.message });
}
