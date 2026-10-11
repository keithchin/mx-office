// The Documents page's search and status filter (page.ts), without the page, for the tests.

import type { DeliverableItem } from '../../../shared/deliverables';

export type Filter = 'all' | 'missing' | 'branch' | 'draft' | 'present';
export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'present', label: 'On main' },
  { id: 'branch', label: 'On a branch' },
  { id: 'draft', label: 'Draft' },
  { id: 'missing', label: 'Missing' },
];

/** The items `filter` and `query` keep, each with only the files the query names (all of them when the item's title does). */
export function filterItems(items: readonly DeliverableItem[], filter: Filter, query: string): DeliverableItem[] {
  const q = query.trim().toLowerCase();
  const out: DeliverableItem[] = [];
  for (const i of items) {
    if (filter !== 'all' && (i.status !== filter || (filter === 'missing' && i.optional))) continue;
    if (!q || i.title.toLowerCase().includes(q)) {
      out.push(i);
      continue;
    }
    const files = i.files.filter((f) => f.path.toLowerCase().includes(q));
    if (files.length) out.push({ ...i, files, more: undefined });
  }
  return out;
}

export const countOf = (items: readonly DeliverableItem[], f: Filter) => (f === 'all' ? items.length : items.filter((i) => i.status === f && !(f === 'missing' && i.optional)).length);
