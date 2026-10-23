// The App Workspace's explorer on the server (shared/app-explorer.ts): the business tree's levels at a
// commit (./business.ts), the all-files view's folders and files (./files.ts), and what changed between two
// served revisions (the documents whose units differ, and the files git says differ), for the "changed"
// dots. Each answer is about one commit, which never changes, so each is worked out once and kept.

import { modelOf } from '../model/index.js';
import { diffIndexes } from '../model/mpr.js';
import type { Floor } from '../floor.js';
import { businessLevel, docsOfTree, docsOfUnits, type AppDocs, type DocReader } from './business.js';
import { changedFiles } from './files.js';
import type { ExplorerChanges, ExplorerLevel } from '../../shared/app-explorer.js';

type Ctx = { cfg: { dataDir: string } };

const docsKept = new Map<string, Promise<{ docs: AppDocs; reader: DocReader } | null>>();

/** The app's documents at `sha`: from its units, else (no node:sqlite) from the Model tab's tree; null: no app there. */
function docsAt(ctx: Ctx, floor: Floor, sha: string) {
  const key = `${floor.dir}\0${sha}`;
  let p = docsKept.get(key);
  if (p) return p;
  p = (async () => {
    const m = modelOf(ctx);
    const cm = await m.units.commit(floor.dir, sha).catch(() => null);
    if (cm) return docsOfUnits(cm);
    const tree = await m.tree(floor, sha, true).catch(() => null);
    return tree ? docsOfTree(tree.nodes) : null;
  })();
  docsKept.set(key, p);
  p.catch(() => docsKept.delete(key));
  while (docsKept.size > 8) docsKept.delete(docsKept.keys().next().value as string);
  return p;
}

/** One level of the business tree at `sha`, or why not. */
export async function explorerLevel(ctx: Ctx, floor: Floor, sha: string, at: string): Promise<ExplorerLevel | { status: number; error: string }> {
  if (at.length > 300 || /[\\\u0000-\u001f]/.test(at)) return { status: 400, error: 'Not a level of the tree' };
  const d = await docsAt(ctx, floor, sha);
  if (!d) return { rev: sha, at, nodes: [], note: 'The app’s pages and logic can’t be read at this version.' };
  const nodes = await businessLevel(d.docs, d.reader, at);
  return nodes ? { rev: sha, at, nodes } : { status: 404, error: 'No such part of the tree' };
}

/** What changed from `from` to `to`: documents (by `kind:qn`) and shown files. */
export async function explorerChanges(ctx: Ctx, floor: Floor, from: string, to: string): Promise<ExplorerChanges> {
  const m = modelOf(ctx);
  const [a, b, files] = await Promise.all([m.units.commit(floor.dir, from).catch(() => null), m.units.commit(floor.dir, to).catch(() => null), changedFiles(floor.dir, from, to)]);
  const docs = a && b ? (({ added, changed }) => [...added, ...changed])(diffIndexes(a.ix, b.ix)) : [];
  return { from, to, docs, files };
}
