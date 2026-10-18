// What Home reads besides the socket's floors (start/view.ts draws it): GET /api/start (server/start/:
// Needs you across everything, stuck and failing work, live apps, milestones, health), GET /api/budget/office
// (the spend the Projects page's cards show) and GET /api/portfolios (the clients). Each is asked when the
// page opens and again only when something says it moved (a team change, a project waiting more or less),
// at most every so often and never while the tab is hidden: no timer of its own polls the office.

import type { StartView } from '../../shared/start';
import type { OfficeBudgetView } from '../../shared/budget/types';
import type { PortfoliosView } from '../../shared/portfolios';
import { portfoliosView } from '../ui/portfolios/api';

/** The least time between two asks for the same thing. */
const MIN_GAP_MS = { start: 15_000, budget: 60_000, portfolios: 60_000 } as const;
type Key = keyof typeof MIN_GAP_MS;

export interface StartData {
  start?: StartView;
  budget?: OfficeBudgetView;
  portfolios?: PortfoliosView;
  /** Why one couldn't be read (said on its section, never guessed round). */
  failed: Partial<Record<Key, string>>;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

const ASK: Record<Key, () => Promise<unknown>> = {
  start: () => getJson<StartView>('/api/start'),
  budget: () => getJson<OfficeBudgetView>('/api/budget/office'),
  portfolios: () => portfoliosView(),
};

/** Home's data, and `ask(key)` to have one read again (dropped when asked too soon or while hidden). */
export function startData(changed: (key: Key) => void) {
  const data: StartData = { failed: {} };
  const at: Partial<Record<Key, number>> = {};
  const busy = new Set<Key>();
  /** Asked again while hidden or too soon: done once the tab is back. */
  const owed = new Set<Key>();

  function ask(key: Key, force = false) {
    if (busy.has(key)) return;
    if (!force && document.hidden) return void owed.add(key);
    const wait = MIN_GAP_MS[key] - (Date.now() - (at[key] ?? 0));
    if (!force && wait > 0) {
      // Once, when the gap is up: the change that asked isn't lost, and asking again meanwhile adds nothing.
      if (!owed.has(key)) setTimeout(() => owed.has(key) && ask(key), wait);
      owed.add(key);
      return;
    }
    owed.delete(key);
    busy.add(key);
    at[key] = Date.now();
    ASK[key]()
      .then((v) => {
        (data as unknown as Record<Key, unknown>)[key] = v;
        delete data.failed[key];
      })
      .catch((e: Error) => (data.failed[key] = e.message))
      .finally(() => {
        busy.delete(key);
        changed(key);
      });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    for (const k of [...owed]) ask(k);
  });

  return {
    data,
    ask,
    /** Every source, at once (the page opening). */
    all() {
      for (const k of Object.keys(ASK) as Key[]) ask(k, true);
    },
  };
}
