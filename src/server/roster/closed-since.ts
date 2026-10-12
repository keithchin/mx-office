// When task outcomes came in (release 39) on this office: stamped once in its own settings
// (office-settings.json) the first time it starts with them, and never moved after. A pull request closed
// without merging before then raises no "rework, cancel, or replaced?" decision: an office that updates
// doesn't fill Needs you with PRs closed weeks ago. The task is left as it was.

import { officeSettings, updateOfficeSettings } from '../connections/store.js';

/** Stamps the start once (office/core.ts, after the office's settings are open). */
export function markOutcomesStart(now = Date.now()): number {
  const had = officeSettings().outcomesSince;
  if (typeof had === 'number' && Number.isFinite(had)) return had;
  updateOfficeSettings({ outcomesSince: now });
  return now;
}

/** The stamp, or undefined where the office's settings aren't open (unit tests): every closed PR counts then. */
export const outcomesSince = (): number | undefined => {
  const t = officeSettings().outcomesSince;
  return typeof t === 'number' && Number.isFinite(t) ? t : undefined;
};
