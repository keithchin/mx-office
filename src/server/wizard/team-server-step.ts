// A new project on Mendix Team Server (ProjectPlan.teamServer, shared/team-server.ts), as steps wrapped round the
// setup's own (like local-only.ts):
//   repo     first the Portal app: the Projects API makes it (POST /projects, then its job followed to the app's
//            id: team-server/api.ts), or the id the person pasted is checked on Team Server; every stage is
//            saved on the job before the next, so a Retry never creates a second app. Then the setup's own repo
//            step: the bare repository on this machine (Team Server alone: no GitHub, its origin on this machine) or GitHub
//            (the mirror). Cancel & undo never deletes the Portal app.
//   clone    the setup's own clone, then the `teamserver` remote (the plain URL) and Team Server's history adopted
//            with one commit that keeps the project's tree and has the Portal's template commit as its second
//            parent (platform-link.md's single-tree adoption, done with plumbing), so both mains fast-forward
//            from it and nothing is ever force-pushed. The template's files are not taken in.
//   app      the app is made fresh with the picked Studio Pro (mx create-project --sprintr-app-id <the app's
//            id>), named App.mpr as Team Server's template names it (platform-link.md trap 6).
//   settings the record in agent-office.project.json and the project's Team Server rule in CLAUDE.md.
//   commit   the setup's own commit and push to origin, then main to Team Server (team-server/sync.ts), checked.
// The Mendix token reaches git per command only (team-server/git.ts) and the Projects API as its header.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StepId } from '../../shared/wizard.js';
import { MENDIX_ENDPOINTS, TEAMSERVER_REMOTE, portalAppName, portalSummary, teamServerUrl, type TeamServerEndpoints, type TeamServerRecord } from '../../shared/team-server.js';
import type { JobState, StepImpl, StepIO } from './job.js';
import type { SetupDeps } from './steps.js';
import { createProject, waitForProject, type Fetch } from '../team-server/api.js';
import { gitRefusalWords, tsGit } from '../team-server/git.js';
import { adoptionCommit, fetchTsMain, teamServerRules, withTeamServerRules } from '../team-server/adopt.js';
import { ensureRemote, syncMain } from '../team-server/sync.js';
import { writeRecord } from '../team-server/project.js';
import { auditSync, auditTs } from '../team-server/audit.js';
import { officeGitEnv, toolkitEnv } from './config.js';

export interface TeamServerStepDeps {
  /** The Projects API and Team Server's git host, and how to call them (tests pass fakes; the office uses Mendix's). */
  teamServer?: { endpoints?: TeamServerEndpoints; fetch?: Fetch; sleep?: (ms: number) => Promise<void>; jobTimeoutMs?: number };
}

export function withTeamServer(deps: SetupDeps, steps: Record<StepId, StepImpl>): Record<StepId, StepImpl> {
  const { repo, clone, app, settings, commit } = steps;
  const ep = () => deps.teamServer?.endpoints ?? MENDIX_ENDPOINTS;
  const tokenOf = () => {
    const t = deps.mendixToken?.();
    if (!t) throw new Error('No Mendix token in 🔌 Connections, so the office can’t reach the Mendix Portal or Team Server. Add one with the mx:app:create and mx:modelrepository:repo:read / :write scopes, then Retry');
    return t;
  };
  const gitFor = (io: StepIO) => tsGit({ token: tokenOf(), env: { ...toolkitEnv(deps.cfg, deps.env ?? process.env), ...officeGitEnv() }, git: ep().git, onLine: (l) => io.log(`  ${l}`), run: deps.run });
  const recOf = (job: JobState): TeamServerRecord => {
    const id = job.teamServer?.projectId;
    if (!id) throw new Error('The Portal app isn’t made yet: Retry from the repository step');
    return { projectId: id, url: teamServerUrl(id, ep().git), remote: TEAMSERVER_REMOTE, ...(job.plan.teamServer?.mirror ? { mirror: true } : {}), how: job.teamServer?.how ?? 'made', by: job.by, at: job.startedAt };
  };

  /**
   * The Portal app's events in the new project's own audit log, once it has one (the clone step makes the project): the
   * repo step recorded them office-wide, before there was a project, so the project's log would otherwise lack them.
   */
  function projectAudit(job: JobState) {
    const ts = job.teamServer;
    if (!job.floor || !ts?.projectId || ts.audited) return;
    const app = `${job.plan.owner}/${job.plan.name}`;
    if (ts.how === 'linked') auditTs({ action: 'team-server.linked', floor: job.floor, by: job.by, projectId: ts.projectId, summary: `${job.by} linked the existing Mendix Portal app ${ts.projectId} to the new project ${app}` });
    else {
      auditTs({ action: 'team-server.app-create', floor: job.floor, by: job.by, summary: `${job.by} asked the Mendix Portal to create the app for ${app}${ts.jobId ? ` (job ${ts.jobId})` : ''}`, severity: 'info', ...(ts.jobId ? { details: { jobId: ts.jobId } } : {}) });
      auditTs({ action: 'team-server.app-created', floor: job.floor, by: job.by, projectId: ts.projectId, summary: `The Mendix Portal created the app for ${app} (${ts.projectId})`, ...(ts.jobId ? { details: { jobId: ts.jobId } } : {}) });
    }
    ts.audited = true;
  }

  /** The Portal app, made or linked, its id saved on the job and the plan (mx create-project binds the app to it). */
  async function portalApp(job: JobState, io: StepIO): Promise<string> {
    const ts = (job.teamServer ??= {});
    const save = () => io.save?.();
    if (ts.projectId) {
      job.plan.sprintrAppId = ts.projectId;
      return `Portal app ${ts.projectId} (already ${ts.how === 'linked' ? 'linked' : 'made'})`;
    }
    const pasted = job.plan.teamServer?.projectId;
    if (pasted) {
      // An existing app: its repository must answer with this token before anything is built on it.
      const g = gitFor(io);
      const r = await g.auth(os.tmpdir(), ['ls-remote', '--heads', teamServerUrl(pasted, ep().git)], { allowFail: true, timeoutMs: 2 * 60_000 });
      if (r.code !== 0) throw new Error(gitRefusalWords(r.tail.join(' ') || `couldn't reach the Team Server repository of ${pasted}`));
      Object.assign(ts, { projectId: pasted, how: 'linked' });
      job.plan.sprintrAppId = pasted;
      save();
      auditTs({ action: 'team-server.linked', by: job.by, projectId: pasted, summary: `${job.by} linked the existing Mendix Portal app ${pasted} to the new project ${job.plan.owner}/${job.plan.name}` });
      return `linked the existing Portal app ${pasted}`;
    }
    const name = portalAppName(job.plan.name);
    if (!name) throw new Error(`“${job.plan.name}” can’t be a Mendix app name: use letters, digits, spaces, - or _`);
    const api = { token: tokenOf(), endpoints: ep(), fetch: deps.teamServer?.fetch, sleep: deps.teamServer?.sleep };
    if (!ts.jobId && ts.sentAt && !ts.unsure) {
      // Sent, but the office stopped before it heard the job's id: the app may exist. Said once; the next Retry creates.
      ts.unsure = true;
      delete ts.sentAt;
      save();
      throw new Error(`The office asked the Mendix Portal to create “${name}” but stopped before it heard back, so the app may be there already. Look in the Portal (https://sprintr.home.mendix.com/): if it is, Cancel this setup and start again with its App ID under Advanced; if it isn’t, Retry creates it`);
    }
    if (!ts.jobId) {
      ts.sentAt = Date.now();
      save();
      io.log(`  creating the app “${name}” in the Mendix Portal…`);
      auditTs({ action: 'team-server.app-create', by: job.by, summary: `${job.by} asked the Mendix Portal to create the app “${name}” for ${job.plan.owner}/${job.plan.name}`, severity: 'info' });
      try {
        ts.jobId = await createProject(api, { name, summary: portalSummary(job.plan.description) || undefined });
      } catch (err) {
        // A refusal created nothing: the next Retry may ask again.
        delete ts.sentAt;
        save();
        throw err;
      }
      save();
    } else io.log(`  following the Mendix Portal's job ${ts.jobId} again…`);
    const id = await waitForProject(api, ts.jobId, (l) => io.log(`  ${l}`), deps.teamServer?.jobTimeoutMs);
    Object.assign(ts, { projectId: id, how: 'made' as const });
    delete ts.unsure;
    job.plan.sprintrAppId = id;
    save();
    auditTs({ action: 'team-server.app-created', by: job.by, projectId: id, summary: `The Mendix Portal created the app “${name}” (${id}) for ${job.plan.owner}/${job.plan.name}`, details: { jobId: ts.jobId } });
    return `created the Portal app “${name}” (${id}); Cancel & undo never deletes it`;
  }

  return {
    ...steps,
    async repo(job, io) {
      if (!job.plan.teamServer || job.plan.kind !== 'new') return repo(job, io);
      io.log(`  ${await portalApp(job, io)}`);
      // The repository step's own detail, as it was: Cancel & undo reads it (shared/setup-cancel.ts), and the Portal app is never its to delete.
      return repo(job, io);
    },

    async clone(job, io) {
      const r = await clone(job, io);
      if (!job.plan.teamServer || !job.dir) return r;
      const rec = recOf(job);
      projectAudit(job);
      const g = gitFor(io);
      await ensureRemote(g, job.dir, rec);
      const tsMain = await fetchTsMain(g, job.dir, rec.remote);
      const head = (await g.plain(job.dir, ['rev-parse', 'HEAD'])).stdout.trim();
      const adopt = await adoptionCommit(g, job.dir, head, tsMain, `Adopt the Team Server history of Mendix Portal app ${rec.projectId}\n\nThe project's own tree is kept; Team Server's main is the second parent, so both mains fast-forward from here.`);
      // The same tree: moving the branch changes no file.
      if (adopt) await g.plain(job.dir, ['merge', '--ff-only', '--quiet', adopt]);
      return { ...r, detail: [r.detail, `${rec.remote} remote ${rec.url}${adopt ? ', Team Server history adopted' : ''}`].filter(Boolean).join(' · ') };
    },

    async app(job, io) {
      if (job.plan.teamServer && job.teamServer?.projectId) job.plan.sprintrAppId = job.teamServer.projectId;
      return app(job, io);
    },

    async settings(job, io) {
      const r = await settings(job, io);
      if (!job.plan.teamServer || !job.dir) return r;
      const rec = recOf(job);
      const did: string[] = [];
      if (writeRecord(job.dir, rec)) did.push(`Team Server app ${rec.projectId} recorded`);
      const claude = path.join(job.dir, 'CLAUDE.md');
      const before = existsSync(claude) ? readFileSync(claude, 'utf8') : '';
      const after = withTeamServerRules(before, teamServerRules(rec));
      if (after !== before) {
        writeFileSync(claude, after);
        did.push('CLAUDE.md: Team Server rule');
      }
      return did.length ? { status: 'done', detail: [r.detail, ...did].filter(Boolean).join(' · ') } : r;
    },

    async commit(job, io) {
      const r = await commit(job, io);
      if (!job.plan.teamServer || !job.dir) return r;
      const rec = recOf(job);
      const s = await syncMain({ g: gitFor(io), dir: job.dir, rec });
      auditSync(job.floor, rec.projectId, s, { name: job.by });
      if (s.state !== 'pushed' && s.state !== 'same') throw new Error(s.message);
      return { ...r, detail: `${r.detail}; ${s.message}` };
    },
  };
}
