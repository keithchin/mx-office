// The Incidents sub-tab's pure parts: the query string for GET /api/incidents, what a new incident made
// from an audit event starts with, and how times and links are written. No DOM, for the tests.

import type { AuditEvent } from '../../../shared/audit';
import type { CorrectiveAction, IncidentSeverity, IncidentStatus } from '../../../shared/incidents';

export interface IncFilter {
  /** A floor's id, '_office' or 'all'. */
  floor: string;
  status: IncidentStatus[];
  severity: IncidentSeverity[];
  q: string;
}

export function incQuery(f: IncFilter): string {
  const p = new URLSearchParams();
  p.set('floor', f.floor);
  if (f.status.length) p.set('status', f.status.join(','));
  if (f.severity.length) p.set('severity', f.severity.join(','));
  if (f.q.trim()) p.set('q', f.q.trim());
  return p.toString();
}

/** When an audit event happened, from its id (its first nine characters are the time in base 36). */
export function auditIdTime(id: string): number | undefined {
  const t = parseInt(id.slice(0, 9), 36);
  return Number.isFinite(t) && t > 1_500_000_000_000 && t < 4_000_000_000_000 ? t : undefined;
}

/** What "Create incident from this event" starts the form with. */
export function draftFromEvent(e: AuditEvent) {
  const floor = e.floor && e.floor !== '_office' ? e.floor : undefined;
  return {
    title: e.summary.slice(0, 160),
    severity: (e.severity === 'warning' ? 'sev3' : 'near-miss') as IncidentSeverity,
    summary: `From the audit log: ${e.actor.name} — ${e.action}: ${e.summary}`,
    floors: floor ? [floor] : [],
    linkAudit: [e.id],
    workers: e.actor.kind === 'agent' ? [{ name: e.actor.name, ...(e.actor.id ? { id: e.actor.id } : {}), ...(floor ? { floor } : {}) }] : [],
    detectedAt: e.at,
  };
}

/** A link of a corrective action as an href, when it's something a browser can open. */
export function actionHref(link: CorrectiveAction['link'], repoUrl?: string): string | undefined {
  if (!link) return undefined;
  if (/^https?:\/\//i.test(link.ref)) return link.ref;
  const n = link.ref.replace(/^#/, '');
  if (repoUrl && (link.kind === 'pr' || link.kind === 'issue') && /^\d+$/.test(n)) return `${repoUrl}/${link.kind === 'pr' ? 'pull' : 'issues'}/${n}`;
  if (repoUrl && link.kind === 'commit' && /^[0-9a-f]{7,40}$/i.test(link.ref)) return `${repoUrl}/commit/${link.ref}`;
  return undefined;
}

export const fmtTime = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
