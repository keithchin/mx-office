// The readiness check wired to the office (./checks.ts does the looking, ./fixes.ts the fixing): one service per
// office, made on first use. A folder's report is cached (READY_TTL_MS, "Check again" asks afresh) and two asks
// for the same folder share one run. After a fix the folder's report is worked out again. When a folder is
// attached (POST /api/expert/open), the budget asked for before is set on the new project (readyOnAttach).
// The wizard (Expert mode's slice 5) can reuse checkFolder and the fixes through this module's exports.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { budgetAmount, type ReadyFixId, type ReadyReport } from '../../shared/expert-ready.js';
import { cleanProjectId, MENDIX_ENDPOINTS, type TeamServerEndpoints } from '../../shared/team-server.js';
import { checkFolder, toolkitCommitOf, type ReadyDeps } from './checks.js';
import { lookAtModel } from './model.js';
import { addTeamServerRemote, folderKey, pinToolkit, WishBook } from './fixes.js';
import { gitRun } from '../toolkit-pin/git.js';
import { detect } from '../toolkit-pin/detect.js';
import { isRepo } from '../toolkit-pin/pins.js';
import { toolkitDir } from '../connections/store.js';
import { credential } from '../connections/resolve.js';
import { findMxcli } from '../model/mxcli.js';
import { resolveCommand } from '../workers/process.js';
import { looksFakeTool, mxcliVersion } from '../testing/mxcli-tool.js';
import { realToolsAllowed, testModeOf } from '../testmode.js';
import { mendixVersions, wizardConfig } from '../wizard/config.js';
import { budgetOf, controlOf } from '../budget/index.js';
import { setSettings } from '../budget/control.js';
import { tsGit, type TsGit } from '../team-server/git.js';
import { officeGitEnv } from '../workers/git-identity.js';
import { isExpertProject } from '../expert/mode.js';
import type { Fetch } from '../team-server/api.js';

export { checkFolder, type ReadyDeps } from './checks.js';
export { lookAtModel } from './model.js';
export { addTeamServerRemote, pinToolkit, WishBook } from './fixes.js';

/** A folder's report is reused this long unless "Check again" asks afresh. */
export const READY_TTL_MS = 60_000;

/** git for the check: read-only commands, no optional locks, no prompts, off the event loop. */
export const readyGit: ReadyDeps['git'] = async (args, dir) => {
  const r = await gitRun(args, dir, 15_000);
  return r.ok ? r.out.trim() : undefined;
};

export interface ReadyOfficeDeps {
  /** Team Server git for the fix (tests pass a fake). */
  tsGit?(token: string): TsGit;
  fetch?: Fetch;
  endpoints?: TeamServerEndpoints;
  token?(): string | undefined;
  /** The check's deps the office would otherwise make (tests swap some). */
  check?: Partial<ReadyDeps>;
}

export interface FixRequest {
  fix: ReadyFixId;
  /** set-budget: dollars. */
  total?: unknown;
  /** add-teamserver: an existing Portal app's id; none makes a new one. */
  projectId?: unknown;
  /** add-teamserver: the app's name when one is made. */
  name?: unknown;
}

export class ReadyService {
  readonly wishes: WishBook;
  private cache = new Map<string, { at: number; report: Promise<ReadyReport> }>();

  constructor(
    private ctx: Pick<Ctx, 'cfg' | 'floors'>,
    private o: ReadyOfficeDeps = {},
  ) {
    this.wishes = new WishBook(path.join(ctx.cfg.dataDir, 'expert-ready', 'wishes.json'));
  }

  private floorAt(dir: string): Floor | undefined {
    const k = folderKey(dir);
    return [...this.ctx.floors.values()].find((f) => folderKey(f.dir) === k);
  }

  private token() {
    return (this.o.token ?? (() => credential('mendix')))();
  }

  deps(): ReadyDeps {
    const dataDir = this.ctx.cfg.dataDir;
    return {
      git: readyGit,
      model: lookAtModel,
      async toolkitCommit(dir, register) {
        const root = toolkitDir();
        if (!(await isRepo(root))) return undefined;
        const d = await detect(root, dir, register);
        return d.sha ? { sha: d.sha, how: d.source } : undefined;
      },
      async mxcli(dir) {
        const own = ['mxcli.exe', 'mxcli'].map((n) => path.join(dir, n)).find((f) => existsSync(f));
        const onPath = own ? undefined : resolveCommand('mxcli');
        const office = own || onPath ? undefined : findMxcli(dataDir);
        const bin = own ?? onPath ?? office;
        if (!bin) return undefined;
        const from = own ? 'project' : onPath ? 'path' : 'office';
        // A test office asks only a plainly fake mxcli (testing/mxcli-tool.ts' rule).
        const mayAsk = !testModeOf().on || looksFakeTool(bin) || realToolsAllowed();
        const version = mayAsk ? await mxcliVersion(bin).catch(() => undefined) : undefined;
        return { bin, from, ...(version ? { version } : {}) };
      },
      studioVersions: () => mendixVersions(wizardConfig().mendixDir),
      budget: (dir) => {
        const f = this.floorAt(dir);
        if (!f) return undefined;
        try {
          return { total: budgetOf(this.ctx as Ctx).file({ id: f.id, name: f.def.name, dir: f.dir }).settings.total };
        } catch {
          return undefined;
        }
      },
      wishes: (dir) => this.wishes.get(dir),
      mendixAccount: () => !!this.token(),
      attachedTo: (dir) => {
        const f = this.floorAt(dir);
        return f && isExpertProject(f) ? f.id : undefined;
      },
      ...this.o.check,
    };
  }

  /** The folder's report: cached, or worked out now (`fresh`). Two asks share a run. */
  check(dir: string, fresh = false, now = Date.now()): Promise<ReadyReport> {
    const k = folderKey(dir);
    const hit = this.cache.get(k);
    if (hit && (!fresh || now - hit.at < 1_000) && now - hit.at < READY_TTL_MS) return hit.report;
    const report = checkFolder(path.resolve(dir), this.deps());
    this.cache.set(k, { at: now, report });
    report.catch(() => this.cache.get(k)?.report === report && this.cache.delete(k));
    if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value as string);
    return report;
  }

  /** One fix, clicked by `by`. Returns what was done in words, or an error. The folder is checked again after. */
  async fix(dir: string, req: FixRequest, by: string): Promise<{ message: string } | { error: string }> {
    try {
      const message = await this.apply(path.resolve(dir), req, by);
      this.cache.delete(folderKey(dir));
      return { message };
    } catch (err) {
      return { error: (err as Error).message.slice(0, 400) };
    }
  }

  private async apply(dir: string, req: FixRequest, by: string): Promise<string> {
    switch (req.fix) {
      case 'pin-toolkit': {
        const register = await readFile(path.join(dir, 'PROJECT.md'), 'utf8').catch(() => undefined);
        const sha = (await toolkitCommitOf(dir, register, this.deps()))?.sha;
        if (!sha) throw new Error('Couldn’t tell which toolkit commit this folder is on: nothing was pinned');
        return pinToolkit(dir, sha, by);
      }
      case 'add-teamserver': {
        const token = this.token();
        if (!token) throw new Error('Add your Mendix account in Settings › Connections first: nothing was changed');
        const endpoints = this.o.endpoints ?? MENDIX_ENDPOINTS;
        const g = this.o.tsGit?.(token) ?? tsGit({ token, env: { ...process.env, ...officeGitEnv() }, git: endpoints.git });
        const typed = typeof req.projectId === 'string' ? req.projectId.trim() : '';
        const projectId = typed ? cleanProjectId(typed) : undefined;
        if (typed && !projectId) throw new Error('An App ID looks like 1a2b3c4d-…: 36 characters, from the app’s General settings in the Mendix Portal');
        const name = typeof req.name === 'string' && req.name.trim() ? req.name.trim() : path.basename(dir);
        const r = await addTeamServerRemote({ g, dir, name, endpoints, api: { token, endpoints, ...(this.o.fetch ? { fetch: this.o.fetch } : {}) }, ...(projectId ? { projectId } : {}), by });
        return r.message;
      }
      case 'seed-users':
        this.wishes.patch(dir, { seedUsers: { at: Date.now(), by } });
        return 'Noted. Ask the session after attaching: it makes the model change.';
      case 'add-tests':
        this.wishes.patch(dir, { addTests: { at: Date.now(), by } });
        return 'Noted. Ask the session after attaching.';
      case 'set-budget': {
        const total = budgetAmount(req.total);
        if (!total) throw new Error('The budget is an amount in US dollars, more than 0');
        const f = this.floorAt(dir);
        if (f) {
          const err = setSettings(budgetOf(this.ctx as Ctx), { id: f.id, name: f.def.name, dir: f.dir }, { total, autoPause: true }, by, controlOf(this.ctx as Ctx));
          if (err) throw new Error(err);
          return `Budget set: $${total} total, auto-pause at 100 %`;
        }
        this.wishes.patch(dir, { budget: { total, autoPause: true, at: Date.now(), by } });
        return `Budget $${total} total, auto-pause at 100 %: set when you attach`;
      }
      default:
        throw new Error('No such fix');
    }
  }

  /** A folder was attached as `floor`: the budget asked for before is set on it. */
  onAttach(floor: Floor, by: string) {
    const w = this.wishes.get(floor.dir);
    if (!w.budget) return;
    const err = setSettings(budgetOf(this.ctx as Ctx), { id: floor.id, name: floor.def.name, dir: floor.dir }, { total: w.budget.total, autoPause: true }, by, controlOf(this.ctx as Ctx));
    if (err) console.warn(`agent-office: couldn't set ${floor.def.name}'s budget on attach: ${err}`);
    const { budget: _b, ...rest } = w;
    this.wishes.set(floor.dir, rest);
    this.cache.delete(folderKey(floor.dir));
  }
}

const offices = new WeakMap<object, ReadyService>();

export function readyOf(ctx: Pick<Ctx, 'cfg' | 'floors'>, o?: ReadyOfficeDeps): ReadyService {
  let s = offices.get(ctx.cfg);
  if (!s) offices.set(ctx.cfg, (s = new ReadyService(ctx, o)));
  return s;
}

/** POST /api/expert/open calls this once the project is made. */
export const readyOnAttach = (ctx: Ctx, floor: Floor, by: string) => readyOf(ctx).onAttach(floor, by);
