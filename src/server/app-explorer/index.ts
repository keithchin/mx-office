// The Developer view's explorer on the server (shared/app-explorer.ts): the business tree's levels at a
// commit (./business.ts), the whole tree at once for the search, the all-files view's folders, files and
// search (./files.ts), the documents with their relationships (./documents.ts), main's newest commit as the
// default revision (./head.ts), and what changed between two revisions (the documents whose units differ,
// and the files git says differ), for the "changed" dots. Each answer is about one commit, which never
// changes, so each is worked out once and kept; a failure is never kept (it may be passing).
//
// Nothing here looks at the live app: the tree reads the repository, so a stopped runtime or one that
// failed to start doesn't change what the explorer shows.

import { modelOf } from '../model/index.js';
import { diffIndexes } from '../model/mpr.js';
import type { Floor } from '../floor.js';
import { businessIndex, businessLevel, docsOfTree, docsOfUnits, type AppDocs, type DocReader } from './business.js';
import { changedFiles } from './files.js';
import { modelProblem, type ExplorerChanges, type ExplorerIndex, type ExplorerLevel, type ExplorerNode } from '../../shared/app-explorer.js';

type Ctx = { cfg: { dataDir: string } };
type Docs = { docs: AppDocs; reader: DocReader };
type DocsAnswer = Docs | { problem: string };

const docsKept = new Map<string, Promise<DocsAnswer>>();
const indexKept = new WeakMap<AppDocs, Promise<Record<string, ExplorerNode[]>>>();

/** The app's documents at `sha`: from its units, else (no node:sqlite) from the Model tab's tree; or what went wrong. */
function docsAt(ctx: Ctx, floor: Floor, sha: string): Promise<DocsAnswer> {
  const key = `${floor.dir}\0${sha}`;
  const hit = docsKept.get(key);
  if (hit) return hit;
  const p = (async (): Promise<DocsAnswer> => {
    const m = modelOf(ctx);
    let why = '';
    const cm = await m.units.commit(floor.dir, sha).catch((err: Error) => ((why = err.message), null));
    if (cm) return docsOfUnits(cm);
    if (why) return { problem: modelProblem(sha, why) };
    try {
      const tree = await m.tree(floor, sha, true);
      return docsOfTree(tree.nodes);
    } catch (err) {
      return { problem: modelProblem(sha, (err as Error).message) };
    }
  })();
  docsKept.set(key, p);
  // A problem isn't kept: the next look tries again (a git hiccup, mxcli installed meanwhile).
  void p.then((r) => ('problem' in r ? docsKept.delete(key) : undefined), () => docsKept.delete(key));
  while (docsKept.size > 8) docsKept.delete(docsKept.keys().next().value as string);
  return p;
}

const badLevel = (at: string) => at.length > 600 || /[\\\u0000-\u001f]/.test(at);

/** One level of the business tree at `sha`, or why not. */
export async function explorerLevel(ctx: Ctx, floor: Floor, sha: string, at: string): Promise<ExplorerLevel | { status: number; error: string }> {
  if (badLevel(at)) return { status: 400, error: 'Not a level of the tree' };
  const d = await docsAt(ctx, floor, sha);
  if ('problem' in d) return { rev: sha, at, nodes: [], problem: d.problem };
  let nodes;
  try {
    nodes = await businessLevel(d.docs, d.reader, at);
  } catch {
    return { status: 404, error: 'No such part of the tree' };
  }
  return nodes ? { rev: sha, at, nodes } : { status: 404, error: 'No such part of the tree' };
}

/** Every level of the business tree at `sha` (the search looks through all of it), or what went wrong. */
export async function explorerIndex(ctx: Ctx, floor: Floor, sha: string): Promise<ExplorerIndex> {
  const d = await docsAt(ctx, floor, sha);
  if ('problem' in d) return { rev: sha, levels: {}, problem: d.problem };
  let p = indexKept.get(d.docs);
  if (!p) {
    p = businessIndex(d.docs, d.reader);
    indexKept.set(d.docs, p);
    p.catch(() => indexKept.delete(d.docs));
  }
  return { rev: sha, levels: await p };
}

/** What changed from `from` to `to`: documents (by `kind:qn`) and shown files. */
export async function explorerChanges(ctx: Ctx, floor: Floor, from: string, to: string): Promise<ExplorerChanges> {
  const m = modelOf(ctx);
  const [a, b, files] = await Promise.all([m.units.commit(floor.dir, from).catch(() => null), m.units.commit(floor.dir, to).catch(() => null), changedFiles(floor.dir, from, to)]);
  const docs = a && b ? (({ added, changed }) => [...added, ...changed])(diffIndexes(a.ix, b.ix)) : [];
  return { from, to, docs, files };
}
