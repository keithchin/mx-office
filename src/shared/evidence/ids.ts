// The domain identifiers the Knowledge & Evals work needs, as aliases beside the floor and worker ids
// (docs/knowledge-evals/gap-map.md, section 3). Nothing is renamed: a floor id stays the routing key,
// and these name the same things in a way that survives a floor being renamed or added again.
// Pure (no Node imports): the browser may import it too.

import { isRoleId, type RoleId } from '../roster/roles.js';

/** One office is one tenant. Always derived on the server, never taken from a client. */
export const TENANT_ID = 'local';
export type TenantId = typeof TENANT_ID;

/** The ids a trace event or an audit event can carry, and what an adapter reports for each. */
export const ID_FIELDS = ['projectId', 'executionId', 'taskId', 'agentInstanceId', 'roleId', 'sessionId'] as const;
export type IdField = (typeof ID_FIELDS)[number];

/** `recorded`: the source carried it. `inferred`: an adapter worked it out from other ids (a floor id, a worker id). */
export type IdSource = 'recorded' | 'inferred';

// ---- ULIDs ---------------------------------------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID = '[0-9A-HJKMNP-TV-Z]{26}';

/** A ULID: 10 characters of milliseconds, 16 of randomness, sortable by when it was minted. */
export function ulid(now = Date.now(), random: (n: number) => Uint8Array = randomBytes): string {
  let t = Math.max(0, Math.floor(now));
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = random(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] % 32];
  return time + rand;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

// ---- The ids --------------------------------------------------------------------------------------

const PROJECT_RE = new RegExp(`^prj_${ULID}$`);
const EXECUTION_RE = new RegExp(`^exe_${ULID}$`);
const TASK_RE = new RegExp(`^tsk_${ULID}$`);
const ISSUE_TASK_RE = /^issue:[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}#[1-9]\d{0,9}$/;
const QUEUE_TASK_RE = /^queue:[a-z0-9-]{1,40}\/[a-f0-9]{6,32}$/;
const WORKER_RE = /^[a-f0-9]{6,32}$/;
const SUBAGENT_RE = /^sub_[A-Za-z0-9_-]{1,80}$/;
const FIRM_RE = /^firm_\d{8}-[a-f0-9]{6}_[a-z0-9-]{1,40}$/;
const SESSION_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

/** A project's stable id: `prj_<ulid>`, minted once per project and kept in floors.json (server/projects/ids.ts). */
export type ProjectId = string;
export const isProjectId = (v: unknown): v is ProjectId => typeof v === 'string' && PROJECT_RE.test(v);
export const mintProjectId = (now?: number, random?: (n: number) => Uint8Array): ProjectId => `prj_${ulid(now, random)}`;

/** One delivery attempt (a queue task seated, a Lead handed work, a benchmark trial): `exe_<ulid>`. */
export type ExecutionId = string;
export const isExecutionId = (v: unknown): v is ExecutionId => typeof v === 'string' && EXECUTION_RE.test(v);
export const mintExecutionId = (now?: number, random?: (n: number) => Uint8Array): ExecutionId => `exe_${ulid(now, random)}`;

/**
 * A piece of work: `tsk_<ulid>` once minted, `issue:<owner>/<repo>#<n>` for issue-based work (a stable
 * external key), or `queue:<floor>/<queue task id>` for a queue task from before task ids were minted.
 */
export type TaskId = string;
export const isTaskId = (v: unknown): v is TaskId => typeof v === 'string' && (TASK_RE.test(v) || ISSUE_TASK_RE.test(v) || QUEUE_TASK_RE.test(v));
export const mintTaskId = (now?: number, random?: (n: number) => Uint8Array): TaskId => `tsk_${ulid(now, random)}`;
/** The task id of issue #n in `repo` (owner/name), or undefined when either isn't one. */
export function issueTaskId(repo: string | undefined, n: number | undefined): TaskId | undefined {
  if (!repo || !Number.isInteger(n) || (n as number) < 1) return undefined;
  const id = `issue:${repo.toLowerCase()}#${n}`;
  return ISSUE_TASK_RE.test(id) ? id : undefined;
}
/** The task id of a queue task that has no minted one: its floor and its queue id. */
export function legacyQueueTaskId(floor: string, queueTaskId: string): TaskId | undefined {
  const id = `queue:${floor}/${queueTaskId}`;
  return QUEUE_TASK_RE.test(id) ? id : undefined;
}

/**
 * Who did it: a worker is already a durable agent instance across its sessions, so a worker's id is its
 * agentInstanceId; a subagent is `sub_<Claude agent_id>`, a Firm reviewer `firm_<engagement>_<reviewer>`.
 * The session it was in at the time is a separate id (sessionId), never folded into this one.
 */
export type AgentInstanceId = string;
export const isAgentInstanceId = (v: unknown): v is AgentInstanceId => typeof v === 'string' && (WORKER_RE.test(v) || SUBAGENT_RE.test(v) || FIRM_RE.test(v));
export const workerInstanceId = (workerId: string | undefined): AgentInstanceId | undefined => (workerId && WORKER_RE.test(workerId) ? workerId : undefined);
export const subagentInstanceId = (agentId: string | undefined): AgentInstanceId | undefined => (agentId && SUBAGENT_RE.test(`sub_${agentId}`) ? `sub_${agentId}` : undefined);
export const reviewerInstanceId = (engagementId: string, reviewerId: string): AgentInstanceId | undefined => {
  const id = `firm_${engagementId}_${reviewerId}`;
  return FIRM_RE.test(id) ? id : undefined;
};

/** A provider's own session id, as the worker records it. */
export const isSessionId = (v: unknown): v is string => typeof v === 'string' && SESSION_RE.test(v);

/** The roster role (shared/roster/roles.ts). Under team shapes, the role a worker covered at the time. */
export type { RoleId };
export { isRoleId };

/** The validator for each id field. */
export const ID_VALIDATORS: Record<IdField, (v: unknown) => boolean> = {
  projectId: isProjectId,
  executionId: isExecutionId,
  taskId: isTaskId,
  agentInstanceId: isAgentInstanceId,
  roleId: isRoleId,
  sessionId: isSessionId,
};

/** The ids an audit event (AuditInput.ids) or a new record may carry, all optional. */
export type RecordedIds = Partial<Record<IdField, string>> & { spanId?: string; parentSpanId?: string };

const SPAN_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** `ids` with every field that isn't a valid id of its kind dropped; undefined when none is left. */
export function cleanIds(ids: unknown): RecordedIds | undefined {
  if (!ids || typeof ids !== 'object' || Array.isArray(ids)) return undefined;
  const src = ids as Record<string, unknown>;
  const out: RecordedIds = {};
  for (const f of ID_FIELDS) if (ID_VALIDATORS[f](src[f])) out[f] = src[f] as string;
  for (const f of ['spanId', 'parentSpanId'] as const) if (typeof src[f] === 'string' && SPAN_RE.test(src[f] as string)) out[f] = src[f] as string;
  return Object.keys(out).length ? out : undefined;
}
