// 📦 Deliverables for a floor (shared/deliverables.ts): the scan (scan.ts) over its "main" (the
// project's default branch on GitHub, origin/<default>, read the way the setup panel reads its gates,
// wizard/gate-source.ts, with the same 90 s fetch; the floor's folder only when there's no remote), its
// team's worktrees and the office branches, kept a little while so several pages and a team page
// flipping between teams don't ask git each time; and which folder or branch a file route may read
// (only one the scan listed).

import path from 'node:path';
import { ROLES } from '../../shared/roster/roles.js';
import type { DeliverablesView } from '../../shared/deliverables.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { rosterOf } from '../roster/adapter.js';
import type { Source } from './content.js';
import { scanDeliverables, type ScanInput, type ScanPerson } from './scan.js';
import { branchInfo, fetchDefault } from '../wizard/gate-source.js';
import { commitTime } from './git.js';

/** A scan is handed out again for this long (ms). */
const FRESH_MS = 20_000;
const cache = new Map<string, { at: number; p: Promise<DeliverablesView> }>();

/** The floor's workers and its team members (hired or not, for their names on branches). */
function people(ctx: Ctx, floor: Floor): ScanPerson[] {
  let members: { name: string; role: (typeof ROLES)[number]['id']; workerId?: string }[] = [];
  try {
    const d = rosterOf(ctx).data(floor.id);
    members = ROLES.map((r) => ({ name: d.members[r.id].name, role: r.id, workerId: d.members[r.id].workerId }));
  } catch {
    // no roster: the workers alone
  }
  const out: ScanPerson[] = [];
  for (const w of floor.workers.list()) {
    const m = members.find((x) => x.workerId === w.id);
    out.push({ workerId: w.id, name: m?.name ?? w.name, role: m?.role, ...(w.worktree && !w.lost ? { dir: path.resolve(floor.dir, w.worktree.path), branch: w.worktree.branch } : {}) });
  }
  for (const m of members) if (!out.some((p) => p.role === m.role)) out.push({ name: m.name, role: m.role });
  return out;
}

/** What to scan: main is origin/<default> when the project has one (fetched at most every 90 s), else the folder. */
export async function scanInput(floor: Pick<Floor, 'id' | 'dir'>, who: ScanPerson[], fetch = true): Promise<ScanInput> {
  const input: ScanInput = { floor: floor.id, dir: floor.dir, people: who };
  let info = await branchInfo(floor.dir);
  if (!info) return input;
  if (fetch) {
    // Waited for only the first time this office looks; after that the next scan sees what it brought.
    const f = fetchDefault(floor.dir, info.def);
    if (!fetchedOnce.has(floor.dir)) {
      fetchedOnce.add(floor.dir);
      await f;
      info = (await branchInfo(floor.dir)) ?? info;
    }
  }
  input.main = { def: info.def, sha: info.sha, at: await commitTime(floor.dir, info.sha) };
  if (info.branch !== info.def || info.behind > 0) input.checkout = { branch: info.branch, behind: info.behind, defaultBranch: info.def };
  return input;
}
const fetchedOnce = new Set<string>();

/** The floor's deliverables, scanned at most every FRESH_MS (or now, with `fresh`). Never throws. */
export function deliverablesOf(ctx: Ctx, floor: Floor, fresh = false): Promise<DeliverablesView> {
  const hit = cache.get(floor.id);
  if (hit && !fresh && Date.now() - hit.at < FRESH_MS) return hit.p;
  const p = scanInput(floor, people(ctx, floor))
    .then((input) => scanDeliverables(input))
    .catch(() => ({ floor: floor.id, scannedAt: Date.now(), items: [], sources: [] }) as DeliverablesView);
  cache.set(floor.id, { at: Date.now(), p });
  return p;
}

/**
 * Where `src` (main, wt:<worker>, ref:<branch>) says to read on this floor, if it's a place the latest
 * scan looked in: a worker's own worktree folder, or one of the branches it listed.
 */
export async function sourceOf(ctx: Ctx, floor: Floor, src: string): Promise<Source | undefined> {
  const view = await deliverablesOf(ctx, floor);
  if (src === 'main') {
    // origin/<default>, as the scan reads it (the folder only with no remote).
    const info = view.main ? await branchInfo(floor.dir) : undefined;
    return info ? { repo: floor.dir, branch: `origin/${info.def}` } : { dir: floor.dir };
  }
  if (!view.sources.some((s) => s.src === src)) return undefined;
  if (src.startsWith('wt:')) {
    const w = floor.workers.get(src.slice(3));
    return w?.worktree && !w.lost ? { dir: path.resolve(floor.dir, w.worktree.path) } : undefined;
  }
  if (src.startsWith('ref:')) return { repo: floor.dir, branch: src.slice(4) };
  return undefined;
}
