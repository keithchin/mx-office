// Team Server in the audit log: every Portal app created or linked and every push or pull, with the app's id and
// commits, never a token (the summaries come from words that went through the redactor, the details are ids).

import { audit, byWhom, office } from '../audit/index.js';
import type { TeamServerSync } from '../../shared/team-server.js';

export type TsAction = 'team-server.app-create' | 'team-server.app-created' | 'team-server.linked' | 'team-server.sync' | 'team-server.connected';

export function auditTs(a: { action: TsAction; floor?: string; by?: string; byId?: string; projectId?: string; summary: string; details?: Record<string, unknown>; severity?: 'info' | 'notice' | 'warning' }) {
  audit.record({
    ...(a.floor ? { floor: a.floor } : {}),
    actor: a.by ? byWhom(a.by, a.byId) : office(),
    action: a.action,
    target: { kind: 'mendix-app', ...(a.projectId ? { id: a.projectId, label: `Portal app ${a.projectId}` } : {}) },
    summary: a.summary,
    ...(a.details ? { details: a.details } : {}),
    severity: a.severity ?? 'notice',
  });
}

/** A sync's result in the log: a push or pull is a notice, a refusal a warning, nothing to do isn't logged. */
export function auditSync(floor: string | undefined, projectId: string, s: TeamServerSync, by?: { name: string; id?: string }) {
  // Nothing to do, or no network yet (a sleep): nothing worth an audit line.
  if (s.state === 'same' || s.state === 'unreachable') return;
  auditTs({ action: 'team-server.sync', floor, by: by?.name, byId: by?.id, projectId, summary: s.message, details: { state: s.state, ...(s.sha ? { sha: s.sha } : {}) }, severity: s.state === 'pushed' || s.state === 'pulled' ? 'notice' : 'warning' });
}
