// Lock in's record per project, <data>/expert-lockin/<project>.json: its runs (the checks at a commit), its merges
// with their receipts, the deploy requests it raised, the phases it closed, and the decision log of everything it
// did (each row counts in the proof strip's DECISIONS beside PROJECT.md's own). Kept in memory once read, written
// atomically, newest last, capped.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../flow/store.js';
import type { LockInDecision, LockInMerge, LockInRun } from '../../shared/expert-lockin.js';

export interface LockInBook {
  runs: LockInRun[];
  merges: LockInMerge[];
  decisions: LockInDecision[];
  deploys: { id: string; at: number; merge: string; by: string }[];
  closed: { id: string; name: string; at: number; merge: string; by: string }[];
}

const KEEP = 100;
const books = new Map<string, LockInBook>();
const fileOf = (dataDir: string, floorId: string) => path.join(dataDir, 'expert-lockin', `${floorId.replace(/[^A-Za-z0-9_.-]/g, '-')}.json`);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function lockInBook(dataDir: string, floorId: string): LockInBook {
  const f = fileOf(dataDir, floorId);
  let b = books.get(f);
  if (b) return b;
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as Partial<LockInBook>;
    b = { runs: arr(raw.runs), merges: arr(raw.merges), decisions: arr(raw.decisions), deploys: arr(raw.deploys), closed: arr(raw.closed) };
  } catch {
    b = { runs: [], merges: [], decisions: [], deploys: [], closed: [] };
  }
  // A run the office stopped in the middle of (a restart) never finishes: said, not shown as running forever.
  for (const r of b.runs) {
    if (r.finishedAt) continue;
    r.finishedAt = r.startedAt;
    r.checks = r.checks.map((c) => (c.status === 'running' || c.status === 'waiting' ? { ...c, status: 'not-run', summary: 'Stopped', detail: 'The office restarted while it ran: run the checks again' } : c));
  }
  books.set(f, b);
  return b;
}

export function saveLockIn(dataDir: string, floorId: string, b: LockInBook) {
  for (const k of ['runs', 'merges', 'decisions', 'deploys', 'closed'] as const) (b[k] as unknown[]) = b[k].slice(-KEEP);
  writeJsonAtomic(fileOf(dataDir, floorId), b);
}

/** Lock in's rows in the decision log (the proof strip adds them to PROJECT.md's). */
export const lockInDecisions = (dataDir: string, floorId: string): number => lockInBook(dataDir, floorId).decisions.length;

/** Tests: forget what was read. */
export const forgetLockIn = () => books.clear();
