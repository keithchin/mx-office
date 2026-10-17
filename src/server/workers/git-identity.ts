// Who an agent's commits say made them (2026-10-16 project audit: every commit read "Keith Chin", the
// person whose git config the workers inherited, so the history said the PM wrote code he never saw).
// Each agent worker commits as itself: author "<Name> (Mx Office <role>)" with a stable address per
// profile (or role, or worker) under agents.mx-office.local, never a real mailbox; committer the office's
// own commit identity (🔌 Connections) or, with none set, "Mx Office". Set as GIT_AUTHOR_* and
// GIT_COMMITTER_* in the worker's environment, so every git call it makes uses them whatever git's
// config says. A shell worker is a person typing: it keeps their identity. GitHub still shows the
// token's account as the opener and merger of a PR; the agent's name goes in the PR body (review-gate.ts).

import type { WorkerInfo } from '../../shared/protocol.js';
import { AGENT_EMAIL_DOMAIN } from '../../shared/review-gate.js';
import { officeSettings } from '../connections/store.js';

/** A team member's seat as its commits name it: its name, its role's title, and its stable key (profile id, else role id). */
export interface AgentSeat {
  name: string;
  role: string;
  key: string;
}

const local = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
/** Quotes and angle brackets would break the author line git writes. */
const clean = (s: string) => s.replace(/[<>"\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The office's committer: its commit identity when one is set, else "Mx Office". */
export function officeCommitter(office: { name: string; email: string } | undefined = officeSettings().gitIdentity): { name: string; email: string } {
  return office?.name && office.email ? office : { name: 'Mx Office', email: `office@${AGENT_EMAIL_DOMAIN}` };
}

/** The author an agent's commits get: its seat's name and role, else the worker's own name. */
export function agentAuthor(info: Pick<WorkerInfo, 'id' | 'name'>, seat?: AgentSeat): { name: string; email: string } {
  const name = clean(seat?.name || info.name.replace(/ 🐚$/, '')) || 'Agent';
  return { name: `${name} (Mx Office ${clean(seat?.role || 'agent')})`, email: `${local(seat?.key ?? `worker-${info.id}`)}@${AGENT_EMAIL_DOMAIN}` };
}

/** The GIT_AUTHOR_* / GIT_COMMITTER_* an agent worker starts with; nothing for a shell (a person's own). */
export function agentGitEnv(info: Pick<WorkerInfo, 'id' | 'name' | 'kind'>, seat?: AgentSeat, office?: { name: string; email: string }): Record<string, string> {
  if (info.kind !== 'agent') return {};
  const a = agentAuthor(info, seat);
  const c = officeCommitter(office ?? officeSettings().gitIdentity);
  return { GIT_AUTHOR_NAME: a.name, GIT_AUTHOR_EMAIL: a.email, GIT_COMMITTER_NAME: c.name, GIT_COMMITTER_EMAIL: c.email };
}
