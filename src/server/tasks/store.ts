// The task record (Slice 1B-4): <data>/tasks/<project>.jsonl, append only, a line per task made or per
// event on one, each hash-chained like the answer store (answers/store.ts: prev is the sha256 of the line
// before, hash is the line's own without that field), so an edited, dropped or reordered line shows.
//
// It's independent of the agents: a member's task and its prevTasks cache on the roster, and a queue task,
// only hold the ids. Minting is synchronous (the id has to be in the text before it's typed): the record is
// in memory at once and its line goes to disk in order behind the floor's earlier ones, one fsync'd append
// at a time, off the event loop. Whatever types a new task waits for its line first (createDurable, durable):
// a failed create rejects there, so nothing is sent with an id the record doesn't have, and the record is
// dropped from memory. Events stay fire-and-forget (logged); flushed() says whether any line was lost.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { mintExecutionId, mintTaskId } from '../../shared/evidence/ids.js';
import type { TaskEvent, TaskLine, TaskRecord, TaskSource } from '../../shared/tasks.js';
import { sha256 } from '../audit/log.js';
import { readJsonlStore } from '../durable/jsonl.js';

const FLOOR = /^[A-Za-z0-9_.-]{1,64}$/;
const TEXT_MAX = 160;

/** The file operations the append uses (a test's, to make one fail). */
export interface TaskFs {
  open: typeof fsp.open;
  mkdir: typeof fsp.mkdir;
  readFile: typeof fsp.readFile;
}

interface FloorTasks {
  /** The tasks by id, every line folded in (lines read from disk and those appended since). */
  byId: Map<string, TaskRecord>;
  /** The last line written: what the next one chains to. */
  last: string;
  loaded: boolean;
  /** Events on tasks not in memory yet (made before a restart, the file not read yet): folded in once it is. */
  early: { task: string; event: TaskEvent }[];
}

/** What flushed() found: every line queued so far on disk, or how many weren't (and the last reason). */
export type TaskFlush = { ok: true } | { ok: false; failed: number; error: string };

export interface NewTask {
  source: TaskSource;
  text: string;
  issue?: number;
  legacyId?: string;
}

export class TaskStore {
  private floors = new Map<string, FloorTasks>();
  private loading = new Map<string, Promise<void>>();
  private chains = new Map<string, Promise<unknown>>();
  /** Each floor's lines that couldn't be written (sticky: a lost line stays lost). */
  private failures = new Map<string, { failed: number; error: string }>();
  /** Creates whose line isn't settled yet, and those whose line was lost: what durable() answers from. */
  private pending = new Map<string, Promise<Error | undefined>>();
  private lost = new Map<string, string>();

  constructor(
    readonly dir: string,
    private fs: TaskFs = fsp as unknown as TaskFs,
    private now: () => number = Date.now,
  ) {}

  file(floorId: string) {
    if (!FLOOR.test(floorId)) throw new Error(`not a project id: ${floorId}`);
    return path.join(this.dir, `${floorId}.jsonl`);
  }

  private mem(floorId: string): FloorTasks {
    let f = this.floors.get(floorId);
    if (!f) this.floors.set(floorId, (f = { byId: new Map(), last: '', loaded: false, early: [] }));
    return f;
  }

  /** Reads the floor's file once (asynchronously), folding in what was minted before the read finished. */
  load(floorId: string): Promise<void> {
    const f = this.mem(floorId);
    if (f.loaded) return Promise.resolve();
    let p = this.loading.get(floorId);
    if (!p) {
      p = this.read(floorId, f).finally(() => this.loading.delete(floorId));
      this.loading.set(floorId, p);
    }
    return p;
  }

  private async read(floorId: string, f: FloorTasks): Promise<void> {
    // Only a missing file is "none yet": a locked one rejects (the next load tries again), a torn tail is kept aside and cut off.
    const text = (await readJsonlStore(this.file(floorId))).lines.join('\n');
    const disk = new Map<string, TaskRecord>();
    let last = '';
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        fold(disk, JSON.parse(line) as TaskLine);
        last = line;
      } catch {
        // A torn last line (a crash mid-append): verify says so; reading skips it.
      }
    }
    // What was minted meanwhile is newer than the file: it goes on top (its lines are queued behind the read).
    for (const [id, t] of f.byId) disk.set(id, t);
    for (const x of f.early) if (!f.byId.has(x.task)) disk.get(x.task)?.events.push(x.event);
    f.early = [];
    f.byId = disk;
    if (!f.last) f.last = last;
    f.loaded = true;
  }

  /**
   * A task made now: its id at once, its line on disk soon (in order). Anything that sends the id waits for
   * durable() (or uses createDurable) first. A create whose line fails is taken out of memory again.
   */
  create(floorId: string, t: NewTask): TaskRecord {
    const rec: TaskRecord = { id: mintTaskId(this.now()), createdAt: this.now(), source: t.source, text: t.text.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX), ...(t.issue !== undefined ? { issue: t.issue } : {}), ...(t.legacyId ? { legacyId: t.legacyId } : {}), events: [] };
    this.mem(floorId).byId.set(rec.id, rec);
    const { events: _e, ...task } = rec;
    const key = `${floorId}\0${rec.id}`;
    const done = this.write(floorId, { op: 'create', task }).then((err) => {
      this.pending.delete(key);
      if (err) {
        this.lost.set(key, err.message);
        const f = this.floors.get(floorId);
        if (f?.byId.get(rec.id) === rec) f.byId.delete(rec.id);
      }
      return err;
    });
    this.pending.set(key, done);
    return rec;
  }

  /** A task made now whose line is on disk: rejects (and nothing knows the id) when it couldn't be written. */
  async createDurable(floorId: string, t: NewTask): Promise<TaskRecord> {
    const rec = this.create(floorId, t);
    await this.durable(floorId, rec.id);
    return rec;
  }

  /**
   * Resolves once task `id`'s create line is on disk; rejects when it couldn't be written. An id this process
   * didn't make (read from the file, or from before a restart) resolves at once.
   */
  async durable(floorId: string, id: string): Promise<void> {
    const key = `${floorId}\0${id}`;
    const err = await this.pending.get(key);
    const why = err?.message ?? this.lost.get(key);
    if (why) throw new Error(why);
  }

  /** An event on a task, kept in memory at once and appended in order. */
  event(floorId: string, taskId: string, e: TaskEvent): void {
    const f = this.mem(floorId);
    const t = f.byId.get(taskId);
    if (t) t.events.push(e);
    else if (!f.loaded) f.early.push({ task: taskId, event: e });
    this.write(floorId, { op: 'event', task: taskId, event: e });
  }

  /** The issue a task's work is filed as, learned after it was made (a proposal's issue). */
  setIssue(floorId: string, taskId: string, issue: number): void {
    const t = this.mem(floorId).byId.get(taskId);
    if (t) t.issue = issue;
    this.write(floorId, { op: 'issue', task: taskId, issue });
  }

  /**
   * A new attempt at a task on `worker`: its execution id, `assigned` the first time and `reassigned` after.
   * `executionId`, when given, was minted before the send (it's in the dispatch record): an attempt already on
   * the record with it isn't written twice.
   */
  attempt(floorId: string, taskId: string, a: { worker: string; role?: string; from?: string; executionId?: string }): string {
    const t = this.mem(floorId).byId.get(taskId);
    if (a.executionId && t?.events.some((e) => (e.type === 'assigned' || e.type === 'reassigned') && e.executionId === a.executionId)) return a.executionId;
    const executionId = a.executionId ?? mintExecutionId(this.now());
    const before = t ? t.events.some((e) => e.type === 'assigned' || e.type === 'reassigned') : !!a.from;
    const at = this.now();
    this.event(floorId, taskId, before ? { type: 'reassigned', at, worker: a.worker, ...(a.role ? { role: a.role } : {}), executionId, ...(a.from ? { from: a.from } : {}) } : { type: 'assigned', at, worker: a.worker, ...(a.role ? { role: a.role } : {}), executionId });
    return executionId;
  }

  /** The task, as far as this process knows it (load the floor first for tasks from before a restart). */
  get(floorId: string, id: string): TaskRecord | undefined {
    return this.floors.get(floorId)?.byId.get(id);
  }

  /** Whether the id names one of the floor's tasks this process knows. */
  has(floorId: string, id: string): boolean {
    return !!this.floors.get(floorId)?.byId.has(id);
  }

  /** The newest open task naming issue `n` (made from a proposal's issue, or a queue task), when there is one. */
  byIssue(floorId: string, n: number): TaskRecord | undefined {
    let best: TaskRecord | undefined;
    for (const t of this.floors.get(floorId)?.byId.values() ?? []) {
      if (t.issue !== n || t.events.some((e) => e.type === 'completed' || e.type === 'cancelled' || e.type === 'superseded')) continue;
      if (!best || t.createdAt > best.createdAt) best = t;
    }
    return best;
  }

  /** Every task of the floor, oldest first. */
  async all(floorId: string): Promise<TaskRecord[]> {
    await this.load(floorId);
    return [...this.mem(floorId).byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Resolves once every line queued so far is settled: ok, or how many of the floor's lines were lost (sticky). */
  async flushed(floorId: string): Promise<TaskFlush> {
    await (this.chains.get(floorId) ?? Promise.resolve()).catch(() => undefined);
    const f = this.failures.get(floorId);
    return f ? { ok: false, ...f } : { ok: true };
  }

  /** Queues a line behind the floor's earlier ones: resolves to the error when it couldn't be written (never rejects). */
  private write(floorId: string, l: TaskLine): Promise<Error | undefined> {
    const prev = this.chains.get(floorId) ?? Promise.resolve();
    const next: Promise<Error | undefined> = prev
      .catch(() => undefined)
      .then(async () => {
        await this.load(floorId);
        const f = this.mem(floorId);
        const body = { ...l, prev: f.last ? sha256(f.last) : '' };
        const line = JSON.stringify({ ...body, hash: sha256(JSON.stringify(body)) });
        await this.fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
        const h = await this.fs.open(this.file(floorId), 'a', 0o600);
        try {
          await h.writeFile(`${line}\n`);
          await h.sync();
        } finally {
          await h.close();
        }
        f.last = line;
        return undefined;
      })
      .catch((err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err));
        const had = this.failures.get(floorId);
        this.failures.set(floorId, { failed: (had?.failed ?? 0) + 1, error: e.message });
        console.error(`agent-office: tasks: couldn't save a task line for ${floorId}: ${e.message}`);
        return e;
      });
    this.chains.set(floorId, next);
    return next;
  }

  /** Whether every line fits its own hash and points at the one before it. */
  async verify(floorId: string): Promise<{ ok: boolean; brokenAt?: number }> {
    let text = '';
    try {
      text = String(await this.fs.readFile(this.file(floorId), 'utf8'));
    } catch {
      return { ok: true };
    }
    let prev = '';
    let n = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      n++;
      let l: Record<string, unknown>;
      try {
        l = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return { ok: false, brokenAt: n };
      }
      const { hash, ...rest } = l;
      if (l.prev !== prev || sha256(JSON.stringify(rest)) !== hash) return { ok: false, brokenAt: n };
      prev = sha256(line);
    }
    return { ok: true };
  }
}

/** One line folded into the tasks read so far. */
function fold(into: Map<string, TaskRecord>, l: TaskLine) {
  if (l.op === 'create' && l.task && typeof l.task.id === 'string') into.set(l.task.id, { ...l.task, events: [] });
  else if (l.op === 'event' && typeof l.task === 'string' && l.event) into.get(l.task)?.events.push(l.event);
  else if (l.op === 'issue' && typeof l.task === 'string' && Number.isInteger(l.issue)) {
    const t = into.get(l.task);
    if (t) t.issue = l.issue;
  }
}
