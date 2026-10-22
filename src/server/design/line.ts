// The design pointer under a bound project's `Task: tsk_…` line (tasks/lines.ts hook): from the binding and
// selections already in memory, never waiting. The guidance file it names is generated deterministically (its
// name is a hash of the digest, the task's patterns and the exceptions, so the same inputs always name the same
// file) and written AHEAD, with the critical write (temp file, fsync, rename): every file a task of the project
// can be given (the project-wide one and one per issue with selections of its own) when the binding or the
// selections change and at start. The line gives a path only when that file is already written; otherwise it
// says the guidance couldn't be prepared (no path), the manifest records it as unavailable, and the file is
// written for the next task. A project with no binding gets no line, as before; a version that is only a
// candidate on its branch (./adoption.ts) gets a line saying so, never one that says it is applied.
// What was supplied goes on one line of <data>/context-manifests/<floor>.design.jsonl: supplied, never "read".

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { candidateLine, designLine, guidanceText, patternsForTask, unavailableLine } from '../../shared/design/context.js';
import type { DesignContextRecord, ProjectDesignBinding } from '../../shared/design/types.js';
import { windowsForm } from '../../shared/portfolios.js';
import { writeTextCritical } from '../flow/critical-write.js';
import type { TaskLineAsk } from '../tasks/lines.js';
import type { DesignProjects } from './projects.js';

const safe = (floor: string) => floor.replace(/[^A-Za-z0-9_-]/g, '_');

/** Writes a guidance file; resolves once it's whole on disk (a test's may be slow or fail). */
export type GuidanceWriter = (file: string, text: string) => Promise<void>;

export class DesignLines {
  /** Files known to be whole on disk (written here, or found at their exact size: every write is atomic). */
  private ready = new Set<string>();
  private pending = new Map<string, Promise<void>>();
  private failures = new Map<string, string>();
  private chain = new Map<string, Promise<unknown>>();

  constructor(
    private root: string,
    private dataDir: string,
    private projects: DesignProjects,
    private packageDir: (id: string, n: number) => string,
    private now: () => number = Date.now,
    private write: GuidanceWriter = (file, text) => writeTextCritical(file, text),
  ) {}

  manifestFile(floor: string) {
    return path.join(this.dataDir, 'context-manifests', `${safe(floor)}.design.jsonl`);
  }

  /** The guidance file's path and text for a binding and a set of patterns. */
  guidance(floor: string, b: ProjectDesignBinding, patternIds: readonly string[]): { file: string; text: string } {
    const key = createHash('sha256').update(JSON.stringify([b.digest, b.n, [...patternIds].sort(), b.exceptions, b.applied?.at ?? 0])).digest('hex').slice(0, 12);
    return { file: path.join(this.root, 'guidance', safe(floor), `${key}.md`), text: guidanceText(b, windowsForm(this.packageDir(b.systemId, b.n)), patternIds) };
  }

  /** Writes a guidance file once (same name, same text: never needs writing again); rejects when it couldn't. */
  ensure(g: { file: string; text: string }): Promise<void> {
    if (this.ready.has(g.file)) return Promise.resolve();
    let p = this.pending.get(g.file);
    if (!p) {
      p = this.write(g.file, g.text)
        .then(
          () => {
            this.ready.add(g.file);
            this.failures.delete(g.file);
          },
          (err: Error) => {
            this.failures.set(g.file, err.message);
            throw err;
          },
        )
        .finally(() => this.pending.delete(g.file));
      this.pending.set(g.file, p);
    }
    return p;
  }

  /** Whether the file is whole on disk now (never waits: one stat at most). */
  private isReady(g: { file: string; text: string }): boolean {
    if (this.ready.has(g.file)) return true;
    if (this.pending.has(g.file)) return false;
    try {
      if (statSync(g.file).size !== Buffer.byteLength(g.text)) return false;
    } catch {
      return false;
    }
    this.ready.add(g.file);
    return true;
  }

  /** Every guidance file a task of the project can be given, written before any task is given its path. */
  async prepare(floor: string): Promise<void> {
    const b = this.projects.binding(floor);
    if (!b) return;
    const sel = await this.projects.selectionsOf(floor);
    const issues = [...new Set(sel.flatMap((s) => ('issue' in s.scope ? [s.scope.issue] : [])))];
    const sets = [patternsForTask(sel, undefined), ...issues.map((i) => patternsForTask(sel, i))];
    const out = await Promise.allSettled(sets.map((ids) => this.ensure(this.guidance(floor, b, ids))));
    const bad = out.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (bad) throw bad.reason;
  }

  /** The hook: one line for a bound project's task (or a candidate's), nothing for any other. */
  line(t: TaskLineAsk): string | undefined {
    const b = this.projects.binding(t.floorId);
    if (!b) return this.candidate(t);
    const patternIds = patternsForTask(this.projects.selectionsNow(t.floorId), t.issue);
    const g = this.guidance(t.floorId, b, patternIds);
    const base = { floor: t.floorId, taskId: t.taskId, systemId: b.systemId, n: b.n, digest: b.digest, patternIds, at: this.now() };
    if (this.isReady(g)) {
      const file = windowsForm(g.file);
      const line = designLine(b, patternIds, file);
      this.record(t.floorId, { ...base, guidance: file, line, status: 'supplied', guidanceChars: g.text.length });
      return line;
    }
    // Not there (yet): no path is given, the manifest says so, and it's written for the next task.
    const reason = this.failures.get(g.file) ?? (this.pending.has(g.file) ? 'still being written' : 'not written yet');
    const line = unavailableLine(b);
    this.record(t.floorId, { ...base, line, status: 'unavailable', reason: reason.slice(0, 200), guidanceChars: 0 });
    void this.ensure(g).catch((err: Error) => console.warn(`agent-office: design guidance for ${t.floorId}: ${err.message}`));
    return line;
  }

  /** No binding, but a version committed on its branch and not merged: said as a candidate, nothing more. */
  private candidate(t: TaskLineAsk): string | undefined {
    const a = this.projects.adoption(t.floorId);
    if (!a?.commit || !a.branch || a.status === 'active' || a.status === 'discarded') return undefined;
    const line = candidateLine(a, a.branch);
    this.record(t.floorId, { floor: t.floorId, taskId: t.taskId, systemId: a.systemId, n: a.n, digest: a.digest, patternIds: [], line, status: 'candidate', guidanceChars: 0, at: this.now() });
    return line;
  }

  private record(floor: string, rec: DesignContextRecord) {
    this.later(floor, async () => {
      await mkdir(path.dirname(this.manifestFile(floor)), { recursive: true });
      await appendFile(this.manifestFile(floor), `${JSON.stringify(rec)}\n`);
    });
  }

  /** Background manifest lines, one floor's at a time and in order. */
  private later(floor: string, fn: () => Promise<void>) {
    const run = (this.chain.get(floor) ?? Promise.resolve()).then(fn).catch((err: Error) => console.warn(`agent-office: design manifest for ${floor}: ${err.message}`));
    this.chain.set(floor, run);
  }

  /** Waits for a floor's background writes (tests). */
  settled(floor: string): Promise<unknown> {
    // The guidance files still being written too, so a test's folder can go once this resolves.
    return Promise.allSettled([this.chain.get(floor), ...this.pending.values()]);
  }
}
