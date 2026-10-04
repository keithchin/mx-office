// What a team's page shows from the floor's project (shared/roster/team-page.ts): the team journal's
// newest entries, the analysis team's memos, the design team's artifacts and the newest standup page.
// Read-only, from the floor's main checkout, and kept a little while so a page flipping between teams
// (or several people looking) doesn't ask git and the disk each time.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseJournal } from '../../shared/roster/journal.js';
import { journalPath, type TeamId } from '../../shared/roster/roles.js';
import { JOURNAL_BODY_MAX, JOURNAL_SHOWN, type TeamPageData } from '../../shared/roster/team-page.js';

/** An answer is handed out again for this long (ms). */
const FRESH_MS = 20_000;
/** How many paths a list keeps (the page shows the newest few). */
const LIST_MAX = 40;

const cache = new Map<string, { at: number; p: Promise<TeamPageData> }>();

/** The project's files under the folders the panels list, as git has them (tracked, or new and not ignored). */
function listed(dir: string): Promise<string[]> {
  const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'docs/insights', 'docs/standups', 'docs/requirements', 'design', 'docs/design', ':(icase)*brd*.md'];
  return new Promise((resolve) => {
    execFile('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 15_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, out) => {
      resolve(err ? [] : [...new Set(out.split('\0').filter(Boolean))]);
    });
  });
}

/** Newest first by the date in the name (2026-W40, 2026-10-05), then by name. */
const newestFirst = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });

async function read(dir: string, team: TeamId): Promise<TeamPageData> {
  const [text, files] = await Promise.all([readFile(path.join(dir, journalPath(team)), 'utf8').catch(() => ''), listed(dir)]);
  const journal = parseJournal(text)
    .slice(-JOURNAL_SHOWN)
    .reverse()
    .map((e) => ({ heading: e.heading, date: e.date, body: e.body.length > JOURNAL_BODY_MAX ? `${e.body.slice(0, JOURNAL_BODY_MAX)}…` : e.body }));
  const under = (...prefixes: string[]) => files.filter((f) => prefixes.some((p) => f.startsWith(p)));
  const insights = [...under('docs/insights/', 'docs/requirements/'), ...files.filter((f) => /brd/i.test(path.posix.basename(f)) && f.endsWith('.md'))];
  const standups = under('docs/standups/').filter((f) => f.endsWith('.md')).sort(newestFirst);
  return {
    team,
    journalPath: journalPath(team),
    journal,
    insights: [...new Set(insights)].sort(newestFirst).slice(0, LIST_MAX),
    design: under('design/', 'docs/design/').sort().slice(0, LIST_MAX),
    standup: standups[0],
  };
}

/** The page's project data for `team` on the floor checked out at `dir`. Never throws: what's missing is empty. */
export function teamPageData(floorId: string, dir: string, team: TeamId): Promise<TeamPageData> {
  const key = `${floorId}\0${team}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.p;
  const p = read(dir, team);
  cache.set(key, { at: Date.now(), p });
  return p;
}
