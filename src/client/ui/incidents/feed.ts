// The open sev1 and sev2 incidents, for Needs you (the Command Center's strip and the Team phone): fetched
// from GET /api/incidents on first use, again whenever the audit log says an incident changed
// ({t:'audit.new'} with an incident.* action), and every few minutes in case a message was missed.

import { briefOf, type IncidentBrief, type IncidentList } from '../../../shared/incidents';
import type { ServerMsg } from '../../../shared/protocol';

const POLL_MS = 5 * 60_000;

let briefs: IncidentBrief[] = [];
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();

async function refresh() {
  try {
    const res = await fetch('/api/incidents?floor=all&status=open&severity=sev1,sev2', { credentials: 'same-origin' });
    if (!res.ok) return;
    const list = (await res.json()) as IncidentList;
    const next = list.incidents.map(briefOf);
    if (JSON.stringify(next) === JSON.stringify(briefs)) return;
    briefs = next;
    for (const fn of subs) fn();
  } catch {
    // Next time.
  }
}

/** Looks again soon (several changes at once are one look). */
function soon() {
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), 300);
}

function start() {
  if (started || typeof fetch !== 'function') return;
  started = true;
  void refresh();
  setInterval(() => void refresh(), POLL_MS);
}

/** The open sev1 and sev2 incidents as last fetched (the first call starts fetching). */
export function incidentBriefs(): IncidentBrief[] {
  start();
  return briefs;
}

export function onIncidentsChanged(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Every message from the office: an incident changed when the audit log says so. */
export function incidentFeedMessage(msg: ServerMsg) {
  if (started && msg.t === 'audit.new' && msg.event.action.startsWith('incident.')) soon();
}
