// Reading the audit log: filtering events, newest first, a page at a time behind a cursor, with the
// counts the filter bar shows; and the CSV export. Pure, so the tests and the routes share it.

import { actionMatches, type AuditActorKind, type AuditEvent, type AuditPage } from '../../shared/audit.js';

export interface AuditQuery {
  /** One floor's events (its id, or '_office'), or every floor's when missing or 'all'. */
  floor?: string;
  since?: number;
  until?: number;
  actorKind?: AuditActorKind | readonly AuditActorKind[];
  /** Exact actions, prefixes ('worker.' or 'worker.*') or group names (shared/audit.ts). */
  actions?: readonly string[];
  /** Free text, in the summary, the actor, the action and the target. */
  q?: string;
  limit?: number;
  cursor?: string;
  /** With `since`: counts per bucket of this many ms from it, to `until` or now (the timeline). */
  bucket?: number;
}

/** The most buckets a timeline has. */
export const MAX_BUCKETS = 400;

export const MAX_LIMIT = 1000;

/** Newest first: by time, then id (ids sort by time and then by the order they were made in). */
export const newestFirst = (a: AuditEvent, b: AuditEvent) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export const encodeCursor = (e: AuditEvent) => Buffer.from(`${e.at}:${e.id}`).toString('base64url');
export function decodeCursor(c: string | undefined): { at: number; id: string } | undefined {
  if (!c) return undefined;
  const [at, id] = Buffer.from(c, 'base64url').toString('utf8').split(':');
  return Number.isFinite(Number(at)) && id ? { at: Number(at), id } : undefined;
}

/** Whether an event passes the filter (the cursor and the limit aside). */
export function matches(e: AuditEvent, q: AuditQuery): boolean {
  if (q.since !== undefined && e.at < q.since) return false;
  if (q.until !== undefined && e.at > q.until) return false;
  if (q.actorKind !== undefined) {
    const kinds = typeof q.actorKind === 'string' ? [q.actorKind] : q.actorKind;
    if (kinds.length && !kinds.includes(e.actor.kind)) return false;
  }
  if (q.actions?.length && !actionMatches(e.action, q.actions)) return false;
  if (q.q) {
    const needle = q.q.toLowerCase();
    const hay = `${e.summary} ${e.actor.name} ${e.action} ${e.target?.label ?? ''} ${e.target?.id ?? ''} ${e.floor ?? ''}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

/** A page of the matching events, newest first, from the lists of every floor asked for. */
export function queryEvents(lists: readonly (readonly AuditEvent[])[], q: AuditQuery): Omit<AuditPage, 'chain' | 'promptText'> {
  const all: AuditEvent[] = [];
  for (const list of lists) for (const e of list) if (matches(e, q)) all.push(e);
  all.sort(newestFirst);
  const counts: AuditPage['counts'] = { actions: {}, actors: {} };
  for (const e of all) {
    counts.actions[e.action] = (counts.actions[e.action] ?? 0) + 1;
    counts.actors[e.actor.kind] = (counts.actors[e.actor.kind] ?? 0) + 1;
  }
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(q.limit ?? 100)));
  const after = decodeCursor(q.cursor);
  const start = after ? all.findIndex((e) => e.at < after.at || (e.at === after.at && e.id < after.id)) : 0;
  const events = start < 0 ? [] : all.slice(start, start + limit);
  const more = start >= 0 && start + limit < all.length;
  return { events, total: all.length, counts, ...(more ? { nextCursor: encodeCursor(events[events.length - 1]) } : {}), ...(q.bucket ? histogram(all, q) : {}) };
}

/** Events per bucket from `since` on: the timeline over the table. */
function histogram(all: readonly AuditEvent[], q: AuditQuery): Pick<AuditPage, 'histogram'> {
  if (q.since === undefined || !q.bucket || q.bucket < 60_000) return {};
  const end = q.until ?? Date.now();
  const n = Math.min(MAX_BUCKETS, Math.max(1, Math.ceil((end - q.since) / q.bucket)));
  const counts = new Array<number>(n).fill(0);
  for (const e of all) {
    const i = Math.floor((e.at - q.since) / q.bucket);
    if (i >= 0 && i < n) counts[i]++;
  }
  return { histogram: { start: q.since, size: q.bucket, counts } };
}

// ---- Export ----------------------------------------------------------------------------------------

export const CSV_COLUMNS = ['time', 'floor', 'actor_kind', 'actor', 'action', 'target', 'summary', 'severity', 'details', 'id', 'prev', 'hash'] as const;

/** One CSV field: quoted when it has to be, and never read as a formula by a spreadsheet. */
export function csvField(v: unknown): string {
  let s = v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(e: AuditEvent): string {
  const target = e.target ? [e.target.kind, e.target.label ?? e.target.id].filter(Boolean).join(': ') : '';
  return [new Date(e.at).toISOString(), e.floor ?? '', e.actor.kind, e.actor.name, e.action, target, e.summary, e.severity, e.details ?? '', e.id, e.prev, e.hash].map(csvField).join(',');
}

export const csvHeader = () => CSV_COLUMNS.join(',');
