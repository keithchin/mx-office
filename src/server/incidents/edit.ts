// What a person may send to make or change an incident (POST /api/incidents and friends), checked and
// trimmed: unknown fields dropped, lengths capped, enums held to their values. Pure, for the tests.

import {
  ACTION_LINK_KINDS,
  ACTION_STATUSES,
  isIncidentStatus,
  isSeverity,
  type ActionLinkKind,
  type ActionStatus,
  type CorrectiveAction,
  type IncidentImpact,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentWorker,
} from '../../shared/incidents.js';

export interface IncidentPatch {
  title?: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  summary?: string;
  impact?: IncidentImpact;
  rootCause?: string;
  floors?: string[];
  actions?: CorrectiveAction[];
  /** Audit events to link, and to unlink. */
  linkAudit?: string[];
  unlinkAudit?: string[];
  workers?: IncidentWorker[];
  detectedAt?: number;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : undefined);
const ids = (v: unknown, max = 50) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, 80)).filter((x): x is string => !!x))].slice(0, max) : undefined);

function impactOf(v: unknown): IncidentImpact | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const out: IncidentImpact = {};
  const spend = Number(o.spendUsd);
  if (o.spendUsd !== undefined && o.spendUsd !== null && o.spendUsd !== '' && Number.isFinite(spend) && spend >= 0) out.spendUsd = Math.round(spend * 100) / 100;
  const agents = Number(o.agents);
  if (o.agents !== undefined && o.agents !== null && o.agents !== '' && Number.isInteger(agents) && agents >= 0) out.agents = Math.min(agents, 10_000);
  const data = str(o.data, 300);
  if (data) out.data = data;
  const text = str(o.text, 1000);
  if (text) out.text = text;
  return out;
}

function actionsOf(v: unknown): CorrectiveAction[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: CorrectiveAction[] = [];
  for (const [n, raw] of v.slice(0, 30).entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const text = str(a.text, 300);
    if (!text) continue;
    const status: ActionStatus = ACTION_STATUSES.includes(a.status as ActionStatus) ? (a.status as ActionStatus) : 'open';
    const l = a.link as Record<string, unknown> | undefined;
    const ref = l && typeof l === 'object' ? str(l.ref, 300) : undefined;
    const kind = l && ACTION_LINK_KINDS.includes(l.kind as ActionLinkKind) ? (l.kind as ActionLinkKind) : undefined;
    out.push({ id: str(a.id, 40) || `a${n + 1}`, text, status, ...(ref && kind ? { link: { kind, ref } } : {}) });
  }
  return out;
}

function workersOf(v: unknown): IncidentWorker[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .slice(0, 50)
    .map((w) => (w && typeof w === 'object' ? (w as Record<string, unknown>) : {}))
    .map((w) => ({ name: str(w.name, 80) ?? '', ...(str(w.id, 80) ? { id: str(w.id, 80) } : {}), ...(str(w.floor, 64) ? { floor: str(w.floor, 64) } : {}) }))
    .filter((w) => w.name);
}

/** A patch from a request body, or what's wrong with it. */
export function cleanPatch(body: unknown): IncidentPatch | string {
  if (!body || typeof body !== 'object') return 'Send JSON';
  const b = body as Record<string, unknown>;
  const p: IncidentPatch = {};
  if (b.title !== undefined) {
    const t = str(b.title, 160);
    if (!t) return 'An incident needs a title';
    p.title = t;
  }
  if (b.severity !== undefined) {
    if (!isSeverity(b.severity)) return 'Severity is sev1, sev2, sev3 or near-miss';
    p.severity = b.severity;
  }
  if (b.status !== undefined) {
    if (!isIncidentStatus(b.status)) return 'Status is open, mitigated or resolved';
    p.status = b.status;
  }
  if (b.summary !== undefined) p.summary = str(b.summary, 4000) ?? '';
  if (b.rootCause !== undefined) p.rootCause = str(b.rootCause, 4000) ?? '';
  if (b.impact !== undefined) p.impact = impactOf(b.impact) ?? {};
  if (b.floors !== undefined) p.floors = ids(b.floors, 20) ?? [];
  if (b.actions !== undefined) p.actions = actionsOf(b.actions) ?? [];
  if (b.linkAudit !== undefined) p.linkAudit = ids(b.linkAudit) ?? [];
  if (b.unlinkAudit !== undefined) p.unlinkAudit = ids(b.unlinkAudit) ?? [];
  if (b.workers !== undefined) p.workers = workersOf(b.workers) ?? [];
  if (b.detectedAt !== undefined) {
    const t = typeof b.detectedAt === 'number' ? b.detectedAt : Date.parse(String(b.detectedAt));
    if (Number.isFinite(t)) p.detectedAt = t;
  }
  return p;
}
