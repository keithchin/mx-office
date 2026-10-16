// The design pointer under a bound project's `Task: tsk_…` line (tasks/lines.ts hook): from the binding and
// selections already in memory, never waiting. The guidance file it names is generated deterministically
// (its name is a hash of the digest, the task's patterns and the exceptions, so the same inputs always name
// the same file) and written in the background if it isn't there yet; the project-wide one is written ahead,
// when the binding or the selections change. What was supplied goes on one line of
// <data>/context-manifests/<floor>.design.jsonl: supplied, never "read".

import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { designLine, guidanceText, patternsForTask } from '../../shared/design/context.js';
import type { DesignContextRecord, ProjectDesignBinding } from '../../shared/design/types.js';
import { windowsForm } from '../../shared/portfolios.js';
import type { TaskLineAsk } from '../tasks/lines.js';
import type { DesignProjects } from './projects.js';

const safe = (floor: string) => floor.replace(/[^A-Za-z0-9_-]/g, '_');

export class DesignLines {
  private written = new Set<string>();
  private chain = new Map<string, Promise<unknown>>();

  constructor(
    private root: string,
    private dataDir: string,
    private projects: DesignProjects,
    private packageDir: (id: string, n: number) => string,
    private now: () => number = Date.now,
  ) {}

  manifestFile(floor: string) {
    return path.join(this.dataDir, 'context-manifests', `${safe(floor)}.design.jsonl`);
  }

  /** The guidance file's path and text for a binding and a set of patterns. */
  guidance(floor: string, b: ProjectDesignBinding, patternIds: readonly string[]): { file: string; text: string } {
    const key = createHash('sha256').update(JSON.stringify([b.digest, b.n, [...patternIds].sort(), b.exceptions, b.applied?.at ?? 0])).digest('hex').slice(0, 12);
    return { file: path.join(this.root, 'guidance', safe(floor), `${key}.md`), text: guidanceText(b, windowsForm(this.packageDir(b.systemId, b.n)), patternIds) };
  }

  /** Writes a guidance file once (same name, same text: never needs writing again). */
  async ensure(g: { file: string; text: string }): Promise<void> {
    if (this.written.has(g.file)) return;
    await mkdir(path.dirname(g.file), { recursive: true });
    await writeFile(g.file, g.text);
    this.written.add(g.file);
  }

  /** The project-wide guidance, ahead of the first task (after a bind or a new selection). */
  async prepare(floor: string): Promise<void> {
    const b = this.projects.binding(floor);
    if (!b) return;
    const sel = await this.projects.selectionsOf(floor);
    await this.ensure(this.guidance(floor, b, patternsForTask(sel, undefined)));
  }

  /** The hook: one line for a bound project's task, nothing for any other. */
  line(t: TaskLineAsk): string | undefined {
    const b = this.projects.binding(t.floorId);
    if (!b) return undefined;
    const patternIds = patternsForTask(this.projects.selectionsNow(t.floorId), t.issue);
    const g = this.guidance(t.floorId, b, patternIds);
    const file = windowsForm(g.file);
    const line = designLine(b, patternIds, file);
    const rec: DesignContextRecord = { floor: t.floorId, taskId: t.taskId, systemId: b.systemId, n: b.n, digest: b.digest, patternIds, guidance: file, line, guidanceChars: g.text.length, at: this.now() };
    this.later(t.floorId, async () => {
      await this.ensure(g);
      await mkdir(path.dirname(this.manifestFile(t.floorId)), { recursive: true });
      await appendFile(this.manifestFile(t.floorId), `${JSON.stringify(rec)}\n`);
    });
    return line;
  }

  /** Background writes, one floor's at a time and in order. */
  private later(floor: string, fn: () => Promise<void>) {
    const run = (this.chain.get(floor) ?? Promise.resolve()).then(fn).catch((err: Error) => console.warn(`agent-office: design guidance for ${floor}: ${err.message}`));
    this.chain.set(floor, run);
  }

  /** Waits for a floor's background writes (tests). */
  settled(floor: string): Promise<unknown> {
    return this.chain.get(floor) ?? Promise.resolve();
  }
}
