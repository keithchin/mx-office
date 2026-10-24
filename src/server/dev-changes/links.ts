// One identity across entry points (assessment §6): requests made outside the Developer change record get a
// linked DC-n whose alias is their own id, so the receipts, Approvals and the audit see one request id.
//
//   - a C4 request (CR-n) made before Developer changes existed (no change id on it): linked by the link pass
//   - a Model-tab "Change this" (MCR-n): linked when it's made, and by the link pass for older ones. It stays with
//     the member the person chose (its own record and delivery), so it is linked, not queued here: folding it into
//     the queue would change who gets it and when (the Model tab's role and "now" choices)
//
// The pass is one-off and append-only: it reads the old records, never writes them, and only appends `create`
// lines (with `linked`) to the change record; running it again finds every alias already linked and adds nothing.
// Old ids and their history stay exactly as they were.

import path from 'node:path';
import { parseStoreSync } from '../durable/read.js';
import type { ChangeRequestRecord } from '../../shared/change-requests.js';
import type { ChangeElement, ChangeRequest } from '../../shared/model-change.js';
import type { DevChange, ElementRef } from '../../shared/dev-changes.js';
import type { DevChanges } from './service.js';

/** A Model-tab element as a change's reference, when the reference can name it (association, enumeration, constant can't). */
export function modelRef(e: ChangeElement): ElementRef | undefined {
  const parts = e.qn.split('.');
  switch (e.kind) {
    case 'page':
    case 'snippet':
      return { docType: e.kind, docQn: e.qn, kind: 'page' };
    case 'microflow':
    case 'nanoflow':
      return { docType: e.kind, docQn: e.qn, kind: e.kind };
    case 'entity':
      return parts.length === 2 ? { docType: 'domainmodel', docQn: parts[0], name: parts[1], kind: 'entity' } : undefined;
    case 'attribute':
      return parts.length === 3 ? { docType: 'domainmodel', docQn: parts[0], name: `${parts[1]}.${parts[2]}`, kind: 'attribute' } : undefined;
    default:
      return undefined;
  }
}

/** The linked record for a Model-tab request. */
export function mcrLink(r: ChangeRequest, owner?: string): Parameters<DevChanges['link']>[1] {
  const refs = r.elements.map(modelRef).filter((x): x is ElementRef => !!x);
  return {
    text: r.request,
    by: r.by,
    ...(owner ? { owner } : {}),
    at: r.at,
    source: r.sha ? { sha: r.sha.toLowerCase(), kind: 'viewed' } : { kind: 'unknown' },
    ...(refs[0] ? { ref: refs[0] } : {}),
    ...(refs.length > 1 ? { refs: refs.slice(1) } : {}),
    via: 'model',
    linked: { kind: 'mcr', id: r.id, member: r.member, role: r.role, ...(r.workerId ? { workerId: r.workerId } : {}), at: r.at },
  };
}

/** The linked record for a C4 request made before Developer changes (no change id). */
export function crLink(r: ChangeRequestRecord): Parameters<DevChanges['link']>[1] {
  return {
    text: r.text,
    by: r.by,
    ...(r.owner ? { owner: r.owner } : {}),
    at: r.at,
    source: r.revision ? { sha: r.revision, kind: 'viewed' } : { kind: 'unknown' },
    ...(r.page ? { page: r.page } : {}),
    ...(r.revision ? { revision: r.revision } : {}),
    via: 'migrated',
    linked: { kind: 'cr', id: r.id, taskId: r.taskId, member: r.member, role: r.role, ...(r.workerId ? { workerId: r.workerId } : {}), at: r.at },
  };
}

const read = <T>(file: string): T[] => {
  try {
    const v = parseStoreSync(file) as { items?: T[] };
    return Array.isArray(v?.items) ? v.items : [];
  } catch {
    return [];
  }
};

const fileOf = (dataDir: string, kind: string, floorId: string) => path.join(dataDir, kind, `${floorId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

/** The link pass for one project: links every old CR-n (without a change id) and every MCR-n not linked yet. Returns the records it made. */
export async function linkPass(svc: DevChanges, dataDir: string, floorId: string, all: readonly DevChange[]): Promise<DevChange[]> {
  const linked = new Set(all.flatMap((c) => (c.linked ? [`${c.linked.kind}:${c.linked.id}`] : [])));
  const made: DevChange[] = [];
  const crs = read<ChangeRequestRecord>(fileOf(dataDir, 'change-requests', floorId)).filter((r) => r && typeof r.id === 'string' && !r.changeId && !linked.has(`cr:${r.id}`));
  const mcrs = read<ChangeRequest>(fileOf(dataDir, 'model-change', floorId)).filter((r) => r && typeof r.id === 'string' && Array.isArray(r.elements) && !linked.has(`mcr:${r.id}`));
  // Oldest first, so the new ids follow the order they were asked in.
  const both = [...crs.map((r) => ({ at: r.at, link: crLink(r) })), ...mcrs.map((r) => ({ at: r.at, link: { ...mcrLink(r), via: 'migrated' as const } }))].sort((a, b) => a.at - b.at);
  for (const x of both) {
    const r = await svc.link(floorId, x.link);
    if (!r.again) made.push(r.change);
  }
  return made;
}
