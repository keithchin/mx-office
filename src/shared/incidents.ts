// Incidents: something that went wrong, or nearly did, worth a record of its own with a cause and a
// follow-up (unlike the audit log's routine events, which it links to). Shared by the server
// (server/incidents/: the store, the detection rules, the API) and the Incidents sub-tab of the Audit log
// (ui/incidents/), and by Needs you (shared/needsyou.ts), which lists open sev1 and sev2 incidents.

export type IncidentSeverity = 'sev1' | 'sev2' | 'sev3' | 'near-miss';
export const INCIDENT_SEVERITIES: readonly IncidentSeverity[] = ['sev1', 'sev2', 'sev3', 'near-miss'];
export const SEVERITY_LABEL: Record<IncidentSeverity, string> = { sev1: 'Sev 1 · critical', sev2: 'Sev 2 · major', sev3: 'Sev 3 · minor', 'near-miss': 'Near miss' };
export const SEVERITY_SHORT: Record<IncidentSeverity, string> = { sev1: 'SEV1', sev2: 'SEV2', sev3: 'SEV3', 'near-miss': 'NEAR MISS' };

export type IncidentStatus = 'open' | 'mitigated' | 'resolved';
export const INCIDENT_STATUSES: readonly IncidentStatus[] = ['open', 'mitigated', 'resolved'];
export const STATUS_LABEL: Record<IncidentStatus, string> = { open: 'Open', mitigated: 'Mitigated', resolved: 'Resolved' };

export const isSeverity = (v: unknown): v is IncidentSeverity => INCIDENT_SEVERITIES.includes(v as IncidentSeverity);
export const isIncidentStatus = (v: unknown): v is IncidentStatus => INCIDENT_STATUSES.includes(v as IncidentStatus);

/** The automatic detection rules (server/incidents/rules.ts), each one a setting of its own. */
export const INCIDENT_RULES = ['realLaunch', 'spendSpike', 'spendCap', 'interrupted', 'escalationUndelivered', 'crashLoop', 'studioDenied', 'flowFailed', 'sweepErrors', 'loginFailed', 'pageStall', 'serverStall'] as const;
export type IncidentRule = (typeof INCIDENT_RULES)[number];
export const isIncidentRule = (v: unknown): v is IncidentRule => INCIDENT_RULES.includes(v as IncidentRule);

export interface DetectedBy {
  kind: 'rule' | 'agent' | 'person';
  name: string;
  rule?: IncidentRule;
  id?: string;
}

export interface IncidentImpact {
  /** What it cost, in dollars, when known. */
  spendUsd?: number;
  /** How many agents it touched. */
  agents?: number;
  /** What data it touched, in words ("throwaway worktrees only"). */
  data?: string;
  /** Anything else. */
  text?: string;
}

export interface TimelineEntry {
  at: number;
  by: string;
  text: string;
  kind: 'detected' | 'note' | 'status' | 'change' | 'recurrence';
}

export type ActionStatus = 'open' | 'done' | 'wontfix';
export const ACTION_STATUSES: readonly ActionStatus[] = ['open', 'done', 'wontfix'];
export type ActionLinkKind = 'commit' | 'pr' | 'issue' | 'setting' | 'url';
export const ACTION_LINK_KINDS: readonly ActionLinkKind[] = ['commit', 'pr', 'issue', 'setting', 'url'];

export interface CorrectiveAction {
  id: string;
  text: string;
  status: ActionStatus;
  link?: { kind: ActionLinkKind; ref: string };
}

export interface IncidentWorker {
  id?: string;
  name: string;
  floor?: string;
}

export interface Incident {
  id: string;
  /** Shown as INC-<number>. */
  number: number;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  detectedAt: number;
  detectedBy: DetectedBy;
  /** Floor ids; empty for the office as a whole. */
  floors: string[];
  summary: string;
  impact: IncidentImpact;
  timeline: TimelineEntry[];
  rootCause?: string;
  actions: CorrectiveAction[];
  /** Audit events it's about. */
  auditIds: string[];
  workers: IncidentWorker[];
  /** What an automatic one is deduped by: rule:floor. */
  dedupeKey?: string;
  /** How many times its rule fired into it. */
  occurrences: number;
  lastSeenAt: number;
  /** Recorded after the fact, not by the office as it happened. */
  retrospective?: boolean;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
}

/** What Needs you is given: open sev1 and sev2 incidents, and nothing else of them. */
export interface IncidentBrief {
  id: string;
  number: number;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  floors: string[];
  detectedAt: number;
}

export const briefOf = (i: Incident): IncidentBrief => ({ id: i.id, number: i.number, title: i.title, severity: i.severity, status: i.status, floors: i.floors, detectedAt: i.detectedAt });

/** Whether Needs you lists it: still open, and sev1 or sev2. */
export const needsAttention = (i: Pick<Incident, 'status' | 'severity'>) => i.status === 'open' && (i.severity === 'sev1' || i.severity === 'sev2');

// ---- Settings ----------------------------------------------------------------------------------------

export interface RuleSetting {
  on: boolean;
  /** How many in `minutes` it takes (crash loops, denied writes, failed sign-ins, failed runs, sweep errors). */
  count?: number;
  minutes?: number;
  /** Spend spike: the floor's last hour against this many times its trailing hourly average… */
  factor?: number;
  /** …once that hour is at least this many dollars… */
  minUsd?: number;
  /** …or past this many dollars an hour whatever the average. */
  absUsd?: number;
}

export interface IncidentSettings {
  rules: Record<IncidentRule, RuleSetting>;
  /** An open incident from the same rule on the same floor seen again within this many hours is updated rather than a new one opened. */
  dedupeHours: number;
}

export const DEFAULT_INCIDENT_SETTINGS: IncidentSettings = {
  dedupeHours: 24,
  rules: {
    realLaunch: { on: true },
    spendSpike: { on: true, factor: 3, minUsd: 5, absUsd: 25 },
    spendCap: { on: true },
    interrupted: { on: true, count: 1 },
    escalationUndelivered: { on: true, minutes: 30 },
    crashLoop: { on: true, count: 3, minutes: 15 },
    studioDenied: { on: true, count: 5, minutes: 10 },
    flowFailed: { on: true, count: 3, minutes: 60 },
    sweepErrors: { on: true, count: 3, minutes: 360 },
    loginFailed: { on: true, count: 5, minutes: 10 },
    pageStall: { on: true },
    serverStall: { on: true },
  },
};

export const RULE_META: Record<IncidentRule, { label: string; what: string }> = {
  realLaunch: { label: 'Real agent launched in a test office', what: 'A worker started (or was about to start) a real agent CLI on a test office' },
  spendSpike: { label: 'Spend spike', what: "A floor's spend in the last hour past N× its trailing hourly average, or past a set amount" },
  spendCap: { label: 'Spend cap reached', what: "A floor's daily spend cap paused the office's prompts" },
  interrupted: { label: 'Interrupted turns', what: 'The office stopped with workers in the middle of a turn' },
  escalationUndelivered: { label: 'Escalation answer not delivered', what: 'An answer to an escalation still not delivered to its agent after this long' },
  crashLoop: { label: 'Worker crash loop', what: 'A worker exited abnormally this many times in this long' },
  studioDenied: { label: 'Studio mode denied writes', what: 'Agents had writes held by Studio mode this many times in this long' },
  flowFailed: { label: 'Workflow or gate-check failures', what: 'A workflow or gate-check run failed this many times in this long' },
  sweepErrors: { label: 'Worktree cleanup errors', what: "The worktree cleanup couldn't remove worktrees this many times in this long" },
  loginFailed: { label: 'Failed sign-ins', what: 'Sign-ins failed this many times in this long' },
  pageStall: { label: 'A page froze', what: "A browser's page ran one task for longer than half a second (the view and where the time went are in the incident)" },
  serverStall: { label: 'The server stalled', what: "The office server's event loop was blocked for longer than a second" },
};

/** Settings as stored, made whole: unknown rules dropped, missing fields from the defaults, numbers kept sane. */
export function normalizeSettings(raw: unknown): IncidentSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<IncidentSettings>;
  const rules = {} as Record<IncidentRule, RuleSetting>;
  for (const id of INCIDENT_RULES) {
    const d = DEFAULT_INCIDENT_SETTINGS.rules[id];
    const got = (r.rules && typeof r.rules === 'object' ? (r.rules as Record<string, unknown>)[id] : undefined) as Partial<RuleSetting> | undefined;
    const out: RuleSetting = { on: typeof got?.on === 'boolean' ? got.on : d.on };
    for (const k of ['count', 'minutes', 'factor', 'minUsd', 'absUsd'] as const) {
      if (d[k] === undefined) continue;
      const v = Number(got?.[k]);
      out[k] = Number.isFinite(v) && v > 0 ? Math.min(v, 100_000) : d[k];
    }
    rules[id] = out;
  }
  const dh = Number(r.dedupeHours);
  return { rules, dedupeHours: Number.isFinite(dh) && dh > 0 ? Math.min(dh, 24 * 30) : DEFAULT_INCIDENT_SETTINGS.dedupeHours };
}

// ---- The list --------------------------------------------------------------------------------------

/** GET /api/incidents' answer. */
export interface IncidentList {
  incidents: Incident[];
  counts: { status: Record<IncidentStatus, number>; severity: Record<IncidentSeverity, number> };
  /** Whether the incidents file's hash chain holds. */
  chain: { ok: boolean; brokenAt?: number };
  admin: boolean;
  settings: IncidentSettings;
}

const SEV_RANK: Record<IncidentSeverity, number> = { sev1: 0, sev2: 1, sev3: 2, 'near-miss': 3 };
const STATUS_RANK: Record<IncidentStatus, number> = { open: 0, mitigated: 1, resolved: 2 };

/** Open before mitigated before resolved; within each, the worst first, then the newest. */
export function sortIncidents(list: readonly Incident[]): Incident[] {
  return [...list].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.detectedAt - a.detectedAt);
}

export function countIncidents(list: readonly Incident[]): IncidentList['counts'] {
  const status = { open: 0, mitigated: 0, resolved: 0 } as Record<IncidentStatus, number>;
  const severity = { sev1: 0, sev2: 0, sev3: 0, 'near-miss': 0 } as Record<IncidentSeverity, number>;
  for (const i of list) {
    status[i.status]++;
    severity[i.severity]++;
  }
  return { status, severity };
}

export interface IncidentFilter {
  /** A floor id ('_office': office-wide only), or every floor when missing or 'all'. */
  floor?: string;
  status?: readonly IncidentStatus[];
  severity?: readonly IncidentSeverity[];
  q?: string;
}

export function filterIncidents(list: readonly Incident[], f: IncidentFilter): Incident[] {
  const q = f.q?.trim().toLowerCase();
  return list.filter((i) => {
    if (f.floor && f.floor !== 'all' && !(f.floor === '_office' ? i.floors.length === 0 : i.floors.includes(f.floor))) return false;
    if (f.status?.length && !f.status.includes(i.status)) return false;
    if (f.severity?.length && !f.severity.includes(i.severity)) return false;
    if (q && !`inc-${i.number} ${i.title} ${i.summary} ${i.rootCause ?? ''} ${i.workers.map((w) => w.name).join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export const incidentRef = (i: Pick<Incident, 'number'>) => `INC-${i.number}`;
