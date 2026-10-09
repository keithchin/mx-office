// What the Portal top bar's search finds, without the page: the projects, the pages of the project
// you're on (the left navigation's, or the tab row's), its agents, issues and pull requests, the
// office's pages and the documentation, filtered by what's typed and ranked (a name that starts with it
// first, then a word in it that does, then anywhere, or what else it answers to). The results come in
// groups, one per kind, the group with the best match first. Pure, so tests/portal-theme.test.ts and
// tests/portal-nav.test.ts run it. ui/portal/search.ts draws it.

export type SearchKind = 'project' | 'tab' | 'agent' | 'issue' | 'pr' | 'page' | 'doc';

export interface SearchItem {
  kind: SearchKind;
  label: string;
  /** A second line: where it is, or what it is. */
  hint?: string;
  /** What else it answers to (a project's repository, an issue's number, a docs page's headings). */
  also?: string;
  go(): void;
}

/** How many results the flat list shows (searchItems). */
export const MAX_RESULTS = 8;
/** How many of each kind the grouped list shows (searchGroups). */
export const PER_GROUP = 5;

/** Each kind's group heading, in the order groups with equal matches come. */
export const KIND_ORDER: readonly SearchKind[] = ['project', 'tab', 'agent', 'issue', 'pr', 'page', 'doc'];
export const KIND_LABEL: Record<SearchKind, string> = { project: 'Projects', tab: 'Pages of this project', agent: 'Agents', issue: 'Issues', pr: 'Pull requests', page: 'Office', doc: 'Documentation' };
const ORDER = Object.fromEntries(KIND_ORDER.map((k, i) => [k, i])) as Record<SearchKind, number>;

/** How well `item` answers `q` (lower case, trimmed): 0 not at all, 3 its name starts with it, 2 a word does, 1 anywhere. */
export function score(item: Pick<SearchItem, 'label' | 'also'>, q: string): number {
  if (!q) return 1;
  const name = item.label.toLowerCase();
  if (name.startsWith(q)) return 3;
  if (name.split(/[\s\-_·/#:()]+/).some((w) => w.startsWith(q))) return 2;
  if (name.includes(q) || (item.also ?? '').toLowerCase().includes(q)) return 1;
  return 0;
}

/**
 * The items for `query`, best first: by score, then projects before tabs before pages, then as listed.
 * An empty query lists the tabs and the projects, up to MAX_RESULTS.
 */
export function searchItems<T extends Pick<SearchItem, 'kind' | 'label' | 'also'>>(items: readonly T[], query: string, max = MAX_RESULTS): T[] {
  const q = query.trim().toLowerCase();
  return items
    .map((item, i) => ({ item, i, s: score(item, q) }))
    .filter((r) => r.s > 0 && (q || r.item.kind === 'project' || r.item.kind === 'tab' || r.item.kind === 'page'))
    .sort((a, b) => b.s - a.s || ORDER[a.item.kind] - ORDER[b.item.kind] || a.i - b.i)
    .slice(0, max)
    .map((r) => r.item);
}

export interface SearchGroup<T> {
  kind: SearchKind;
  label: string;
  items: T[];
}

/**
 * The results for `query` in groups: each kind's best `perGroup`, best first within it; the groups by
 * their best match, then in KIND_ORDER. With nothing typed: this project's pages and the projects only
 * (the agents, issues, pull requests and docs wait for a word).
 */
export function searchGroups<T extends Pick<SearchItem, 'kind' | 'label' | 'also'>>(items: readonly T[], query: string, perGroup = PER_GROUP): SearchGroup<T>[] {
  const q = query.trim().toLowerCase();
  const by = new Map<SearchKind, { item: T; i: number; s: number }[]>();
  items.forEach((item, i) => {
    if (!q && item.kind !== 'tab' && item.kind !== 'project') return;
    const s = score(item, q);
    if (!s) return;
    const list = by.get(item.kind) ?? [];
    list.push({ item, i, s });
    by.set(item.kind, list);
  });
  return [...by]
    .map(([kind, list]) => {
      const sorted = list.sort((a, b) => b.s - a.s || a.i - b.i);
      return { kind, best: sorted[0].s, group: { kind, label: KIND_LABEL[kind], items: sorted.slice(0, perGroup).map((r) => r.item) } };
    })
    .sort((a, b) => (q ? b.best - a.best : 0) || ORDER[a.kind] - ORDER[b.kind])
    .map((r) => r.group);
}

/** A tab button's words without its emoji and its count: "🎛️ Command Center 6" → "Command Center". */
export function tabLabel(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+\d+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
