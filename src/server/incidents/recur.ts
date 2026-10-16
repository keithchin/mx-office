// An incident a rule fires into again (index.ts raise): what changed, as a small delta the store appends
// as a 'recur' line (store.ts) and folds onto the incident when it reads the file, instead of a full copy
// of the incident with its whole timeline on every recurrence (INC-12, the server-stall incident, had 246
// copies of a timeline up to 200 entries long: 6.2 MB). And the timeline's own cap: every entry a person
// or the analysis wrote is kept (up to TIMELINE_MAX), but of a rule's "seen again" lines only the first
// RECUR_HEAD and the last RECUR_TAIL: the incident's `occurrences` says how many there were.

import type { Incident, IncidentImpact, IncidentSeverity, IncidentWorker, TimelineEntry } from '../../shared/incidents.js';

export const TIMELINE_MAX = 200;
export const RECUR_HEAD = 5;
export const RECUR_TAIL = 20;
/** At most this many linked audit events on an incident. */
export const AUDIT_IDS_MAX = 200;

/** What a recurrence changes. Everything else stays as the incident had it. */
export interface RecurDelta {
  occurrences: number;
  lastSeenAt: number;
  updatedAt: number;
  severity?: IncidentSeverity;
  /** Workers not on it before. */
  workers?: IncidentWorker[];
  /** Audit events not linked before. */
  auditIds?: string[];
  /** The impact as it became, when it changed. */
  impact?: IncidentImpact;
  /** The timeline entries it adds. */
  timeline: TimelineEntry[];
}

/** The timeline kept: everything but a rule's recurrences, the first and last few of those, and no more than TIMELINE_MAX in all. */
export function trimTimeline(t: readonly TimelineEntry[]): TimelineEntry[] {
  const recur = t.reduce((n, e) => n + (e.kind === 'recurrence' ? 1 : 0), 0);
  let out = t as TimelineEntry[];
  if (recur > RECUR_HEAD + RECUR_TAIL) {
    let seen = 0;
    out = t.filter((e) => {
      if (e.kind !== 'recurrence') return true;
      const n = seen++;
      return n < RECUR_HEAD || n >= recur - RECUR_TAIL;
    });
  }
  return out.length > TIMELINE_MAX ? out.slice(-TIMELINE_MAX) : out === t ? [...t] : out;
}

/** The incident after a recurrence: the same fold whether it's worked out as it happens or read back from the file. */
export function foldRecur(i: Incident, d: RecurDelta): Incident {
  const out: Incident = { ...i, occurrences: d.occurrences, lastSeenAt: d.lastSeenAt, updatedAt: d.updatedAt };
  if (d.severity) out.severity = d.severity;
  if (d.workers?.length) out.workers = [...i.workers, ...d.workers];
  if (d.auditIds?.length) out.auditIds = [...new Set([...i.auditIds, ...d.auditIds])].slice(0, AUDIT_IDS_MAX);
  if (d.impact) out.impact = d.impact;
  out.timeline = trimTimeline([...i.timeline, ...d.timeline]);
  return out;
}
