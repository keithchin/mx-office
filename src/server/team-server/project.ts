// A project's Team Server record: `teamServer` in its agent-office.project.json (shared/team-server.ts
// TeamServerRecord), written by the wizard's settings step or by Connect to Team Server, committed with the
// project so every office (and every clone) sees the same app. Read from the folder, cached briefly.

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanProjectId, portalUrl, TEAMSERVER_REMOTE, type CloudEnvironments, type TeamServerRecord } from '../../shared/team-server.js';
import { environmentsStale, peekEnvironments } from './environments.js';

export const PROJECT_FILE = 'agent-office.project.json';
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; stamp: string; rec?: TeamServerRecord }>();

/** A record read back, checked (a hand-edited file with a bad id or a URL with a user in it reads as none). */
export function cleanRecord(v: unknown): TeamServerRecord | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const projectId = cleanProjectId(r.projectId);
  const url = typeof r.url === 'string' ? r.url : '';
  // Never a URL that carries credentials (user:pass@ or a token in it).
  if (!projectId || !/^https?:\/\/[^/@\s]+\/[^@\s]+$/.test(url)) return undefined;
  return {
    projectId,
    url,
    remote: typeof r.remote === 'string' && /^[\w.-]{1,40}$/.test(r.remote) ? r.remote : TEAMSERVER_REMOTE,
    ...(r.mirror === true ? { mirror: true } : {}),
    how: r.how === 'linked' ? 'linked' : 'made',
    by: typeof r.by === 'string' ? r.by.slice(0, 100) : '',
    at: typeof r.at === 'number' ? r.at : 0,
  };
}

/** The project (or worktree) at `dir`'s Team Server record, if it has one. */
export function teamServerAt(dir: string | undefined, now = Date.now()): TeamServerRecord | undefined {
  if (!dir) return undefined;
  const f = path.join(dir, PROJECT_FILE);
  const hit = cache.get(f);
  if (hit && now - hit.at < TTL_MS) return hit.rec;
  let stamp = '-';
  try {
    const s = statSync(f);
    stamp = `${s.mtimeMs}:${s.size}`;
  } catch {
    // no project file
  }
  if (hit && hit.stamp === stamp) {
    hit.at = now;
    return hit.rec;
  }
  let rec: TeamServerRecord | undefined;
  if (stamp !== '-') {
    try {
      rec = cleanRecord((JSON.parse(readFileSync(f, 'utf8')) as { teamServer?: unknown }).teamServer);
    } catch {
      // unreadable: none
    }
  }
  cache.set(f, { at: now, stamp, rec });
  return rec;
}

/** Writes the record into the project file (keeping everything else); true when it changed. */
export function writeRecord(dir: string, rec: TeamServerRecord): boolean {
  const f = path.join(dir, PROJECT_FILE);
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
  } catch {
    // first time
  }
  const had = cleanRecord(saved.teamServer);
  if (had && had.projectId === rec.projectId && had.url === rec.url && !!had.mirror === !!rec.mirror && had.remote === rec.remote) return false;
  writeFileSync(f, `${JSON.stringify({ ...saved, teamServer: rec }, null, 2)}\n`);
  cache.delete(f);
  return true;
}

/** Forgets what was read (tests; a write elsewhere). */
export const forgetTeamServer = () => cache.clear();

/** Reads the app's cloud environments again in the background (set by team-server/index.ts, which has the token). */
let refreshEnvironments: ((projectId: string) => void) | undefined;
export const onEnvironmentsWanted = (fn: ((projectId: string) => void) | undefined) => void (refreshEnvironments = fn);

/**
 * A setup view with the project's Team Server app and remote (the Overview's Repository row), read now like localOnly,
 * and the app's cloud environments as last read (a stale read is asked for again in the background, never waited on).
 */
export function withTeamServerView<T extends object>(dir: string, v: T): T & { teamServer?: { projectId: string; url: string; portalUrl: string; mirror?: boolean; environments?: CloudEnvironments } } {
  const rec = teamServerAt(dir);
  if (!rec) return v;
  if (environmentsStale(rec.projectId)) refreshEnvironments?.(rec.projectId);
  const envs = peekEnvironments(rec.projectId);
  return { ...v, teamServer: { projectId: rec.projectId, url: rec.url, portalUrl: portalUrl(rec.projectId), ...(rec.mirror ? { mirror: true } : {}), ...(envs ? { environments: envs } : {}) } };
}
