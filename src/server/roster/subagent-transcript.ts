// The Leads' subagent runs as a Claude Code transcript tells them, for when the hooks didn't (an office
// restart mid-run, a hook that never got through, a background run finishing, which no hook reports):
// the Agent (Task) call going out (an assistant tool_use), its answer coming back or its background
// launch (the user tool_result, with Claude Code's toolUseResult), and a background run's
// <task-notification> when it's done. Sidechain lines (the subagent's own conversation) are skipped.
// Pure: fed the transcript's text a piece at a time, it hands back the signals for subagent-runs.ts.

import type { LiveSignal } from './subagent-runs.js';

const TOOLS = new Set(['Agent', 'Task']);
const clip = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, n) : undefined);
const tag = (text: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(text)?.[1]?.trim() || undefined;

export class SubagentTranscript {
  /** The Agent calls seen, so their answers are known for what they are. */
  private readonly calls = new Set<string>();
  /** The end of the last piece, when it stopped mid-line. */
  private rest = '';

  /** Takes the next piece of the transcript; a line cut off at its end waits for the rest. */
  feed(chunk: string): LiveSignal[] {
    const lines = (this.rest + chunk).split('\n');
    this.rest = lines.pop() ?? '';
    const out: LiveSignal[] = [];
    for (const line of lines) {
      if (!line.includes('Agent') && !line.includes('Task') && !line.includes('task-notification') && !line.includes('toolUseResult')) continue;
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
  }

  private entry(l: any): LiveSignal[] {
    if (!l || typeof l !== 'object' || l.isSidechain) return [];
    const at = Date.parse(l.timestamp);
    if (!Number.isFinite(at)) return [];
    if (l.type === 'queue-operation') return l.operation === 'enqueue' && typeof l.content === 'string' ? notification(l.content, at) : [];
    const content = l.message?.content;
    if (l.type === 'user' && typeof content === 'string') return notification(content, at);
    if (!Array.isArray(content)) return [];
    const out: LiveSignal[] = [];
    for (const b of content) {
      if (l.type === 'assistant' && b?.type === 'tool_use' && TOOLS.has(b.name) && typeof b.id === 'string') {
        this.calls.add(b.id);
        const i = b.input ?? {};
        out.push({ kind: 'dispatch', at, toolUseId: b.id, agent: clip(i.subagent_type, 60), task: clip(i.description, 120) ?? clip(i.prompt, 120), model: clip(i.model, 40), ...(i.run_in_background === true ? { background: true } : {}) });
      } else if (l.type === 'user' && b?.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        const r = l.toolUseResult && typeof l.toolUseResult === 'object' ? l.toolUseResult : undefined;
        const agentish = !!r && (typeof r.agentId === 'string' || typeof r.totalDurationMs === 'number');
        if (!this.calls.has(b.tool_use_id) && !agentish) continue;
        if (r && (r.status === 'async_launched' || r.isAsync === true)) {
          out.push({ kind: 'launched', at, toolUseId: b.tool_use_id, agentId: clip(r.agentId, 80), task: clip(r.description, 120), model: clip(r.resolvedModel, 60) });
        } else {
          out.push({ kind: 'result', at, toolUseId: b.tool_use_id, failed: b.is_error === true || r?.status === 'failed', ...(typeof r?.totalDurationMs === 'number' ? { durationMs: r.totalDurationMs } : {}) });
        }
      } else if (l.type === 'user' && b?.type === 'text' && typeof b.text === 'string') {
        out.push(...notification(b.text, at));
      }
    }
    return out;
  }
}

/** A background task's <task-notification>: for a subagent run, the run reporting it's over. */
function notification(text: string, at: number): LiveSignal[] {
  if (!text.includes('<task-notification>')) return [];
  const status = tag(text, 'status');
  if (!status || status === 'running') return [];
  return [{ kind: 'notified', at, agentId: clip(tag(text, 'task-id'), 80), toolUseId: clip(tag(text, 'tool-use-id'), 80), failed: status !== 'completed' }];
}
