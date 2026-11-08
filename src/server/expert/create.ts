// "Create and open session" (the Expert wizard, POST /api/expert/create): the thin form made into the setup's full
// plan (shared/wizard.ts ProjectPlan, `mode: 'expert'`), then run by the same setup as Team mode (wizard/index.ts),
// with the Expert steps wrapped round it (wizard/expert-step.ts). Git and the Team Server push are always on: the app
// is created on Team Server, or an existing Portal app is connected, with no GitHub mirror. An offline test office
// never calls the Mendix Portal, so there the project's origin is the test office's local stand-in, said in the log.
// GET /api/expert/setup-info: what the pin dropdowns offer, read from the office's own toolkit clone and mxcli.

import { cleanProjectId } from '../../shared/team-server.js';
import { newProjectDiscovery, slugify, type ProjectPlan } from '../../shared/wizard.js';
import { cleanPin, expertFormProblem, isExpertModel, oneParagraph, type ExpertForm, type ExpertSetupInfo } from '../../shared/expert-setup.js';
import { commitInfo, commitsIn, ensurePin, latestCommit } from '../toolkit-pin/pins.js';
import type { Ctx } from '../office/context.js';
import type { ExpertStepDeps } from '../wizard/expert-step.js';
import { setExpertBudget } from './budget.js';
import { findMxcli } from '../model/mxcli.js';
import { mxcliVersion } from '../testing/mxcli-tool.js';

/** What the office is like, for the plan: the Studio Pro versions it has, its organization, and whether it's an offline test office. */
export interface CreateEnv {
  versions: readonly string[];
  org: string;
  offline: boolean;
  /** A Mendix token is in 🔌 Connections (the Mendix account shows "connected"). */
  mendixToken: boolean;
}

/** The form as sent, read field by field (nothing else from the request is used). */
export function readForm(raw: unknown): ExpertForm {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    name: str(r.name, 100).replace(/\s+/g, ' ').trim(),
    mendix: str(r.mendix, 20).trim(),
    app: r.app === 'connect' ? 'connect' : 'create',
    ...(typeof r.appId === 'string' ? { appId: r.appId.trim().slice(0, 80) } : {}),
    toolkit: typeof r.toolkit === 'string' ? r.toolkit : 'latest',
    mxcli: typeof r.mxcli === 'string' ? r.mxcli : 'latest',
    demoUsers: r.demoUsers !== false,
    budget: Number(r.budget),
    model: isExpertModel(r.model) ? r.model : (r.model as ExpertForm['model']) ?? 'sonnet',
    brief: typeof r.brief === 'string' ? r.brief.slice(0, 4000) : '',
  };
}

/** The setup's plan for the form, or why it can't be made. `by`: who makes it (the project's operator). */
export function expertPlanOf(raw: unknown, env: CreateEnv, by: string): ProjectPlan | string {
  const f = readForm(raw);
  const bad = expertFormProblem(f, env.versions);
  if (bad) return bad;
  // Team Server needs the Mendix account; an offline test office has none and never calls the Portal.
  if (!env.offline && !env.mendixToken) return 'Connect your Mendix account first (Settings › Connections › Mendix): Expert projects live on Team Server';
  const name = slugify(f.name);
  const brief = oneParagraph(f.brief);
  const teamServer = env.offline ? undefined : { mirror: false, ...(f.app === 'connect' ? { projectId: cleanProjectId(f.appId)! } : {}) };
  return {
    kind: 'new',
    owner: env.org,
    name,
    // The Portal app's summary: the brief's first sentence, if there is one.
    description: brief.split(/(?<=[.!?])\s/)[0].slice(0, 350),
    private: true,
    mendix: f.mendix,
    entry: 'greenfield',
    tier: 'standard',
    interview: 'steering',
    execApproval: 'auto',
    intake: [],
    clients: [],
    operators: by ? [by] : [],
    roles: [],
    discovery: { ...newProjectDiscovery(), issue: false, queue: false, model: f.model },
    createdByHand: false,
    ...(teamServer ? { teamServer, localOnly: true } : {}),
    mode: 'expert',
    expert: { model: f.model, toolkit: cleanPin(f.toolkit, 'toolkit')!, mxcli: cleanPin(f.mxcli, 'mxcli')!, demoUsers: f.demoUsers, budget: Math.round(f.budget * 100) / 100, brief, title: f.name },
  };
}

/** The pin dropdowns' choices: the toolkit clone's newest commit and the few before it, and the office's mxcli. No fetch, no network. */
export async function expertSetupInfo(toolkitRoot: string, dataDir: string): Promise<ExpertSetupInfo> {
  const out: ExpertSetupInfo = { toolkit: { recent: [] }, mxcli: { versions: [] } };
  try {
    const latest = await latestCommit(toolkitRoot);
    if (latest) {
      out.toolkit.latest = { sha: latest.sha, date: (await commitInfo(toolkitRoot, latest.sha)).date };
      out.toolkit.recent = (await commitsIn(toolkitRoot, latest.sha, 8)).map((c) => ({ sha: c.sha, date: c.date, subject: c.subject }));
    }
  } catch {
    // no toolkit clone: the dropdown offers "latest release" only, and the setup says what it found
  }
  try {
    const bin = findMxcli(dataDir);
    const v = bin ? await mxcliVersion(bin) : undefined;
    if (v) out.mxcli = { latest: v, versions: [v] };
  } catch {
    // no mxcli on this machine: the toolkit installs its own
  }
  return out;
}

/** The office's mxcli release, for a 'latest' pin. */
export async function officeMxcli(dataDir: string): Promise<string | undefined> {
  const bin = findMxcli(dataDir);
  return bin ? mxcliVersion(bin).catch(() => undefined) : undefined;
}

/** The Expert steps' hooks into the office (wizard/index.ts hands them to wizard/expert-step.ts). */
export function officeExpertDeps(ctx: Ctx, toolkitRoot: () => string): ExpertStepDeps {
  return {
    setMode: (floorId, title) => {
      const r = ctx.building.setMode(floorId, 'expert', title);
      if (typeof r === 'string') return r;
      ctx.floorsChanged();
      return undefined;
    },
    setBudget: (floorId, total, by) => setExpertBudget(ctx, floorId, total, by),
    pinToolkit: async (sha) => {
      const root = toolkitRoot();
      return { sha, dir: await ensurePin(root, sha), date: (await commitInfo(root, sha)).date };
    },
    mxcliLatest: () => officeMxcli(ctx.cfg.dataDir),
  };
}
