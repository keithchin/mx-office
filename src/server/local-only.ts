// Local-only projects: a project created with "Keep this project off GitHub" (wizard/local-only.ts) says so
// in its agent-office.project.json (`"localOnly": true`). Everything the office would ask GitHub about such
// a project (its issues and pull requests, PR checks, merges, comments, labels) is refused before gh runs
// (github.ts asks `localOnlyAt`), with one plain sentence instead of a failure, and every hire is told the
// project's rule in its first message (roster/adapter.ts). Read from the project's folder, cached briefly.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** What a refused GitHub call says, and what degraded features show. */
export const LOCAL_ONLY_TEXT = 'Not on GitHub: issues, pull requests and PR checks are unavailable for this project';

/** The rule each hire on a local-only project is told (one line, under the hire prompt's 300 characters). */
export const LOCAL_ONLY_HIRE_LINE = 'This project is local only (not on GitHub): never push to GitHub or run gh commands that publish; work on local branches, and the Lead merges into main locally.';

/** The rule for a project on Mendix Team Server with no GitHub ("off GitHub" too, but its code goes to Team Server). */
export const TEAM_SERVER_HIRE_LINE = 'This project is not on GitHub (its code is on Mendix Team Server): never push to GitHub, to Team Server, or run gh commands that publish; work on local branches, and the Lead merges into main locally.';

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; stamp: string; local: boolean; teamServer: boolean }>();

/**
 * Whether the project (or worktree) at `dir` is off GitHub (`"localOnly": true`; the key keeps its old name); false
 * when it can't tell. A project on Team Server with no GitHub is off GitHub too: `offGitHubAt` says which kind.
 */
export function localOnlyAt(dir: string | undefined, now = Date.now()): boolean {
  return read(dir, now).local;
}

/** Off GitHub, and why: `teamserver` (the code goes to Team Server), `machine` (it stays here); undefined: on GitHub. */
export function offGitHubAt(dir: string | undefined, now = Date.now()): 'teamserver' | 'machine' | undefined {
  const r = read(dir, now);
  return r.local ? (r.teamServer ? 'teamserver' : 'machine') : undefined;
}

function read(dir: string | undefined, now: number): { local: boolean; teamServer: boolean } {
  if (!dir) return { local: false, teamServer: false };
  const f = path.join(dir, 'agent-office.project.json');
  const hit = cache.get(f);
  if (hit && now - hit.at < TTL_MS) return hit;
  let stamp = '-';
  try {
    const s = statSync(f);
    stamp = `${s.mtimeMs}:${s.size}`;
  } catch {
    // no project file: not local only
  }
  if (hit && hit.stamp === stamp) {
    hit.at = now;
    return hit;
  }
  let local = false;
  let teamServer = false;
  if (stamp !== '-') {
    try {
      const j = JSON.parse(readFileSync(f, 'utf8')) as { localOnly?: unknown; teamServer?: unknown };
      local = j.localOnly === true;
      teamServer = !!j.teamServer && typeof j.teamServer === 'object';
    } catch {
      // unreadable: not local only
    }
  }
  const e = { at: now, stamp, local, teamServer };
  cache.set(f, e);
  return e;
}

/** Forgets what was read (the settings step just wrote the file; tests). */
export const forgetLocalOnly = () => cache.clear();

type HireContext = { line: string; record(role: string, workerId: string, sessionId?: string): Promise<void> };

/** A hire's context (the portfolio's brain line, if any) with a local-only project's rule after it. */
export async function withLocalOnlyLine(base: Promise<HireContext | undefined>, dir: string | undefined): Promise<HireContext | undefined> {
  const b = await base;
  const off = offGitHubAt(dir);
  if (!off) return b;
  const rule = off === 'teamserver' ? TEAM_SERVER_HIRE_LINE : LOCAL_ONLY_HIRE_LINE;
  return { line: b ? `${b.line} ${rule}` : rule, record: b ? (...a) => b.record(...a) : async () => undefined };
}
