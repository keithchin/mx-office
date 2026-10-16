// The tray's Needs-you count and the app's notifications, from the office's GET /api/desktop/status (the
// red items its Teams notifications and phone pushes post, each with a stable id). One notification per
// item the app hasn't seen before, remembered across restarts of the app and the office; an item that
// goes and comes back within a week isn't new. The first look of all doesn't notify each item already
// waiting: one line says how many. Pure.

export interface Need {
  id: string;
  floor: string;
  project: string;
  who: string;
  summary: string;
  urgency: string;
  level: 'block' | 'warn';
  path: string;
}

export interface OfficeStatus {
  needs: Need[];
  working: number;
}

/** What the app remembers: each id it has seen, with when it last saw it. */
export interface SeenState {
  primed: boolean;
  keys: Record<string, number>;
}

export const emptySeen = (): SeenState => ({ primed: false, keys: {} });

/** Forgotten this long after it last showed, and at most this many remembered. */
export const FORGET_MS = 7 * 24 * 60 * 60_000;
export const MAX_KEYS = 2000;
/** At most this many notifications from one look; the rest are one summary. */
export const MAX_PER_LOOK = 4;

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');

/** /api/desktop/status's body, or undefined when it isn't one. */
export function parseStatus(body: unknown): OfficeStatus | undefined {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { needs?: unknown }).needs)) return undefined;
  const b = body as { needs: unknown[]; working?: unknown };
  const needs: Need[] = [];
  for (const n of b.needs) {
    if (!n || typeof n !== 'object') continue;
    const r = n as Record<string, unknown>;
    if (!str(r.id)) continue;
    needs.push({ id: str(r.id, 500), floor: str(r.floor), project: str(r.project), who: str(r.who), summary: str(r.summary), urgency: str(r.urgency), level: r.level === 'block' ? 'block' : 'warn', path: str(r.path, 1000) });
  }
  return { needs, working: typeof b.working === 'number' && b.working > 0 ? Math.floor(b.working) : 0 };
}

export interface Diff {
  /** Items not seen before, at most MAX_PER_LOOK of them. */
  fresh: Need[];
  /** New items beyond those. */
  more: number;
  /** The very first look: nothing is fresh, `waiting` says how many were already there. */
  first: boolean;
  waiting: number;
  seen: SeenState;
}

/** Compares a look with what was seen; returns what's new and what to remember. */
export function diffNeeds(prev: SeenState, needs: readonly Need[], now: number): Diff {
  const keys: Record<string, number> = {};
  const present = new Set(needs.map((n) => n.id));
  for (const [k, at] of Object.entries(prev.keys)) if (now - at < FORGET_MS) keys[k] = at;
  // Gone for over FORGET_MS: forgotten, so it's new if it shows again.
  const isNew = needs.filter((n, i) => !(n.id in keys) && needs.findIndex((m) => m.id === n.id) === i);
  for (const id of present) keys[id] = now;
  const trimmed = Object.entries(keys);
  const seen: SeenState = { primed: true, keys: trimmed.length > MAX_KEYS ? Object.fromEntries(trimmed.sort((a, b) => b[1] - a[1]).slice(0, MAX_KEYS)) : keys };
  if (!prev.primed) return { fresh: [], more: 0, first: true, waiting: needs.length, seen };
  return { fresh: isNew.slice(0, MAX_PER_LOOK), more: Math.max(0, isNew.length - MAX_PER_LOOK), first: false, waiting: needs.length, seen };
}

export interface NoteSpec {
  title: string;
  body: string;
  /** The office path its click opens. */
  path: string;
  /** The item's id (none for a summary). */
  id?: string;
}

/** The notifications a diff makes: one per fresh item, a summary for the rest or for a first look. */
export function notesFor(d: Diff): NoteSpec[] {
  if (d.first) return d.waiting ? [{ title: 'Mx Office', body: `${needYouText(d.waiting)}.`, path: 'home' }] : [];
  const out: NoteSpec[] = d.fresh.map((n) => ({ id: n.id, title: `${n.project}: ${n.who}`.slice(0, 120), body: `${n.urgency && n.urgency !== 'Needs a look' ? `${n.urgency}: ` : ''}${n.summary}`.slice(0, 250), path: n.path || 'home' }));
  if (d.more) out.push({ title: 'Mx Office', body: `${d.more} more ${d.more === 1 ? 'needs' : 'need'} you.`, path: 'home' });
  return out;
}

/** "1 needs you", "3 need you". */
export const needYouText = (n: number) => `${n} ${n === 1 ? 'needs' : 'need'} you`;

export type TrayState = 'starting' | 'running' | 'restarting' | 'stopped' | 'crashed' | 'signed-out' | 'disconnected' | 'unknown';

/** The tray's tooltip: the app, what needs you (or why it can't say: `line`, connection.ts countLine), and the build. */
export function tooltipFor(t: { state: TrayState; count?: number; build?: string; attached?: boolean; line?: string }): string {
  const what =
    t.line ??
    (t.state === 'starting'
      ? 'starting…'
      : t.state === 'restarting'
        ? 'restarting…'
        : t.state === 'stopped'
          ? 'stopped'
          : t.state === 'crashed'
            ? 'the office stopped unexpectedly'
            : t.state === 'signed-out'
              ? 'sign in to see what needs you'
              : t.state === 'disconnected'
                ? 'office not answering'
                : t.state === 'unknown'
                  ? 'checking what needs you…'
                  : t.count
                    ? needYouText(t.count)
                    : 'nothing needs you');
  // Windows cuts a tray tooltip at 127 characters.
  return [`Mx Office: ${what}`, t.build ? `${t.attached ? 'attached, ' : ''}${t.build}` : undefined].filter(Boolean).join('\n').slice(0, 127);
}
