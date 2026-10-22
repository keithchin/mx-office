// What the surfaced asks' detectors read of main and the branches (detect.ts), from what the office
// already has: main's PROJECT.md as stuck detection reads it (stuck/repo.ts, once per main commit), and
// local git only, off the event loop: the commits each agent branch has that main hasn't (one log per
// branch, cached by both commits), the lead's newest standup on its branch, and the BRDs and design
// artifacts on main (one ls-tree, one cat-file) and in the worktrees (read from the disk).

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from '../office/context.js';
import type { BranchStandup } from '../../shared/asks.js';
import { mainOf, listFiles, readFiles } from '../testing/repo.js';
import { readRepo } from '../stuck/repo.js';
import { rosterOf } from '../roster/adapter.js';
import { managerRole } from '../roster/coverage.js';
import { pool, GIT_PARALLEL } from '../deliverables/git.js';
import { blockedOnYouOf, type AheadBranch, type BrdText, type DetectInput } from './detect.js';
import type { AsksFloor } from './service.js';
import { catFiles, git, type Place, type Read } from './sources.js';
import { gateItemsOf } from '../review-gate/index.js';
import { claimsItemsOf } from '../claims/index.js';
import { securityItemsOf } from '../security-gate/index.js';

/** Paths that are the team's own updates: journals (handoffs are entries in them), standups, handoff notes. */
export const isDocsPath = (f: string) => /^docs\/(team|standups)\//.test(f) || /handoff/i.test(f);
const BRD_DIRS = ['analysis/knowledge-base/brd', 'analysis/brd', 'knowledge-base/brd'];
/** Every knowledge base's brd/ the toolkit reads (bin/lib/discover-brds.sh): each analysis/<source>/knowledge-base (a migration's), then the fixed ones. */
const brdDirsOf = (analysisChildren: readonly string[]) => [
  ...analysisChildren.filter((n) => n && n !== 'knowledge-base' && n !== 'brd' && !n.includes('.')).map((n) => `analysis/${n}/knowledge-base/brd`),
  ...BRD_DIRS,
];
const DESIGN = ['design/design-system.html', 'design/prototype.html'];
const WIREFRAMES = 'design/wireframes';

const logs = new Map<string, Promise<{ commits: number; docs: number; oldestDocsAt?: number } | undefined>>();

/** What commit `sha` has that `main` hasn't: its commits, those touching docs, and the oldest of those (ms). Cached by both commits. */
export function aheadOf(dir: string, main: string, sha: string): Promise<{ commits: number; docs: number; oldestDocsAt?: number } | undefined> {
  const k = `${dir}\0${main}\0${sha}`;
  let p = logs.get(k);
  if (!p) {
    p = git(['log', '--format=%x01%ct', '--name-only', '--no-renames', `${main}..${sha}`], dir).then((out) => {
      if (out === undefined) return undefined;
      let commits = 0;
      let docs = 0;
      let oldest: number | undefined;
      for (const block of out.split('\x01')) {
        const [head, ...names] = block.split('\n');
        const at = Number(head.trim()) * 1000;
        if (!head.trim()) continue;
        commits++;
        if (names.some((n) => n.trim() && isDocsPath(n.trim()))) {
          docs++;
          oldest = oldest === undefined ? at : Math.min(oldest, at);
        }
      }
      return { commits, docs, ...(oldest !== undefined ? { oldestDocsAt: oldest } : {}) };
    });
    logs.set(k, p);
    while (logs.size > 400) logs.delete(logs.keys().next().value!);
  }
  return p;
}

/** Each place's branch with its commit: a branch place carries it; a worktree's is read from the branch refs. */
async function branchShas(dir: string, places: readonly Place[]): Promise<{ place: Place; ref: string; sha: string }[]> {
  const out = await git(['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/heads'], dir);
  const heads = new Map((out ?? '').split('\n').map((l) => l.split('\0') as [string, string]).filter((x) => x[0] && x[1]));
  return places.flatMap((p) => {
    if (!p.branch) return [];
    const sha = p.sha ?? heads.get(p.branch);
    return sha ? [{ place: p, ref: p.branch, sha }] : [];
  });
}

/** The agent branches ahead of main, with their docs commits. */
export async function aheadBranches(dir: string, main: string, places: readonly Place[]): Promise<AheadBranch[]> {
  const list = (await branchShas(dir, places.filter((p) => p.kind !== 'checkout'))).filter((b) => b.sha !== main);
  const got = await pool(list, GIT_PARALLEL, (b) => aheadOf(dir, main, b.sha));
  return list.flatMap((b, i) => {
    const a = got[i];
    return a && a.commits > 0 ? [{ who: b.place.who, branch: b.ref, sha: b.sha, ...a }] : [];
  });
}

const newestFirst = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });

/** The newest standup page on the lead's branch (or in its worktree), when it's newer than main's newest. */
export async function leadStandup(dir: string, main: string, lead: Place | undefined): Promise<BranchStandup | undefined> {
  if (!lead?.branch) return undefined;
  const mainNewest = (await listFiles(dir, main, ['docs/standups/'])).filter((f) => f.endsWith('.md')).sort(newestFirst)[0];
  let file: string | undefined;
  let text: string | undefined;
  if (lead.dir) {
    const names = await readdir(path.join(lead.dir, 'docs/standups')).catch(() => [] as string[]);
    file = names.filter((n) => n.endsWith('.md')).map((n) => `docs/standups/${n}`).sort(newestFirst)[0];
    if (file) text = await readFile(path.join(lead.dir, file), 'utf8').catch(() => undefined);
  } else {
    const sha = lead.sha ?? lead.branch;
    file = (await listFiles(dir, sha, ['docs/standups/'])).filter((f) => f.endsWith('.md')).sort(newestFirst)[0];
    if (file) text = (await catFiles(dir, [`${sha}:${file}`]))[0];
  }
  if (!file || text === undefined || (mainNewest && newestFirst(file, mainNewest) >= 0)) return undefined;
  const date = /(\d{4}-\d{2}-\d{2}(?:-\d+)?)\.md$/.exec(file)?.[1] ?? file;
  return { who: lead.who, branch: lead.branch, file, date, blocked: blockedOnYouOf(text) };
}

/** The BRDs and design artifacts on main and in the worktrees. */
export async function reviewFiles(dir: string, main: string, worktrees: readonly Place[]): Promise<{ brds: BrdText[]; design: string[] }> {
  const children = (await listFiles(dir, main, ['analysis/'], false)).map((p) => p.slice('analysis/'.length));
  const atMain = await listFiles(dir, main, [...brdDirsOf(children), 'design']);
  const brdFiles = atMain.filter((f) => f.endsWith('.brd.json'));
  const texts = await readFiles(dir, main, brdFiles, 4 * 1024 * 1024);
  const brds: BrdText[] = brdFiles.flatMap((f) => (texts.has(f) ? [{ file: f, text: texts.get(f)! }] : []));
  const design = atMain.filter((f) => DESIGN.includes(f) || (f.startsWith(`${WIREFRAMES}/`) && f.endsWith('.html')));
  for (const w of worktrees) {
    if (!w.dir) continue;
    for (const d of brdDirsOf(await readdir(path.join(w.dir, 'analysis')).catch(() => [] as string[]))) {
      for (const n of await readdir(path.join(w.dir, d)).catch(() => [] as string[])) {
        if (!n.endsWith('.brd.json')) continue;
        const t = await readFile(path.join(w.dir, d, n), 'utf8').catch(() => undefined);
        if (t !== undefined) brds.push({ file: `${d}/${n}`, text: t });
      }
    }
    for (const f of DESIGN) if (await stat(path.join(w.dir, f)).then((s) => s.isFile(), () => false)) design.push(f);
    for (const n of await readdir(path.join(w.dir, WIREFRAMES)).catch(() => [] as string[])) if (n.endsWith('.html')) design.push(`${WIREFRAMES}/${n}`);
  }
  return { brds, design };
}

/** The detectors' input besides what was read everywhere. */
export async function detectInputOf(ctx: Ctx, floor: AsksFloor, reads: readonly Read[]): Promise<Omit<DetectInput, 'reads' | 'now'>> {
  const main = await mainOf(floor.dir);
  if (!main) return {};
  let lead: { name: string; role: string } | undefined;
  try {
    const d = rosterOf(ctx).data(floor.id);
    const role = managerRole(d);
    lead = { name: d.members[role].name, role };
  } catch {
    // no team
  }
  const places = reads.map((r) => r.place);
  const leadPlace = lead ? places.find((p) => p.role === lead!.role && p.branch) : undefined;
  const [repo, ahead, standup, review, gate, claims, security] = await Promise.all([
    readRepo(floor.dir).catch(() => undefined),
    aheadBranches(floor.dir, main.sha, places).catch(() => []),
    leadStandup(floor.dir, main.sha, leadPlace).catch(() => undefined),
    reviewFiles(floor.dir, main.sha, places.filter((p) => p.kind === 'worktree')).catch(() => ({ brds: [], design: [] })),
    gateItemsOf(ctx, floor.id, main, lead?.name).catch(() => []),
    claimsItemsOf(ctx, floor.id, main).catch(() => []),
    securityItemsOf(ctx, floor.id, main, lead?.name).catch(() => []),
  ]);
  return {
    ...(repo?.project ? { mainProject: repo.project.text } : {}),
    ahead,
    ...(lead ? { lead: lead.name } : {}),
    ...(standup ? { standup } : {}),
    brds: review.brds,
    design: review.design,
    gate,
    claims,
    security,
  };
}
