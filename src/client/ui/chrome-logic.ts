// The flat views' top-bar chrome, the parts with no DOM in them (ui/badge.ts, ui/viewpick.ts and
// shared/flatmenu.ts draw them): what a badge on a tab says, when the Standup tab gets its dot, what the
// Team boards tab counts, and where the arrow keys go in a dropdown. Kept apart so a test can run them.

import type { RosterView } from '../../shared/roster/types';

/** What a badge shows: a count, "!" for something broken, a dot for something new, or nothing. */
export type BadgeValue = number | '!' | 'dot' | null | undefined | false;

/** The badge's text: "" for nothing (or a dot, which has no text), a count capped at 99+. */
export function badgeText(b: BadgeValue): string {
  if (b === '!') return '!';
  if (typeof b !== 'number' || b <= 0) return '';
  return b > 99 ? '99+' : String(Math.floor(b));
}

/** Whether the badge shows at all. */
export const badgeShown = (b: BadgeValue): boolean => b === 'dot' || badgeText(b) !== '';

/** The newest standup's id is not the one last seen on this browser: a new one to read. */
export function newStandup(latest: string | undefined, seen: string | null | undefined): boolean {
  return !!latest && latest !== seen;
}

/** What waits on the Project Manager from the teams: approvals and open escalations that belong to a team. */
export function teamAttention(v: Pick<RosterView, 'approvals' | 'escalations'> | undefined): number {
  if (!v) return 0;
  // An escalation that's also an approval item counts once.
  const asApproval = new Set(v.approvals.map((a) => a.escalationId).filter(Boolean));
  const approvals = v.approvals.filter((a) => a.team).length;
  const escalations = v.escalations.filter((e) => e.status === 'open' && e.team && !asApproval.has(e.id)).length;
  return approvals + escalations;
}

/** Where a key moves the highlight in a list of `n` (a listbox or a menu), or undefined for a key it doesn't use. */
export function stepIndex(i: number, key: string, n: number): number | undefined {
  if (n <= 0) return undefined;
  switch (key) {
    case 'ArrowDown':
      return i < 0 ? 0 : (i + 1) % n;
    case 'ArrowUp':
      return i <= 0 ? n - 1 : i - 1;
    case 'Home':
      return 0;
    case 'End':
      return n - 1;
    default:
      return undefined;
  }
}
