// Connect to Team Server: an existing local-only project gets a Mendix Portal app (made by the Projects API, or one
// whose App ID the Project Manager pasted), the `teamserver` remote, and its main on Team Server. Its history is
// kept: one commit with the project's own tree plus the record (agent-office.project.json `teamServer`) and the
// Team Server rule in CLAUDE.md, whose second parent is Team Server's main (the Portal's template commit), so it
// fast-forwards both the project's origin and Team Server. It is built with a temporary index (git plumbing), so the
// project's folder and the agents' worktrees are never checked out or touched; the template's files are not taken in.
// Origin is pushed first and without force (a main that moved meanwhile refuses it, and nothing reaches Team Server).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEAMSERVER_REMOTE, portalAppName, portalSummary, teamServerUrl, type TeamServerEndpoints, type TeamServerRecord, type TeamServerSync } from '../../shared/team-server.js';
import { createProject, waitForProject, type ApiDeps } from './api.js';
import { gitRefusalWords, type TsGit } from './git.js';
import { ensureRemote, pushNotes, pushToTeamServer } from './sync.js';
import { PROJECT_FILE, cleanRecord } from './project.js';
import { adoptionCommit, fetchTsMain, teamServerRules, withTeamServerRules } from './adopt.js';

export interface ConnectDeps {
  g: TsGit;
  /** The project's main checkout. */
  dir: string;
  name: string;
  description: string;
  by: string;
  endpoints: TeamServerEndpoints;
  /** The Projects API (token, fetch); used only when no App ID was given. */
  api: ApiDeps;
  /** An existing Portal app's id, pasted by the Project Manager. */
  projectId?: string;
  /** A Projects API job already sent for this project (kept by the caller across a restart). */
  jobId?: string;
  /** Saves the job id as soon as the Portal gives it (so a restart follows it instead of creating a second app). */
  sent?(jobId: string): void;
  onLine?(line: string): void;
  main?: string;
  now?: () => number;
}

export interface Connected {
  rec: TeamServerRecord;
  commit: string;
  sync: TeamServerSync;
  how: 'made' | 'linked';
}

/** A file's text at `rev`, '' when it isn't there. */
const showAt = async (g: TsGit, dir: string, rev: string, file: string) => {
  const r = await g.plain(dir, ['show', `${rev}:${file}`], { allowFail: true });
  return r.code === 0 ? r.stdout : '';
};

/** `base`'s tree with `files` replaced (a temporary index: the folder and its index are never touched). */
async function treeWith(g: TsGit, dir: string, base: string, files: Record<string, string>): Promise<string> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ts-connect-'));
  const env = { GIT_INDEX_FILE: path.join(tmp, 'index') };
  try {
    await g.plain(dir, ['read-tree', base], { env });
    for (const [rel, text] of Object.entries(files)) {
      const f = path.join(tmp, 'blob');
      writeFileSync(f, text);
      const blob = (await g.plain(dir, ['hash-object', '-w', `--path=${rel}`, f])).stdout.trim();
      await g.plain(dir, ['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`], { env });
    }
    return (await g.plain(dir, ['write-tree'], { env })).stdout.trim();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Makes or checks the Portal app, then puts the project on Team Server as above. Throws in words (token-free). */
export async function connectProject(d: ConnectDeps): Promise<Connected> {
  const { g, dir } = d;
  const main = d.main ?? 'main';
  const say = d.onLine ?? (() => undefined);
  // 1. The Portal app.
  let projectId = d.projectId;
  let how: 'made' | 'linked' = 'linked';
  if (projectId) {
    const r = await g.auth(os.tmpdir(), ['ls-remote', '--heads', teamServerUrl(projectId, d.endpoints.git)], { allowFail: true, timeoutMs: 2 * 60_000 });
    if (r.code !== 0) throw new Error(gitRefusalWords(r.tail.join(' ') || `couldn't reach the Team Server repository of ${projectId}`));
  } else {
    const name = portalAppName(d.name);
    if (!name) throw new Error(`“${d.name}” can’t be a Mendix app name: use letters, digits, spaces, - or _`);
    let jobId = d.jobId;
    if (!jobId) {
      say(`Creating the app “${name}” in the Mendix Portal…`);
      jobId = await createProject(d.api, { name, summary: portalSummary(d.description) || undefined });
      d.sent?.(jobId);
    }
    projectId = await waitForProject(d.api, jobId, say);
    how = 'made';
  }
  const rec: TeamServerRecord = { projectId, url: teamServerUrl(projectId, d.endpoints.git), remote: TEAMSERVER_REMOTE, how, by: d.by, at: (d.now ?? Date.now)() };
  // 2. The remote and both mains.
  await ensureRemote(g, dir, rec);
  const tsMain = await fetchTsMain(g, dir, rec.remote);
  await g.plain(dir, ['fetch', '--quiet', 'origin', `+refs/heads/${main}:refs/remotes/origin/${main}`]);
  const head = (await g.plain(dir, ['rev-parse', `refs/remotes/origin/${main}`])).stdout.trim();
  // 3. One commit: the project's tree, the record and the rule, Team Server's main as its second parent.
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse((await showAt(g, dir, head, PROJECT_FILE)) || '{}') as Record<string, unknown>;
  } catch {
    // an unreadable project file is replaced by one with the record
  }
  if (cleanRecord(saved.teamServer)) throw new Error('This project is on Team Server already');
  const files = {
    [PROJECT_FILE]: `${JSON.stringify({ ...saved, teamServer: rec }, null, 2)}\n`,
    'CLAUDE.md': withTeamServerRules(await showAt(g, dir, head, 'CLAUDE.md'), teamServerRules(rec)),
  };
  const tree = await treeWith(g, dir, head, files);
  const msg = `Connect to Mendix Team Server (Portal app ${projectId})\n\nRecorded in ${PROJECT_FILE} by ${d.by} in Mx Office.${tsMain ? ' Team Server\'s main is the second parent, so both mains fast-forward from here.' : ''}`;
  const commit = (await adoptionCommit(g, dir, head, tsMain, msg, tree))!;
  // 4. Origin first, never forced: a main that moved meanwhile refuses it, and Team Server is left as it was.
  const pushed = await g.plain(dir, ['push', '--no-progress', 'origin', `${commit}:refs/heads/${main}`], { allowFail: true, timeoutMs: 10 * 60_000 });
  if (pushed.code !== 0) throw new Error(`Not connected: ${main} moved on in the project's origin meanwhile (${pushed.tail.slice(-1).join(' ').slice(0, 160)}). Nothing was pushed to Team Server; try again. The Portal app ${projectId} stays: paste its App ID to use it`);
  // 5. Then Team Server, checked with ls-remote.
  await pushToTeamServer(g, dir, rec.remote, commit);
  const notes = await pushNotes(g, dir, rec.remote);
  // 6. The project's folder follows when it's on main with nothing uncommitted (fast-forward only).
  await g.plain(dir, ['fetch', '--quiet', 'origin'], { allowFail: true });
  const cur = (await g.plain(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true })).stdout.trim();
  const dirty = (await g.plain(dir, ['status', '--porcelain', '--untracked-files=no'], { allowFail: true })).stdout.trim();
  if (cur === main && !dirty) await g.plain(dir, ['merge', '--ff-only', '--quiet', `origin/${main}`], { allowFail: true });
  const at = (d.now ?? Date.now)();
  return { rec, commit, how, sync: { at, state: 'pushed', sha: commit, message: `Connected: ${main} (${commit.slice(0, 7)}) is on Team Server${notes ? `; ${notes}` : ''}.` } };
}
