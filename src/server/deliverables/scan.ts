// The deliverables scan: every catalog or extra path (shared/deliverables.ts) in the floor's main
// checkout, in each hired team member's worktree (uncommitted work included), and on the office's
// other branches (committed work not merged yet), put together into the view the panels show.
// Read-only, and cheap to ask again: a branch's own work is one `git diff --raw` cached by its commit
// and main's (git.ts), a worktree one `git status` plus its commit's cached tree, and only the files
// that will show are stat'ed (a draft's banner read once per version of the file). Worktrees and
// branches are looked at a few at a time, every git call off the event loop.

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
import { blobSizes, forkChanges, GIT_PARALLEL, headOf, officeBranches, pool, treeAt, worktreeState } from './git.js';

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

/** A file's draft banner, read once per version of the file (its path, size and time). */
const banners = new Map<string, boolean>();
async function draftAt(abs: string, p: string, size: number, mtime: number): Promise<boolean> {
  if (draftByName(p)) return true;
  const k = kindOf(p);
  if (k !== 'md' && k !== 'html') return false;
  const key = `${abs}\0${size}\0${mtime}`;
  const hit = banners.get(key);
  if (hit !== undefined) return hit;
  const draft = draftByHead(await head(abs));
  banners.set(key, draft);
  if (banners.size > 5000) banners.delete(banners.keys().next().value!);
  return draft;
}

/** A checkout file: its committed blob id, unless it's changed (or new) in the folder. */
type CheckoutFile = { oid?: string };

/** A checkout's deliverable files, from its commit's tree (cached) and one `git status`; undefined when it isn't a git checkout. */
async function checkoutFiles(repo: string, dir: string): Promise<{ head?: string; files: Map<string, CheckoutFile> } | undefined> {
  const st = await worktreeState(dir);
  if (!st) return undefined;
  const files = new Map<string, CheckoutFile>();
  for (const t of st.head ? await treeAt(repo, st.head) : []) {
    if (isDeliverablePath(t.path) && !st.gone.has(t.path)) files.set(t.path, st.dirty.has(t.path) ? {} : { oid: t.oid });
  }
  for (const p of st.dirty) if (!files.has(p) && !st.gone.has(p) && isDeliverablePath(p)) files.set(p, {});
  return { head: st.head, files };
}

/** `paths` in `dir` with their size, time and whether they're drafts (a few dozen at a time; one gone since git listed it is left out). */
async function statFiles(dir: string, paths: readonly string[]): Promise<Map<string, { size: number; mtime: number; draft: boolean }>> {
  const out = new Map<string, { size: number; mtime: number; draft: boolean }>();
  await pool(paths, 32, async (p) => {
    try {
      const abs = path.join(dir, p);
      const s = await stat(abs);
      if (!s.isFile()) return;
      const mtime = Math.round(s.mtimeMs);
      out.set(p, { size: s.size, mtime, draft: await draftAt(abs, p, s.size, mtime) });
    } catch {
      // gone since git listed it
    }
  });
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

/** One place's files, before they're put together: each with its blob (when committed), size, time and draft. */
type Listing = { where: DeliverableWhere; files: { path: string; oid?: string; size?: number; mtime?: number; draft: boolean }[] };

export async function scanDeliverables(input: ScanInput, now = Date.now()): Promise<DeliverablesView> {
  const found = new Map<string, Found>();
  // Main, the worktrees and the branches are read side by side; what they found is put together in order after.
  const base = input.main?.sha ?? (await headOf(input.dir));
  const mainP = (async () => {
    if (input.main) {
      // On main means on origin/<default>: what has merged, whatever branch the floor's folder is on.
      const label = `origin/${input.main.def}`;
      for (const t of await treeAt(input.dir, input.main.sha)) {
        if (isDeliverablePath(t.path)) found.set(t.path, { where: [{ src: 'main', label }], oid: t.oid, size: t.size, mtime: input.main.at, draft: draftByName(t.path), onMain: true });
      }
      return;
    }
    const co = await checkoutFiles(input.dir, input.dir);
    if (!co) return;
    const stats = await statFiles(input.dir, [...co.files.keys()]);
    for (const [p, f] of co.files) {
      const s = stats.get(p);
      if (s) found.set(p, { where: [{ src: 'main', label: 'main' }], oid: f.oid, size: s.size, mtime: s.mtime, draft: s.draft, onMain: true });
    }
  })();

  // The team's worktrees: what a Lead is still writing, committed or not.
  const members = input.people.filter((p) => p.role && p.dir && p.workerId && path.resolve(p.dir) !== path.resolve(input.dir));
  const viaWorktree = new Set(members.map((m) => m.branch).filter((b): b is string => !!b));
  const worktreesP = pool(members, GIT_PARALLEL, async (m): Promise<Listing> => {
    const where: DeliverableWhere = { src: `wt:${m.workerId}`, label: `${m.name}'s worktree`, branch: m.branch, who: m.name, role: m.role };
    const co = await checkoutFiles(input.dir, m.dir!);
    if (!co) return { where, files: [] };
    // Its own work: what it changed since its branch forked from main, committed or not (no oid: changed in the folder).
    const mine = co.head && base ? await forkChanges(input.dir, base, co.head) : undefined;
    const shown = [...co.files].filter(([p, f]) => !f.oid || !mine || mine.has(p));
    const stats = await statFiles(m.dir!, shown.map(([p]) => p));
    return { where, files: shown.flatMap(([p, f]) => (stats.has(p) ? [{ path: p, oid: f.oid, ...stats.get(p)! }] : [])) };
  });

  // Every other office branch: committed work not merged, only what the branch itself changed since it
  // forked (not the older copies of files main moved on from).
  const also = input.people.map((p) => p.branch).filter((b): b is string => !!b);
  const branchesP = officeBranches(input.dir, also).then((list) =>
    pool(
      list.filter((b) => !viaWorktree.has(b.name) && !viaWorktree.has(b.name.replace(/^origin\//, ''))),
      GIT_PARALLEL,
      async (b): Promise<Listing> => {
        const owner = branchOwner(b.name, input.people);
        const where: DeliverableWhere = { src: `ref:${b.name}`, label: b.name, branch: b.name, who: owner.who, role: owner.role };
        const mine = base ? await forkChanges(input.dir, base, b.sha) : undefined;
        // No common history with main: everything on it.
        const files = mine ? [...mine].map(([p, oid]) => ({ path: p, oid, size: undefined as number | undefined })) : (await treeAt(input.dir, b.sha)).map((t) => ({ path: t.path, oid: t.oid, size: t.size as number | undefined }));
        return { where, files: files.filter((f) => isDeliverablePath(f.path)).map((f) => ({ ...f, mtime: b.at, draft: draftByName(f.path) })) };
      },
    ),
  );

  const [, worktrees, branches] = await Promise.all([mainP, worktreesP, branchesP]);
  // The branches' files' sizes, in one call for all of them (a blob's size never changes).
  const unsized = branches.flatMap((l) => l.files.filter((f) => f.size === undefined && f.oid).map((f) => f.oid!));
  const sized = unsized.length ? await blobSizes(input.dir, unsized) : new Map<string, number>();

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
  for (const l of worktrees) {
    sources.push(l.where);
    for (const f of l.files) add(f.path, l.where, f.oid, f.size, f.mtime, f.draft);
  }
  for (const l of branches) {
    if (!l.files.length) continue;
    for (const f of l.files) add(f.path, l.where, f.oid, f.size ?? (f.oid ? sized.get(f.oid) : undefined), f.mtime, f.draft);
    sources.push(l.where);
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
