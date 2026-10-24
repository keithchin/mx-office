// The page the Developer view's canvas shows first: the app's own first page in the explorer's order (Pages,
// then the app's modules and folders as the model has them; Marketplace modules left out), preferring one that
// opens without anything passed to it (it has an address). Read from the explorer's index of every level at
// the revision shown (one request, which the search uses too), so the default canvas is the Model preview and
// never needs the live app. Pure.

import { MARKETPLACE, type ExplorerNode } from '../../../../shared/app-explorer';

const skip = (n: ExplorerNode) => n.addon || n.id.endsWith(MARKETPLACE);

/** The first page under Pages (one with an address first) and the rows above it, or undefined when the app has none. */
export function firstPage(levels: Readonly<Record<string, readonly ExplorerNode[]>>): { page: ExplorerNode; above: string[] } | undefined {
  const kids = (n: ExplorerNode) => levels[n.id] ?? (n.path !== undefined ? levels[n.path] : undefined) ?? [];
  const pages: { page: ExplorerNode; above: string[] }[] = [];
  const walk = (list: readonly ExplorerNode[], above: string[]) => {
    for (const n of list) {
      if (skip(n)) continue;
      if (n.type === 'page' && n.qn) pages.push({ page: n, above });
      else if (above.length < 12) walk(kids(n), [...above, n.id]);
    }
  };
  const root = (levels[''] ?? []).find((n) => n.id === 'pages');
  if (!root) return undefined;
  walk(kids(root), [root.id]);
  return pages.find((p) => p.page.url) ?? pages[0];
}
