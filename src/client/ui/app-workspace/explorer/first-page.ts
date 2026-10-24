// The page the Developer view's canvas shows first: the app's own first page in the explorer's order (Pages,
// then the app's modules and folders as the model has them; Marketplace modules left out), preferring one that
// opens without anything passed to it (it has an address). Read from the explorer's index of every level at
// the revision shown (one request, which the search uses too), so the default canvas is the Model preview and
// never needs the live app. Pure.

import { MARKETPLACE, type ExplorerNode } from '../../../../shared/app-explorer';

const skip = (n: ExplorerNode) => n.addon || n.id.endsWith(MARKETPLACE);

/** The first page under Pages (one with an address first), or undefined when the app has none. */
export function firstPage(levels: Readonly<Record<string, readonly ExplorerNode[]>>): ExplorerNode | undefined {
  const kids = (n: ExplorerNode) => levels[n.id] ?? (n.path !== undefined ? levels[n.path] : undefined) ?? [];
  const pages: ExplorerNode[] = [];
  const walk = (list: readonly ExplorerNode[], depth: number) => {
    for (const n of list) {
      if (skip(n)) continue;
      if (n.type === 'page' && n.qn) pages.push(n);
      else if (depth < 12) walk(kids(n), depth + 1);
    }
  };
  const root = (levels[''] ?? []).find((n) => n.id === 'pages');
  if (!root) return undefined;
  walk(kids(root), 0);
  return pages.find((p) => p.url) ?? pages[0];
}
