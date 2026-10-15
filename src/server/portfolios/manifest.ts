// Context manifests: <data>/context-manifests/<floor>.jsonl, one line per hire of a project in a portfolio
// with a brain (shared/portfolios.ts ContextManifest). A manifest records what the hire was OFFERED: the
// pointer, the brain's snapshot, the routed files with their hashes and what was left out, and why. It
// never claims the agent read or obeyed any of it (the probe saw agents grep the folder instead of
// following the pointer: findings §7). Appended only, never rewritten: old manifests are kept when the
// brain changes or is disconnected. Each floor's file is read once and its latest line per role kept
// in memory.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ContextManifest } from '../../shared/portfolios.js';

const safe = (floor: string) => floor.replace(/[^A-Za-z0-9_-]/g, '_');

export class ManifestStore {
  readonly dir: string;
  private latest = new Map<string, Promise<Map<string, ContextManifest>>>();
  private counts = new Map<string, number>();
  private chain = new Map<string, Promise<unknown>>();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'context-manifests');
  }

  file(floor: string): string {
    return path.join(this.dir, `${safe(floor)}.jsonl`);
  }

  /** Every manifest of a floor, oldest first (for the tests and the existing-context review). */
  async all(floor: string): Promise<ContextManifest[]> {
    const text = await readFile(this.file(floor), 'utf8').catch(() => '');
    const out: ContextManifest[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as ContextManifest);
      } catch {
        // a torn last line: skipped
      }
    }
    return out;
  }

  /** The newest manifest per role of a floor. */
  latestByRole(floor: string): Promise<Map<string, ContextManifest>> {
    let p = this.latest.get(floor);
    if (!p) {
      p = this.all(floor).then((list) => {
        this.counts.set(floor, list.length);
        const m = new Map<string, ContextManifest>();
        for (const x of list) if (!m.has(x.role) || m.get(x.role)!.preparedAt <= x.preparedAt) m.set(x.role, x);
        return m;
      });
      this.latest.set(floor, p);
    }
    return p;
  }

  async count(floor: string): Promise<number> {
    await this.latestByRole(floor);
    return this.counts.get(floor) ?? 0;
  }

  /** Appends one (serialised per floor). */
  append(m: ContextManifest): Promise<void> {
    const prev = this.chain.get(m.floor) ?? Promise.resolve();
    const run = prev.then(async () => {
      const latest = await this.latestByRole(m.floor);
      await mkdir(this.dir, { recursive: true });
      await appendFile(this.file(m.floor), `${JSON.stringify(m)}\n`);
      latest.set(m.role, m);
      this.counts.set(m.floor, (this.counts.get(m.floor) ?? 0) + 1);
    });
    this.chain.set(
      m.floor,
      run.catch(() => undefined),
    );
    return run;
  }
}
