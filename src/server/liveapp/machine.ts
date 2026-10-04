// What a live app may do next, as a table, so the process juggling in app.ts can't wander into a
// state nobody drew: two people pressing ▶ at once start it once, a stop during a start wins, and
// main moving only restarts an app that is actually up.

import type { LiveAppStatus } from '../../shared/protocol.js';

export type LiveAppEvent =
  /** Someone pressed ▶ (or ⟳ on one that isn't running). */
  | 'start'
  /** Someone pressed ⟳, or main moved: stop what runs, then start on the newest main. */
  | 'restart'
  /** Main moved under a running app (auto-refresh). */
  | 'update'
  /** The app answered on its port. */
  | 'ready'
  /** The process ended, or gave up, without being asked to. */
  | 'crash'
  /** Someone pressed ■, or the office is closing. */
  | 'stop'
  /** The process is gone after a stop. */
  | 'exited';

const TABLE: Record<LiveAppStatus, Partial<Record<LiveAppEvent, LiveAppStatus>>> = {
  stopped: { start: 'starting', restart: 'starting' },
  failed: { start: 'starting', restart: 'starting', stop: 'stopped' },
  starting: { ready: 'running', crash: 'failed', stop: 'stopping', restart: 'starting' },
  updating: { ready: 'running', crash: 'failed', stop: 'stopping', restart: 'starting' },
  running: { crash: 'failed', stop: 'stopping', restart: 'starting', update: 'updating' },
  stopping: { exited: 'stopped', crash: 'stopped' },
};

/** Where `event` takes an app that is `from`; undefined when it doesn't apply there (and nothing should happen). */
export function nextStatus(from: LiveAppStatus, event: LiveAppEvent): LiveAppStatus | undefined {
  return TABLE[from][event];
}

/** Whether a process is (or should be) running in this state. */
export const isUp = (s: LiveAppStatus) => s === 'starting' || s === 'updating' || s === 'running';
