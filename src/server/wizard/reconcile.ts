// Reconciliation: settling a setup's operation records whose outcome nobody confirmed (prepared,
// in-flight, outcome-unknown, or reconciling when the office stopped), by looking at the world, never by
// guessing. Run when the office loads its setups, before a Retry, and by "Check GitHub again".
//
//   prepared (never marked in flight, so never sent) → failed-confirmed, without a look
//   repository create   found          → unverified (succeeded when GitHub's creation time is after the
//                                        intent and the look before said "not there"; still unverified:
//                                        only "Use this existing repository" carries setup on, as adopted)
//                       not found      → failed-confirmed (the next Retry may create it)
//                       couldn't say   → outcome-unknown, setup stays paused
//   folder create       there          → unverified (as above, "Use this existing folder")
//                       not there      → failed-confirmed
//   repository delete   not found, or another id at the name → succeeded; same id → failed-confirmed
//   folder delete       not there → succeeded; there → failed-confirmed
//
// Nothing here ever makes a record "created by this operation": only the command's own confirmed
// success does (steps.ts). Adopting (`adopt`) records `adopted`, which never lets Cancel & undo delete.

import { lstat, realpath } from 'node:fs/promises';
import { advance, needsAttention, unsettled, type OperationRecord } from '../../shared/setup-operations.js';
import type { OperationStore } from './operations.js';
import type { RepoLookup } from './repo-lookup.js';

export type FolderLook = { state: 'present'; realpath: string } | { state: 'absent' } | { state: 'unknown'; reason: string };

export interface ReconcileDeps {
  /** step 1's classified lookup (found with id / not found / unknown). */
  lookup(repo: string): Promise<RepoLookup>;
  folder?(dir: string): Promise<FolderLook>;
  now?(): number;
}

/** Whether a folder is there, never following what it is: a link counts as there. */
export async function lookFolder(dir: string): Promise<FolderLook> {
  try {
    await lstat(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'absent' };
    return { state: 'unknown', reason: `${code ?? 'error'}: ${(err as Error).message}`.slice(0, 200) };
  }
  return { state: 'present', realpath: await realpath(dir).catch(() => dir) };
}

/** GitHub's clock and the office's may differ a little: a creation time this much before the intent still counts as after it. */
const SKEW_MS = 2 * 60_000;

function afterIntent(op: OperationRecord, createdAt: string | undefined): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  return op.before === 'absent' && Number.isFinite(t) && t >= (op.dispatchedAt ?? op.createdAt) - SKEW_MS;
}

/** What a look says about one record: its next state and what changes, or undefined to leave it as it is. */
async function inspect(op: OperationRecord, deps: ReconcileDeps): Promise<{ state: OperationRecord['state']; patch: Partial<OperationRecord> } | undefined> {
  const wasUnverified = !unsettled(op);
  // Never marked in flight, so never sent: the in-flight mark is saved before any command goes (operations.ts), and a mark that couldn't be saved stops it.
  if (!wasUnverified && !op.dispatchedAt) return { state: 'failed-confirmed', patch: { detail: 'never sent: the office stopped before asking' } };
  if (op.kind === 'repo-create' || op.kind === 'repo-delete') {
    const look = await deps.lookup(op.target);
    if (look.state === 'unknown') return wasUnverified ? undefined : { state: 'outcome-unknown', patch: { detail: look.reason.slice(0, 300) } };
    if (op.kind === 'repo-delete') {
      if (look.state === 'not-found') return { state: 'succeeded', patch: { detail: 'not on GitHub any more: the delete happened' } };
      if (!look.githubId) return { state: 'outcome-unknown', patch: { detail: 'GitHub didn’t say which repository is at that name' } };
      if (op.identity?.githubId && look.githubId !== op.identity.githubId) return { state: 'succeeded', patch: { detail: 'the repository it deleted is gone (another one is at that name now)' } };
      return { state: 'failed-confirmed', patch: { detail: 'still on GitHub: the delete didn’t happen' } };
    }
    if (look.state === 'not-found') return wasUnverified ? { state: 'resolved', patch: { gone: true, detail: 'not on GitHub any more' } } : { state: 'failed-confirmed', patch: { detail: 'not on GitHub: the create didn’t happen' } };
    const evidence = afterIntent(op, look.createdAt) ? ('created-after-intent' as const) : ('no-evidence' as const);
    return {
      state: evidence === 'created-after-intent' ? 'succeeded' : 'resolved',
      patch: {
        provenance: 'unverified',
        evidence,
        identity: { nameWithOwner: look.nameWithOwner ?? op.target, ...(look.githubId ? { githubId: look.githubId } : {}), ...(look.createdAt ? { createdAt: look.createdAt } : {}) },
        detail: `on GitHub${look.createdAt ? ` (created ${look.createdAt})` : ''}, but the office can’t prove this setup created it`,
      },
    };
  }
  const look = await (deps.folder ?? lookFolder)(op.target);
  if (look.state === 'unknown') return wasUnverified ? undefined : { state: 'outcome-unknown', patch: { detail: look.reason } };
  if (op.kind === 'folder-delete') return look.state === 'absent' ? { state: 'succeeded', patch: { detail: 'not there any more: the delete happened' } } : { state: 'failed-confirmed', patch: { detail: 'still there: the delete didn’t finish' } };
  if (look.state === 'absent') return wasUnverified ? { state: 'resolved', patch: { gone: true, detail: 'not there any more' } } : { state: 'failed-confirmed', patch: { detail: 'not there: the clone didn’t happen' } };
  return {
    state: op.before === 'absent' ? 'succeeded' : 'resolved',
    patch: { provenance: 'unverified', evidence: op.before === 'absent' ? 'created-after-intent' : 'no-evidence', identity: { realpath: look.realpath }, detail: 'the folder is there, but the office can’t prove this setup cloned it' },
  };
}

/**
 * Looks again at a setup run's unsettled records (and, with `recheck`, at those waiting for adoption)
 * and saves what it finds. Returns the records that still need someone. A save that fails rejects:
 * the record stays as it was on disk, which is unsettled, so nothing goes ahead.
 */
export async function reconcile(store: OperationStore, job: { id: string; startedAt: number }, deps: ReconcileDeps, opts: { recheck?: boolean; kinds?: OperationRecord['kind'][] } = {}): Promise<OperationRecord[]> {
  const now = () => deps.now?.() ?? Date.now();
  const mine = (o: OperationRecord) => !opts.kinds || opts.kinds.includes(o.kind);
  for (const op of store.of(job.id, job.startedAt).filter(mine)) {
    if (!unsettled(op) && !(opts.recheck && needsAttention(op))) continue;
    let cur = op;
    if (unsettled(op)) {
      cur = advance(op, 'reconciling', now());
      await store.put(cur);
    }
    let next: Awaited<ReturnType<typeof inspect>>;
    try {
      next = await inspect(op, deps);
    } catch (err) {
      next = unsettled(op) ? { state: 'outcome-unknown', patch: { detail: (err as Error).message.slice(0, 300) } } : undefined;
    }
    if (next) await store.put(advance(cur, next.state, now(), next.patch));
  }
  return store.of(job.id, job.startedAt).filter((o) => mine(o) && needsAttention(o));
}

/**
 * "Use this existing repository / folder": a create a look found there (unverified) becomes `adopted`
 * and resolved, so setup carries on. Never "created by this operation": Cancel & undo won't delete it.
 */
export async function adopt(store: OperationStore, job: { id: string; startedAt: number }, opId: string, by: { name: string; id?: string }, now = Date.now()): Promise<OperationRecord | string> {
  const op = store.of(job.id, job.startedAt).find((o) => o.id === opId);
  if (!op || (op.kind !== 'repo-create' && op.kind !== 'folder-create')) return 'No such operation for this setup';
  if (unsettled(op)) return op.kind === 'repo-create' ? 'Check GitHub again first: the office only offers to use a repository it has found there' : 'Check the folder again first';
  if (op.provenance !== 'unverified' || op.gone) return 'There is nothing to adopt: it is settled already';
  const next = advance(op, 'resolved', now, { provenance: 'adopted', detail: `${by.name} chose to use the existing ${op.kind === 'repo-create' ? 'repository' : 'folder'}` });
  await store.put(next, by);
  return next;
}
