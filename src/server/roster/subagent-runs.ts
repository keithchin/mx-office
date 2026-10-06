// The live runs of a floor's subagents (shared/roster/subagent-live.ts), kept up to date from what the
// hooks and the Lead's transcript say, one signal at a time. Pure: a list in, the same list changed,
// so the tests drive it straight. subagent-live.ts feeds it.
//
// A run is matched by its Agent call's tool_use_id first, then by Claude Code's agent id, then by being
// the oldest of that subagent still working that hasn't got one yet: the hooks and the transcript name
// the same run in different ways, and either may come first or not at all.

import { LIVE_KEPT, LIVE_STALE_MS, type LiveRun } from '../../shared/roster/subagent-live.js';
import type { RoleId } from '../../shared/roster/roles.js';

/** One thing heard about a subagent run. */
export type LiveSignal =
  /** The Lead's Agent call went out (PreToolUse; the transcript's tool_use). */
  | { kind: 'dispatch'; at: number; toolUseId?: string; agent?: string; task?: string; model?: string; background?: boolean }
  /** Its call came back at once: it runs in the background as agent `agentId`. */
  | { kind: 'launched'; at: number; toolUseId?: string; agentId?: string; agent?: string; task?: string; model?: string }
  /** It began (again) or stopped (SubagentStart / SubagentStop). */
  | { kind: 'start'; at: number; agentId?: string; agent?: string }
  | { kind: 'stop'; at: number; agentId?: string; agent?: string }
  /** Its call came back with its answer (PostToolUse; the transcript's tool_result). */
  | { kind: 'result'; at: number; toolUseId?: string; agent?: string; task?: string; model?: string; failed: boolean; durationMs?: number }
  /** A background run reported it finished (the transcript's task-notification). */
  | { kind: 'notified'; at: number; toolUseId?: string; agentId?: string; failed: boolean };

/** Who sent it and where the word came from. */
export interface LiveWho {
  lead: RoleId;
  workerId: string;
  source: LiveRun['source'];
}

/** Hooks and transcript name one dispatch this close together when neither has the other's id. */
const SAME_DISPATCH_MS = 15_000;
const GENERAL = 'general-purpose';

const mine = (r: LiveRun, who: LiveWho) => r.workerId === who.workerId;
const oldestFirst = (a: LiveRun, b: LiveRun) => a.startedAt - b.startedAt;

function finish(r: LiveRun, at: number, failed: boolean, durationMs?: number) {
  r.status = failed ? 'failed' : 'done';
  r.endedAt = Math.max(at, r.startedAt);
  r.durationMs = durationMs ?? r.endedAt - (r.resumedAt ?? r.startedAt);
}

function fill(r: LiveRun, s: { task?: string; model?: string; agent?: string }) {
  if (s.task && !r.task) r.task = s.task;
  if (s.model && !r.model) r.model = s.model;
  if (s.agent && r.name === GENERAL && s.agent !== GENERAL) r.name = s.agent;
}

/** The run a signal is about, if the list has it. */
function find(runs: LiveRun[], who: LiveWho, s: LiveSignal): LiveRun | undefined {
  const tool = 'toolUseId' in s ? s.toolUseId : undefined;
  const agentId = 'agentId' in s ? s.agentId : undefined;
  if (tool) {
    const r = runs.find((x) => x.toolUseId === tool);
    if (r) return r;
  }
  if (agentId) {
    // A resumed agent has had more than one run: the newest is the one going on.
    const r = runs.filter((x) => x.agentId === agentId).sort(oldestFirst).at(-1);
    if (r) return r;
  }
  return undefined;
}

/** The oldest run of subagent `agent` (any, when unnamed) of this Lead still working that `ok` lets match. */
function oldestWorking(runs: LiveRun[], who: LiveWho, agent: string | undefined, ok: (r: LiveRun) => boolean): LiveRun | undefined {
  return runs.filter((r) => mine(r, who) && r.status === 'working' && (!agent || r.name === agent) && ok(r)).sort(oldestFirst)[0];
}

function add(runs: LiveRun[], who: LiveWho, at: number, fields: Partial<LiveRun> & { name?: string }): LiveRun {
  const r: LiveRun = { id: fields.toolUseId ?? fields.agentId ?? `${who.workerId}-${at}-${runs.length}`, lead: who.lead, workerId: who.workerId, name: fields.name ?? GENERAL, status: 'working', startedAt: at, seenAt: at, source: who.source };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && k !== 'name') (r as unknown as Record<string, unknown>)[k] = v;
  runs.push(r);
  return r;
}

/**
 * Takes in one signal about a run of the Lead's subagents. True when the list changed in a way the
 * browsers should see (a run began, ended, or got its task); false when it was already known.
 */
export function applyLive(runs: LiveRun[], who: LiveWho, s: LiveSignal): boolean {
  let r = find(runs, who, s);
  const agent = 'agent' in s ? s.agent : undefined;
  switch (s.kind) {
    case 'dispatch': {
      // The other source's word on the same call, without its id: the newest dispatch of that subagent close by.
      r ??= runs.find((x) => mine(x, who) && x.source !== who.source && !x.toolUseId && (!agent || x.name === agent || x.name === GENERAL) && Math.abs(x.startedAt - s.at) <= SAME_DISPATCH_MS);
      if (r) {
        const had = `${r.task}|${r.model}|${r.name}`;
        if (s.toolUseId) r.toolUseId ??= s.toolUseId;
        if (s.background) r.background = true;
        fill(r, s);
        return had !== `${r.task}|${r.model}|${r.name}`;
      }
      add(runs, who, s.at, { name: agent, task: s.task, model: s.model, toolUseId: s.toolUseId, ...(s.background ? { background: true } : {}) });
      return true;
    }
    case 'launched': {
      r ??= oldestWorking(runs, who, agent, (x) => !x.agentId && !x.background);
      if (!r) r = add(runs, who, s.at, { name: agent, task: s.task, model: s.model, toolUseId: s.toolUseId });
      r.background = true;
      if (s.agentId) r.agentId ??= s.agentId;
      if (s.toolUseId) r.toolUseId ??= s.toolUseId;
      fill(r, s);
      r.seenAt = Math.max(r.seenAt, s.at);
      return true;
    }
    case 'start': {
      if (r) {
        r.seenAt = Math.max(r.seenAt, s.at);
        if (r.status === 'working') return false;
        // Taken up again: working once more, from now.
        r.status = 'working';
        r.resumedAt = s.at;
        r.endedAt = r.durationMs = undefined;
        return true;
      }
      r = oldestWorking(runs, who, agent, (x) => !x.agentId);
      if (r) {
        if (s.agentId) r.agentId = s.agentId;
        fill(r, s);
        r.seenAt = Math.max(r.seenAt, s.at);
        return false;
      }
      add(runs, who, s.at, { name: agent, agentId: s.agentId });
      return true;
    }
    case 'stop': {
      r ??= oldestWorking(runs, who, agent, (x) => !x.agentId);
      if (!r || r.status !== 'working') return false;
      r.seenAt = Math.max(r.seenAt, s.at);
      finish(r, s.at, false);
      return true;
    }
    case 'result': {
      r ??= oldestWorking(runs, who, agent, (x) => !x.background && !x.toolUseId);
      if (!r) {
        const started = s.at - (s.durationMs ?? 0);
        r = add(runs, who, started, { name: agent, task: s.task, model: s.model, toolUseId: s.toolUseId });
        finish(r, s.at, s.failed, s.durationMs);
        r.seenAt = s.at;
        return true;
      }
      fill(r, s);
      r.seenAt = Math.max(r.seenAt, s.at);
      const wasWorking = r.status === 'working';
      // A SubagentStop came first: the call's answer says whether it failed, and how long it really took.
      if (wasWorking || (s.failed && r.status === 'done')) {
        finish(r, wasWorking ? s.at : (r.endedAt ?? s.at), s.failed, s.durationMs ?? (wasWorking ? undefined : r.durationMs));
        return true;
      }
      return false;
    }
    case 'notified': {
      if (!r || r.status !== 'working') return false;
      r.seenAt = Math.max(r.seenAt, s.at);
      finish(r, s.at, s.failed);
      return true;
    }
  }
}

/** Runs still working with no word of them for LIVE_STALE_MS are lost. True when any were. */
export function expireLive(runs: LiveRun[], now: number): boolean {
  let changed = false;
  for (const r of runs) {
    if (r.status !== 'working' || now - r.seenAt < LIVE_STALE_MS) continue;
    r.status = 'lost';
    r.endedAt = r.seenAt;
    changed = true;
  }
  return changed;
}

/** Keeps the newest LIVE_KEPT runs, dropping the oldest finished ones first. Changes the list in place. */
export function trimLive(runs: LiveRun[], kept = LIVE_KEPT): LiveRun[] {
  if (runs.length <= kept) return runs;
  const order = [...runs].sort((a, b) => Number(a.status === 'working') - Number(b.status === 'working') || a.startedAt - b.startedAt);
  const drop = new Set(order.slice(0, runs.length - kept));
  const keep = runs.filter((r) => !drop.has(r));
  runs.splice(0, runs.length, ...keep);
  return runs;
}
