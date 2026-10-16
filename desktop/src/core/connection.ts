// Whether the office answers the app, and how fresh the tray's counts are. Each look (every 30 seconds,
// and after a page loads) is /api/health plus GET /api/desktop/status with the window's sign-in; what came
// back moves the connection between four states:
//
//   running       the status answered: its counts are confirmed as of now
//   signed-out    the office answered 401: it's there, but the counts can't be read (and none are kept)
//   disconnected  nothing answered: the last counts are kept, marked as of when they were confirmed
//   unknown       before the first look, or the office answers but its status isn't readable
//
// The tray never shows a count it couldn't confirm on the last look as if it were fresh. Ownership is not
// decided here: an office the app attached to that stops answering is reported, never stopped or started
// again by the app; "Start the office here" is the user's choice, and only when nothing answers on the port
// (decideStartHere). Pure: the clock and the time format are handed in.

import { decideStart, type Health } from './health.js';
import { diffNeeds, needYouText, notesFor, type NoteSpec, type OfficeStatus, type SeenState } from './needs.js';

export type Conn = 'unknown' | 'running' | 'signed-out' | 'disconnected';

export interface ConnState {
  conn: Conn;
  /** The last time the office answered at all. */
  seenAt?: number;
  /** The last status check that succeeded: `status` is as of then. */
  checkedAt?: number;
  /** The last confirmed counts, kept (stale) while the office doesn't answer; dropped when signed out. */
  status?: OfficeStatus;
  /** Looks in a row that didn't confirm the counts. */
  failures: number;
}

export type Look = { kind: 'ok'; status: OfficeStatus } | { kind: 'signed-out' } | { kind: 'down' } | { kind: 'unreadable' };

export const initialConn = (): ConnState => ({ conn: 'unknown', failures: 0 });

/**
 * What one look found. `healthy`: /api/health answered as the office. `code`: the status request's HTTP
 * status, undefined when it failed (refused, timed out). `status`: its parsed body, when it was one.
 */
export function lookOf(p: { healthy: boolean; code?: number; status?: OfficeStatus }): Look {
  if (p.code === 401) return { kind: 'signed-out' };
  if (p.code !== undefined && p.code >= 200 && p.code < 300 && p.status) return { kind: 'ok', status: p.status };
  // Something answered the status request (a 5xx, a body that isn't one): the office is there.
  if (p.healthy || p.code !== undefined) return { kind: 'unreadable' };
  return { kind: 'down' };
}

/** The connection after a look. */
export function nextConn(prev: ConnState, look: Look, now: number): ConnState {
  switch (look.kind) {
    case 'ok':
      return { conn: 'running', seenAt: now, checkedAt: now, status: look.status, failures: 0 };
    case 'signed-out':
      return { conn: 'signed-out', seenAt: now, ...(prev.checkedAt !== undefined ? { checkedAt: prev.checkedAt } : {}), failures: 0 };
    case 'unreadable':
      return { ...prev, conn: 'unknown', seenAt: now, failures: prev.failures + 1 };
    case 'down':
      return { ...prev, conn: 'disconnected', failures: prev.failures + 1 };
  }
}

/** Counts confirmed by the last look, or undefined: only these may be shown as they are (the badge). */
export const freshStatus = (s: ConnState): OfficeStatus | undefined => (s.conn === 'running' ? s.status : undefined);

/** "14:05", in the computer's own clock. */
export const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * The tray's line about what needs you: "2 need you"; "2 need you · as of 14:05, office not answering";
 * "Sign in to see what needs you"; "Office not answering". Lower case first (the tray capitalises it).
 */
export function countLine(s: ConnState, time: (ms: number) => string = clockTime): string {
  const n = s.status?.needs.length ?? 0;
  const stale = (why: string) => (s.status && s.checkedAt !== undefined ? `${n ? needYouText(n) : 'nothing needed you'} · as of ${time(s.checkedAt)}, ${why}` : undefined);
  switch (s.conn) {
    case 'running':
      return n ? needYouText(n) : 'nothing needs you';
    case 'signed-out':
      return 'sign in to see what needs you';
    case 'disconnected':
      return stale('office not answering') ?? 'office not answering';
    case 'unknown':
      return s.failures ? (stale("couldn't check") ?? "the office answers, but couldn't say what needs you") : 'checking what needs you…';
  }
}

export type StartHere = { kind: 'attach'; health: Health } | { kind: 'busy' } | { kind: 'start' };

/**
 * "Start the office here", asked for by the user after an attached office stopped answering: an office
 * answering again is attached to again, a port something still holds is reported, and only a free port
 * gets an office of the app's own. Never two offices on the same port.
 */
export function decideStartHere(p: { health?: Health; portOpen: boolean }): StartHere {
  const d = decideStart({ ...p, attach: 'always' });
  return d.kind === 'attach' ? d : d.kind === 'busy' ? d : { kind: 'start' };
}

/**
 * A look's effect on the app: the connection, what was seen (only a confirmed look changes it, so a
 * failure, a sign-out or a reconnection never forgets what was already notified) and the notifications.
 */
export function afterLook(p: { conn: ConnState; seen: SeenState; muted?: boolean }, look: Look, now: number): { conn: ConnState; seen?: SeenState; notes: NoteSpec[] } {
  const conn = nextConn(p.conn, look, now);
  if (look.kind !== 'ok') return { conn, notes: [] };
  const d = diffNeeds(p.seen, look.status.needs, now);
  return { conn, seen: d.seen, notes: p.muted ? [] : notesFor(d) };
}
