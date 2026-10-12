// Where a setup's operation records live (shared/setup-operations.ts): one small file per setup,
// <office data>/wizard/operations/<setup id>.json, apart from the setup's checkpoint (which is written in
// the background and only logs a failure). Every change goes through the acknowledged critical write
// (flow/critical-write.ts): the copy the office reads from changes only once the file has it, and a
// write that fails rejects to the caller, who then doesn't send the command (intent) or stops the setup
// for reconciliation (outcome). Each change is told to `onChange` (the office's audit log).

import { readFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { advance, opsOfRun, readOperation, OPERATION_VERSION, type OperationKind, type OperationRecord, type OperationState } from '../../shared/setup-operations.js';
import { writeJsonCritical, type CriticalFs } from '../flow/critical-write.js';

/** The intent couldn't be saved: the command was NOT sent. */
export class IntentUnsavedError extends Error {
  override name = 'IntentUnsavedError';
}
/** The command ran, but its outcome couldn't be saved: the setup stops for reconciliation. */
export class OutcomeUnsavedError extends Error {
  override name = 'OutcomeUnsavedError';
}
/** An operation's outcome isn't settled: no further step runs until it is. */
export class OperationPendingError extends Error {
  override name = 'OperationPendingError';
}
/** Errors that a step's automatic retries must never try again. */
export const OPERATION_ERRORS = new Set(['IntentUnsavedError', 'OutcomeUnsavedError', 'OperationPendingError']);

const KEPT = 200;
const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '-');
const why = (err: unknown) => ((err as NodeJS.ErrnoException).code ? `${(err as NodeJS.ErrnoException).code}: ` : '') + ((err as Error).message ?? String(err)).slice(0, 300);

export type OperationChange = (op: OperationRecord, from: OperationState | undefined, by?: { name: string; id?: string }) => void;

export interface OperationStoreOptions {
  /** The file operations (a test's, to make a write fail). */
  fs?: CriticalFs;
  /** Kept in memory only (a step run outside the office's job book, in tests): never the office's way. */
  memory?: boolean;
  onChange?: OperationChange;
  now?: () => number;
}

/** What a step (or Cancel & undo) uses for one setup: the records of its run, and writing them. */
export interface JobOps {
  list(): OperationRecord[];
  /** Writes the intent (prepared); throws IntentUnsavedError when it can't. */
  prepare(kind: OperationKind, target: string, extra?: Partial<Pick<OperationRecord, 'before' | 'identity' | 'authorisedBy' | 'provenance' | 'project'>>): Promise<OperationRecord>;
  /** Marks it in-flight right before the command goes; throws IntentUnsavedError when it can't (then don't send it). */
  dispatch(op: OperationRecord): Promise<OperationRecord>;
  /** Writes the outcome; throws OutcomeUnsavedError when it can't. */
  settle(op: OperationRecord, state: OperationState, patch?: Partial<Pick<OperationRecord, 'provenance' | 'identity' | 'detail' | 'evidence' | 'gone'>>, by?: { name: string; id?: string }): Promise<OperationRecord>;
}

export class OperationStore {
  private cache = new Map<string, OperationRecord[]>();
  private chains = new Map<string, Promise<unknown>>();

  constructor(
    readonly root: string,
    private opts: OperationStoreOptions = {},
  ) {}

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  file(setup: string) {
    return path.join(this.root, `${safe(setup)}.json`);
  }

  /** Every record kept for the setup id (all its runs). */
  all(setup: string): OperationRecord[] {
    let list = this.cache.get(setup);
    if (list) return list;
    list = [];
    if (!this.opts.memory) {
      try {
        const j = JSON.parse(readFileSync(this.file(setup), 'utf8')) as { v?: unknown; ops?: unknown[] };
        if (j?.v === OPERATION_VERSION && Array.isArray(j.ops)) list = j.ops.map(readOperation).filter((o): o is OperationRecord => !!o && o.setup === setup);
      } catch {
        // none yet (or not readable: no records, so nothing gives authority)
      }
    }
    this.cache.set(setup, list);
    return list;
  }

  /** The records of one run of the setup. */
  of(setup: string, startedAt: number): OperationRecord[] {
    return opsOfRun(this.all(setup), startedAt);
  }

  /**
   * Writes `op` (new, or a newer version of one kept) through the critical write, one write per setup
   * at a time; the records read here change only once the file has it. Rejects with the write's error.
   */
  put(op: OperationRecord, by?: { name: string; id?: string }): Promise<void> {
    const prev = this.chains.get(op.setup) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(async () => {
      const list = this.all(op.setup);
      const before = list.find((o) => o.id === op.id);
      const after = [...list.filter((o) => o.id !== op.id), op].slice(-KEPT);
      if (!this.opts.memory) await writeJsonCritical(this.file(op.setup), { v: OPERATION_VERSION, setup: op.setup, ops: after }, this.opts.fs);
      this.cache.set(op.setup, after);
      try {
        this.opts.onChange?.(op, before?.state, by);
      } catch (err) {
        console.error(`agent-office: couldn't audit an operation record: ${(err as Error).message}`);
      }
    });
    this.chains.set(op.setup, next);
    return next;
  }

  /** Takes a setup's records out of use (Cancel & undo removed the setup): kept beside, never read again. */
  retire(setup: string) {
    this.cache.delete(setup);
    if (this.opts.memory) return;
    const file = this.file(setup);
    try {
      renameSync(file, `${file.slice(0, -5)}.${this.now()}.retired`);
    } catch {
      // none
    }
  }

  /** The records of one setup run, for its steps or its Cancel & undo. */
  handle(job: { id: string; startedAt: number; floor?: string }, attempt = 1): JobOps {
    const write = async (op: OperationRecord, Err: new (m: string) => Error, what: string, by?: { name: string; id?: string }) => {
      try {
        await this.put(op, by);
      } catch (err) {
        throw new Err(what.replace('%s', why(err)));
      }
      return op;
    };
    const label = (kind: OperationKind) => ({ 'repo-create': 'creating the repository', 'repo-delete': 'deleting the repository', 'folder-create': 'cloning the folder', 'folder-delete': 'deleting the folder' })[kind];
    return {
      list: () => this.of(job.id, job.startedAt),
      prepare: (kind, target, extra = {}) => {
        const at = this.now();
        const op: OperationRecord = {
          v: OPERATION_VERSION,
          id: `op_${at.toString(36)}_${randomBytes(5).toString('hex')}`,
          setup: job.id,
          setupStartedAt: job.startedAt,
          attempt,
          ...(job.floor || extra.project ? { project: extra.project ?? job.floor } : {}),
          kind,
          target,
          state: 'prepared',
          provenance: extra.provenance ?? 'unverified',
          ...(extra.before ? { before: extra.before } : {}),
          ...(extra.identity ? { identity: extra.identity } : {}),
          ...(extra.authorisedBy ? { authorisedBy: extra.authorisedBy } : {}),
          createdAt: at,
          updatedAt: at,
          history: [{ state: 'prepared', at }],
        };
        return write(op, IntentUnsavedError, `The office couldn't save its record of ${label(kind)} before doing it (%s), so it didn't start. Check the office's data folder has room and can be written to, then Retry`);
      },
      dispatch: (op) => {
        const at = this.now();
        return write(advance(op, 'in-flight', at, { dispatchedAt: at }), IntentUnsavedError, `The office couldn't save its record of ${label(op.kind)} before doing it (%s), so it didn't start. Check the office's data folder has room and can be written to, then Retry`);
      },
      settle: (op, state, patch = {}, by) =>
        write(
          advance(op, state, this.now(), patch),
          OutcomeUnsavedError,
          `The office finished ${label(op.kind)} but couldn't save the result (%s). Setup is paused so it doesn't create or remove the wrong thing: once the office's data folder can be written to, Check again`,
          by,
        ),
    };
  }
}
