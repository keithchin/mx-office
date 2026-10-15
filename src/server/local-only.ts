// Local-only projects: a project created with "Keep this project off GitHub" (wizard/local-only.ts) says so
// in its agent-office.project.json (`"localOnly": true`). Everything the office would ask GitHub about such
// a project (its issues and pull requests, PR checks, merges, comments, labels) is refused before gh runs
// (github.ts asks `localOnlyAt`), with one plain sentence instead of a failure, and every hire is told the
// project's rule in its first message (roster/adapter.ts). Read from the project's folder, cached briefly.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** What a refused GitHub call says, and what degraded features show. */
export const LOCAL_ONLY_TEXT = 'Local only: not on GitHub, so issues, pull requests and PR checks are unavailable for this project';

/** The rule each hire on a local-only project is told (one line, under the hire prompt's 300 characters). */
export const LOCAL_ONLY_HIRE_LINE = 'This project is local only (not on GitHub): never push to GitHub or run gh commands that publish; work on local branches, and the Lead merges into main locally.';

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; stamp: string; local: boolean }>();

/** Whether the project (or worktree) at `dir` is local only; false when it can't tell. */
export function localOnlyAt(dir: string | undefined, now = Date.now()): boolean {
  if (!dir) return false;
  const f = path.join(dir, 'agent-office.project.json');
  const hit = cache.get(f);
  if (hit && now - hit.at < TTL_MS) return hit.local;
  let stamp = '-';
  try {
    const s = statSync(f);
    stamp = `${s.mtimeMs}:${s.size}`;
  } catch {
    // no project file: not local only
  }
  if (hit && hit.stamp === stamp) {
    hit.at = now;
    return hit.local;
  }
  let local = false;
  if (stamp !== '-') {
    try {
      local = (JSON.parse(readFileSync(f, 'utf8')) as { localOnly?: unknown }).localOnly === true;
    } catch {
      // unreadable: not local only
    }
  }
  cache.set(f, { at: now, stamp, local });
  return local;
}

/** Forgets what was read (the settings step just wrote the file; tests). */
export const forgetLocalOnly = () => cache.clear();

type HireContext = { line: string; record(role: string, workerId: string, sessionId?: string): Promise<void> };

/** A hire's context (the portfolio's brain line, if any) with a local-only project's rule after it. */
export async function withLocalOnlyLine(base: Promise<HireContext | undefined>, dir: string | undefined): Promise<HireContext | undefined> {
  const b = await base;
  if (!localOnlyAt(dir)) return b;
  return { line: b ? `${b.line} ${LOCAL_ONLY_HIRE_LINE}` : LOCAL_ONLY_HIRE_LINE, record: b ? (...a) => b.record(...a) : async () => undefined };
}
