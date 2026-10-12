// The Testing safety switches (shared/testing/switches.ts), kept with the office's own settings
// (office-settings.json, connections/store.ts) and changed only by an admin, each change audited as
// settings.change. Both are off until someone turns them on, so an office that updates to release 39
// raises no new Needs you items, starts no mxcli runs by itself and makes no new gh calls on its
// existing projects.

import { cleanSwitches, SWITCH_LABEL, type TestingSwitches, type TestingSwitchKey } from '../../shared/testing/switches.js';
import { audit, human } from '../audit/index.js';
import { officeSettings, updateOfficeSettings } from '../connections/store.js';

/** The switches now (off when nothing was saved). */
export const testingSwitches = (): TestingSwitches => cleanSwitches(officeSettings().testingSwitches);

/** When a merged PR merged: GitHub's mergedAt, else when the office saw it (the task's doneAt). */
export function mergedAtOf(pull: { mergedAt?: string } | undefined, doneAt: number | undefined): number | undefined {
  const t = pull?.mergedAt ? Date.parse(pull.mergedAt) : NaN;
  return Number.isFinite(t) ? t : doneAt;
}

/**
 * Turns one or both switches on or off; each one that changes is audited. Turning judging on stamps
 * `judgeSince` with now, so merges from before it are never judged. Returns the switches, or why not.
 */
export function setTestingSwitches(patch: { judge?: unknown; autoScore?: unknown }, who: { name: string; accountId?: string }, now = Date.now()): TestingSwitches | string {
  const asked = (['judge', 'autoScore'] as const).filter((k) => patch[k] !== undefined);
  if (!asked.length || asked.some((k) => typeof patch[k] !== 'boolean')) return 'Send { judge: true|false } and/or { autoScore: true|false }';
  const before = testingSwitches();
  const next: TestingSwitches = { ...before };
  const changed: TestingSwitchKey[] = [];
  for (const k of asked) {
    const on = patch[k] as boolean;
    if (before[k] === on) continue;
    changed.push(k);
    if (k === 'judge') {
      next.judge = on;
      if (on) next.judgeSince = now;
      else delete next.judgeSince;
      Object.assign(next, { judgeBy: who.name, judgeAt: now });
    } else Object.assign(next, { autoScore: on, autoBy: who.name, autoAt: now });
  }
  if (!changed.length) return before;
  updateOfficeSettings({ testingSwitches: next });
  for (const k of changed)
    audit.record({
      actor: human(who.name, who.accountId),
      action: 'settings.change',
      target: { kind: 'setting', id: `testing.${k}`, label: SWITCH_LABEL[k] },
      summary: `${next[k] ? 'Turned on' : 'Turned off'} "${SWITCH_LABEL[k]}" (${who.name})${k === 'judge' && next.judge ? ': only pull requests merged from now on are judged' : ''}`,
      details: { before: { on: before[k] }, after: { on: next[k], ...(k === 'judge' && next.judgeSince ? { since: next.judgeSince } : {}) } },
      severity: 'notice',
    });
  return next;
}
