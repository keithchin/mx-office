// What a pull request's checks pipeline (pr-checks.yml) says about it, for its card on the board:
// the sticky scorecard comment, row by row, and the Playwright screenshots from the run's artifact
// (GET /api/pr-shots, see server/prshots/). No Node imports: the page reads it too.

import type { Scorecard } from './analysis.js';

/** One row of the scorecard's table: "✅ | Studio Pro `mx check` | 0 error(s)". */
export interface ScorecardRow {
  icon: string;
  check: string;
  result: string;
}

export interface PrShot {
  /** Its path inside the artifact, which is how the page asks for the picture. */
  name: string;
  /** What it shows, from the test it came from. */
  label: string;
}

export interface PrChecks {
  pr: number;
  /** The newest pr-checks run on the PR's branch; missing when it has none. */
  run?: { id: number; status: string; conclusion: string; sha: string; url: string; createdAt: string };
  /** The comment's headline ("✅ Mendix PR checks — passing") and its rows, read with analysis/scorecard.ts. */
  headline?: string;
  rows: ScorecardRow[];
  scorecard?: Scorecard;
  shots: PrShot[];
  /** Why there's less than there might be (the artifact expired, gh failed); the rest still shows. */
  note?: string;
}

/** The table rows of a scorecard comment (the ones with an icon in front). */
export function scorecardRows(body: string): ScorecardRow[] {
  const out: ScorecardRow[] = [];
  for (const line of body.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (!line.trim().startsWith('|') || cells.length < 5) continue;
    const [, icon, check, result] = cells;
    if (!icon || /^-+$/.test(icon) || !check || check.toLowerCase() === 'check') continue;
    out.push({ icon, check: check.replace(/`/g, ''), result: result.replace(/\*\*/g, '') });
  }
  return out;
}

/** "smoke-home-page-loads-chromium" → "smoke home page loads". */
export function shotLabel(dir: string, file: string): string {
  const base = dir && dir !== '.' && dir !== 'data' ? dir : file.replace(/\.png$/i, '');
  return base.replace(/-(chromium|firefox|webkit)(-retry\d+)?$/i, '').replace(/[-_]+/g, ' ').trim();
}
