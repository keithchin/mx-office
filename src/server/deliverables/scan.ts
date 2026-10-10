// The deliverables scan: every catalog or extra path (shared/deliverables.ts) in the floor's main
// checkout, in each hired team member's worktree (uncommitted work included), and on the office's
// other branches (committed work not merged yet), put together into the view the panels show.
// Read-only; a branch's listing is cached by its head commit (git.ts), a checkout's is read fresh.

import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  DELIVERABLES,
  draftByHead,
  draftByName,
  extraTeam,
  isDeliverablePath,
  itemStatus,
  kindOf,
  specFor,
  unsortedReport,
  type DeliverableFile,
  type DeliverableItem,
  type DeliverablesView,
  type DeliverableWhere,
} from '../../shared/deliverables.js';
import type { RoleId, TeamId } from '../../shared/roster/roles.js';
import { TEAM_IDS } from '../../shared/roster/card-team.js';
import { changedSinceFork, checkoutFiles, committedIds, headOf, officeBranches, treeAt } from './git.js';

/** Someone on the floor: a worker, and the team role it is, if it's a team member. */
export interface ScanPerson {
  workerId?: string;
  name: string;
  role?: RoleId;
  /** Its worktree, absolute, and the branch it's on. */
  dir?: string;
  branch?: string;
}

export interface ScanInput {
  floor: string;
  /** The floor's main checkout. */
  dir: string;
  /** The floor's workers (with their roles, for the team's), and the team members not hired (for their names on branches). */
  people: ScanPerson[];
  /**
   * The project's default branch on GitHub, when it has one: "main" is then origin/<def> at `sha`
   * (committed `at`), not whatever the floor's folder has checked out (gate-source.ts's reading).
   */
  main?: { def: string; sha: string; at: number };
  /** The floor's folder when it's on another branch than the default one, or behind it. */
  checkout?: { branch: string; behind: number; defaultBranch: string };
}

/** How many files one item lists (the rest is a count). */
const ITEM_FILES = 60;
const EXTRA_FILES = 40;
const HEAD_BYTES = 3000;

interface Found {
  where: DeliverableWhere[];
  /** The blob id on main, when it's committed there unchanged. */
  oid?: string;
  size?: number;
  mtime?: number;
  draft: boolean;
  onMain: boolean;
}

async function head(file: string): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

/** A checkout's deliverable files with their size, time, committed blob id and whether they're drafts. */
async function checkout(dir: string): Promise<Map<string, { size: number; mtime: number; draft: boolean; oid?: string }>> {
  const out = new Map<string, { size: number; mtime: number; draft: boolean; oid?: string }>();
  const [listed, ids] = await Promise.all([checkoutFiles(dir), committedIds(dir)]);
  const paths = (listed ?? []).filter(isDeliverablePath);
  for (let i = 0; i < paths.length; i += 32) {
    await Promise.all(
      paths.slice(i, i + 32).map(async (p) => {
        try {
          const abs = path.join(dir, p);
          const s = await stat(abs);
          if (!s.isFile()) return;
          const k = kindOf(p);
          const draft = draftByName(p) || ((k === 'md' || k === 'html') && draftByHead(await head(abs)));
          out.set(p, { size: s.size, mtime: Math.round(s.mtimeMs), draft, oid: ids.get(p) });
        } catch {
          // gone since git listed it
        }
      }),
    );
  }
  return out;
}

/** Who a branch is: the worker on it, else a name it starts with (office/barbara-stage1), else its own name. */
export function branchOwner(branch: string, people: readonly ScanPerson[]): { who: string; role?: RoleId } {
  const local = branch.replace(/^origin\//, '');
  const on = people.find((p) => p.branch === local);
  if (on) return { who: on.name, role: on.role };
  const word = /^office\/([^/]+)/.exec(local)?.[1]?.toLowerCase() ?? '';
  const named = [...people].sort((a, b) => (b.role ? 1 : 0) - (a.role ? 1 : 0)).find((p) => p.name && (word === p.name.toLowerCase() || word.startsWith(`${p.name.toLowerCase()}-`)));
  if (named) return { who: named.name, role: named.role };
  const bare = word.replace(/-[0-9a-f]{3,}$/, '');
  return { who: bare ? bare[0].toUpperCase() + bare.slice(1) : local };
}

export async function scanDeliverables(input: ScanInput, now = Date.now()): Promise<DeliverablesView> {
  const found = new Map<string, Found>();
  if (input.main) {
    // On main means on origin/<default>: what has merged, whatever branch the floor's folder is on.
    const label = `origin/${input.main.def}`;
    for (const t of await treeAt(input.dir, input.main.sha)) {
      if (isDeliverablePath(t.path)) found.set(t.path, { where: [{ src: 'main', label }], oid: t.oid, size: t.size, mtime: input.main.at, draft: draftByName(t.path), onMain: true });
    }
  } else {
    for (const [p, f] of await checkout(input.dir)) found.set(p, { where: [{ src: 'main', label: 'main' }], oid: f.oid, size: f.size, mtime: f.mtime, draft: f.draft, onMain: true });
  }
  const base = input.main?.sha ?? 'HEAD';
  const sources: DeliverableWhere[] = [];
  /** Adds a place a file is, unless it's the same file as on main (the same blob). */
  const add = (p: string, where: DeliverableWhere, oid: string | undefined, size: number | undefined, mtime: number | undefined, draft: boolean) => {
    const f = found.get(p);
    if (f?.onMain && oid && f.oid === oid) return;
    if (!f) found.set(p, { where: [where], size, mtime, draft, onMain: false });
    else {
      f.where.push(where);
      if (!f.onMain) f.draft ||= draft;
      if (!f.onMain && (mtime ?? 0) > (f.mtime ?? 0)) {
        f.mtime = mtime;
        f.size = size;
      }
    }
  };

  // The team's worktrees: what a Lead is still writing, committed or not.
  const members = input.people.filter((p) => p.role && p.dir && p.workerId);
  const viaWorktree = new Set<string>();
  for (const m of members) {
    if (path.resolve(m.dir!) === path.resolve(input.dir)) continue;
    const files = await checkout(m.dir!);
    const where: DeliverableWhere = { src: `wt:${m.workerId}`, label: `${m.name}'s worktree`, branch: m.branch, who: m.name, role: m.role };
    sources.push(where);
    if (m.branch) viaWorktree.add(m.branch);
    // Its own work: what it changed since its branch forked from main, committed or not (no oid: changed in the folder).
    const head = await headOf(m.dir!);
    const mine = head ? await changedSinceFork(input.dir, head, base) : undefined;
    for (const [p, f] of files) if (!f.oid || !mine || mine.has(p)) add(p, where, f.oid, f.size, f.mtime, f.draft);
  }

  // Every other office branch: committed work not merged.
  const also = input.people.map((p) => p.branch).filter((b): b is string => !!b);
  for (const b of await officeBranches(input.dir, also)) {
    if (viaWorktree.has(b.name) || viaWorktree.has(b.name.replace(/^origin\//, ''))) continue;
    const owner = branchOwner(b.name, input.people);
    const where: DeliverableWhere = { src: `ref:${b.name}`, label: b.name, branch: b.name, who: owner.who, role: owner.role };
    let any = false;
    // Only what the branch itself changed since it forked: not the older copies of files main moved on from.
    const mine = await changedSinceFork(input.dir, b.sha, base);
    for (const t of await treeAt(input.dir, b.sha)) {
      if (!isDeliverablePath(t.path) || (mine && !mine.has(t.path))) continue;
      any = true;
      add(t.path, where, t.oid, t.size, b.at, draftByName(t.path));
    }
    if (any) sources.push(where);
  }

  const files = new Map<string, DeliverableFile>();
  for (const [p, f] of found) {
    if (!f.onMain && !f.where.length) continue;
    files.set(p, { path: p, kind: kindOf(p), status: f.draft ? 'draft' : f.onMain ? 'present' : 'branch', size: f.size, mtime: f.mtime, where: f.where });
  }
  const sorted = [...files.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  const items: DeliverableItem[] = DELIVERABLES.map((d) => {
    const mine = sorted.filter((f) => specFor(f.path)?.id === d.id);
    return {
      id: d.id,
      team: d.team,
      stage: d.stage,
      title: d.title,
      owner: d.owner,
      ...(d.optional ? { optional: true } : {}),
      status: itemStatus(mine),
      files: mine.slice(0, ITEM_FILES),
      ...(mine.length > ITEM_FILES ? { more: mine.length - ITEM_FILES } : {}),
    };
  });
  for (const team of TEAM_IDS as readonly TeamId[]) {
    const mine = sorted.filter((f) => extraTeam(f.path) === team);
    if (!mine.length) continue;
    // Newest first: the extras are what someone just made.
    mine.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
    items.push({ id: `extras-${team}`, team, title: 'Beyond the toolkit', optional: true, status: itemStatus(mine), files: mine.slice(0, EXTRA_FILES), ...(mine.length > EXTRA_FILES ? { more: mine.length - EXTRA_FILES } : {}) });
  }
  // A report straight under reports/ that's no analyst report and in no team's folder: the Project Coordinator sorts it.
  const unsorted = sorted.filter((f) => unsortedReport(f.path)).sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  if (unsorted.length) items.push({ id: 'unsorted-reports', team: 'management', title: 'Unsorted reports', optional: true, status: itemStatus(unsorted), files: unsorted.slice(0, EXTRA_FILES), ...(unsorted.length > EXTRA_FILES ? { more: unsorted.length - EXTRA_FILES } : {}) });
  return { floor: input.floor, scannedAt: now, items, sources, ...(input.main ? { main: `origin/${input.main.def}`, sourceCommit: input.main.sha } : {}), ...(input.checkout ? { checkout: input.checkout } : {}) };
}
