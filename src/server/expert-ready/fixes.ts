// The readiness check's fixes (shared/expert-ready.ts), each one clicked by a person and each writing only what
// its button says:
//   - pin-toolkit: the `toolkit` record in the folder's agent-office.project.json (toolkit-pin/record.ts), the
//     file's other settings kept;
//   - add-teamserver: the Portal app (made, or one whose App ID was given: team-server/connect.ts portalApp), the
//     "teamserver" remote (team-server/sync.ts ensureRemote; never origin or any other remote) and the
//     `teamServer` record in agent-office.project.json. Nothing is committed or pushed: the session's background
//     proof pushes its branch there;
//   - seed-users / add-tests: a wish in the office's own data (<data>/expert-ready/wishes.json), nothing in the
//     folder: they are model changes the session makes, and its composer is filled with them later;
//   - set-budget: the attached project's budget, or (not attached yet) kept with the wishes and set on attach.

import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TEAMSERVER_REMOTE, teamServerUrl, type TeamServerEndpoints, type TeamServerRecord } from '../../shared/team-server.js';
import type { ReadyWishes } from '../../shared/expert-ready.js';
import { nextRecord, PROJECT_FILE, recordOf, withRecord } from '../toolkit-pin/record.js';
import { portalApp } from '../team-server/connect.js';
import { ensureRemote } from '../team-server/sync.js';
import { cleanRecord } from '../team-server/project.js';
import type { TsGit } from '../team-server/git.js';
import type { ApiDeps } from '../team-server/api.js';
import { writeJsonAtomic } from '../flow/store.js';

// ---- Wishes (the office's data, never the folder) -----------------------------------------------

/** The key a folder's wishes are kept under: its resolved path, case-folded on Windows. */
export const folderKey = (dir: string) => (process.platform === 'win32' ? path.resolve(dir).toLowerCase() : path.resolve(dir));

export class WishBook {
  private data: Record<string, ReadyWishes> | undefined;

  constructor(private file: string) {}

  private all(): Record<string, ReadyWishes> {
    if (this.data) return this.data;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      this.data = j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, ReadyWishes>) : {};
    } catch {
      this.data = {};
    }
    return this.data;
  }

  get(dir: string): ReadyWishes {
    return { ...(this.all()[folderKey(dir)] ?? {}) };
  }

  set(dir: string, w: ReadyWishes) {
    const all = this.all();
    if (Object.keys(w).length) all[folderKey(dir)] = w;
    else delete all[folderKey(dir)];
    writeJsonAtomic(this.file, all);
  }

  patch(dir: string, p: Partial<ReadyWishes>) {
    this.set(dir, { ...this.get(dir), ...p });
  }
}

// ---- The folder's project file ------------------------------------------------------------------

async function projectFile(dir: string): Promise<string | undefined> {
  return readFile(path.join(dir, PROJECT_FILE), 'utf8').catch(() => undefined);
}

/** Pins the toolkit at `commit`: agent-office.project.json's `toolkit` record, nothing else. */
export async function pinToolkit(dir: string, commit: string, by: string, now = new Date()): Promise<string> {
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new Error('That is not a toolkit commit');
  const text = await projectFile(dir);
  const prev = recordOf(text);
  if (prev?.commit === commit) return `Already pinned to ${commit.slice(0, 7)}`;
  await writeFile(path.join(dir, PROJECT_FILE), withRecord(text, nextRecord(prev, commit, by, 'pin', undefined, now.toISOString())));
  return `Pinned to ${commit.slice(0, 7)} in ${PROJECT_FILE}`;
}

export interface TeamServerFixDeps {
  g: TsGit;
  dir: string;
  /** The Portal app's name when one is made (the project's name). */
  name: string;
  endpoints: TeamServerEndpoints;
  api: ApiDeps;
  /** An existing Portal app's id; none: a new app is made. */
  projectId?: string;
  by: string;
  now?: () => number;
}

/** Adds the Team Server remote (existing remotes kept) and records the app. Throws in words, token-free. */
export async function addTeamServerRemote(d: TeamServerFixDeps): Promise<{ rec: TeamServerRecord; message: string }> {
  const { g, dir } = d;
  const remotes = (await g.plain(dir, ['remote'], { allowFail: true })).stdout.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (remotes.includes(TEAMSERVER_REMOTE)) throw new Error(`The folder already has a “${TEAMSERVER_REMOTE}” remote: nothing was changed`);
  const text = await projectFile(dir);
  let saved: Record<string, unknown> = {};
  try {
    saved = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`${PROJECT_FILE} isn't valid JSON: fix it first, nothing was changed`);
  }
  if (cleanRecord(saved.teamServer)) throw new Error(`${PROJECT_FILE} already names a Team Server app: nothing was changed`);
  const app = await portalApp({ g, name: d.name, description: '', endpoints: d.endpoints, api: d.api, ...(d.projectId ? { projectId: d.projectId } : {}) });
  const rec: TeamServerRecord = { projectId: app.projectId, url: teamServerUrl(app.projectId, d.endpoints.git), remote: TEAMSERVER_REMOTE, how: app.how, by: d.by, at: (d.now ?? Date.now)() };
  await ensureRemote(g, dir, rec);
  await writeFile(path.join(dir, PROJECT_FILE), `${JSON.stringify({ ...saved, teamServer: rec }, null, 2)}\n`);
  return { rec, message: `Added the “${TEAMSERVER_REMOTE}” remote (${app.how === 'made' ? 'new' : 'existing'} Portal app ${app.projectId}) and recorded it in ${PROJECT_FILE}` };
}
