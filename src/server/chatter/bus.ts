// What the rest of the office tells the team chatter (chatter/index.ts), in one line where it happens:
// the office relaying escalations to the Project Coordinator, a review nudge, one agent prompting
// another through office-workers, a Lead dispatching a subagent. No imports of the chatter itself, so
// the roster's tests (fake floors, no chatter) just talk to nobody.

import type { ChatterKind, ChatterParty, ChatterRef, ChatterTo } from '../../shared/chatter.js';

/** A message as its source knows it: the chatter fills in roles and teams, redacts, clips and stamps it. */
export interface ChatterDraft {
  kind: ChatterKind;
  from: ChatterParty;
  to: ChatterTo;
  text: string;
  at?: number;
  ref?: ChatterRef;
  /** Set for messages read from somewhere the office looks again (the roster, a journal): the same key is one message. */
  key?: string;
  /** A team phone message (server/phone/): its lines and Markdown kept, up to CHATTER_LONG_MAX. */
  long?: boolean;
}

export type ChatterEvent =
  | { t: 'msg'; floor: string; draft: ChatterDraft }
  /** A worker called its Agent tool (PreToolUse): the floor and who it is are the chatter's to find. */
  | { t: 'dispatch'; workerId: string; at: number; agent: string; task: string };

const listeners = new Set<(ev: ChatterEvent) => void>();

export function onChatter(l: (ev: ChatterEvent) => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

function emit(ev: ChatterEvent) {
  for (const l of listeners) {
    try {
      l(ev);
    } catch (err) {
      console.error('agent-office: a chatter listener failed', err);
    }
  }
}

export const noteChatter = (floor: string, draft: ChatterDraft) => emit({ t: 'msg', floor, draft });

/** The office itself, as a speaker. */
export const OFFICE: ChatterParty = { name: 'The office', kind: 'office' };

/** A worker as a speaker: the chatter adds its roster role. */
export const workerParty = (w: { id: string; name: string }): ChatterParty => ({ name: w.name, kind: 'agent', workerId: w.id });

const clip = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, n) : undefined);

/** A PreToolUse payload: a subagent being dispatched, with what it's asked to do. True when it was one. */
export function noteDispatch(workerId: string, payload: unknown, now = Date.now()): boolean {
  const p = (payload ?? {}) as { tool_name?: unknown; tool_input?: { subagent_type?: unknown; description?: unknown; prompt?: unknown } };
  if (p.tool_name !== 'Agent' && p.tool_name !== 'Task') return false;
  const desc = clip(p.tool_input?.description, 160);
  const prompt = clip(p.tool_input?.prompt, 600);
  const task = [desc, prompt && prompt !== desc ? prompt : undefined].filter(Boolean).join(' — ');
  if (!task) return false;
  emit({ t: 'dispatch', workerId, at: now, agent: clip(p.tool_input?.subagent_type, 60) ?? 'general-purpose', task });
  return true;
}
