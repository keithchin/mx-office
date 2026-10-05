// The Audit log tab's pure parts: the time range a preset means, the timeline's bucket, the query
// string, whether a live event fits the filter, how an actor and an action look, and the settings diff.

import { actionMatches, AUDIT_GROUPS, OFFICE_FLOOR, type AuditActorKind, type AuditEvent, type AuditGroup } from '../../../shared/audit';

export type Preset = 'hour' | 'today' | '7d' | '30d' | 'custom';
export const PRESETS: readonly { id: Preset; label: string }[] = [
  { id: 'hour', label: 'Last hour' },
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'custom', label: 'Custom' },
];

export interface Filter {
  /** A floor's id, '_office' for the office's own, or 'all'. */
  floor: string;
  preset: Preset;
  /** The custom range (ms); also where a click on the timeline zooms to. */
  since?: number;
  until?: number;
  actors: AuditActorKind[];
  group: AuditGroup | '';
  q: string;
}

const H = 3_600_000;
const DAY = 24 * H;

/** Local midnight of the day `t` is in. */
export const midnight = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** The range a filter covers, and the timeline's bucket: an hour's worth of 5 minutes up to two days of hours, then days. */
export function rangeOf(f: Pick<Filter, 'preset' | 'since' | 'until'>, now: number): { since: number; until?: number; bucket: number } {
  const since = f.preset === 'hour' ? now - H : f.preset === 'today' ? midnight(now) : f.preset === '7d' ? midnight(now) - 6 * DAY : f.preset === '30d' ? midnight(now) - 29 * DAY : (f.since ?? now - DAY);
  const until = f.preset === 'custom' ? f.until : undefined;
  const span = (until ?? now) - since;
  const bucket = span <= 2 * H ? 5 * 60_000 : span <= 2 * DAY ? H : DAY;
  return { since, until, bucket };
}

/** GET /api/audit's (or the export's) query string for a filter. */
export function queryString(f: Filter, now: number, extra: Record<string, string | number | undefined> = {}): string {
  const r = rangeOf(f, now);
  const p = new URLSearchParams();
  p.set('floor', f.floor);
  p.set('since', String(r.since));
  if (r.until !== undefined) p.set('until', String(r.until));
  if (f.actors.length) p.set('actor', f.actors.join(','));
  if (f.group) p.set('action', f.group);
  if (f.q.trim()) p.set('q', f.q.trim());
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) p.set(k, String(v));
  return p.toString();
}

/** Whether a live event belongs in the table as it's filtered now. */
export function fits(e: AuditEvent, floor: string, f: Filter, now: number): boolean {
  if (f.floor !== 'all' && f.floor !== floor) return false;
  const r = rangeOf(f, now);
  if (e.at < r.since || (r.until !== undefined && e.at > r.until)) return false;
  if (f.actors.length && !f.actors.includes(e.actor.kind)) return false;
  if (f.group && !actionMatches(e.action, [f.group])) return false;
  if (f.q.trim()) {
    const hay = `${e.summary} ${e.actor.name} ${e.action} ${e.target?.label ?? ''} ${e.target?.id ?? ''}`.toLowerCase();
    if (!hay.includes(f.q.trim().toLowerCase())) return false;
  }
  return true;
}

export const ACTOR_META: Record<AuditActorKind, { icon: string; label: string }> = {
  human: { icon: '🧑', label: 'Human' },
  agent: { icon: '🤖', label: 'Agent' },
  office: { icon: '🏢', label: 'Office' },
  jeff: { icon: '🧑‍⚖️', label: 'Jeff' },
  reviewer: { icon: '🔍', label: 'Reviewer' },
};

/** A steady color for a name, for its avatar dot. */
export function nameColor(name: string): string {
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${n % 360} 62% 52%)`;
}

/** The pill's color group for an action: its filter group, or 'other'. */
export function pillGroup(action: string): AuditGroup | 'other' {
  for (const [g, def] of Object.entries(AUDIT_GROUPS)) if (def.prefixes.some((p) => action.startsWith(p))) return g as AuditGroup;
  return 'other';
}

export const floorLabel = (floor: string | undefined, names: (id: string) => string | undefined) => (!floor || floor === OFFICE_FLOOR ? 'Office' : (names(floor) ?? floor));

/** A row of the settings diff: a field, what it was, what it is now. */
export interface DiffRow {
  key: string;
  before: string;
  after: string;
}

const show = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

/** The before/after of a settings change, field by field; empty when the details have neither. */
export function diffRows(details: Record<string, unknown> | undefined): DiffRow[] {
  if (!details || (!('before' in details) && !('after' in details))) return [];
  const b = details.before;
  const a = details.after;
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!obj(b) && !obj(a)) return [{ key: 'value', before: show(b), after: show(a) }];
  const before = obj(b) ? b : {};
  const after = obj(a) ? a : {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].map((key) => ({ key, before: show(before[key]), after: show(after[key]) }));
}

/** The time in a row: the clock today, the date and the clock before. */
export function rowTime(at: number, now: number): string {
  const d = new Date(at);
  const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  if (midnight(at) === midnight(now)) return clock;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${clock}`;
}

/** A bucket's label on the timeline. */
export function bucketLabel(start: number, size: number): string {
  const d = new Date(start);
  if (size >= DAY) return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}
