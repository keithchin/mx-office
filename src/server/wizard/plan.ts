// What the browser sends as a new project, checked and trimmed before anything runs: a name that's a
// valid repository slug, choices from the lists the wizard offered, and text cut to sane lengths.

import { ENTRY_MODES, ownerProblem, PROJECT_ROLES, slugProblem, type AnswerKind, type EntryMode, type IntakeAnswer, type ProjectPlan, type ProjectRole } from '../../shared/wizard.js';

export const DISCOVERY_MODELS = ['opus', 'sonnet', 'haiku'] as const;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const names = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : [])
    .map((x) => text(x, 100))
    .filter(Boolean)
    .slice(0, 12);

/** The plan, cleaned; or why it can't be used. `versions` are the Studio Pro versions on the machine. */
export function cleanPlan(raw: unknown, versions: string[], org: string): ProjectPlan | string {
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
  return {
    kind,
    owner,
    name,
    description: text(r.description, 350).replace(/\n+/g, ' '),
    private: r.private !== false,
    mendix,
    entry: kind === 'change' && entry !== 'assurance' ? 'existing-app-change' : entry,
    tier: r.tier === 'small' ? 'small' : 'standard',
    interview: r.interview === 'unattended' ? 'unattended' : 'attended',
    execApproval: r.execApproval === 'ask' ? 'ask' : 'auto',
    intake,
    clients: names(r.clients),
    operators: names(r.operators),
    roles: [...new Set(roles)],
    discovery: { issue: d.issue === true, queue: d.issue === true && d.queue === true, model },
    createdByHand: r.createdByHand === true,
  };
}
