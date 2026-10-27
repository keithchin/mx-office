// What a branch is, for the merge panel and its confirm step (./index.ts): the DC(s) it belongs to (its branch
// dev/DC-n, or the change its worker was handed) with the request's title, what it changes since it left main
// (model, code, notes: a journal-only or docs-only branch is "notes only"), and for one commit the confirm
// step's facts: its subject, files and model units, the checks and journeys recorded at exactly that commit, and
// the data-impact finding. Read with git off the event loop; paths are kept per (base, commit), so a look costs
// nothing new until a branch moves. The DC store, testing records and the data-impact guard are loaded lazily
// (no import cycle with the review gate, which imports this feature).

import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import type { Git } from '../gitgraph/index.js';
import { journeyIdOf, journeysIn } from '../../shared/testing/links.js';
import { sameRevision } from '../../shared/testing/record.js';
import { classify, pathKind, type LocalMergeDc, type LocalMergeFiles, type LocalMergeKind, type LocalMergeResult } from '../../shared/local-merge.js';

const pathsKept = new Map<string, Promise<string[]>>();

/** The paths changed from `base` to `sha` (both commits), kept per pair. */
export function changedPaths(git: Git, dir: string, base: string, sha: string): Promise<string[]> {
  const key = `${dir}|${base}|${sha}`;
  let p = pathsKept.get(key);
  if (!p) {
    p = git(['diff', '--name-only', '--no-renames', base, sha], dir)
      .then((out) => out.split('\n').map((l) => l.trim()).filter(Boolean))
      .catch(() => [] as string[]);
    pathsKept.set(key, p);
    if (pathsKept.size > 500) pathsKept.delete(pathsKept.keys().next().value!);
  }
  return p;
}

/** Where `sha` left `target` (git merge-base), or undefined. */
export async function forkOf(git: Git, dir: string, target: string, sha: string): Promise<string | undefined> {
  return (await git(['merge-base', target, sha], dir).catch(() => '')).trim() || undefined;
}

type Kind = { files: LocalMergeFiles; kind: LocalMergeKind; paths: string[]; fork?: string };
const kindKept = new Map<string, Promise<Kind>>();

/** What the commit changes since it left main, by kind (kept per main and commit: a look costs nothing until either moves). */
export function kindAt(git: Git, dir: string, target: string, sha: string): Promise<Kind> {
  const key = `${dir}|${target}|${sha}`;
  let p = kindKept.get(key);
  if (!p) {
    p = (async () => {
      const fork = await forkOf(git, dir, target, sha);
      const paths = fork ? await changedPaths(git, dir, fork, sha) : [];
      return { ...classify(paths), paths, ...(fork ? { fork } : {}) };
    })();
    kindKept.set(key, p);
    if (kindKept.size > 300) kindKept.delete(kindKept.keys().next().value!);
  }
  return p;
}

const DC_BRANCH = /^dev\/(DC-\d{1,6})$/;
const titleOf = (text: string) => text.replace(/\n+About: [^\n]*$/, '').trim().split('\n')[0].replace(/\s+/g, ' ').slice(0, 90);

/**
 * The DC(s) a branch belongs to: dev/DC-n by its name, else the change handed to the worker whose worktree it is
 * (its newest hand-over), or a change an agent asked to merge from this branch (its escalation names both), never
 * from commit subjects (a subject that mentions another DC is not that DC).
 */
export async function dcsOf(ctx: Ctx, floorId: string, branch: string, workerId: string | undefined): Promise<LocalMergeDc[]> {
  let all: { id: string; text: string; activated?: { workerId?: string; taskId?: string; requestId?: string }; previous?: { workerId?: string }[]; queue: string }[] = [];
  try {
    const { devChangesOf } = await import('../dev-changes/index.js');
    all = await devChangesOf(ctx).store.all(floorId);
  } catch {
    all = [];
  }
  const named = DC_BRANCH.exec(branch)?.[1];
  if (named) {
    const c = all.find((x) => x.id === named);
    return [{ id: named, title: c ? titleOf(c.text) : '' }];
  }
  // A change an agent asked to have merged from this branch (its escalation names the branch and the change).
  const asked: string[] = [];
  try {
    const { mergeAsks } = await import('./asks.js');
    for (const a of mergeAsks(ctx, floorId).filter((x) => x.branches.includes(branch))) {
      for (const id of a.ids) {
        const c = all.find((x) => x.id === id || x.activated?.requestId === id);
        if (c && !asked.includes(c.id)) asked.push(c.id);
      }
    }
  } catch {
    /* no team: none asked */
  }
  const mine = workerId ? all.filter((c) => c.activated?.workerId === workerId && (c.queue === 'active' || c.queue === 'settled')).slice(-2) : [];
  const ids = [...new Set([...asked.slice(0, 3), ...mine.map((c) => c.id)])];
  return ids.map((id) => ({ id, title: titleOf(all.find((c) => c.id === id)?.text ?? '') }));
}

/** The checks and journeys recorded at exactly `sha` (the Testing page's records). */
export async function resultsAt(ctx: Ctx, floorId: string, sha: string): Promise<{ checks: LocalMergeResult[]; journeys: LocalMergeResult[] }> {
  const checks: LocalMergeResult[] = [];
  const journeys: LocalMergeResult[] = [];
  try {
    const { testingStore } = await import('../testing/index.js');
    const recs = await testingStore(ctx.cfg.dataDir, floorId).all();
    for (const r of recs) {
      if (!sameRevision(r.testedRevision, sha)) continue;
      const other = r.results.filter((x) => {
        const j = journeyIdOf(x.name) ?? journeysIn(x.name)[0];
        if (j) journeys.push({ name: j, verdict: x.status });
        return !j;
      });
      if (!other.length && r.results.length) continue;
      const failed = other.some((x) => x.status === 'failed');
      const verdict = r.conclusion ?? (failed ? 'failed' : other.length && other.every((x) => x.status === 'passed') ? 'passed' : 'skipped');
      checks.push({ name: r.suite, verdict });
    }
  } catch {
    /* no testing records: none at that commit */
  }
  return { checks: checks.slice(-8), journeys: journeys.slice(-12) };
}

/** The model units changed from `fork` to `sha` (kind:Module.Name), when the model reads at both ends. */
export async function unitsAt(ctx: Ctx, floor: Floor, fork: string, sha: string): Promise<string[]> {
  try {
    const { explorerChanges } = await import('../app-explorer/index.js');
    return (await explorerChanges(ctx, floor, fork, sha)).docs.slice(0, 12);
  } catch {
    return [];
  }
}

/** The data-impact finding of the commit against where it left main: `none` without model files or a domain model. */
export async function impactAt(ctx: Ctx, floor: Floor, git: Git, fork: string | undefined, sha: string, files: LocalMergeFiles): Promise<{ status: 'clear' | 'impact' | 'unknown' | 'none'; lines: string[] }> {
  if (!fork || !files.model) return { status: 'none', lines: [] };
  const tree = await git(['ls-tree', '--name-only', sha], floor.dir).catch(() => '');
  if (!tree.split('\n').some((l) => /\.mpr$/i.test(l.trim()))) return { status: 'none', lines: [] };
  try {
    const [{ dataImpactOf }, { modelOf }] = await Promise.all([import('../data-impact/index.js'), import('../model/index.js')]);
    const units = modelOf(ctx).units;
    const a = await dataImpactOf(ctx as never)
      .guard.assessments(units)
      .assess(floor.dir, fork, sha)
      .finally(() => units.blobs(floor.dir).close());
    const status = a.status === 'clear' ? 'clear' : a.status === 'impact' ? 'impact' : 'unknown';
    return { status, lines: status === 'unknown' ? [a.error ?? a.uncertainty] : a.findings.slice(0, 6).map((f) => f.risk) };
  } catch (err) {
    return { status: 'unknown', lines: [(err as Error).message.slice(0, 160)] };
  }
}

/** A few changed paths, model first. */
export const somePaths = (paths: readonly string[]) => [...paths].sort((a, b) => (pathKind(a) === 'model' ? 0 : 1) - (pathKind(b) === 'model' ? 0 : 1)).slice(0, 8);
