// Building EvidenceRefs and trace events for the read-only adapters (adapters.ts): the ref's id and
// content hash, and the envelope with every id either present (with how it was obtained) or listed as a
// gap with a reason. Never a blank or zero standing in for an id nobody recorded.

import { createHash } from 'node:crypto';
import { ID_FIELDS, TENANT_ID, type IdField, type IdSource } from '../../shared/evidence/ids.js';
import type { EvidenceKind, EvidenceRef, IdGap, RetentionClass, SourceSystem, TraceEvent, TraceEventType } from '../../shared/evidence/types.js';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface RefInput {
  kind: EvidenceKind;
  sourceSystem: SourceSystem;
  sourceId: string;
  sourceVersion?: string;
  /** The record as read: hashed into contentHash unless `contentHash` is given (an audit line's own hash). */
  record?: unknown;
  contentHash?: string;
  locator: string;
  retentionClass: RetentionClass;
  projectId?: string;
  capturedAt: number;
}

/** An EvidenceRef to a record that is there now (availability `available`). */
export function evidenceRef(r: RefInput): EvidenceRef {
  const contentHash = r.contentHash ?? (r.record === undefined ? undefined : sha256(JSON.stringify(r.record)));
  return {
    id: `ev_${sha256(`${r.sourceSystem}|${r.sourceId}|${r.sourceVersion ?? ''}`).slice(0, 24)}`,
    tenantId: TENANT_ID,
    ...(r.projectId ? { projectId: r.projectId } : {}),
    kind: r.kind,
    sourceSystem: r.sourceSystem,
    sourceId: r.sourceId,
    ...(r.sourceVersion ? { sourceVersion: r.sourceVersion } : {}),
    ...(contentHash ? { contentHash } : {}),
    capturedAt: r.capturedAt,
    locator: r.locator,
    availability: 'available',
    retentionClass: r.retentionClass,
  };
}

/** One id as an adapter found it: a value and how, or why it's unknown. */
export type Found = { value: string; source: IdSource } | { reason: string };
export const recorded = (value: string | undefined, reason: string): Found => (value ? { value, source: 'recorded' } : { reason });
export const inferred = (value: string | undefined, reason: string): Found => (value ? { value, source: 'inferred' } : { reason });
/** The first of `options` that has a value, else the last one's reason. */
export const firstFound = (...options: Found[]): Found => options.find((o) => 'value' in o) ?? options[options.length - 1];

export interface EnvelopeInput {
  eventId: string;
  occurredAt: number;
  ingestedAt: number;
  floorId?: string;
  ids: Record<IdField, Found>;
  spanId?: string;
  parentSpanId?: string;
  sequence?: number;
  eventType: TraceEventType;
  action: string;
  summary: string;
  payload: Record<string, unknown>;
  source: EvidenceRef;
  redacted: boolean;
}

/** The trace envelope: each id present with its source, or in `gaps` with its reason. */
export function envelope(e: EnvelopeInput): TraceEvent {
  const out: TraceEvent = {
    eventId: e.eventId,
    schemaVersion: 1,
    occurredAt: e.occurredAt,
    ingestedAt: e.ingestedAt,
    tenantId: TENANT_ID,
    ...(e.floorId ? { floorId: e.floorId } : {}),
    ...(e.spanId ? { spanId: e.spanId } : {}),
    ...(e.parentSpanId ? { parentSpanId: e.parentSpanId } : {}),
    ...(e.sequence !== undefined ? { sequence: e.sequence } : {}),
    eventType: e.eventType,
    action: e.action,
    summary: e.summary,
    payload: e.payload,
    source: e.source,
    idSource: {},
    gaps: [],
    redaction: e.redacted ? 'redacted' : 'none',
  };
  const gaps: IdGap[] = [];
  for (const f of ID_FIELDS) {
    const found = e.ids[f];
    if ('value' in found) {
      out[f] = found.value;
      out.idSource[f] = found.source;
    } else gaps.push({ field: f, reason: found.reason });
  }
  out.gaps = gaps;
  return out;
}

/** Whether redaction left its mark anywhere in `v`. */
export const wasRedacted = (v: unknown) => JSON.stringify(v ?? null).includes('[redacted]');
