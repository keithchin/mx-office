// The backfill's view of a building that isn't running here: its floors.json, and each floor's
// workers.json and queue.json, read straight off the disk. It's how the runs from before the analyzer
// existed get their records, and how the analyzer can be checked against an office without touching it.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { QueueTask } from '../../shared/protocol.js';
import { restoreTracker, trackerUsage } from '../usage.js';
import type { FloorRef, WorkerSnapshot } from './collect.js';

const readJson = (file: string): any => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

export interface DiskFloor {
  floor: FloorRef;
  workers: WorkerSnapshot[];
  tasks: QueueTask[];
}

/** Every floor an office's data folder lists, with the workers and queue tasks it saved. */
export function readBuilding(dataDir: string): DiskFloor[] {
  const floors = readJson(path.join(dataDir, 'floors.json'));
  const defs: FloorRef[] = Array.isArray(floors)
    ? floors.filter((f) => f && typeof f.id === 'string' && typeof f.dir === 'string').map((f) => ({ id: f.id, name: String(f.name ?? f.id), repo: typeof f.repo === 'string' ? f.repo : undefined, dir: f.dir }))
    : [{ id: path.basename(path.dirname(dataDir)), name: path.basename(path.dirname(dataDir)), dir: path.dirname(dataDir) }];
  return defs.map((floor) => {
    const own = path.join(floor.dir, '.agent-office');
    const saved = readJson(path.join(own, 'workers.json'));
    const queue = readJson(path.join(own, 'queue.json'));
    return { floor, workers: Array.isArray(saved) ? saved.map(snapshotOf).filter((w): w is WorkerSnapshot => !!w) : [], tasks: Array.isArray(queue?.tasks) ? queue.tasks : [] };
  });
}

/** One saved worker, as workers.json has it (see workers/persist.ts). Shells aren't runs. */
export function snapshotOf(s: any): WorkerSnapshot | undefined {
  if (!s || typeof s.id !== 'string' || s.kind === 'shell') return undefined;
  const tracker = restoreTracker(s.tracker);
  return {
    id: s.id,
    name: String(s.name ?? 'Worker'),
    provider: typeof s.provider === 'string' ? s.provider : tracker.transcript ? 'claude' : undefined,
    model: typeof s.model === 'string' ? s.model : undefined,
    effort: typeof s.effort === 'string' ? s.effort : undefined,
    prompt: typeof s.prompt === 'string' ? s.prompt : undefined,
    title: typeof s.title === 'string' ? s.title : undefined,
    sessionId: typeof s.sessionId === 'string' ? s.sessionId : undefined,
    createdAt: Number(s.createdAt) || 0,
    pr: s.pr && Number(s.pr.number) ? { number: Number(s.pr.number) } : undefined,
    worktreePath: s.worktree?.path,
    transcript: tracker.transcript,
    usage: trackerUsage(tracker),
    workedMs: Number(s.workedMs) || 0,
    // Saved mid-turn: it was still at it when the office last wrote this down.
    running: s.midTurn === true,
  };
}
