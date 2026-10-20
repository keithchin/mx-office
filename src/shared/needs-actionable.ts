// What counts as actionable, in one place for every surface the server feeds: the desktop tray, Home's
// project cards, Teams posts and phone pushes (they all go through server/notify-teams/gather.ts floorNeeds).
// An item is actionable when it is red (shared/notify-teams.ts isRedNeed), isn't a sign-off already given
// that only waits for the lead to record it (setup at info), and isn't the "N waiting on <project>" row
// (each project counts its own). A batch sharing a notify key counts once (notifyRows), as it posts once.
// An answer whose delivery the office couldn't confirm (durable dispatch, outcome unknown) is actionable:
// it needs your intervention (Send again, It went through or Abandon on its card), so it is a NeedItem
// here too (deliveryNeedsOf), not only a card on the Command Center. Pure.

import type { NeedItem } from './needsyou.js';
import { isRedNeed, notifyRows } from './notify-teams.js';
import { unknownLine, type DispatchRecord } from './dispatch.js';

/** Whether an item waits on you on every server-fed surface (tray, Home, Teams, push). */
export const isActionable = (n: Pick<NeedItem, 'kind' | 'key' | 'level'>): boolean => n.kind !== 'floor' && isRedNeed(n) && !(n.kind === 'setup' && n.level === 'info');

/** The rows those surfaces show or post: one per notify key, actionable only. */
export const actionableRows = (needs: readonly NeedItem[]): NeedItem[] => notifyRows(needs).filter(isActionable);

/** How many: the number the tray, Home and Teams say for a project. */
export const actionableCount = (needs: readonly NeedItem[]): number => actionableRows(needs).length;

/** A project's answers whose delivery is unconfirmed (outcome unknown), as Needs-you items: needs intervention. */
export function deliveryNeedsOf(floor: string, records: readonly Pick<DispatchRecord, 'id' | 'state' | 'channel' | 'workerName' | 'typedAt' | 'dispatchedAt'>[]): NeedItem[] {
  return records
    .filter((r) => r.state === 'outcome-unknown')
    .map((r) => ({
      key: `delivery-${r.id}`,
      kind: 'delivery' as const,
      icon: '📨',
      text: unknownLine(r),
      tag: 'Needs intervention',
      level: 'block' as const,
      action: 'Open',
      ...(r.typedAt ?? r.dispatchedAt ? { since: r.typedAt ?? r.dispatchedAt } : {}),
      target: { to: 'floor' as const, floor },
    }));
}
