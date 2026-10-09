// ✅ Accept and ↩ Reopen (gap map F2): the Project Manager's explicit acceptance of a delivery version,
// recorded with the evidence of that moment (evidence.ts) in the floor's append-only, hash-chained file
// (store.ts), audited as acceptance.accept / acceptance.reopen with the project id, and found by the
// evidence trace (evidence/trace.ts reads the same file). Reopening starts the next version with a scope
// note and keeps every earlier record. "Changed since acceptance" is worked out when someone looks:
// the delivery branch's head and the deliverables on main against what the record froze.

import { onForgetFloor } from '../office/forget.js';
import path from 'node:path';
import { changedSince, cleanExceptions, suggestVersion, versionProblem, type AcceptanceDraft, type AcceptanceRecord, type AcceptanceView, type Cycle, type Reopen } from '../../shared/acceptance.js';
import { ulid } from '../../shared/evidence/ids.js';
import type { EvidenceRef } from '../../shared/evidence/types.js';
import { audit, human } from '../audit/index.js';
import { budgetOf } from '../budget/index.js';
import { deliverablesOf } from '../deliverables/index.js';
import { evidenceRef } from '../evidence/refs.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { deliverablesDigest, deliveryHead, gather } from '../progress/gather.js';
import { projectIdsFor } from '../projects/ids.js';
import { draftOf } from './evidence.js';
import { AcceptanceStore } from './store.js';

const stores = new Map<string, AcceptanceStore>();
onForgetFloor((f) => {
  for (const k of [...stores.keys()]) if (path.basename(k) === f.id) stores.delete(k);
});

/** The floor's acceptance file (one instance per file, so its cache is shared). */
export function acceptanceStore(dataDir: string, floorId: string): AcceptanceStore {
  const dir = path.join(dataDir, 'acceptance');
  const key = path.join(dir, floorId);
  let s = stores.get(key);
  if (!s) stores.set(key, (s = new AcceptanceStore(dir, floorId)));
  return s;
}

const projectOf = (ctx: Ctx, floor: Floor) => floor.def.projectId ?? projectIdsFor(ctx.cfg.dataDir).byFloorId(floor.id);
const ref = (floor: Floor) => ({ id: floor.id, name: floor.def.name, dir: floor.dir });

/** Something heard each time a floor's acceptance changes (the progress bar's cache lets go of it). */
const changedFns: ((floorId: string) => void)[] = [];
export const onAcceptanceChange = (fn: (floorId: string) => void) => void changedFns.push(fn);

/** What an Accept would record now. */
export async function acceptanceDraft(ctx: Ctx, floor: Floor, admin: boolean): Promise<AcceptanceDraft> {
  return (await draftWith(ctx, floor, admin)).draft;
}

async function draftWith(ctx: Ctx, floor: Floor, admin: boolean) {
  const g = await gather(ctx, floor);
  const head = await deliveryHead(floor, g.setup);
  const draft = draftOf({ floor: floor.id, version: suggestVersion(acceptanceStore(ctx.cfg.dataDir, floor.id).cycles()), ...g, pulls: floor.github.pulls.items, head, budget: { b: budgetOf(ctx), ref: ref(floor) }, admin, now: Date.now() });
  return { draft, g };
}

/** Why the current cycle's accepted delivery no longer matches, from what's there now (`mini`: the head alone, no deliverables scan). */
export async function changedNow(ctx: Ctx, floor: Floor, cycles: readonly Cycle[], mini = false): Promise<string[]> {
  const rec = cycles[cycles.length - 1]?.record;
  if (!rec) return [];
  const g = await gather(ctx, floor, true);
  const head = await deliveryHead(floor, g.setup);
  const digest = mini ? undefined : deliverablesDigest(await deliverablesOf(ctx, floor));
  return changedSince(rec, { commit: head.commit, digest });
}

export async function acceptanceView(ctx: Ctx, floor: Floor, admin: boolean): Promise<AcceptanceView> {
  const store = acceptanceStore(ctx.cfg.dataDir, floor.id);
  const cycles = store.cycles();
  return { floor: floor.id, cycles, changed: await changedNow(ctx, floor, cycles), chain: { ok: store.verify().ok }, admin };
}

export interface Who {
  name: string;
  accountId?: string;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The evidence refs a record cites: each document and the gate dashboard at the accepted commit, and the ledger at that day. */
function refsOf(floor: Floor, projectId: string | undefined, d: AcceptanceDraft, now: number): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const commit = d.source.commit;
  for (const line of [...d.docs, ...d.tests, ...d.scope.agreed]) {
    if (!line.locator || out.some((r) => r.locator === line.locator)) continue;
    out.push(evidenceRef({ kind: line.locator.endsWith(':index.html') ? 'test_report' : 'artifact', sourceSystem: 'git', sourceId: line.locator.slice(4), sourceVersion: commit, locator: line.locator, retentionClass: 'permanent', projectId, capturedAt: now }));
    if (out.length >= 60) break;
  }
  const day = new Date(now).toISOString().slice(0, 10);
  out.push(evidenceRef({ kind: 'artifact', sourceSystem: 'budget', sourceId: `${floor.id}:${day}`, sourceVersion: day, record: d.cost, locator: `budget:${floor.id}:${day}`, retentionClass: 'ledger-30d', projectId, capturedAt: now }));
  return out;
}

/** ✅ Accept: records the current cycle's delivery as `body.version`. A string says why it can't. */
export async function accept(ctx: Ctx, floor: Floor, body: Record<string, unknown>, who: Who): Promise<AcceptanceRecord | string> {
  const store = acceptanceStore(ctx.cfg.dataDir, floor.id);
  const cycles = store.cycles();
  const cur = cycles[cycles.length - 1];
  if (cur.record) return `${cur.record.version} is already accepted: reopen it to start the next version`;
  const version = typeof body.version === 'string' && body.version.trim() ? body.version.trim() : suggestVersion(cycles);
  const bad = versionProblem(version, cycles);
  if (bad) return bad;
  const exceptions = cleanExceptions(body.exceptions);
  if (typeof exceptions === 'string') return exceptions;
  const now = Date.now();
  const { draft: d, g } = await draftWith(ctx, floor, true);
  const projectId = projectOf(ctx, floor);
  const build = text(body.build, 200);
  const deploy = text(body.deploy, 200);
  const record: AcceptanceRecord = {
    schemaVersion: 1,
    id: `acc_${ulid(now)}`,
    ...(projectId ? { projectId } : {}),
    floorId: floor.id,
    version,
    cycle: cur.n,
    acceptedAt: now,
    acceptedBy: { name: who.name, ...(who.accountId ? { accountId: who.accountId } : {}) },
    scope: { ...d.scope, ...(text(body.scopeNote, 2000) ? { note: text(body.scopeNote, 2000) } : {}) },
    source: { ...(d.source.branch ? { branch: d.source.branch } : {}), ...(d.source.commit ? { commit: d.source.commit } : {}), ...(build ? { build } : {}), ...(deploy ? { deploy } : {}), gaps: d.source.gaps.filter((x) => !(build && x.startsWith('no build')) && !(deploy && x.startsWith('no deploy'))) },
    tests: d.tests,
    docs: d.docs,
    ...(d.docsMore ? { docsMore: d.docsMore } : {}),
    exceptions,
    cost: d.cost,
    ...(g.deliverables ? { deliverablesDigest: deliverablesDigest(g.deliverables) } : {}),
    refs: refsOf(floor, projectId, d, now),
  };
  store.append({ op: 'accept', record });
  audit.record({
    floor: floor.id,
    actor: human(who.name, who.accountId),
    action: 'acceptance.accept',
    target: { kind: 'delivery', id: record.id, label: version },
    summary: `Accepted ${floor.def.name} ${version}${record.source.commit ? ` at ${record.source.commit.slice(0, 8)}` : ''}${exceptions.length ? `, with ${exceptions.length} exception${exceptions.length === 1 ? '' : 's'}` : ''}`,
    details: { version, cycle: record.cycle, commit: record.source.commit ?? null, exceptions: exceptions.length, spent: record.cost.spent },
    severity: 'notice',
    ...(projectId ? { ids: { projectId } } : {}),
  });
  changedFns.forEach((fn) => fn(floor.id));
  return record;
}

/** ↩ Reopen: the accepted version stays as it was; the next one starts with `body.scopeNote`. */
export function reopen(ctx: Ctx, floor: Floor, body: Record<string, unknown>, who: Who): Reopen | string {
  const store = acceptanceStore(ctx.cfg.dataDir, floor.id);
  const cycles = store.cycles();
  const cur = cycles[cycles.length - 1];
  if (!cur.record) return `${cur.version} isn't accepted yet: there's nothing to reopen`;
  const version = typeof body.version === 'string' && body.version.trim() ? body.version.trim() : suggestVersion(cycles);
  const bad = versionProblem(version, cycles);
  if (bad) return bad;
  const scopeNote = text(body.scopeNote, 2000);
  if (!scopeNote) return 'Say what the next version is for (its scope note)';
  const now = Date.now();
  const r: Reopen = { id: `reo_${ulid(now)}`, at: now, by: { name: who.name, ...(who.accountId ? { accountId: who.accountId } : {}) }, from: cur.record.version, version, scopeNote };
  store.append({ op: 'reopen', reopen: r });
  const projectId = projectOf(ctx, floor);
  audit.record({
    floor: floor.id,
    actor: human(who.name, who.accountId),
    action: 'acceptance.reopen',
    target: { kind: 'delivery', id: r.id, label: version },
    summary: `Reopened ${floor.def.name}: ${version} starts after ${cur.record.version} (which stays accepted)`,
    details: { from: cur.record.version, version, scopeNote: scopeNote.slice(0, 200) },
    severity: 'notice',
    ...(projectId ? { ids: { projectId } } : {}),
  });
  changedFns.forEach((fn) => fn(floor.id));
  return r;
}
