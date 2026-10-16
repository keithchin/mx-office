// "Resolve old incidents…" (POST /api/incidents/bulk-resolve, shared/incidents-bulk.ts): the incidents the
// admin ticked, each checked again here and resolved through the normal path (updateIncident: one
// 'resolve' line each in the hash chain, each audited as incident.resolved with the note), then one
// incident.bulk-resolve event with how many and which. One that's resolved already, gone, or seen in the
// last seven days without being mitigated is skipped and said why, so pressing it twice resolves nothing
// the second time. Mx Office's analysis isn't started for these (it would run once per incident, each a
// model call): an admin can still ask for one on any of them (Retry analysis).

import { OFFICE_FLOOR, type AuditActor } from '../../shared/audit.js';
import { BULK_MAX, bulkResolvable } from '../../shared/incidents-bulk.js';
import { incidentRef } from '../../shared/incidents.js';
import { audit } from '../audit/index.js';
import { incidentStore, updateIncident } from './index.js';

export interface BulkResult {
  resolved: { id: string; number: number }[];
  skipped: { id: string; why: string }[];
}

/** Resolves each of `ids` that may be (bulkResolvable at `now`), with `note` on each. */
export function bulkResolve(ids: readonly string[], note: string, actor: AuditActor, now = Date.now()): BulkResult {
  const out: BulkResult = { resolved: [], skipped: [] };
  const store = incidentStore();
  if (!store) return out;
  for (const id of [...new Set(ids)].slice(0, BULK_MAX)) {
    const i = store.get(id);
    if (!i) out.skipped.push({ id, why: 'no such incident' });
    else if (i.status === 'resolved') out.skipped.push({ id, why: 'resolved already' });
    else if (!bulkResolvable(i, now)) out.skipped.push({ id, why: 'seen in the last 7 days and not mitigated' });
    else {
      const r = updateIncident(i.id, { status: 'resolved' }, actor, { note, details: { bulk: true } });
      if (r?.status === 'resolved') out.resolved.push({ id: r.id, number: r.number });
      else out.skipped.push({ id, why: "couldn't be resolved" });
    }
  }
  if (out.resolved.length) {
    const refs = out.resolved.map((r) => incidentRef(r));
    audit.record({
      floor: OFFICE_FLOOR,
      actor,
      action: 'incident.bulk-resolve',
      target: { kind: 'incident', id: 'bulk', label: `${out.resolved.length} incident${out.resolved.length === 1 ? '' : 's'}` },
      summary: `Bulk-resolved ${out.resolved.length} incident${out.resolved.length === 1 ? '' : 's'}: ${refs.slice(0, 20).join(', ')}${refs.length > 20 ? ', …' : ''}`,
      details: { count: out.resolved.length, ids: out.resolved.map((r) => r.id), numbers: out.resolved.map((r) => r.number), note, ...(out.skipped.length ? { skipped: out.skipped.length } : {}) },
      severity: 'notice',
    });
  }
  return out;
}
