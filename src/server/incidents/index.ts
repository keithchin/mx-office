// The office's incidents (store.ts keeps them): made by a person (the Incidents sub-tab of the Audit log,
// POST /api/incidents) or by a detection rule (rules.ts, through raise), changed, noted and resolved
// here, every change in the audit log as incident.created, incident.updated or incident.resolved (whose
// {t:'audit.new'} is also what tells the pages to look again). Before office.ts installs a store, and in
// tests that don't, nothing is kept.

import { randomBytes } from 'node:crypto';
import { OFFICE_FLOOR, type AuditActor } from '../../shared/audit.js';
import { briefOf, incidentRef, needsAttention, type DetectedBy, type IncidentBrief, type Incident, type IncidentImpact, type IncidentRule, type IncidentSeverity, type IncidentWorker, type TimelineEntry } from '../../shared/incidents.js';
import { audit } from '../audit/index.js';
import type { IncidentPatch } from './edit.js';
import type { IncidentStore } from './store.js';

export { IncidentStore } from './store.js';

let current: IncidentStore | undefined;
let clock: () => number = Date.now;

export function useIncidents(store: IncidentStore | undefined, now: () => number = Date.now) {
  current = store;
  clock = now;
}
export const incidentStore = () => current;

const TIMELINE_MAX = 200;
const SEV_RANK: Record<IncidentSeverity, number> = { sev1: 0, sev2: 1, sev3: 2, 'near-miss': 3 };
const worse = (a: IncidentSeverity, b: IncidentSeverity) => (SEV_RANK[a] <= SEV_RANK[b] ? a : b);

const newId = () => `inc-${clock().toString(36)}${randomBytes(3).toString('hex')}`;
const entry = (by: string, text: string, kind: TimelineEntry['kind'], at = clock()): TimelineEntry => ({ at, by, text: text.slice(0, 1000), kind });
const pushTimeline = (i: Incident, e: TimelineEntry) => {
  i.timeline = [...i.timeline, e].slice(-TIMELINE_MAX);
};

function auditOf(i: Incident, actor: AuditActor, action: 'incident.created' | 'incident.updated' | 'incident.resolved', summary: string, details?: Record<string, unknown>) {
  audit.record({
    floor: i.floors[0] ?? OFFICE_FLOOR,
    actor,
    action,
    target: { kind: 'incident', id: i.id, label: `${incidentRef(i)} ${i.title}` },
    summary,
    details: { severity: i.severity, status: i.status, ...(i.floors.length > 1 ? { floors: i.floors } : {}), ...details },
    severity: action === 'incident.created' && (i.severity === 'sev1' || i.severity === 'sev2') ? 'warning' : 'notice',
  });
}

export interface NewIncident {
  title: string;
  severity: IncidentSeverity;
  summary?: string;
  floors?: string[];
  impact?: IncidentImpact;
  rootCause?: string;
  auditIds?: string[];
  workers?: IncidentWorker[];
  actions?: Incident['actions'];
  detectedAt?: number;
  detectedBy?: DetectedBy;
  dedupeKey?: string;
  retrospective?: boolean;
  status?: Incident['status'];
  timeline?: TimelineEntry[];
}

/** Makes an incident: by a person, an agent or a rule (detectedBy says which). */
export function createIncident(n: NewIncident, actor: AuditActor, op: 'create' | 'seed' = 'create'): Incident | undefined {
  const store = current;
  if (!store) return undefined;
  const now = clock();
  const detectedBy: DetectedBy = n.detectedBy ?? { kind: actor.kind === 'agent' ? 'agent' : 'person', name: actor.name, ...(actor.id ? { id: actor.id } : {}) };
  const i: Incident = {
    id: newId(),
    number: store.nextNumber(),
    title: n.title,
    severity: n.severity,
    status: n.status ?? 'open',
    detectedAt: n.detectedAt ?? now,
    detectedBy,
    floors: n.floors ?? [],
    summary: n.summary ?? '',
    impact: n.impact ?? {},
    timeline: n.timeline ?? [entry(detectedBy.name, n.retrospective ? 'Recorded retrospectively' : detectedBy.kind === 'rule' ? `Detected: ${n.summary ?? n.title}` : 'Opened', 'detected', n.detectedAt ?? now)],
    ...(n.rootCause ? { rootCause: n.rootCause } : {}),
    actions: n.actions ?? [],
    auditIds: n.auditIds ?? [],
    workers: n.workers ?? [],
    ...(n.dedupeKey ? { dedupeKey: n.dedupeKey } : {}),
    occurrences: 1,
    lastSeenAt: n.detectedAt ?? now,
    ...(n.retrospective ? { retrospective: true } : {}),
    createdAt: now,
    updatedAt: now,
    ...(n.status === 'resolved' ? { resolvedAt: now } : {}),
  };
  store.put(i, op, actor.name);
  auditOf(i, actor, 'incident.created', `${n.retrospective ? 'Recorded' : 'Opened'} ${incidentRef(i)} (${i.severity}): ${i.title}`, { detectedBy: detectedBy.kind, ...(detectedBy.rule ? { rule: detectedBy.rule } : {}), ...(i.auditIds.length ? { auditIds: i.auditIds.slice(0, 10) } : {}) });
  return i;
}

/** Changes an incident; undefined when there's no such incident (or nothing is kept). Notes what changed on its timeline. */
export function updateIncident(id: string, p: IncidentPatch, actor: AuditActor): Incident | undefined {
  const store = current;
  const was = store?.get(id);
  if (!store || !was) return undefined;
  const i: Incident = structuredClone(was);
  const changed: string[] = [];
  const set = <K extends keyof Incident>(k: K, v: Incident[K] | undefined, label = String(k)) => {
    if (v === undefined || JSON.stringify(i[k]) === JSON.stringify(v)) return;
    i[k] = v;
    changed.push(label);
  };
  set('title', p.title);
  set('summary', p.summary);
  set('impact', p.impact);
  set('rootCause', p.rootCause, 'root cause');
  set('floors', p.floors);
  set('actions', p.actions, 'corrective actions');
  set('workers', p.workers);
  set('detectedAt', p.detectedAt, 'detected at');
  if (p.linkAudit?.length || p.unlinkAudit?.length) {
    const next = [...new Set([...i.auditIds.filter((x) => !p.unlinkAudit?.includes(x)), ...(p.linkAudit ?? [])])].slice(0, 200);
    set('auditIds', next, 'linked events');
  }
  const by = actor.name;
  if (p.severity && p.severity !== i.severity) {
    pushTimeline(i, entry(by, `Severity ${i.severity} → ${p.severity}`, 'status'));
    i.severity = p.severity;
    changed.push('severity');
  }
  let resolved = false;
  if (p.status && p.status !== i.status) {
    pushTimeline(i, entry(by, `Status ${i.status} → ${p.status}`, 'status'));
    resolved = p.status === 'resolved';
    i.status = p.status;
    i.resolvedAt = resolved ? clock() : undefined;
    changed.push('status');
  }
  const quiet = changed.filter((c) => c !== 'severity' && c !== 'status');
  if (quiet.length) pushTimeline(i, entry(by, `Changed ${quiet.join(', ')}`, 'change'));
  if (!changed.length) return was;
  i.updatedAt = clock();
  store.put(i, resolved ? 'resolve' : 'update', by);
  if (resolved) auditOf(i, actor, 'incident.resolved', `Resolved ${incidentRef(i)}: ${i.title}${i.rootCause ? ` — cause: ${i.rootCause}` : ''}`, { rootCause: i.rootCause ? { length: i.rootCause.length } : undefined });
  else auditOf(i, actor, 'incident.updated', `Changed ${changed.join(', ')} of ${incidentRef(i)}: ${i.title}`, { changed });
  return i;
}

/** A note on an incident's timeline. */
export function addNote(id: string, text: string, actor: AuditActor): Incident | undefined {
  const store = current;
  const was = store?.get(id);
  const clean = text.trim().slice(0, 1000);
  if (!store || !was || !clean) return undefined;
  const i: Incident = structuredClone(was);
  pushTimeline(i, entry(actor.name, clean, 'note'));
  i.updatedAt = clock();
  store.put(i, 'update', actor.name);
  auditOf(i, actor, 'incident.updated', `Added a note to ${incidentRef(i)}: ${i.title}`, { changed: ['timeline'], note: { length: clean.length } });
  return i;
}

// ---- What the rules raise --------------------------------------------------------------------------

export interface Detection {
  rule: IncidentRule;
  /** Its floor's id, or none for the office as a whole. */
  floor?: string;
  severity: IncidentSeverity;
  title: string;
  summary: string;
  /** The line it adds to the timeline when it fires again into an open incident. */
  again?: string;
  impact?: IncidentImpact;
  workers?: IncidentWorker[];
  auditIds?: string[];
  at?: number;
}

const RULE_ACTOR: AuditActor = { kind: 'office', name: 'Incident rules' };

/**
 * A rule fired: a new incident, or, when the same rule already has one open on the same floor that it
 * fired into within the dedupe window, that one again (counted, its workers and events added, its
 * severity raised if this is worse). Nothing when the rule is switched off.
 */
export function raise(d: Detection): Incident | undefined {
  const store = current;
  if (!store) return undefined;
  const settings = store.settings();
  if (!settings.rules[d.rule].on) return undefined;
  const now = d.at ?? clock();
  const key = `${d.rule}:${d.floor ?? OFFICE_FLOOR}`;
  const open = store.list().find((i) => i.dedupeKey === key && i.status !== 'resolved' && now - i.lastSeenAt < settings.dedupeHours * 3_600_000);
  if (!open) {
    return createIncident(
      { title: d.title, severity: d.severity, summary: d.summary, floors: d.floor ? [d.floor] : [], impact: d.impact, workers: d.workers, auditIds: d.auditIds, detectedAt: now, dedupeKey: key, detectedBy: { kind: 'rule', name: 'Incident rules', rule: d.rule } },
      RULE_ACTOR,
    );
  }
  const i: Incident = structuredClone(open);
  i.occurrences++;
  i.lastSeenAt = now;
  i.updatedAt = clock();
  const seen = new Set(i.workers.map((w) => w.id ?? w.name));
  for (const w of d.workers ?? []) if (!seen.has(w.id ?? w.name)) i.workers.push(w);
  i.auditIds = [...new Set([...i.auditIds, ...(d.auditIds ?? [])])].slice(0, 200);
  if (d.impact?.spendUsd !== undefined) i.impact = { ...i.impact, spendUsd: Math.max(i.impact.spendUsd ?? 0, d.impact.spendUsd) };
  if (i.workers.length) i.impact = { ...i.impact, agents: Math.max(i.impact.agents ?? 0, i.workers.length) };
  const raised = worse(d.severity, i.severity) !== i.severity;
  if (raised) {
    pushTimeline(i, entry('Incident rules', `Severity ${i.severity} → ${d.severity}`, 'status', now));
    i.severity = d.severity;
  }
  pushTimeline(i, entry('Incident rules', d.again ?? `Seen again: ${d.summary}`, 'recurrence', now));
  store.put(i, 'update', RULE_ACTOR.name);
  auditOf(i, RULE_ACTOR, 'incident.updated', `${incidentRef(i)} seen again (${i.occurrences}×): ${d.summary}`, { changed: raised ? ['occurrences', 'severity'] : ['occurrences'], rule: d.rule });
  return i;
}

/** The incidents Needs you lists (open sev1 and sev2), for the server's own Needs you (notify-teams/gather.ts). */
export function attentionBriefs(): IncidentBrief[] {
  return (current?.list() ?? []).filter(needsAttention).map(briefOf);
}
