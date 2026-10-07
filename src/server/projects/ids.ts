// Stable project ids (docs/knowledge-evals/gap-map.md, section 3). A floor id is a slug of the floor's
// name and can change: a floor taken off and added again under another name gets a new slug, and a
// removed floor's slug can be reused by a different project. So each project gets a `prj_<ulid>` the
// first time the office sees its floor, kept in two places:
//   - on the floor itself, FloorDef.projectId in floors.json (Building stamps it on every save, so
//     floors from before this existed get one on the office's first load);
//   - in <data>/projects/ids.json, which outlives the floor: the repository and checkout each project
//     id was seen with, so adding the same repository again (or the same checkout, for a floor with no
//     repository) gets the same id back.
// The floor id stays the routing key everywhere; only the Evals and Library work translates.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isProjectId, mintProjectId, type ProjectId } from '../../shared/evidence/ids.js';
import { normalizeRepo, sameRepo } from '../../shared/floors.js';
import { writeJsonAtomic } from '../flow/store.js';

/** What the registry remembers of one project. */
export interface ProjectEntry {
  projectId: ProjectId;
  /** owner/name, when the floor had one. */
  repo?: string;
  /** Checkouts it was seen at (normalized). */
  dirs: string[];
  /** Every floor id it has had, oldest first. */
  floorIds: string[];
  /** The floor id it has now; cleared when another project takes that id over. */
  currentFloorId?: string;
  createdAt: number;
  lastSeenAt: number;
}

interface RegistryFile {
  version: 1;
  projects: ProjectEntry[];
}

/** The part of a floor the registry goes by (FloorDef, without importing building.ts). */
export interface FloorLike {
  id: string;
  repo?: string;
  dir: string;
  projectId?: string;
}

const normDir = (dir: string) => {
  const r = path.resolve(dir);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

export class ProjectIds {
  readonly file: string;
  private entries: ProjectEntry[] = [];

  constructor(
    dataDir: string,
    private now: () => number = Date.now,
  ) {
    this.file = path.join(dataDir, 'projects', 'ids.json');
    this.load();
  }

  /**
   * The project id for a floor: the one it already carries, else the one its repository (or its
   * checkout, when it has no repository) had before, else a new one. Recorded either way.
   */
  ensure(floor: FloorLike): ProjectId {
    const repo = normalizeRepo(floor.repo);
    const dir = normDir(floor.dir);
    const carried = isProjectId(floor.projectId) ? floor.projectId : undefined;
    // The id the floor carries wins; only a floor without one is matched by repository or checkout.
    let e = carried
      ? this.entries.find((x) => x.projectId === carried)
      : repo
        ? this.entries.find((x) => sameRepo(x.repo, repo))
        : this.entries.find((x) => !x.repo && x.dirs.includes(dir));
    let changed = false;
    if (!e) {
      const at = this.now();
      e = { projectId: carried ?? mintProjectId(at), dirs: [], floorIds: [], createdAt: at, lastSeenAt: at };
      this.entries.push(e);
      changed = true;
    }
    if (repo && !e.repo) {
      e.repo = repo;
      changed = true;
    }
    if (!e.dirs.includes(dir)) {
      e.dirs = [...e.dirs, dir].slice(-10);
      changed = true;
    }
    if (e.floorIds[e.floorIds.length - 1] !== floor.id) {
      e.floorIds = [...e.floorIds.filter((f) => f !== floor.id), floor.id].slice(-20);
      changed = true;
    }
    if (e.currentFloorId !== floor.id) {
      for (const other of this.entries) if (other !== e && other.currentFloorId === floor.id) delete other.currentFloorId;
      e.currentFloorId = floor.id;
      changed = true;
    }
    if (changed) {
      e.lastSeenAt = this.now();
      this.save();
    }
    return e.projectId;
  }

  /**
   * The project a floor id stands for when only the id is known (an old record): the project whose
   * current floor it is, else the latest one that had it. Always inferred, since a slug can be reused.
   */
  byFloorId(floorId: string): ProjectId | undefined {
    const current = this.entries.find((e) => e.currentFloorId === floorId);
    if (current) return current.projectId;
    return this.entries.filter((e) => e.floorIds.includes(floorId)).sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0]?.projectId;
  }

  get(projectId: string): ProjectEntry | undefined {
    const e = this.entries.find((x) => x.projectId === projectId);
    return e && { ...e, dirs: [...e.dirs], floorIds: [...e.floorIds] };
  }

  list(): ProjectEntry[] {
    return this.entries.map((e) => ({ ...e, dirs: [...e.dirs], floorIds: [...e.floorIds] }));
  }

  private load() {
    let raw: Partial<RegistryFile>;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<RegistryFile>;
    } catch {
      return; // none yet: every floor's id is minted (or adopted from floors.json) as it's seen
    }
    const seen = new Set<string>();
    for (const p of Array.isArray(raw.projects) ? raw.projects : []) {
      if (!p || !isProjectId(p.projectId) || seen.has(p.projectId)) continue;
      seen.add(p.projectId);
      this.entries.push({
        projectId: p.projectId,
        ...(normalizeRepo(p.repo) ? { repo: normalizeRepo(p.repo) } : {}),
        dirs: Array.isArray(p.dirs) ? p.dirs.filter((d): d is string => typeof d === 'string').slice(-10) : [],
        floorIds: Array.isArray(p.floorIds) ? p.floorIds.filter((f): f is string => typeof f === 'string').slice(-20) : [],
        ...(typeof p.currentFloorId === 'string' ? { currentFloorId: p.currentFloorId } : {}),
        createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
        lastSeenAt: typeof p.lastSeenAt === 'number' ? p.lastSeenAt : 0,
      });
    }
  }

  private save() {
    try {
      writeJsonAtomic(this.file, { version: 1, projects: this.entries } satisfies RegistryFile);
    } catch (err) {
      console.error(`agent-office: couldn't save the project ids: ${(err as Error).message}`);
    }
  }
}

const registries = new Map<string, ProjectIds>();

/** The office's registry for a data dir (one per office; tests make their own with `new`). */
export function projectIdsFor(dataDir: string): ProjectIds {
  const key = path.resolve(dataDir);
  let r = registries.get(key);
  if (!r) {
    r = new ProjectIds(dataDir);
    registries.set(key, r);
  }
  return r;
}
