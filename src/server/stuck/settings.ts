// Stuck detection's settings, kept with the office's own (office-settings.json, connections/store.ts):
// on unless an admin turns it off, and its thresholds in hours. Only an admin changes them; each change
// is audited as settings.change, with what it was and what it became.

import { cleanStuckSettings, STUCK_HOURS_KEYS, STUCK_HOURS_LABEL, type StuckSettings } from '../../shared/stuck.js';
import { audit, human } from '../audit/index.js';
import { officeSettings, updateOfficeSettings } from '../connections/store.js';

export const stuckSettings = (): StuckSettings => cleanStuckSettings(officeSettings().stuckDetection);

/** Changes what `patch` says ({on?, prHours?, decisionHours?, failingHours?, circlesHours?}); the settings, or why not. */
export function setStuckSettings(patch: Record<string, unknown>, who: { name: string; accountId?: string }, now = Date.now()): StuckSettings | string {
  const before = stuckSettings();
  const next: StuckSettings = { ...before };
  const changed: string[] = [];
  if (patch.on !== undefined) {
    if (typeof patch.on !== 'boolean') return 'on is true or false';
    if (patch.on !== before.on) ((next.on = patch.on), changed.push('on'));
  }
  for (const k of STUCK_HOURS_KEYS) {
    const v = patch[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > 720) return `${k} is a number of hours from 1 to 720`;
    const h = Math.round(v);
    if (h !== before[k]) ((next[k] = h), changed.push(k));
  }
  if (!changed.length) return before;
  next.by = who.name;
  next.at = now;
  updateOfficeSettings({ stuckDetection: next });
  for (const k of changed) {
    const label = k === 'on' ? 'Stuck detection' : `Stuck detection: ${STUCK_HOURS_LABEL[k as (typeof STUCK_HOURS_KEYS)[number]]}`;
    const b = before[k as keyof StuckSettings];
    const a = next[k as keyof StuckSettings];
    audit.record({
      actor: human(who.name, who.accountId),
      action: 'settings.change',
      target: { kind: 'setting', id: `stuck.${k}`, label },
      summary: k === 'on' ? `${a ? 'Turned on' : 'Turned off'} stuck detection (${who.name})` : `Set "${label}" to ${a} h (was ${b} h) (${who.name})`,
      details: { before: { [k]: b }, after: { [k]: a } },
      severity: 'notice',
    });
  }
  return next;
}
