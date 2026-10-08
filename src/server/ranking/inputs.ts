// What the ranking reads from each floor, gathered off the event loop for its background refresh: the
// team journals and the project's own files are read with fs/promises (each file again only when it
// changed), one floor at a time with the loop free in between. The synchronous reads did the same on
// the event loop, and on a loaded machine (builds, the virus scanner looking at every open) the
// refresh held it for over a second (the busy office check, 2026-10-08). What comes out is the same
// FloorInput the synchronous path makes, so the report is the same.

import path from 'node:path';
import type { WorkerInfo } from '../../shared/protocol.js';
import { journalPath, ROLE_BY_ID, ROLES, type RoleId } from '../../shared/roster/roles.js';
import type { JournalEntry } from '../../shared/roster/journal.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { journalFile, journalFileAsync, journalFrom, readJournal } from '../roster/journal-io.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { projectFacts, projectFactsAsync } from '../summary/project.js';
import { roleResolver, type FloorInput } from './facts.js';

/** A turn of the event loop for other work. */
export const breathe = () => new Promise<void>((r) => setImmediate(r));

/** Every floor's input, read there and then (the first ask, before the warm-up has run). */
export function floorInputs(ctx: Ctx, floors: Floor[]): FloorInput[] {
  const roster = rosterOf(ctx);
  return floors.map((f) => {
    const team = teamFloor(ctx, f);
    return {
      id: f.id,
      name: f.def.name,
      workers: f.workers.list(),
      roster: roster.data(f.id),
      pulls: f.github.pulls.items,
      journal: (role, w: WorkerInfo | undefined) => readJournal(team, w, ROLE_BY_ID.get(role)!.team),
      project: projectFacts(f.dir),
    };
  });
}

/**
 * The same, read off the event loop. The journals gatherFacts can ask for are known beforehand: each
 * team's in the checkout, and each team's in the folder of a live worker that holds one of its roles
 * (the worker it passes); those are read first, and its asks are answered from what was read.
 */
export async function floorInputsAsync(ctx: Ctx, floors: Floor[]): Promise<FloorInput[]> {
  const roster = rosterOf(ctx);
  const out: FloorInput[] = [];
  for (const f of floors) {
    const team = teamFloor(ctx, f);
    const workers = f.workers.list();
    const data = roster.data(f.id);
    const roleOf = roleResolver(data);
    const files = new Set<string>();
    for (const r of ROLES) files.add(path.join(f.dir, journalPath(r.team)));
    for (const w of workers) {
      if (w.kind !== 'agent') continue;
      const role = ROLE_BY_ID.get(roleOf(w.id, w.name) as RoleId);
      if (role) files.add(path.join(team.cwdOf(w), journalPath(role.team)));
    }
    const read = new Map<string, JournalEntry[] | undefined>();
    await Promise.all([...files].map(async (file) => read.set(file, await journalFileAsync(file))));
    const project = await projectFactsAsync(f.dir);
    out.push({
      id: f.id,
      name: f.def.name,
      workers,
      roster: data,
      pulls: f.github.pulls.items,
      // Anything not read beforehand (it shouldn't happen) is read there and then, as before.
      journal: (role, w) => journalFrom(team, w, ROLE_BY_ID.get(role)!.team, (file) => (read.has(file) ? read.get(file) : journalFile(file))),
      project,
    });
    await breathe();
  }
  return out;
}
