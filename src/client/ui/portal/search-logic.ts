// What the Portal top bar's search finds, without the page: the projects, the tabs of the page you're
// on and the office's pages, filtered by what's typed and ranked (a name that starts with it first, then
// a word in it that does, then anywhere). Pure, so tests/portal-theme.test.ts runs it. ui/portal/search.ts
// draws it.

export type SearchKind = 'project' | 'tab' | 'page';

export interface SearchItem {
  kind: SearchKind;
  label: string;
  /** A second line: where it is, or what it is. */
  hint?: string;
  /** What else it answers to (a project's repository, say). */
  also?: string;
  go(): void;
}

/** How many results the list shows. */
export const MAX_RESULTS = 8;

/** How well `item` answers `q` (lower case, trimmed): 0 not at all, 3 its name starts with it, 2 a word does, 1 anywhere. */
export function score(item: Pick<SearchItem, 'label' | 'also'>, q: string): number {
  if (!q) return 1;
  const name = item.label.toLowerCase();
  if (name.startsWith(q)) return 3;
  if (name.split(/[\s\-_·/]+/).some((w) => w.startsWith(q))) return 2;
  if (name.includes(q) || (item.also ?? '').toLowerCase().includes(q)) return 1;
  return 0;
}

const ORDER: Record<SearchKind, number> = { project: 0, tab: 1, page: 2 };

/**
 * The items for `query`, best first: by score, then projects before tabs before pages, then as listed.
 * An empty query lists the tabs and the projects, up to MAX_RESULTS.
 */
export function searchItems<T extends Pick<SearchItem, 'kind' | 'label' | 'also'>>(items: readonly T[], query: string, max = MAX_RESULTS): T[] {
  const q = query.trim().toLowerCase();
  return items
    .map((item, i) => ({ item, i, s: score(item, q) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || ORDER[a.item.kind] - ORDER[b.item.kind] || a.i - b.i)
    .slice(0, max)
    .map((r) => r.item);
}

/** A tab button's words without its emoji and its count: "🎛️ Command Center 6" → "Command Center". */
export function tabLabel(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+\d+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
