// When the office goes away under an open page: the page shows a full-page state rather than looking
// stuck. The office says why as it closes each socket (a WebSocket close code: restarting, or stopped),
// and with no word at all (it crashed, or was killed) the page works it out from its own reconnect
// attempts, which it makes anyway: no extra polling. Back up after either, the page reloads. Pure: the
// server sends the codes, the page (ui/loading/office-down.ts) decides what to show.

/** The close codes the office sends as it shuts down (4000–4999 are the application's own). */
export const OFFICE_CLOSE = { stopped: 4000, restarting: 4001 } as const;

/** Why the office is closing: a looping launcher (or the next process) brings it back, or nobody does. */
export type OfficeClosing = 'restart' | 'stop';

export const closeCodeFor = (why: OfficeClosing): number => (why === 'restart' ? OFFICE_CLOSE.restarting : OFFICE_CLOSE.stopped);

/** Failed reconnects in a row, with no word from the office, before the page says it has stopped (≈ 4 s of backoff). */
export const SILENT_STOP_AFTER = 4;
/** Failed reconnects after "restarting" before the page says the restart didn't come back (1 s apart: about two minutes). */
export const RESTART_GIVE_UP_AFTER = 120;

export type DownState = 'restarting' | 'stopped' | undefined;

export interface DownInput {
  /** The close code of the connection that went (undefined while it's up or before it ever was). */
  code?: number;
  /** Reconnect attempts that failed since it went. */
  failures: number;
  /** The page heard the office was restarting (an upgrade, a safe restart) before it went. */
  restartExpected: boolean;
}

/** What the page shows while the office is away: nothing yet (a blip), restarting, or stopped. */
export function downState(d: DownInput): DownState {
  const restarting = d.code === OFFICE_CLOSE.restarting || d.restartExpected;
  if (restarting) return d.failures >= RESTART_GIVE_UP_AFTER ? 'stopped' : 'restarting';
  if (d.code === OFFICE_CLOSE.stopped) return 'stopped';
  return d.failures >= SILENT_STOP_AFTER ? 'stopped' : undefined;
}

export const DOWN_TEXT: Record<'restarting' | 'stopped', { title: string; body: string }> = {
  restarting: { title: 'Restarting… reconnecting', body: 'The office is restarting. This page reloads by itself as soon as it is back.' },
  stopped: { title: 'The office has stopped', body: 'Start it again with start-office.ps1. This page reloads by itself once the office is back.' },
};
