// The audit log's shape, shared by the server (server/audit/) and the Audit log tabs (ui/audit/):
// one event per thing someone (a person, an agent, the office, Jeff or a reviewer) did, kept append
// only with a hash chain so an edited line shows.

import type { RecordedIds } from './evidence/ids.js';

export type AuditActorKind = 'human' | 'agent' | 'office' | 'jeff' | 'reviewer';
export const AUDIT_ACTOR_KINDS: readonly AuditActorKind[] = ['human', 'agent', 'office', 'jeff', 'reviewer'];
export type AuditSeverity = 'info' | 'notice' | 'warning';

export interface AuditActor {
  kind: AuditActorKind;
  name: string;
  id?: string;
}

export interface AuditTarget {
  kind: string;
  id?: string;
  label?: string;
}

/** What `record` is given: the log adds id, at (unless given), prev and hash. */
export interface AuditInput {
  floor?: string;
  actor: AuditActor;
  /** A dotted verb: worker.hire, escalation.answer, settings.change… */
  action: string;
  target?: AuditTarget;
  /** One plain sentence. */
  summary: string;
  /** Small; settings changes carry `before` and `after`. */
  details?: Record<string, unknown>;
  severity?: AuditSeverity;
  at?: number;
  /**
   * The domain ids it belongs to (shared/evidence/ids.ts), when the recorder knows them: optional, so
   * older lines still read and verify. Invalid ones are dropped when it's written.
   */
  ids?: RecordedIds;
}

export interface AuditEvent extends AuditInput {
  id: string;
  at: number;
  severity: AuditSeverity;
  /** sha256 of the line before it in its file ('' for the first ever). */
  prev: string;
  /** sha256 of this line without its own hash. */
  hash: string;
}

export interface AuditChain {
  ok: boolean;
  /** The first event that doesn't fit the chain: its time and floor. */
  brokenAt?: number;
  brokenFloor?: string;
}

/** GET /api/audit's answer. */
export interface AuditPage {
  events: AuditEvent[];
  nextCursor?: string;
  total: number;
  counts: { actions: Record<string, number>; actors: Partial<Record<AuditActorKind, number>> };
  chain: AuditChain;
  /** Events per bucket of `size` ms from `start`, when the query asked for a bucket. */
  histogram?: { start: number; size: number; counts: number[] };
  /** Whether prompt text (its first 80 characters) is logged; admins can turn it on. */
  promptText: boolean;
}

/** Office-wide events (logins, settings, floors added and removed) are kept under this name. */
export const OFFICE_FLOOR = '_office';

/** The action groups the filter offers, each a list of action prefixes. */
export const AUDIT_GROUPS = {
  team: { label: 'Team', prefixes: ['roster.', 'standup.', 'subagent.'] },
  workers: { label: 'Workers', prefixes: ['worker.', 'queue.', 'liveapp.', 'studio.'] },
  escalations: { label: 'Escalations & approvals', prefixes: ['escalation.', 'approval.', 'proposal.'] },
  github: { label: 'GitHub', prefixes: ['pr.', 'issue.'] },
  settings: { label: 'Settings', prefixes: ['settings.', 'floor.'] },
  access: { label: 'Access', prefixes: ['login.', 'account.', 'audit.', 'access.', 'phone.'] },
  jeff: { label: 'Jeff', prefixes: ['judge.'] },
  firm: { label: 'The Firm', prefixes: ['firm.'] },
  delivery: { label: 'Acceptance', prefixes: ['acceptance.'] },
} as const;
export type AuditGroup = keyof typeof AUDIT_GROUPS;
export const isAuditGroup = (g: unknown): g is AuditGroup => typeof g === 'string' && Object.hasOwn(AUDIT_GROUPS, g);

/** Which group an action is in, if any. */
export function auditGroupOf(action: string): AuditGroup | undefined {
  for (const [g, def] of Object.entries(AUDIT_GROUPS)) if (def.prefixes.some((p) => action.startsWith(p))) return g as AuditGroup;
  return undefined;
}

/** Whether `action` matches one of `asked`: a group name, an exact action or a prefix ending in '.' or '*'. */
export function actionMatches(action: string, asked: readonly string[]): boolean {
  return asked.some((a) => {
    if (isAuditGroup(a)) return AUDIT_GROUPS[a].prefixes.some((p) => action.startsWith(p));
    if (a.endsWith('*')) return action.startsWith(a.slice(0, -1));
    if (a.endsWith('.')) return action.startsWith(a);
    return action === a;
  });
}
