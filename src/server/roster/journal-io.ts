// Reading a team's journal off disk: the hired Lead's own copy first (its worktree has entries it
// hasn't pushed yet), then the project's checkout. Never throws: a missing journal is no entries.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkerInfo } from '../../shared/protocol.js';
import { parseJournal, type JournalEntry } from '../../shared/roster/journal.js';
import { journalPath, type TeamId } from '../../shared/roster/roles.js';
import type { TeamFloor } from './types.js';

export function readJournal(floor: Pick<TeamFloor, 'dir' | 'cwdOf'>, w: WorkerInfo | undefined, team: TeamId): JournalEntry[] {
  const dirs = w ? [floor.cwdOf(w), floor.dir] : [floor.dir];
  for (const d of dirs) {
    try {
      const entries = parseJournal(readFileSync(path.join(d, journalPath(team)), 'utf8'));
      if (entries.length) return entries;
    } catch {
      // not there: try the next folder
    }
  }
  return [];
}

/** An entry's first lines, for the org chart's "last journal entry". */
export function excerpt(body: string, n = 220): string {
  const one = body.replace(/^#+\s*/gm, '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}
