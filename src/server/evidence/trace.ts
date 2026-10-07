// The normalized trace view (gap map 4.2): one floor's audit events, chatter, analysis runs, budget
// ledger rows and incidents read through the adapters into trace events, built on demand and stored
// nowhere. Reading never writes: the sources are read from the office's data dir as they are on disk.
// What the office doesn't record at all is listed, so a missing event reads as a gap, not as "none".

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { RunRecord } from '../../shared/analysis.js';
import type { AuditEvent } from '../../shared/audit.js';
import type { SpendRow } from '../../shared/budget/types.js';
import type { ChatterMessage } from '../../shared/chatter.js';
import { TENANT_ID } from '../../shared/evidence/ids.js';
import { SPEC_EVENT_TYPES, type RetentionClass, type SourceSystem, type SpecEventType, type TraceCoverage, type TraceEvent, type TraceView } from '../../shared/evidence/types.js';
import type { Incident } from '../../shared/incidents.js';
import { RunStore } from '../analysis/store.js';
import { AuditLog, fileKey } from '../audit/log.js';
import { ChatterFile } from '../chatter/store.js';
import { IncidentStore } from '../incidents/store.js';
import { fromAudit, fromChatter, fromIncident, fromRun, fromSpendRow, type AdapterCtx } from './adapters.js';

/** Where each source's records come from; undefined means the source couldn't be read at all. */
export interface TraceSources {
  audit(): readonly AuditEvent[] | undefined;
  chatter(): readonly ChatterMessage[] | undefined;
  runs(): readonly RunRecord[] | undefined;
  spend(): readonly SpendRow[] | undefined;
  incidents(): readonly Incident[] | undefined;
}

const attempt = <T>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

/** The office's own files for one floor, read as they are (the audit log's live instance is used when it's this office's). */
export function diskSources(dataDir: string, floorId: string, live?: AuditLog): TraceSources {
  return {
    audit: () => attempt(() => (live ?? new AuditLog(path.join(dataDir, 'audit'))).events(fileKey(floorId))),
    chatter: () => attempt(() => new ChatterFile(dataDir, floorId).messages()),
    runs: () => attempt(() => new RunStore(dataDir).all().filter((r) => r.floor === floorId)),
    spend: () => {
      const raw = attempt(() => readFileSync(path.join(dataDir, 'budget', `${floorId}.json`), 'utf8'));
      if (raw === undefined) return [];
      const rows = attempt(() => (JSON.parse(raw) as { ledger?: { rows?: SpendRow[] } }).ledger?.rows);
      return Array.isArray(rows) ? rows : undefined;
    },
    incidents: () => attempt(() => new IncidentStore(path.join(dataDir, 'incidents')).list().filter((i) => i.floors.includes(floorId))),
  };
}

const RETENTION: Record<'audit' | 'chatter' | 'analysis' | 'budget' | 'incidents', { retention: RetentionClass; note: string }> = {
  audit: { retention: 'audit-90d', note: 'kept 90 days or the newest 50k events; older ones are archived' },
  chatter: { retention: 'chatter-capped', note: 'a derived view, capped at 1000 messages per floor' },
  analysis: { retention: 'permanent', note: 'one record per worker task; cost is an estimate from the office price table' },
  budget: { retention: 'ledger-30d', note: 'detailed rows kept 30 days, at day precision' },
  incidents: { retention: 'permanent', note: 'hash-chained, one snapshot per change' },
};

/**
 * Spec events nothing in the office records durably today (gap map section 2): a trace never shows
 * "none happened" for these, only that they're not observed.
 */
export const ABSENT_EVENTS: readonly SpecEventType[] = ['tool.started', 'tool.completed', 'tool.failed', 'mutation_lock.acquired', 'mutation_lock.released', 'handoff.requested', 'check.completed', 'knowledge.retrieved'];

export interface TraceRequest {
  floorId: string;
  projectId: string;
  repo?: string;
  since?: number;
  /** At most this many events (the newest); default and ceiling 2000. */
  limit?: number;
  now?: number;
}

export const TRACE_MAX = 2000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The trace view of one floor since `since`, oldest first. */
export function buildTrace(req: TraceRequest, sources: TraceSources): TraceView {
  const now = req.now ?? Date.now();
  const c: AdapterCtx = { floorId: req.floorId, repo: req.repo, projectId: req.projectId, now };
  const coverage: TraceCoverage[] = [];
  const all: TraceEvent[] = [];
  const take = <T>(source: keyof typeof RETENTION, system: SourceSystem, list: readonly T[] | undefined, map: (x: T, i: number) => TraceEvent | TraceEvent[]) => {
    const r = RETENTION[source];
    if (list === undefined) {
      coverage.push({ source: system, status: 'missing', events: 0, retentionClass: r.retention, note: `couldn't be read; ${r.note}` });
      return;
    }
    let n = 0;
    list.forEach((x, i) => {
      for (const e of ([] as TraceEvent[]).concat(map(x, i))) {
        if (req.since !== undefined && e.occurredAt < req.since) continue;
        all.push(e);
        n++;
      }
    });
    coverage.push({ source: system, status: n ? 'available' : 'empty', events: n, retentionClass: r.retention, note: r.note });
  };
  take('audit', 'audit', sources.audit(), (e, i) => fromAudit(e, c, i));
  take('chatter', 'chatter', sources.chatter(), (m) => fromChatter(m, c));
  take('analysis', 'analysis', sources.runs(), (r) => fromRun(r, c));
  take('budget', 'budget', sources.spend()?.filter((r) => DAY_RE.test(r.day)), (r) => fromSpendRow(r, c));
  take('incidents', 'incidents', sources.incidents(), (i) => fromIncident(i, c));
  all.sort((a, b) => a.occurredAt - b.occurredAt || (a.sequence ?? 0) - (b.sequence ?? 0));
  const limit = Math.max(1, Math.min(TRACE_MAX, Math.floor(req.limit ?? TRACE_MAX)));
  const events = all.length > limit ? all.slice(-limit) : all;
  return {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    projectId: req.projectId,
    floorId: req.floorId,
    ...(req.since !== undefined ? { since: req.since } : {}),
    generatedAt: now,
    events,
    truncated: events.length < all.length,
    coverage,
    absent: SPEC_EVENT_TYPES.filter((t) => ABSENT_EVENTS.includes(t)),
  };
}
