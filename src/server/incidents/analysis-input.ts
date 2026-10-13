// What Mx Office's incident analysis (analysis.ts) is given: the incident's own record (title, severity,
// summary, the rule that detected it, its impact, timeline, agents, floors, actions and their links), the
// audit events it links, a bounded set of audit events from its floors around when it happened (at most
// NEARBY_MAX, within its window ± MARGIN_MS), and the person's note. Everything is redacted (the audit
// log's redactor: token-shaped strings and secret-named fields) and the whole input capped at INPUT_MAX
// characters, the nearby events dropped first. Nothing else is read: no files, no repository.

import { OFFICE_FLOOR, type AuditEvent } from '../../shared/audit.js';
import { RULE_META, incidentRef, type Incident } from '../../shared/incidents.js';
import { auditLog, redactValue } from '../audit/index.js';
import { fileKey } from '../audit/log.js';
import { redact } from '../judge/pure.js';

/** Audit events from around the incident, at most. */
export const NEARBY_MAX = 40;
/** How far before it was detected and after it was last seen they're looked for. */
export const MARGIN_MS = 30 * 60_000;
/** The input's size at most, in characters. */
export const INPUT_MAX = 24_000;
const TIMELINE_MAX = 40;

export interface EventLine {
  id: string;
  at: string;
  floor?: string;
  actor: string;
  action: string;
  summary: string;
  target?: string;
  details?: unknown;
  ids?: unknown;
}

export interface AnalysisFacts {
  incident: {
    ref: string;
    title: string;
    severity: string;
    status: string;
    detectedAt: string;
    lastSeenAt: string;
    resolvedAt?: string;
    detectedBy: string;
    rule?: { id: string; label: string; what: string };
    occurrences: number;
    summary: string;
    floors: string[];
    impact: Incident['impact'];
    /** What a person already wrote as the cause, if anything. */
    personRootCause?: string;
    agents: string[];
    actions: { text: string; status: string; link?: string }[];
    timeline: { at: string; by: string; kind: string; text: string }[];
  };
  linked: EventLine[];
  nearby: EventLine[];
  note?: string;
}

const iso = (t: number) => new Date(t).toISOString();

const line = (e: AuditEvent): EventLine => ({
  id: e.id,
  at: iso(e.at),
  ...(e.floor ? { floor: e.floor } : {}),
  actor: `${e.actor.name} (${e.actor.kind})`,
  action: e.action,
  summary: e.summary,
  ...(e.target ? { target: [e.target.kind, e.target.label ?? e.target.id].filter(Boolean).join(': ') } : {}),
  ...(e.details ? { details: e.details } : {}),
  ...(e.ids ? { ids: e.ids } : {}),
});

/** The audit events of the incident's floors (or the office's), oldest first. */
export function floorEvents(i: Incident): AuditEvent[] {
  const log = auditLog();
  if (!log) return [];
  const keys = new Set([...(i.floors.length ? i.floors : [OFFICE_FLOOR]), OFFICE_FLOOR].map(fileKey));
  return [...keys].flatMap((k) => [...log.events(k)]).sort((a, b) => a.at - b.at);
}

/** The facts from the incident and `events` (floorEvents): its linked events, and the nearby ones nearest its detection. */
export function gatherFacts(i: Incident, events: readonly AuditEvent[], note?: string, floorName: (id: string) => string = (id) => id): AnalysisFacts {
  const linkedIds = new Set(i.auditIds);
  const from = i.detectedAt - MARGIN_MS;
  const to = Math.max(i.lastSeenAt, i.detectedAt) + MARGIN_MS;
  // Its own incident.* events say nothing the record doesn't.
  const nearby = events
    .filter((e) => !linkedIds.has(e.id) && e.at >= from && e.at <= to && !(e.action.startsWith('incident.') && e.target?.id === i.id))
    .sort((a, b) => Math.abs(a.at - i.detectedAt) - Math.abs(b.at - i.detectedAt))
    .slice(0, NEARBY_MAX)
    .sort((a, b) => a.at - b.at);
  const rule = i.detectedBy.rule;
  return {
    incident: {
      ref: incidentRef(i),
      title: i.title,
      severity: i.severity,
      status: i.status,
      detectedAt: iso(i.detectedAt),
      lastSeenAt: iso(i.lastSeenAt),
      ...(i.resolvedAt ? { resolvedAt: iso(i.resolvedAt) } : {}),
      detectedBy: `${i.detectedBy.name} (${i.detectedBy.kind})`,
      ...(rule ? { rule: { id: rule, label: RULE_META[rule].label, what: RULE_META[rule].what } } : {}),
      occurrences: i.occurrences,
      summary: i.summary,
      floors: i.floors.map(floorName),
      impact: i.impact,
      ...(i.rootCause?.trim() && !i.analysis?.drafted.includes('rootCause') ? { personRootCause: i.rootCause } : {}),
      agents: i.workers.map((w) => w.name),
      actions: i.actions.map((a) => ({ text: a.text, status: a.status, ...(a.link ? { link: `${a.link.kind}: ${a.link.ref}` } : {}) })),
      timeline: i.timeline.slice(-TIMELINE_MAX).map((t) => ({ at: iso(t.at), by: t.by, kind: t.kind, text: t.text })),
    },
    linked: events.filter((e) => linkedIds.has(e.id)).slice(-NEARBY_MAX).map(line),
    nearby: nearby.map(line),
    ...(note?.trim() ? { note: note.trim().slice(0, 2000) } : {}),
  };
}

/** The facts with anything secret-looking taken out (the audit log's redactor). */
export const redactFacts = (f: AnalysisFacts): AnalysisFacts => redactValue(f) as AnalysisFacts;

/** The redacted facts as the call's input, at most INPUT_MAX characters: the nearby events go first, then the linked, then the timeline. */
export function analysisInput(facts: AnalysisFacts): { facts: AnalysisFacts; text: string } {
  const f = redactFacts(structuredClone(facts));
  const text = () => redact(JSON.stringify(f, null, 1));
  let out = text();
  while (out.length > INPUT_MAX && (f.nearby.length || f.linked.length || f.incident.timeline.length > 5)) {
    if (f.nearby.length) f.nearby = f.nearby.slice(Math.ceil(f.nearby.length / 4));
    else if (f.linked.length) f.linked = f.linked.slice(Math.ceil(f.linked.length / 4));
    else f.incident.timeline = f.incident.timeline.slice(-Math.floor(f.incident.timeline.length / 2));
    out = text();
  }
  return { facts: f, text: out.length > INPUT_MAX ? `${out.slice(0, INPUT_MAX)}\n…[cut]` : out };
}
