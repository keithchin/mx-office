// What the browser sends as a new project, checked and trimmed before anything runs: a name that's a
// valid repository slug, choices from the lists the wizard offered, and text cut to sane lengths.

import { ENTRY_MODES, interviewModeOf, ownerProblem, PROJECT_ROLES, slugProblem, type AnswerKind, type EntryMode, type IntakeAnswer, type ProjectPlan, type ProjectRole } from '../../shared/wizard.js';
import { cleanAppId } from './mendix-app.js';
import { isPortfolioId } from '../../shared/portfolios.js';
import { cleanPlanDesign } from './design-step.js';
import { cleanPlanAdopt } from '../../shared/adopt-from.js';
import { cleanChoice } from '../../shared/budget/levels.js';
import { isTeamShape, shapeForRoles } from '../../shared/roster/coverage.js';
import { checkTeamFrom, cleanTeamFrom, type KnownSource } from '../../shared/team-from.js';
import { cleanBrief, cleanDomains, counts, safeFileName, type PlanBrief, type ReadState } from '../../shared/brief.js';

export const DISCOVERY_MODELS = ['opus', 'sonnet', 'haiku'] as const;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const names = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : [])
    .map((x) => text(x, 100))
    .filter(Boolean)
    .slice(0, 12);

/**
 * The plan, cleaned; or why it can't be used. `versions` are the Studio Pro versions on the machine. `teams`, the
 * projects whose team can be copied (server/wizard/team-from-office.ts): a plan's Start from a team is checked
 * against them (an unknown project or profile refused); without it, the plan's team source is dropped.
 */
export function cleanPlan(raw: unknown, versions: string[], org: string, teams?: ReadonlyMap<string, KnownSource>): ProjectPlan | string {
  if (!raw || typeof raw !== 'object') return 'Bad request';
  const r = raw as Record<string, unknown>;
  const kind = r.kind === 'change' ? 'change' : 'new';
  const owner = text(r.owner, 40) || org;
  const name = text(r.name, 100);
  const ownerBad = ownerProblem(owner);
  if (ownerBad) return ownerBad;
  // An existing repository keeps whatever name it has; a new one has to be a clean slug.
  const nameBad = kind === 'new' ? slugProblem(name) : /^[A-Za-z0-9._-]{1,100}$/.test(name) ? undefined : 'Not a repository name';
  if (nameBad) return `Project name: ${nameBad}`;
  const entry = (ENTRY_MODES as readonly string[]).includes(r.entry as string) ? (r.entry as EntryMode) : undefined;
  if (!entry) return 'Pick an entry mode';
  const mendix = text(r.mendix, 20);
  if (!versions.includes(mendix)) return `Studio Pro ${mendix || '(none)'} isn't installed on the office's machine`;
  const intake: IntakeAnswer[] = (Array.isArray(r.intake) ? r.intake : [])
    .map((a: Record<string, unknown>) => ({
      n: Number(a?.n),
      kind: (['answered', 'assumed', 'unverified'].includes(a?.kind as string) ? a.kind : 'answered') as AnswerKind,
      text: text(a?.text, 4000),
    }))
    .filter((a) => Number.isInteger(a.n) && a.n >= 1 && a.n <= 30)
    .slice(0, 30);
  const roles = (Array.isArray(r.roles) ? r.roles : []).filter((x): x is ProjectRole => PROJECT_ROLES.some((p) => p.id === x));
  const d = (r.discovery ?? {}) as Record<string, unknown>;
  const model = (DISCOVERY_MODELS as readonly string[]).includes(d.model as string) ? (d.model as string) : 'opus';
  const asked = teams ? cleanTeamFrom(r.teamFrom, [...new Set(roles)]) : undefined;
  const teamFrom = asked && teams ? checkTeamFrom(asked, teams, isPortfolioId(r.portfolio) ? r.portfolio : undefined) : undefined;
  if (typeof teamFrom === 'string') return teamFrom;
  return {
    kind,
    owner,
    name,
    description: text(r.description, 350).replace(/\n+/g, ' '),
    private: r.private !== false,
    mendix,
    entry: kind === 'change' && entry !== 'assurance' ? 'existing-app-change' : entry,
    tier: r.tier === 'small' ? 'small' : 'standard',
    interview: interviewModeOf(r.interview),
    execApproval: r.execApproval === 'ask' ? 'ask' : 'auto',
    intake,
    clients: names(r.clients),
    operators: names(r.operators),
    roles: [...new Set(roles)],
    discovery: { issue: d.issue === true, queue: d.issue === true && d.queue === true, model },
    createdByHand: r.createdByHand === true,
    ...(kind === 'new' && cleanAppId(r.sprintrAppId) ? { sprintrAppId: cleanAppId(r.sprintrAppId) } : {}),
    ...(cleanChoice(r.budget) ? { budget: cleanChoice(r.budget) } : {}),
    // The shape picked on the Team & budget page; a plan without one is what its roles add up to.
    shape: isTeamShape(r.shape) ? r.shape : shapeForRoles([...new Set(roles)]),
    ...(r.customTeam === true ? { customTeam: true } : {}),
    ...(cleanPlanBrief(r.brief) ? { brief: cleanPlanBrief(r.brief) } : {}),
    ...(isPortfolioId(r.portfolio) ? { portfolio: r.portfolio } : {}),
    ...(cleanPlanDesign(r.design) ? { design: cleanPlanDesign(r.design) } : {}),
    // Start from another app: the source and the choices only, never what they mean (adopt-from/resolve.ts works that out at start). Needs a client.
    ...(isPortfolioId(r.portfolio) && cleanPlanAdopt(r.adopt) ? { adopt: cleanPlanAdopt(r.adopt) } : {}),
    // Off GitHub: a new repository only (a change's repository is on GitHub already). The source folder comes from the draft only (Wizard.start).
    ...(kind === 'new' && r.localOnly === true ? { localOnly: true } : {}),
    ...(teamFrom ? { teamFrom } : {}),
  };
}

const READS: ReadState[] = ['text', 'extracted', 'given', 'read', 'not-read'];

/** The plan's project brief, cleaned (shared/brief.ts): the honesty rules applied again, whatever was sent. */
export function cleanPlanBrief(v: unknown): PlanBrief | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const brief = cleanBrief(r.brief);
  if (!brief) return undefined;
  const a = (r.approved ?? {}) as Record<string, unknown>;
  const approved = text(a.by, 80) && /^\d{4}-\d\d-\d\dT/.test(text(a.at, 40)) ? { by: text(a.by, 80), at: text(a.at, 40), assumed: counts(brief).assumed } : undefined;
  const attachments = (Array.isArray(r.attachments) ? r.attachments : []).slice(0, 10).map((x: Record<string, unknown>) => ({
    name: safeFileName(text(x?.name, 200)),
    size: Math.max(0, Number(x?.size) || 0),
    read: READS.includes(x?.read as ReadState) ? (x.read as ReadState) : 'not-read',
    ...(text(x?.note, 200) ? { note: text(x.note, 200) } : {}),
  }));
  const domains = cleanDomains(r.domains);
  return {
    ...(typeof r.draftId === 'string' && /^d-[a-z0-9-]{6,40}$/.test(r.draftId) ? { draftId: r.draftId } : {}),
    brief,
    ...(domains ? { domains } : {}),
    ...(approved ? { approved } : {}),
    attachments,
    ...(r.manual === true ? { manual: true } : {}),
  };
}
