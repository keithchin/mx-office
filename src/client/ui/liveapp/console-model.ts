// The Console's lists, apart from the page: entries kept in id order with a newer copy replacing an older
// one, capped; what the filters let through; the counts on the tabs. Pure, so tests run it without a page.

import { LOG_KEEP, NET_KEEP, netFailed, netName, type LiveLogEntry, type LiveLogLevel, type LiveNetEntry } from '../../../shared/liveapp/console';

/** Entries by id, oldest first: `put` adds or replaces; what fell off the front is returned. */
export class IdList<T extends { id: number }> {
  items: T[] = [];
  constructor(private keep: number) {}

  put(list: readonly T[]): { added: T[]; replaced: T[]; dropped: T[] } {
    const added: T[] = [];
    const replaced: T[] = [];
    for (const e of list) {
      const i = this.find(e.id);
      if (i >= 0) {
        this.items[i] = e;
        replaced.push(e);
      } else {
        const last = this.items[this.items.length - 1];
        if (!last || last.id < e.id) this.items.push(e);
        else this.items.splice(this.insertAt(e.id), 0, e);
        added.push(e);
      }
    }
    const dropped = this.items.length > this.keep ? this.items.splice(0, this.items.length - this.keep) : [];
    return { added, replaced, dropped };
  }

  clear() {
    this.items = [];
  }

  /** Where `id` is, from the end (news is mostly about the newest), -1 when it isn't. */
  find(id: number): number {
    let lo = 0;
    let hi = this.items.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const at = this.items[mid].id;
      if (at === id) return mid;
      if (at < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  private insertAt(id: number): number {
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.items[mid].id < id) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

export const logList = () => new IdList<LiveLogEntry>(LOG_KEEP);
export const netList = () => new IdList<LiveNetEntry>(NET_KEEP);

export interface LogFilter {
  levels: Record<LiveLogLevel, boolean>;
  text: string;
  /** Entries up to this id were cleared from the view. */
  clearedTo: number;
}

export const freshLogFilter = (): LogFilter => ({ levels: { error: true, warning: true, info: true, debug: false }, text: '', clearedTo: 0 });

export function logShows(e: LiveLogEntry, f: LogFilter): boolean {
  if (e.id <= f.clearedTo || !f.levels[e.level]) return false;
  if (!f.text) return true;
  const q = f.text.toLowerCase();
  return e.message.toLowerCase().includes(q) || e.node.toLowerCase().includes(q) || (e.detail?.toLowerCase().includes(q) ?? false);
}

export function logCounts(items: readonly LiveLogEntry[], clearedTo: number): Record<LiveLogLevel, number> {
  const n: Record<LiveLogLevel, number> = { error: 0, warning: 0, info: 0, debug: 0 };
  for (const e of items) if (e.id > clearedTo) n[e.level]++;
  return n;
}

export type NetView = 'all' | 'xhr' | 'errors';

export interface NetFilter {
  view: NetView;
  text: string;
  clearedTo: number;
}

export const freshNetFilter = (): NetFilter => ({ view: 'all', text: '', clearedTo: 0 });

/** XHR: the app's own calls (xas/, fetch and XHR, WebSockets), not its pages and files. */
export const isCall = (e: LiveNetEntry) => e.kind === 'xas' || e.kind === 'xhr' || e.kind === 'ws';

export function netShows(e: LiveNetEntry, f: NetFilter): boolean {
  if (e.id <= f.clearedTo) return false;
  if (f.view === 'xhr' && !isCall(e)) return false;
  if (f.view === 'errors' && !netFailed(e)) return false;
  if (!f.text) return true;
  const q = f.text.toLowerCase();
  return e.path.toLowerCase().includes(q) || netName(e).toLowerCase().includes(q) || String(e.status ?? '').includes(q) || e.method.toLowerCase() === q;
}

export const netFailures = (items: readonly LiveNetEntry[], clearedTo: number) => items.filter((e) => e.id > clearedTo && netFailed(e)).length;

/** A body as shown: JSON laid out when it's whole JSON, else as it came. */
export function pretty(text: string): string {
  const t = text.trim();
  if (!/^[{[]/.test(t)) return text;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return text;
  }
}

/** "08:00:02.948" from "2026-10-13 08:00:02.948". */
export const clock = (time: string) => /\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?/.exec(time)?.[0] ?? time;
