// The projects' side of design systems, in <data>/design-systems/projects.json: each floor's binding (the
// exact version it adopted), its apply step record (started → done | failed, written before mxcli runs, so a
// restart or a Retry never applies twice), its pending existing-app proposal (one ✋ card) and that adoption's
// operation record (./adoption.ts: one per project, written before each consequential step). The binding
// is also committed as `design` in the project's agent-office.project.json, beside the toolkit pin (survives
// clones; agents can read it). Pattern selections are append-only lines in selections/<floor>.jsonl.
// Everything here is read once and kept in memory, so the agent-context line can ask without waiting.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadJson } from '../durable/read.js';
import { writeJsonCritical, writeTextCritical } from '../flow/critical-write.js';
import type { DesignAdoption, DesignProposal, PatternSelection, ProjectDesignBinding } from '../../shared/design/types.js';

export const PROJECT_FILE = 'agent-office.project.json';

export interface ApplyRecord {
  /** `<floor>|<digest>`: one apply per binding. */
  key: string;
  state: 'started' | 'done' | 'failed';
  at: number;
  detail?: string;
}

interface ProjectsFile {
  version: 1;
  bindings: Record<string, ProjectDesignBinding>;
  applies: Record<string, ApplyRecord>;
  proposals: Record<string, DesignProposal>;
  adoptions: Record<string, DesignAdoption>;
}

const safe = (floor: string) => floor.replace(/[^A-Za-z0-9_-]/g, '_');

export class DesignProjects {
  private data: ProjectsFile = { version: 1, bindings: {}, applies: {}, proposals: {}, adoptions: {} };
  private loaded?: Promise<void>;
  private chain: Promise<unknown> = Promise.resolve();
  private selections = new Map<string, PatternSelection[]>();

  constructor(private root: string) {}

  get file() {
    return path.join(this.root, 'projects.json');
  }

  load(): Promise<void> {
    this.loaded ??= loadJson(
      this.file,
      (v) => {
        if (v === undefined) return;
        const r = v as Partial<ProjectsFile>;
        this.data = { version: 1, bindings: r.bindings ?? {}, applies: r.applies ?? {}, proposals: r.proposals ?? {}, adoptions: r.adoptions ?? {} };
      },
      () => (this.loaded = undefined),
    );
    return this.loaded;
  }

  /** As loaded (nothing before the first load: a line asked for then is simply not given). */
  binding(floor: string): ProjectDesignBinding | undefined {
    return this.data.bindings[floor];
  }
  apply(floor: string): ApplyRecord | undefined {
    return this.data.applies[floor];
  }
  proposal(floor: string): DesignProposal | undefined {
    return this.data.proposals[floor];
  }
  bindings(): Readonly<Record<string, ProjectDesignBinding>> {
    return this.data.bindings;
  }
  /** The project's existing-app adoption record (a copy: change it through setAdoption). */
  adoption(floor: string): DesignAdoption | undefined {
    const a = this.data.adoptions[floor];
    return a ? structuredClone(a) : undefined;
  }
  adoptionFloors(): string[] {
    return Object.keys(this.data.adoptions);
  }

  private change<T>(fn: (d: ProjectsFile) => T): Promise<T> {
    const run = this.chain.then(async () => {
      await this.load();
      const out = fn(this.data);
      await writeJsonCritical(this.file, this.data);
      return out;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Records a floor's binding here and in its folder's agent-office.project.json (`design`, other keys kept). */
  async bind(floor: string, dir: string | undefined, b: ProjectDesignBinding): Promise<void> {
    await this.change((d) => {
      d.bindings[floor] = b;
      delete d.proposals[floor];
    });
    if (dir) await writeProjectRecord(dir, b);
  }

  setApply(floor: string, r: ApplyRecord): Promise<void> {
    return this.change((d) => void (d.applies[floor] = r));
  }

  /** Writes the adoption record (durably: resolves once it's on disk). */
  setAdoption(a: DesignAdoption): Promise<void> {
    const copy = structuredClone(a);
    return this.change((d) => void (d.adoptions[a.floor] = copy));
  }

  /** The adoption's candidate became the project's binding (merged): binding, record and card in one write. */
  activate(a: DesignAdoption, b: ProjectDesignBinding): Promise<void> {
    const copy = structuredClone(a);
    return this.change((d) => {
      d.bindings[a.floor] = b;
      d.adoptions[a.floor] = copy;
      delete d.proposals[a.floor];
    });
  }

  propose(p: DesignProposal): Promise<void> {
    return this.change((d) => void (d.proposals[p.floor] = p));
  }

  dropProposal(floor: string): Promise<DesignProposal | undefined> {
    return this.change((d) => {
      const had = d.proposals[floor];
      delete d.proposals[floor];
      return had;
    });
  }

  /** Forgets a deleted project's records (its committed file goes with its folder). */
  forget(floor: string): Promise<void> {
    return this.change((d) => {
      delete d.bindings[floor];
      delete d.applies[floor];
      delete d.proposals[floor];
      delete d.adoptions[floor];
    });
  }

  // ---- Pattern selections ------------------------------------------------------------------------

  selectionsFile(floor: string) {
    return path.join(this.root, 'selections', `${safe(floor)}.jsonl`);
  }

  /** The floor's selections, oldest first (read once, then kept). */
  async selectionsOf(floor: string): Promise<PatternSelection[]> {
    const hit = this.selections.get(floor);
    if (hit) return hit;
    const text = await readFile(this.selectionsFile(floor), 'utf8').catch(() => '');
    const list: PatternSelection[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        list.push(JSON.parse(line) as PatternSelection);
      } catch {
        // a torn last line
      }
    }
    this.selections.set(floor, list);
    return list;
  }

  /** As already read (empty when not read yet): for the line, which can't wait. */
  selectionsNow(floor: string): readonly PatternSelection[] {
    if (!this.selections.has(floor)) void this.selectionsOf(floor);
    return this.selections.get(floor) ?? [];
  }

  async select(floor: string, s: PatternSelection): Promise<void> {
    const list = await this.selectionsOf(floor);
    await mkdir(path.dirname(this.selectionsFile(floor)), { recursive: true });
    await appendFile(this.selectionsFile(floor), `${JSON.stringify(s)}\n`);
    list.push(s);
  }
}

/**
 * The committed record: `design` in agent-office.project.json, the file's other settings kept as they are. A file
 * that is there but isn't valid JSON is never overwritten (it throws: nothing is changed).
 */
export async function writeProjectRecord(dir: string, b: ProjectDesignBinding): Promise<void> {
  const f = path.join(dir, PROJECT_FILE);
  let obj: Record<string, unknown> = {};
  const was = await readFile(f, 'utf8').catch(() => undefined);
  if (was !== undefined) {
    try {
      const v = JSON.parse(was) as unknown;
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
      obj = v as Record<string, unknown>;
    } catch {
      throw new Error(`${PROJECT_FILE} isn't valid JSON: left as it is (fix it, then Retry)`);
    }
  }
  const { systemId, name, n, digest, kind, themeName, preset, approval, exceptions, start } = b;
  await writeTextCritical(f, `${JSON.stringify({ ...obj, design: { systemId, name, version: n, digest, kind, ...(themeName ? { themeName } : {}), preset, approval, exceptions, ...(start ? { start } : {}) } }, null, 2)}\n`);
}

/** The `design` record in a project folder's agent-office.project.json, when it has one. */
export async function readProjectRecord(dir: string): Promise<Record<string, unknown> | undefined> {
  try {
    const d = (JSON.parse(await readFile(path.join(dir, PROJECT_FILE), 'utf8')) as { design?: unknown }).design;
    return d && typeof d === 'object' ? (d as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
