// Operation records: what a new-project setup (and its Cancel & undo) asked the outside world to do
// that can't simply be done again, kept as a small versioned record per action: creating the GitHub
// repository, deleting it, cloning the local folder, deleting it. Each is written through the office's
// acknowledged critical write (server/flow/critical-write.ts) BEFORE the command goes out (prepared,
// then in-flight) and again with its outcome, so an office that stops halfway knows on its next start
// that an outcome is uncertain, rather than finding a repository and taking it for someone else's
// (step 1's gap). Reconciliation (server/wizard/reconcile.ts) settles an uncertain one by looking, never
// by guessing: it never makes a record "created by this operation"; only the command's own confirmed
// success does. An uncertain or unverified record stops the setup's next steps until it's settled, and
// "Use this existing repository" (adopted) never gives Cancel & undo the right to delete. Pure: the
// server, the pages and the tests read the same rules and the same words.

import { readProvenance, repoProof, folderProof, type SetupProvenance, type Proof } from './setup-provenance.js';

export const OPERATION_VERSION = 1;

export type OperationKind = 'repo-create' | 'repo-delete' | 'folder-create' | 'folder-delete';
export const OPERATION_KINDS: readonly OperationKind[] = ['repo-create', 'repo-delete', 'folder-create', 'folder-delete'];

/**
 * prepared: written, nothing sent yet. in-flight: written, the command is being sent (or was, and its
 * answer was never saved). succeeded: the command said it worked. failed-confirmed: the effect is known
 * not to have happened (GitHub refused, or a look afterwards found nothing). outcome-unknown: it may or
 * may not have happened (a timeout, a lost answer, GitHub down). reconciling: being looked at now.
 * resolved: settled by a look or a person's choice (see `provenance`).
 */
export type OperationState = 'prepared' | 'in-flight' | 'succeeded' | 'failed-confirmed' | 'outcome-unknown' | 'reconciling' | 'resolved';
export const OPERATION_STATES: readonly OperationState[] = ['prepared', 'in-flight', 'succeeded', 'failed-confirmed', 'outcome-unknown', 'reconciling', 'resolved'];

/** Who the thing belongs to: only `created-by-this-operation` (a confirmed create) ever lets Cancel & undo delete it. */
export type OperationProvenance = 'created-by-this-operation' | 'adopted' | 'pre-existing' | 'unverified';
const PROVENANCES: readonly OperationProvenance[] = ['created-by-this-operation', 'adopted', 'pre-existing', 'unverified'];

export interface OperationIdentity {
  /** GitHub's immutable id for the repository. */
  githubId?: string;
  nameWithOwner?: string;
  /** When GitHub says the repository was created (ISO), for the evidence. */
  createdAt?: string;
  /** The folder's canonical path. */
  realpath?: string;
}

export interface OperationRecord {
  v: typeof OPERATION_VERSION;
  /** Stable id: op_<time>_<random>. */
  id: string;
  /** The setup (its job id) and which run of it (its startedAt): a later setup at the same name never reads these. */
  setup: string;
  setupStartedAt: number;
  /** The step's try that wrote it (1 for Cancel & undo and for reconciliation). */
  attempt: number;
  /** The floor (project id), when there is one. */
  project?: string;
  kind: OperationKind;
  /** owner/name for a repository, a canonical path for a folder. */
  target: string;
  state: OperationState;
  provenance: OperationProvenance;
  /** What a look found before acting: a create goes ahead only on `absent`. */
  before?: 'absent' | 'present' | 'unknown';
  identity?: OperationIdentity;
  /** The outcome in a line (redacted). */
  detail?: string;
  /** For a delete: the create record that gave the right to delete. */
  authorisedBy?: string;
  /** How a reconciliation read what it found: whether the evidence fits this operation having made it. */
  evidence?: 'created-after-intent' | 'no-evidence';
  /** A look found the thing gone again (an unverified record that no longer stops anything). */
  gone?: true;
  createdAt: number;
  updatedAt: number;
  dispatchedAt?: number;
  /** The states it went through, oldest first (kept short). */
  history: { state: OperationState; at: number; detail?: string }[];
  /** Read from step 1's provenance record (a setup saved before operation records): never written back. */
  legacy?: true;
}

const str = (v: unknown, max = 1000): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const HISTORY_KEPT = 20;

/** A saved record as this office reads it: anything odd, or of another version, is undefined (no record at all). */
export function readOperation(v: unknown): OperationRecord | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (r.v !== OPERATION_VERSION || !str(r.id, 100) || !str(r.setup, 300) || !num(r.setupStartedAt) || !num(r.attempt)) return undefined;
  if (!OPERATION_KINDS.includes(r.kind as OperationKind) || !str(r.target) || !OPERATION_STATES.includes(r.state as OperationState)) return undefined;
  if (!PROVENANCES.includes(r.provenance as OperationProvenance) || !num(r.createdAt) || !num(r.updatedAt)) return undefined;
  const id = r.identity && typeof r.identity === 'object' ? (r.identity as Record<string, unknown>) : undefined;
  const identity: OperationIdentity | undefined = id
    ? {
        ...(str(id.githubId, 200) ? { githubId: id.githubId } : {}),
        ...(str(id.nameWithOwner, 300) ? { nameWithOwner: id.nameWithOwner } : {}),
        ...(str(id.createdAt, 60) ? { createdAt: id.createdAt } : {}),
        ...(str(id.realpath) ? { realpath: id.realpath } : {}),
      }
    : undefined;
  // A confirmed create without what it created is no proof of anything: read as unverified.
  const provenance = r.provenance as OperationProvenance;
  return {
    v: OPERATION_VERSION,
    id: r.id,
    setup: r.setup,
    setupStartedAt: r.setupStartedAt,
    attempt: r.attempt,
    ...(str(r.project, 200) ? { project: r.project } : {}),
    kind: r.kind as OperationKind,
    target: r.target,
    state: r.state as OperationState,
    provenance,
    ...(r.before === 'absent' || r.before === 'present' || r.before === 'unknown' ? { before: r.before } : {}),
    ...(identity && Object.keys(identity).length ? { identity } : {}),
    ...(str(r.detail, 2000) ? { detail: r.detail } : {}),
    ...(str(r.authorisedBy, 100) ? { authorisedBy: r.authorisedBy } : {}),
    ...(r.evidence === 'created-after-intent' || r.evidence === 'no-evidence' ? { evidence: r.evidence } : {}),
    ...(r.gone === true ? { gone: true as const } : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...(num(r.dispatchedAt) ? { dispatchedAt: r.dispatchedAt } : {}),
    history: Array.isArray(r.history)
      ? r.history
          .filter((h): h is { state: OperationState; at: number; detail?: string } => !!h && OPERATION_STATES.includes((h as { state: OperationState }).state) && num((h as { at: unknown }).at))
          .slice(-HISTORY_KEPT)
          .map((h) => ({ state: h.state, at: h.at, ...(str(h.detail, 500) ? { detail: h.detail } : {}) }))
      : [],
  };
}

/** A record moved to a new state (and whatever else changes), with the step in its history. */
export function advance(op: OperationRecord, state: OperationState, at: number, patch: Partial<Omit<OperationRecord, 'v' | 'id' | 'setup' | 'kind' | 'target' | 'history'>> = {}): OperationRecord {
  const detail = patch.detail ?? op.detail;
  return { ...op, ...patch, state, updatedAt: at, history: [...op.history, { state, at, ...(detail ? { detail: detail.slice(0, 500) } : {}) }].slice(-HISTORY_KEPT) };
}

/** States whose outcome nobody has confirmed yet: reconciliation looks at these. */
export const UNSETTLED: readonly OperationState[] = ['prepared', 'in-flight', 'outcome-unknown', 'reconciling'];
export const unsettled = (op: OperationRecord) => UNSETTLED.includes(op.state);

/**
 * Whether the record stops the setup's next steps: an outcome nobody has confirmed, or a create whose
 * result is there but unverified (it waits for "Use this existing …" or a look that finds it gone).
 */
export function needsAttention(op: OperationRecord): boolean {
  if (unsettled(op)) return true;
  return (op.kind === 'repo-create' || op.kind === 'folder-create') && op.provenance === 'unverified' && (op.state === 'succeeded' || op.state === 'resolved') && !op.gone;
}

/** The records of this run of the setup (a later setup at the same name has another startedAt). */
export const opsOfRun = (ops: readonly OperationRecord[], startedAt: number) => ops.filter((o) => o.setupStartedAt === startedAt);

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Step 1's provenance read as the equivalent records (a setup saved before operation records): a
 * recorded create as a confirmed create, "there already" as pre-existing. Never from the steps' lines.
 */
export function legacyOperations(provenance: unknown, setup: string, setupStartedAt: number): OperationRecord[] {
  const p = readProvenance(provenance);
  const out: OperationRecord[] = [];
  const base = (kind: OperationKind, target: string, at: number, made: boolean, identity: OperationIdentity): OperationRecord => ({
    v: OPERATION_VERSION,
    id: `legacy-${kind}`,
    setup,
    setupStartedAt,
    attempt: 1,
    kind,
    target,
    state: made ? 'succeeded' : 'resolved',
    provenance: made ? 'created-by-this-operation' : 'pre-existing',
    identity,
    createdAt: at,
    updatedAt: at,
    history: [],
    legacy: true,
  });
  if (p?.repo) out.push(base('repo-create', p.repo.nameWithOwner, p.repo.at, p.repo.createdBySetup, { nameWithOwner: p.repo.nameWithOwner, ...(p.repo.githubId ? { githubId: p.repo.githubId } : {}) }));
  if (p?.folder) out.push(base('folder-create', p.folder.path, p.folder.at, p.folder.createdBySetup, { realpath: p.folder.path }));
  return out;
}

/** The latest record of a kind that says anything (a create that failed for sure says nothing). */
function latest(ops: readonly OperationRecord[], kind: OperationKind, match?: (o: OperationRecord) => boolean): OperationRecord | undefined {
  return [...ops].filter((o) => o.kind === kind && o.state !== 'failed-confirmed' && (!match || match(o))).sort((a, b) => a.createdAt - b.createdAt).at(-1);
}

/**
 * The records folded into step 1's provenance shape (what Cancel & undo's plan and madeBySetup read):
 * records first, step 1's own record only for a kind with none. Only a confirmed create with its
 * identity reads as "created by the setup"; adopted, pre-existing and unverified read as "there already".
 */
export function effectiveProvenance(ops: readonly OperationRecord[], legacy: unknown): SetupProvenance | undefined {
  const old = readProvenance(legacy);
  // A create that failed for sure (or was never needed) says nothing: step 1's record still speaks for that kind.
  const repoOps = ops.filter((o) => o.kind === 'repo-create' && !o.legacy && o.state !== 'failed-confirmed');
  const folderOps = ops.filter((o) => o.kind === 'folder-create' && !o.legacy && o.state !== 'failed-confirmed');
  if (!repoOps.length && !folderOps.length) return old;
  const out: SetupProvenance = { v: 1 };
  if (repoOps.length) {
    const r = latest(repoOps, 'repo-create');
    if (r && !needsAttention(r)) {
      const made = r.provenance === 'created-by-this-operation' && r.state === 'succeeded';
      out.repo = { createdBySetup: made, ...(made ? {} : { preExisting: true as const }), nameWithOwner: r.identity?.nameWithOwner ?? r.target, ...(r.identity?.githubId ? { githubId: r.identity.githubId } : {}), at: r.updatedAt };
    }
  } else if (old?.repo) out.repo = old.repo;
  if (folderOps.length) {
    const f = latest(folderOps, 'folder-create');
    if (f && !needsAttention(f)) {
      const made = f.provenance === 'created-by-this-operation' && f.state === 'succeeded';
      out.folder = { createdBySetup: made, ...(made ? {} : { preExisting: true as const }), path: f.identity?.realpath ?? f.target, at: f.updatedAt };
    }
  } else if (old?.folder) out.folder = old.folder;
  return out;
}

export type OpProof = Proof | 'no-id' | 'unresolved' | 'adopted' | 'unverified';

/** Why a record that isn't a confirmed create gives no right to delete. */
function notOurs(op: OperationRecord, what: 'repo' | 'folder'): { proof: OpProof; why: string } {
  const thing = what === 'repo' ? 'repository' : 'folder';
  const where = what === 'repo' ? 'on GitHub ' : '';
  if (unsettled(op)) return { proof: 'unresolved', why: `the office isn’t sure yet whether this setup created the ${thing} (its outcome is unknown), so it won’t delete it: check ${what === 'repo' ? 'GitHub' : 'the folder'} again from the setup first` };
  if (op.provenance === 'unverified') return { proof: 'unverified', why: `the office couldn’t prove this setup created the ${thing}, so it won’t delete it: delete it ${where}yourself if you’re sure` };
  if (op.provenance === 'adopted') return { proof: 'adopted', why: `you chose to use this existing ${thing} in setup, so the office never deletes it` };
  return { proof: 'pre-existing', why: what === 'repo' ? 'it was on GitHub already when the setup looked (you created it, or it was there), so the office never deletes it' : 'it was there before the setup (a floor already), so the office never deletes it' };
}

/**
 * Whether the records prove the setup created `repo`, and the id GitHub must still show for it: a
 * confirmed create of that name by this operation with GitHub's id. A setup with no records reads its
 * step 1 provenance as before (setup-provenance.ts repoProof); a log line never proves anything.
 */
export function repoCreateProof(ops: readonly OperationRecord[], provenance: unknown, repo: string, legacyCreated: boolean): { proof: 'recorded'; githubId: string; op?: string } | { proof: Exclude<OpProof, 'recorded'>; why: string } {
  const own = ops.filter((o) => o.kind === 'repo-create' && !o.legacy && o.state !== 'failed-confirmed' && sameRepo(o.target, repo));
  if (!own.length) return repoProof(readProvenance(provenance), repo, legacyCreated);
  const pending = own.find(needsAttention);
  if (pending) return notOurs(pending, 'repo') as { proof: Exclude<OpProof, 'recorded'>; why: string };
  const r = latest(own, 'repo-create')!;
  if (r.provenance !== 'created-by-this-operation' || r.state !== 'succeeded') return notOurs(r, 'repo') as { proof: Exclude<OpProof, 'recorded'>; why: string };
  if (!r.identity?.githubId) return { proof: 'no-id', why: 'this setup created it, but the office couldn’t record GitHub’s id for it, so it can’t tell it’s still the same repository: delete it on GitHub yourself if you’re sure' };
  return { proof: 'recorded', githubId: r.identity.githubId, op: r.id };
}

/** Whether the records prove the setup cloned the folder whose real path is now `real` (folderProof for a setup with none). */
export function folderCreateProof(ops: readonly OperationRecord[], provenance: unknown, real: string | undefined, legacyCloned: boolean, win: boolean): { proof: 'recorded'; op?: string } | { proof: Exclude<OpProof, 'recorded'> | 'moved'; why: string } {
  const own = ops.filter((o) => o.kind === 'folder-create' && !o.legacy && o.state !== 'failed-confirmed');
  if (!own.length) return folderProof(readProvenance(provenance), real, legacyCloned, win);
  const pending = own.find(needsAttention);
  if (pending) return notOurs(pending, 'folder') as { proof: Exclude<OpProof, 'recorded'>; why: string };
  const f = latest(own, 'folder-create')!;
  if (f.provenance !== 'created-by-this-operation' || f.state !== 'succeeded') return notOurs(f, 'folder') as { proof: Exclude<OpProof, 'recorded'>; why: string };
  const p = folderProof({ v: 1, folder: { createdBySetup: true, path: f.identity?.realpath ?? f.target, at: f.updatedAt } }, real, false, win);
  return p.proof === 'recorded' ? { proof: 'recorded', op: f.id } : p;
}

/** What the setup's page and card say about an operation that needs someone: plain words, and what can be done. */
export interface OperationNotice {
  op: string;
  kind: OperationKind;
  target: string;
  state: OperationState;
  provenance: OperationProvenance;
  title: string;
  text: string;
  /** The primary action: look again ("Check GitHub again", "Check the folder again"). */
  check: string;
  /** Offered only once a look found it there: records it as adopted (never Cancel & undo's to delete). */
  adopt?: string;
}

const clock = (iso: string | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : undefined;
};

/** The words for the first record that needs someone, or undefined when none does. */
export function operationNotice(ops: readonly OperationRecord[]): OperationNotice | undefined {
  const op = ops.find((o) => (o.kind === 'repo-create' || o.kind === 'folder-create') && needsAttention(o));
  if (!op) return undefined;
  const repo = op.kind === 'repo-create';
  const base = { op: op.id, kind: op.kind, target: op.target, state: op.state, provenance: op.provenance, check: repo ? 'Check GitHub again' : 'Check the folder again' };
  if (unsettled(op)) {
    const checked = op.history.some((h) => h.state === 'reconciling');
    const why = op.detail ? ` (${op.detail.replace(/[.\s]+$/, '')})` : '';
    return {
      ...base,
      title: repo ? 'Repository creation may have completed' : 'Cloning the project folder may have completed',
      text: repo
        ? `GitHub stopped responding before Office could confirm the result. Setup is paused so it doesn't create or remove the wrong thing.${checked ? ` Office checked again, but GitHub still couldn't say${why}: check the office's GitHub login in 🔌 Connections, then Check GitHub again.` : ''}`
        : `The office stopped before it could confirm the result. Setup is paused so it doesn't create or remove the wrong thing.${checked ? ` Office looked again, but couldn't tell${why}.` : ''}`,
    };
  }
  const when = clock(op.identity?.createdAt);
  if (repo)
    return {
      ...base,
      title: `${op.identity?.nameWithOwner ?? op.target} is on GitHub, but Office can't prove it created it`,
      text: `Office asked GitHub to create ${op.target}, but couldn't record the result. GitHub now shows a repository with that name${when ? ` (created ${when}${op.evidence === 'created-after-intent' ? ', after Office asked for it' : ''})` : ''}. If it's the one you want, use it and setup carries on. Office will never delete it with Cancel & undo; delete it on GitHub yourself if it isn't wanted.`,
      adopt: 'Use this existing repository',
    };
  return {
    ...base,
    title: `The folder ${op.target} is there, but Office can't prove it cloned it`,
    text: `Office started cloning the project into ${op.target}, but couldn't record the result. The folder is there now. If it's the project's checkout, use it and setup carries on. Office will never delete it with Cancel & undo.`,
    adopt: 'Use this existing folder',
  };
}
