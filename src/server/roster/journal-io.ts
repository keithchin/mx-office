// Reading a team's journal off disk: the hired Lead's own copy first (its worktree has entries it
// hasn't pushed yet), then the project's checkout. Never throws: a missing journal is no entries.

import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WorkerInfo } from '../../shared/protocol.js';
import { parseJournal, type JournalEntry } from '../../shared/roster/journal.js';
import { journalPath, type TeamId } from '../../shared/roster/roles.js';
import type { TeamFloor } from './types.js';

export function readJournal(floor: Pick<TeamFloor, 'dir' | 'cwdOf'>, w: WorkerInfo | undefined, team: TeamId): JournalEntry[] {
  return journalFrom(floor, w, team, journalFile);
}

/** A journal file's entries, or undefined when it isn't there. */
export function journalFile(file: string): JournalEntry[] | undefined {
  try {
    return parseJournal(readFileSync(file, 'utf8'));
  } catch {
    return undefined; // not there: try the next folder
  }
}

/** readJournal's rule (the worker's own copy, then the checkout's) over whatever reads a journal file. */
export function journalFrom(floor: Pick<TeamFloor, 'dir' | 'cwdOf'>, w: WorkerInfo | undefined, team: TeamId, entriesOf: (file: string) => JournalEntry[] | undefined): JournalEntry[] {
  const dirs = w ? [floor.cwdOf(w), floor.dir] : [floor.dir];
  for (const d of dirs) {
    const entries = entriesOf(path.join(d, journalPath(team)));
    if (entries?.length) return entries;
  }
  return [];
}

/** Journal files as last read, by path: read again only when their time or size changed. */
const journals = new Map<string, { key: string; entries: JournalEntry[] }>();

/**
 * A journal file's entries, read off the event loop (undefined when it isn't there), and parsed again
 * only when it changed. For the ranking's background refresh, which looks at every team's journal on
 * every floor: read with readFileSync, that held the loop on a loaded machine (2026-10-08).
 */
export async function journalFileAsync(file: string): Promise<JournalEntry[] | undefined> {
  let key: string;
  try {
    const s = await stat(file);
    key = `${s.mtimeMs}:${s.size}`;
  } catch {
    journals.delete(file);
    return undefined;
  }
  const hit = journals.get(file);
  if (hit?.key === key) return hit.entries;
  try {
    const entries = parseJournal(await readFile(file, 'utf8'));
    journals.set(file, { key, entries });
    if (journals.size > 500) journals.delete(journals.keys().next().value!);
    return entries;
  } catch {
    return undefined;
  }
}

/** Reads of a journal file still out, by path. */
const reading = new Map<string, Promise<JournalEntry[] | undefined>>();

/**
 * readJournal from what was last read off the event loop (journalFileAsync): each file it looks at is
 * read again in the background for the next look, so a look never waits on the disk, and one that
 * changed shows on the look after. For the chatter feed, which looks at every team's journal every 15 s
 * and held the loop 50–320 ms doing it with readFileSync on a loaded machine (2026-10-08).
 */
export function readJournalSoon(floor: Pick<TeamFloor, 'dir' | 'cwdOf'>, w: WorkerInfo | undefined, team: TeamId): JournalEntry[] {
  return journalFrom(floor, w, team, (file) => {
    if (!reading.has(file)) {
      const job = journalFileAsync(file).finally(() => reading.delete(file));
      reading.set(file, job);
    }
    return journals.get(file)?.entries;
  });
}

/** An entry's first lines, for the org chart's "last journal entry". */
export function excerpt(body: string, n = 220): string {
  const one = body.replace(/^#+\s*/gm, '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}
