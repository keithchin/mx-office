// What the team view says of a member whose status reads idle (or asleep) while the office saw it at work
// in the last minute or two (server/workers/pulse.ts: its terminal printed, one of its hooks fired, it ran
// `git commit`): active, with the evidence, never "Ready" or "nobody working" while the work lands. The
// Overview's Team card (ui/portal/overview-logic.ts teamRows) and the Team tab's cards (ui/roster/org.ts)
// read it from the roster's `recent`. Pure: the browser imports it, the tests too.

export type RecentVia = 'output' | 'tool' | 'commit';

/** The status pill's words. */
export const ACTIVE_WORD: Record<RecentVia, string> = { commit: 'Active (just committed)', tool: 'Active (tool calls)', output: 'Active (terminal output)' };

/** The line under it. */
export function activeLine(r: { via: RecentVia; at: number }, now: number): string {
  const ago = Math.max(0, Math.round((now - r.at) / 1000));
  const when = ago < 60 ? `${ago} s ago` : `${Math.round(ago / 60)} min ago`;
  return r.via === 'commit' ? `Committed ${when}; its status lags the work` : r.via === 'tool' ? `A tool call ${when}; its status lags the work` : `Its terminal printed ${when}; its status lags the work`;
}

/** Whether a member reads as active by its pulse: not benched, not already working or asking, and seen at work lately. */
export function activeByPulse(m: { status: string; recent?: { via: RecentVia; at: number } }): boolean {
  return !!m.recent && (m.status === 'idle' || m.status === 'asleep');
}
