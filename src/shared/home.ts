// The home page (/home): where it sits among the office's pages, when the flat views send you there,
// and the numbers its 📊 Statistics tab shows (GET /api/home/stats, see server/home-stats.ts). Pure
// code, no DOM or Node, so the server, the pages and the tests all read the same rules.

/**
 * The pages that sign-in sends you back to (`/login?next=`), so signing in from one of them lands
 * on it again rather than on the 3D office. Anything else goes to `/`, which is never an open redirect.
 */
export const RETURN_PAGES = ['/home', '/lite', '/pixel', '/docs'] as const;
export type ReturnPage = (typeof RETURN_PAGES)[number] | `/docs/${string}`;
/** A page of the docs (/docs/get-started/quick-start): lower-case words, dashes and slashes only. */
const DOC_PAGE = /^\/docs(\/[a-z0-9][a-z0-9-]*)+$/;
export const isReturnPage = (p: unknown): p is ReturnPage =>
  (RETURN_PAGES as readonly unknown[]).includes(p) || (typeof p === 'string' && DOC_PAGE.test(p));

/**
 * Whether a flat view (/lite, /pixel) should hand over to the home page instead of opening: an old
 * `?home` link (the floors page used to be an overlay there), or nothing to say which floor to open,
 * neither in the address (`?floor=`) nor remembered from an earlier visit (`remembered`).
 */
export function flatViewGoesHome(search: string, remembered: string | null): boolean {
  const q = new URLSearchParams(search);
  if (q.has('home')) return true;
  return !q.get('floor') && !remembered;
}

/** One project's row in the Statistics tab's comparison table. */
export interface HomeFloorStats {
  id: string;
  name: string;
  repo?: string;
  /** A toolkit project's current stage, in a few words, when it has one. */
  stage?: string;
  issuesOpen: number;
  issuesClosed: number;
  /** The board keeps the latest 40 closed issues and 30 merged PRs, so the count may be "40+". */
  issuesClosedCapped: boolean;
  prsOpen: number;
  prsMerged: number;
  prsMergedCapped: boolean;
  /** PRs merged in the last 7 days (of the ones the board keeps). */
  mergedWeek: number;
  queued: number;
  running: number;
  /** Its agents: how many there are, working, waiting on a human, and asleep. */
  agents: number;
  working: number;
  waiting: number;
  asleep: number;
  /** The project team's Leads (ui/roster): hired (on the job, whatever they're doing) and benched. None when there's no team view. */
  leads?: { hired: number; benched: number; total: number };
  /** USD its workers spent today and all told (the project summary's numbers). */
  spend: { today: number; total: number };
  /** The latest thing that happened there (ms), from the project summary's activity. */
  lastActivity?: number;
}

export interface HomeStats {
  generatedAt: number;
  /** The whole office's spend from its ledger (it covers every worker it ever ran). */
  spend: { today: number; total: number; budget?: number };
  totals: { agents: number; working: number; waiting: number; asleep: number; issuesOpen: number; prsOpen: number; mergedWeek: number; queued: number };
  floors: HomeFloorStats[];
}

/** The stage label a toolkit project's summary gives, cut down to its first words (as the floor cards say it). */
export const shortStage = (label: string | undefined): string | undefined => (label ? label.replace(/\*\*/g, '').split(/[,(]/)[0].trim() || undefined : undefined);
