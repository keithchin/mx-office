// Approved proposals become GitHub issues on the floor's board, labelled with the team that proposed
// them (team:<team>, made first if the repository hasn't got it). A dry run (the floor's setting, or
// AGENT_OFFICE_TEAMS_DRY_RUN=1 for the whole office) records the decision but asks GitHub nothing,
// and the tests swap the maker out entirely.

import type { IssueDraft } from '../../shared/roster/journal.js';
import { gh } from '../github.js';

export interface MadeIssue {
  number?: number;
  url?: string;
  dryRun?: boolean;
  error?: string;
}

/** Makes an issue in the repository checked out at `dir`; `env` is the asking person's gh, when the office acts as them. */
export type IssueMaker = (dir: string, draft: IssueDraft, env?: Record<string, string>) => Promise<MadeIssue>;

export const envDryRun = () => process.env.AGENT_OFFICE_TEAMS_DRY_RUN === '1';

export const ghIssueMaker: IssueMaker = async (dir, draft, env) => {
  try {
    for (const label of draft.labels) {
      // --force: exists already is fine; a failure here only costs the label, so it's not fatal.
      await gh(['label', 'create', label, '--color', '5bc0eb', '--description', 'Proposed by this team in Agent Office', '--force'], dir, 20_000, env).catch(() => {});
    }
    const args = ['issue', 'create', '--title', draft.title, '--body', draft.body, ...draft.labels.flatMap((l) => ['--label', l])];
    const out = (await gh(args, dir, 30_000, env)).trim();
    const url = out.split('\n').pop() ?? '';
    const n = /\/issues\/(\d+)/.exec(url);
    return { url, number: n ? Number(n[1]) : undefined };
  } catch (err) {
    return { error: (err as Error).message };
  }
};

export const dryRunMaker: IssueMaker = async () => ({ dryRun: true });
