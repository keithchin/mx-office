// The acceptance record (gap map F2): a Project Manager's explicit ✅ Accept of a delivery, bound to a
// version (v1, v1.1, v2…) and to the evidence the office had at that moment: the scope agreed and
// delivered, the commit at the head of the delivery branch, the gate checks, CI and test reports (a gap
// shown as a gap, never as a zero), the documents' revisions, the exceptions still open and who owns
// them, who accepted and when, and the spend frozen at that moment. A merge is never an acceptance.
// Reopening starts the next version and never erases an earlier record. The records live append-only
// and hash-chained (server/acceptance/); this file is their shape and the pure rules both sides share.
// Delivery closing (handover packs, wind-down) attaches to a record by its id later.

import type { EvidenceRef } from './evidence/types.js';

/** One fact the record cites: what it is, what the office found, and a gap's reason when it found nothing. */
export interface EvidenceLine {
  label: string;
  /** `missing` and `unknown` are gaps: nothing was there, or nothing could tell. */
  status: 'pass' | 'fail' | 'pending' | 'present' | 'missing' | 'unknown';
  detail?: string;
  /** A logical locator (git:<sha>:<path>, audit:<floor>:<id>), never a client path. */
  locator?: string;
}

export interface Exception {
  text: string;
  /** Who owns closing it: a person or a role. */
  owner: string;
}

export interface CostSnapshot {
  at: number;
  /** USD, as the ledger had it then (estimated history included). */
  spent: number;
  /** Of `spent`, estimated from history rather than booked as it happened. */
  estimated: number;
  /** Calls the office couldn't price: `spent` is a floor when there are any. */
  unmeteredCalls: number;
  budget?: number;
  planned?: number;
  byStage: { stage: string; label: string; actual: number; planned?: number }[];
  /** The local currency shown beside USD then, when one was set. */
  fx?: { currency: string; rate: number };
}

export interface AcceptanceRecord {
  schemaVersion: 1;
  /** acc_<ulid>: what delivery closing and the evidence trace point at. */
  id: string;
  projectId?: string;
  floorId: string;
  version: string;
  cycle: number;
  acceptedAt: number;
  acceptedBy: { name: string; accountId?: string };
  scope: { agreed: EvidenceLine[]; delivered: EvidenceLine[]; note?: string };
  /** The delivery branch's head when accepted; build and deploy only when someone typed them (else gaps). */
  source: { branch?: string; commit?: string; build?: string; deploy?: string; gaps: string[] };
  tests: EvidenceLine[];
  docs: EvidenceLine[];
  /** More documents were on main than the record lists. */
  docsMore?: number;
  exceptions: Exception[];
  cost: CostSnapshot;
  /** sha256 of the deliverables on main then, to tell when they changed afterwards. */
  deliverablesDigest?: string;
  /** What the record cites, as evidence refs (the trace and later Evals read these). */
  refs: EvidenceRef[];
}

export interface Reopen {
  id: string;
  at: number;
  by: { name: string; accountId?: string };
  /** The version that was accepted, and the one now under way. */
  from: string;
  version: string;
  scopeNote: string;
}

/** One line of a floor's acceptance file: a full record or a reopen, chained to the line before. */
export type AcceptanceEntry = { op: 'accept'; record: AcceptanceRecord } | { op: 'reopen'; reopen: Reopen };

/** A delivery cycle: the version under way, how it was opened, and its acceptance once given. */
export interface Cycle {
  version: string;
  n: number;
  opened?: Reopen;
  record?: AcceptanceRecord;
}

/** GET /api/acceptance's answer. */
export interface AcceptanceView {
  floor: string;
  /** Oldest first; the last is the one under way (or accepted). */
  cycles: Cycle[];
  /** Why the current accepted delivery no longer matches (empty: it does); only for an accepted current cycle. */
  changed: string[];
  chain: { ok: boolean };
  admin: boolean;
}

/** GET /api/acceptance/draft's answer: what an Accept would record now, for the dialog to show. */
export interface AcceptanceDraft {
  /** Send back on Accept. A changed delivery/evidence/cost requires a new review. */
  reviewToken: string;
  floor: string;
  version: string;
  scope: { agreed: EvidenceLine[]; delivered: EvidenceLine[] };
  source: { branch?: string; commit?: string; gaps: string[] };
  tests: EvidenceLine[];
  docs: EvidenceLine[];
  docsMore?: number;
  /** Gaps and failures the PM may want to carry as exceptions, with a suggested owner. */
  suggestions: Exception[];
  cost: CostSnapshot;
  admin: boolean;
}

// ---- Rules (pure) ---------------------------------------------------------------------------------

const VERSION = /^v(\d{1,4})(?:\.(\d{1,4}))?$/;

/** A version label's numbers, or undefined when it isn't one (v1, v1.1, v12.3). */
export function parseVersion(v: unknown): [number, number] | undefined {
  const m = typeof v === 'string' ? VERSION.exec(v.trim()) : null;
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : undefined;
}

export const compareVersions = (a: string, b: string): number => {
  const x = parseVersion(a) ?? [0, 0];
  const y = parseVersion(b) ?? [0, 0];
  return x[0] - y[0] || x[1] - y[1];
};

/** The cycles a floor's entries make, in order. The first is v1, open from the start. */
export function cyclesOf(entries: readonly AcceptanceEntry[]): Cycle[] {
  const cycles: Cycle[] = [{ version: 'v1', n: 1 }];
  for (const e of entries) {
    const cur = cycles[cycles.length - 1];
    if (e.op === 'accept') {
      if (cur.record) continue; // a second accept of one cycle never happens (the store refuses it); ignored if it's there
      cur.record = e.record;
      cur.version = e.record.version;
    } else if (cur.record) cycles.push({ version: e.reopen.version, n: cur.n + 1, opened: e.reopen });
  }
  return cycles;
}

/** The newest accepted version, if any. */
export const lastAccepted = (cycles: readonly Cycle[]): string | undefined => [...cycles].reverse().find((c) => c.record)?.record?.version;

/** The label to offer: the cycle's own while it's open, else the next minor after the last accepted. */
export function suggestVersion(cycles: readonly Cycle[]): string {
  const cur = cycles[cycles.length - 1];
  if (!cur.record) return cur.version;
  const v = parseVersion(cur.record.version) ?? [1, 0];
  return `v${v[0]}.${v[1] + 1}`;
}

/** Why `label` can't be the version accepted (or reopened) next, or undefined when it can. */
export function versionProblem(label: unknown, cycles: readonly Cycle[]): string | undefined {
  if (!parseVersion(label)) return 'A version looks like v1, v1.1 or v2';
  const last = lastAccepted(cycles);
  if (last && compareVersions(String(label), last) <= 0) return `It has to come after ${last}, the last accepted version`;
  return undefined;
}

/** Exceptions from a request: each with words and an owner, a few hundred characters at most, 30 at most. */
export function cleanExceptions(raw: unknown): Exception[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return 'Exceptions are a list';
  const out: Exception[] = [];
  for (const x of raw.slice(0, 30)) {
    const text = typeof x?.text === 'string' ? x.text.trim().slice(0, 400) : '';
    const owner = typeof x?.owner === 'string' ? x.owner.trim().slice(0, 80) : '';
    if (!text && !owner) continue;
    if (!text) return 'Every exception needs words';
    if (!owner) return `"${text.slice(0, 40)}" needs an owner`;
    out.push({ text, owner });
  }
  return out;
}

/** What changed since the record, from what's there now. Unknowns are left out rather than counted as changes. */
export function changedSince(record: Pick<AcceptanceRecord, 'source' | 'deliverablesDigest'>, now: { commit?: string; digest?: string }): string[] {
  const out: string[] = [];
  const was = record.source.commit;
  if (was && now.commit && now.commit !== was) out.push(`${record.source.branch ?? 'the delivery branch'} moved from ${was.slice(0, 8)} to ${now.commit.slice(0, 8)}`);
  if (record.deliverablesDigest && now.digest && now.digest !== record.deliverablesDigest) out.push('the deliverables on main changed');
  return out;
}
