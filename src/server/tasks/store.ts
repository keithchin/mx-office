// The task record (Slice 1B-4): <data>/tasks/<project>.jsonl, append only, a line per task made or per
// event on one, each hash-chained like the answer store (answers/store.ts: prev is the sha256 of the line
// before, hash is the line's own without that field), so an edited, dropped or reordered line shows.
//
// It's independent of the agents: a member's task and its prevTasks cache on the roster, and a queue task,
// only hold the ids. Minting is synchronous (the id has to be in the text before it's typed): the record is
// in memory at once and its line goes to disk in order behind the floor's earlier ones, one fsync'd append
// at a time, off the event loop. A failed write is logged, never thrown at the caller that typed the task.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { mintExecutionId, mintTaskId } from '../../shared/evidence/ids.js';
import type { TaskEvent, TaskLine, TaskRecord, TaskSource } from '../../shared/tasks.js';
import { sha256 } from '../audit/log.js';

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
    let text = '';
    try {
      text = String(await this.fs.readFile(this.file(floorId), 'utf8'));
    } catch {
      // none yet
    }
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

  /** A task made now: its id at once, its line on disk soon (in order). */
  create(floorId: string, t: NewTask): TaskRecord {
    const rec: TaskRecord = { id: mintTaskId(this.now()), createdAt: this.now(), source: t.source, text: t.text.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX), ...(t.issue !== undefined ? { issue: t.issue } : {}), ...(t.legacyId ? { legacyId: t.legacyId } : {}), events: [] };
    this.mem(floorId).byId.set(rec.id, rec);
    const { events: _e, ...task } = rec;
    this.write(floorId, { op: 'create', task });
    return rec;
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

  /** A new attempt at a task on `worker`: its execution id, `assigned` the first time and `reassigned` after. */
  attempt(floorId: string, taskId: string, a: { worker: string; role?: string; from?: string }): string {
    const executionId = mintExecutionId(this.now());
    const t = this.mem(floorId).byId.get(taskId);
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

  /** Resolves once every line queued so far is on disk (or failed). */
  flushed(floorId: string): Promise<void> {
    return (this.chains.get(floorId) ?? Promise.resolve()).then(
      () => undefined,
      () => undefined,
    );
  }

  private write(floorId: string, l: TaskLine) {
    const prev = this.chains.get(floorId) ?? Promise.resolve();
    const next = prev
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
      })
      .catch((err: unknown) => console.error(`agent-office: tasks: couldn't save a task line for ${floorId}: ${(err as Error).message}`));
    this.chains.set(floorId, next);
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
