// The documentation's pages for the Portal top bar's search (./search.ts): the docs bundle the docs page
// reads (/docs/site.json, built from docs/site/), asked for once, the first time the search is focused,
// and kept for the visit as titles and headings only. Never polled; a failure just leaves docs out.

import { docUrl, type DocBundle } from '../../../shared/docsite';
import type { SearchItem } from './search-logic';

let pages: SearchItem[] | undefined;
let asked: Promise<void> | undefined;

/** The docs' pages as search items: [] until they've come (call loadDocs first). */
export const docItems = (): SearchItem[] => pages ?? [];

/** Asks for the bundle once; `then` runs when it's in (to draw the results again). */
export function loadDocs(then: () => void): void {
  if (pages || asked) return;
  asked = fetch('/docs/site.json', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<DocBundle>) : undefined))
    .then((b) => {
      if (!b) return;
      pages = b.pages
        .filter((p) => p.title)
        .map((p): SearchItem => ({
          kind: 'doc',
          label: p.title,
          hint: p.slug.split('/')[0]?.replace(/-/g, ' ') || 'Documentation',
          also: p.headings.map((x) => x.text).join(' · '),
          go: () => location.assign(docUrl(p.slug)),
        }));
      then();
    })
    .catch(() => undefined);
}
