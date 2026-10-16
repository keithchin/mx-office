// The Clients page's pure parts (clients/view.ts; tests/clients-page.test.ts): a client's address, the
// search, the order of the cards and a client's tile colour.

import type { PortfolioView } from '../../shared/portfolios';
import { FLOOR_PALETTES } from '../../shared/floors';

/** The Clients page, or one client's page on it. */
export const clientHref = (id?: string) => (id ? `/clients?client=${encodeURIComponent(id)}` : '/clients');

/** Whether a client matches what's typed in the search: its name or one of its projects' names, any case. */
export function clientMatches(p: Pick<PortfolioView, 'label' | 'projects'>, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return p.label.toLowerCase().includes(t) || p.projects.some((x) => x.name.toLowerCase().includes(t));
}

/** The cards in name order (any case), so a rename moves a client to where its new name puts it. */
export function sortedClients<T extends Pick<PortfolioView, 'label'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

/** A client's tile colour: one of the floors' palettes, picked from its id (so a rename keeps it). */
export function paletteOf(id: string): number {
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return n % FLOOR_PALETTES.length;
}
