// EvidenceRef and the trace envelope (spec section 7, gap map 4.2): how a claim, a result or a trace event
// points at the record it came from, by source system, id and version rather than a mutable URL, and the
// one normalized shape every existing record (audit, chatter, analysis runs, the budget ledger,
// incidents) is read into. Pure: types, validation and locator parsing, no Node imports.

import { safeRelPath } from '../deliverables.js';
import { ID_FIELDS, ID_VALIDATORS, TENANT_ID, type IdField, type IdSource, type TenantId } from './ids.js';

export const EVIDENCE_KINDS = ['artifact', 'test_report', 'trace_event', 'requirement_revision', 'review_finding', 'incident', 'benchmark_result', 'human_assessment', 'transcript'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const SOURCE_SYSTEMS = ['audit', 'chatter', 'delivery', 'firm', 'incidents', 'analysis', 'budget', 'git', 'github', 'import', 'eval'] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

export const AVAILABILITY = ['available', 'expired', 'redacted', 'missing'] as const;
export type Availability = (typeof AVAILABILITY)[number];

/** How long the source keeps what's cited: a ref past it resolves as `expired`, never as empty. */
export const RETENTION_CLASSES = ['audit-90d', 'ledger-30d', 'chatter-capped', 'permanent', 'transcript-external'] as const;
export type RetentionClass = (typeof RETENTION_CLASSES)[number];

export interface EvidenceRef {
  id: string;
  tenantId: TenantId;
  projectId?: string;
  kind: EvidenceKind;
  sourceSystem: SourceSystem;
  /** The record's id in its source: an audit event id, `INC-12`, `<floor>:<workerId>`, a ledger row key. */
  sourceId: string;
  /** Which version of it: an audit hash, an incident's updatedAt, a commit sha, a ledger day. */
  sourceVersion?: string;
  /** sha256 of the record as it was read. */
  contentHash?: string;
  capturedAt: number;
  /** Logical, never a client-supplied path: `audit:<floor>:<eventId>`, `git:<sha>:<relpath>`, `delivery:<floor>:<acc_ id>` (see parseLocator). */
  locator: string;
  excerpt?: { start?: number; end?: number };
  availability: Availability;
  retentionClass: RetentionClass;
}

/** The events spec section 7 asks a trace to carry. */
export const SPEC_EVENT_TYPES = [
  'execution.started',
  'execution.completed',
  'execution.aborted',
  'task.assigned',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'mutation_lock.acquired',
  'mutation_lock.released',
  'handoff.requested',
  'handoff.completed',
  'escalation.raised',
  'escalation.resolved',
  'human.intervention',
  'artifact.submitted',
  'check.completed',
  'review.completed',
  'knowledge.retrieved',
  'budget.updated',
] as const;
export type SpecEventType = (typeof SPEC_EVENT_TYPES)[number];
/** The spec's events, plus an incident recorded and anything else a source said (kept, with its own action name). */
export type TraceEventType = SpecEventType | 'incident.recorded' | 'other';
const TRACE_EVENT_TYPES: readonly string[] = [...SPEC_EVENT_TYPES, 'incident.recorded', 'other'];

/** An id the source didn't carry and no adapter could infer: shown as unknown, never as an empty or zero value. */
export interface IdGap {
  field: IdField;
  reason: string;
}

export interface TraceEvent {
  eventId: string;
  schemaVersion: 1;
  occurredAt: number;
  ingestedAt: number;
  tenantId: TenantId;
  /** Missing only for office-wide events with no project; then `gaps` says so. */
  projectId?: string;
  /** The floor it happened on (the routing key), kept beside the project id. */
  floorId?: string;
  executionId?: string;
  taskId?: string;
  agentInstanceId?: string;
  roleId?: string;
  sessionId?: string;
  spanId?: string;
  parentSpanId?: string;
  /** Order within its source, when the source has one (an audit file's line order). */
  sequence?: number;
  eventType: TraceEventType;
  /** The source's own name for it: the audit action, the chatter kind… */
  action: string;
  /** One line for people. */
  summary: string;
  payload: Record<string, unknown>;
  source: EvidenceRef;
  /** How each id that is present was obtained. */
  idSource: Partial<Record<IdField, IdSource>>;
  /** The ids that are unknown for this event, and why. */
  gaps: IdGap[];
  redaction: 'none' | 'redacted';
}

/** How a source fared for one trace: its retention, how many events it gave, and what it can't say. */
export interface TraceCoverage {
  source: SourceSystem;
  status: 'available' | 'empty' | 'missing';
  events: number;
  retentionClass: RetentionClass;
  note?: string;
}

/** GET /api/evidence/trace's answer. */
export interface TraceView {
  schemaVersion: 1;
  tenantId: TenantId;
  projectId: string;
  floorId: string;
  since?: number;
  generatedAt: number;
  /** Oldest first. */
  events: TraceEvent[];
  /** More matched than were sent: the newest `events.length` are. */
  truncated: boolean;
  coverage: TraceCoverage[];
  /** Spec events no source of this office records at all: always a gap, never "none happened". */
  absent: SpecEventType[];
}

/** A cost or count as a source knows it: a value only when it was measured or estimated, else unknown. */
export type Measured = { status: 'observed' | 'estimated'; value: number } | { status: 'unknown'; reason: string };

// ---- Locators ------------------------------------------------------------------------------------

export type Locator =
  | { scheme: 'audit'; floor: string; eventId: string }
  | { scheme: 'chatter'; floor: string; messageId: string }
  | { scheme: 'analysis'; runId: string }
  | { scheme: 'budget'; floor: string; rowKey: string }
  | { scheme: 'incidents'; incidentId: string }
  | { scheme: 'delivery'; floor: string; recordId: string }
  | { scheme: 'git'; sha: string; path: string };

const SEG = /^[A-Za-z0-9_.@#|+-]{1,200}$/;
const FLOOR = /^[A-Za-z0-9_-]{1,64}$/;
const SHA = /^[a-f0-9]{7,64}$/;

/** A locator read back, or undefined when it isn't one: no `..`, no absolute or backslashed paths, no stray parts. */
export function parseLocator(s: unknown): Locator | undefined {
  if (typeof s !== 'string' || s.length > 1200 || /[\0-\x1f\\]/.test(s)) return undefined;
  const [scheme, ...rest] = s.split(':');
  const ok = (v: string | undefined) => v !== undefined && SEG.test(v) && v !== '.' && v !== '..';
  switch (scheme) {
    case 'audit':
    case 'chatter':
    case 'budget': {
      if (rest.length !== 2 || !FLOOR.test(rest[0]) || !ok(rest[1])) return undefined;
      if (scheme === 'audit') return { scheme, floor: rest[0], eventId: rest[1] };
      if (scheme === 'chatter') return { scheme, floor: rest[0], messageId: rest[1] };
      return { scheme, floor: rest[0], rowKey: rest[1] };
    }
    case 'analysis':
      return rest.length === 2 && FLOOR.test(rest[0]) && ok(rest[1]) ? { scheme, runId: `${rest[0]}:${rest[1]}` } : undefined;
    case 'incidents':
      return rest.length === 1 && ok(rest[0]) ? { scheme, incidentId: rest[0] } : undefined;
    case 'delivery':
      return rest.length === 2 && FLOOR.test(rest[0]) && ok(rest[1]) ? { scheme, floor: rest[0], recordId: rest[1] } : undefined;
    case 'git': {
      const p = rest.slice(1).join(':');
      return rest.length >= 2 && SHA.test(rest[0]) && safeRelPath(p) ? { scheme, sha: rest[0], path: p } : undefined;
    }
    default:
      return undefined;
  }
}

/** A locator as text (the inverse of parseLocator for a valid one). */
export function formatLocator(l: Locator): string {
  switch (l.scheme) {
    case 'audit':
      return `audit:${l.floor}:${l.eventId}`;
    case 'chatter':
      return `chatter:${l.floor}:${l.messageId}`;
    case 'analysis':
      return `analysis:${l.runId}`;
    case 'budget':
      return `budget:${l.floor}:${l.rowKey}`;
    case 'incidents':
      return `incidents:${l.incidentId}`;
    case 'delivery':
      return `delivery:${l.floor}:${l.recordId}`;
    case 'git':
      return `git:${l.sha}:${l.path}`;
  }
}

// ---- Validation ----------------------------------------------------------------------------------

const has = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const time = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** What's wrong with an EvidenceRef: an empty list when it's a valid one. */
export function validateEvidenceRef(v: unknown): string[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return ['not an object'];
  const r = v as Record<string, unknown>;
  const errs: string[] = [];
  if (!text(r.id, 120)) errs.push('id');
  if (r.tenantId !== TENANT_ID) errs.push('tenantId');
  if (r.projectId !== undefined && !ID_VALIDATORS.projectId(r.projectId)) errs.push('projectId');
  if (!has(EVIDENCE_KINDS, r.kind)) errs.push('kind');
  if (!has(SOURCE_SYSTEMS, r.sourceSystem)) errs.push('sourceSystem');
  if (!text(r.sourceId, 300)) errs.push('sourceId');
  if (r.sourceVersion !== undefined && !text(r.sourceVersion, 200)) errs.push('sourceVersion');
  if (r.contentHash !== undefined && !(typeof r.contentHash === 'string' && /^[a-f0-9]{64}$/.test(r.contentHash))) errs.push('contentHash');
  if (!time(r.capturedAt)) errs.push('capturedAt');
  if (!parseLocator(r.locator)) errs.push('locator');
  if (r.excerpt !== undefined) {
    const e = r.excerpt as Record<string, unknown> | null;
    if (!e || typeof e !== 'object' || (e.start !== undefined && !time(e.start)) || (e.end !== undefined && !time(e.end)) || (time(e.start) && time(e.end) && (e.end as number) < (e.start as number))) errs.push('excerpt');
  }
  if (!has(AVAILABILITY, r.availability)) errs.push('availability');
  if (!has(RETENTION_CLASSES, r.retentionClass)) errs.push('retentionClass');
  return errs;
}

export const isEvidenceRef = (v: unknown): v is EvidenceRef => validateEvidenceRef(v).length === 0;

/** What's wrong with a TraceEvent: an empty list when it's a valid one. An id that's present must be valid, and none may be both present and a gap. */
export function validateTraceEvent(v: unknown): string[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return ['not an object'];
  const e = v as Record<string, unknown>;
  const errs: string[] = [];
  if (!text(e.eventId, 160)) errs.push('eventId');
  if (e.schemaVersion !== 1) errs.push('schemaVersion');
  if (!time(e.occurredAt)) errs.push('occurredAt');
  if (!time(e.ingestedAt)) errs.push('ingestedAt');
  if (e.tenantId !== TENANT_ID) errs.push('tenantId');
  if (!has(TRACE_EVENT_TYPES, e.eventType)) errs.push('eventType');
  if (!text(e.action, 120)) errs.push('action');
  if (typeof e.summary !== 'string') errs.push('summary');
  if (!e.payload || typeof e.payload !== 'object' || Array.isArray(e.payload)) errs.push('payload');
  for (const err of validateEvidenceRef(e.source)) errs.push(`source.${err}`);
  if (e.redaction !== 'none' && e.redaction !== 'redacted') errs.push('redaction');
  const gaps = Array.isArray(e.gaps) ? (e.gaps as IdGap[]) : undefined;
  if (!gaps || gaps.some((g) => !g || !has(ID_FIELDS, g.field) || !text(g.reason, 300))) errs.push('gaps');
  const idSource = (e.idSource && typeof e.idSource === 'object' ? e.idSource : undefined) as Record<string, unknown> | undefined;
  if (!idSource) errs.push('idSource');
  for (const f of ID_FIELDS) {
    const present = e[f] !== undefined;
    if (present && !ID_VALIDATORS[f](e[f])) errs.push(f);
    if (present && idSource && idSource[f] !== 'recorded' && idSource[f] !== 'inferred') errs.push(`idSource.${f}`);
    if (present && gaps?.some((g) => g.field === f)) errs.push(`${f}: both present and a gap`);
  }
  if (e.projectId === undefined && !gaps?.some((g) => g.field === 'projectId')) errs.push('projectId: missing without a gap');
  return errs;
}

export const isTraceEvent = (v: unknown): v is TraceEvent => validateTraceEvent(v).length === 0;
