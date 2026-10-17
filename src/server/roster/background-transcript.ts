// A worker's background work as its Claude Code transcript tells it (shared/roster/background-work.ts):
// a Monitor call or a Bash call run in the background going out (an assistant tool_use), its result
// naming the task it runs as (the user tool_result with Claude Code's toolUseResult: `taskId` and
// `timeoutMs` for a Monitor, `backgroundTaskId` for a command, also one moved to the background when it
// outran its timeout), and each <task-notification> after (in a user message, or the queue-operation
// that queued it): a Monitor event, or the task's end (a status, or "Monitor expired"). Sidechain lines
// (a subagent's own conversation) are skipped. Pure: fed the transcript's text a piece at a time (the
// same reads the live subagent runs make, subagent-live.ts), it hands back the signals.

import type { BgKind, BgSignal } from '../../shared/roster/background-work.js';

const clip = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, n) : undefined);
/** Calls remembered until their result comes, at most. */
const CALLS_KEPT = 200;
const ENDED = new Set(['completed', 'failed', 'killed', 'stopped', 'error', 'cancelled', 'timeout']);

interface Call {
  tool: BgKind;
  label?: string;
  timeoutMs?: number;
  persistent?: boolean;
}

/** A Monitor or background-Bash call's input, as a call; undefined for anything else. */
export function bgCallOf(name: unknown, input: any): Call | undefined {
  const i = input && typeof input === 'object' ? input : {};
  if (name === 'Monitor') return { tool: 'monitor', label: clip(i.description, 80) ?? clip(i.command, 80), ...(typeof i.timeout_ms === 'number' ? { timeoutMs: i.timeout_ms } : {}), ...(i.persistent === true ? { persistent: true } : {}) };
  if (name === 'Bash') return { tool: 'command', label: clip(i.description, 80) ?? clip(i.command, 80) };
  return undefined;
}

/** The task a tool's result says it runs in the background as, if any (a result object, or its text). */
export function bgTaskOf(result: any, text?: unknown): { taskId: string; timeoutMs?: number; persistent?: boolean } | undefined {
  const r = result && typeof result === 'object' ? result : undefined;
  const id = clip(r?.taskId, 60) ?? clip(r?.backgroundTaskId, 60);
  if (id) return { taskId: id, ...(typeof r?.timeoutMs === 'number' ? { timeoutMs: r.timeoutMs } : {}), ...(r?.persistent === true ? { persistent: true } : {}) };
  const s = typeof text === 'string' ? text : typeof result === 'string' ? result : undefined;
  const m = s && (/^Monitor started \(task ([\w-]+)/.exec(s) ?? /(?:moved to the background|running in background) (?:\(ID: |with ID: )([\w-]+)/.exec(s));
  return m ? { taskId: m[1] } : undefined;
}

const tags = (text: string, name: string) => [...text.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, 'g'))].map((m) => m[1].trim()).filter(Boolean);

/** A <task-notification>'s word on background tasks: an event (it runs on) or its end. */
export function bgNotification(text: string, at: number): BgSignal[] {
  if (!text.includes('<task-notification>')) return [];
  const taskIds = tags(text, 'task-id').filter((t) => !t.startsWith('__'));
  const toolUseId = tags(text, 'tool-use-id')[0];
  if (!taskIds.length && !toolUseId) return [];
  const status = tags(text, 'status')[0]?.toLowerCase();
  const event = tags(text, 'event')[0] ?? '';
  const ended = (status !== undefined && ENDED.has(status)) || /^\[Monitor expired/.test(event);
  return [{ kind: ended ? 'closed' : 'event', at, taskIds, ...(toolUseId ? { toolUseId } : {}) }];
}

export class BackgroundTranscript {
  private readonly calls = new Map<string, Call>();
  private rest = '';

  /** Takes the next piece of the transcript; a line cut off at its end waits for the rest. */
  feed(chunk: string): BgSignal[] {
    const lines = (this.rest + chunk).split('\n');
    this.rest = lines.pop() ?? '';
    const out: BgSignal[] = [];
    for (const line of lines) {
      // Cheap first: only the lines that can say anything about background work are parsed.
      if (!line.includes('"Monitor"') && !line.includes('run_in_background') && !line.includes('askId"') && !line.includes('task-notification')) continue;
      let l: any;
      try {
        l = JSON.parse(line);
      } catch {
        continue;
      }
      out.push(...this.entry(l));
    }
    return out;
  }

  /** Starts over (the file was replaced): what was half-read is dropped. */
  reset() {
    this.rest = '';
    this.calls.clear();
  }

  private entry(l: any): BgSignal[] {
    if (!l || typeof l !== 'object' || l.isSidechain) return [];
    const at = Date.parse(l.timestamp);
    if (!Number.isFinite(at)) return [];
    if (l.type === 'queue-operation') return l.operation === 'enqueue' && typeof l.content === 'string' ? bgNotification(l.content, at) : [];
    const content = l.message?.content;
    if (l.type === 'user' && typeof content === 'string') return bgNotification(content, at);
    if (!Array.isArray(content)) return [];
    const out: BgSignal[] = [];
    for (const b of content) {
      if (l.type === 'assistant' && b?.type === 'tool_use' && typeof b.id === 'string') {
        // Every Monitor call; a Bash call only when sent to the background (one moved there later is known by its result).
        if (b.name === 'Monitor' || (b.name === 'Bash' && b.input?.run_in_background === true)) {
          const c = bgCallOf(b.name, b.input);
          if (c) this.remember(b.id, c);
        }
      } else if (l.type === 'user' && b?.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        const call = this.calls.get(b.tool_use_id);
        const r = l.toolUseResult;
        const task = b.is_error === true ? undefined : bgTaskOf(r, typeof b.content === 'string' ? b.content : undefined);
        this.calls.delete(b.tool_use_id);
        if (!task) continue;
        // A result naming a background task: a Monitor's has its timeout; otherwise it's a command.
        const tool: BgKind = call?.tool ?? (r && typeof r === 'object' && 'timeoutMs' in r ? 'monitor' : 'command');
        out.push({ kind: 'launched', at, tool, toolUseId: b.tool_use_id, taskId: task.taskId, ...(call?.label ? { label: call.label } : {}), ...((task.timeoutMs ?? call?.timeoutMs) !== undefined ? { timeoutMs: task.timeoutMs ?? call?.timeoutMs } : {}), ...(task.persistent || call?.persistent ? { persistent: true } : {}) });
      } else if (l.type === 'user' && b?.type === 'text' && typeof b.text === 'string') {
        out.push(...bgNotification(b.text, at));
      }
    }
    return out;
  }

  private remember(id: string, c: Call) {
    this.calls.set(id, c);
    if (this.calls.size > CALLS_KEPT) this.calls.delete(this.calls.keys().next().value!);
  }
}
