// What the console's Chat view (view.ts) draws, worked out without the DOM so a test can check it:
// a conversation taking in the office's updates, its tool calls folded into compact rows ("Edited 3
// files"), and the plain text of a terminal for workers with no transcript to read.

import type { ConvoMsg, ConvoToolStatus } from '../../../../shared/protocol/convo';

export type ToolMsg = Extract<ConvoMsg, { kind: 'tool' }>;

/** A worker's conversation as the page has it. */
export interface Convo {
  available: boolean;
  reason?: string;
  messages: ConvoMsg[];
}

/** The most messages the page keeps for one worker (the view draws the last 200 of them at first). */
export const KEEP = 400;

/** Takes in an update: a message whose id is already there replaces it in place, a new one goes on the end. */
export function upsert(list: ConvoMsg[], update: readonly ConvoMsg[], keep = KEEP): ConvoMsg[] {
  const at = new Map(list.map((m, i) => [m.id, i]));
  const out = list.slice();
  for (const m of update) {
    const i = at.get(m.id);
    if (i === undefined) {
      at.set(m.id, out.length);
      out.push(m);
    } else out[i] = m;
  }
  return out.length > keep ? out.slice(out.length - keep) : out;
}

/** One row of the chat: a message, or a run of tool calls of one kind shown as one line. */
export type ChatItem = { kind: 'msg'; id: string; msg: Exclude<ConvoMsg, ToolMsg> } | { kind: 'tools'; id: string; label: string; status: ConvoToolStatus; tools: ToolMsg[] };

/** The tools whose runs fold into one row, and how that row says it. */
const FOLD: Record<string, { group: string; many: (n: number) => string }> = {
  Edit: { group: 'edit', many: (n) => `Edited ${n} files` },
  MultiEdit: { group: 'edit', many: (n) => `Edited ${n} files` },
  NotebookEdit: { group: 'edit', many: (n) => `Edited ${n} files` },
  Write: { group: 'write', many: (n) => `Wrote ${n} files` },
  Read: { group: 'read', many: (n) => `Read ${n} files` },
  Grep: { group: 'search', many: (n) => `Ran ${n} searches` },
  Glob: { group: 'search', many: (n) => `Ran ${n} searches` },
};

/** A run's status: failed if any failed, else running if any is, else ok. */
const worst = (tools: readonly ToolMsg[]): ConvoToolStatus => (tools.some((t) => t.status === 'error') ? 'error' : tools.some((t) => t.status === 'running') ? 'running' : 'ok');

/** The label of a folded run: "Edited a.ts" for one file, "Edited 3 files" for several. */
function runLabel(tools: readonly ToolMsg[]): string {
  const fold = FOLD[tools[0].tool];
  if (!fold || tools.length === 1) return tools[0].summary;
  if (fold.group === 'search') return fold.many(tools.length);
  const files = new Set(tools.map((t) => t.target ?? t.id));
  return files.size === 1 ? tools[0].summary : fold.many(files.size);
}

/** The conversation as rows: each tool call a row of its own, except runs of edits, reads or searches, folded. */
export function chatItems(messages: readonly ConvoMsg[]): ChatItem[] {
  const out: ChatItem[] = [];
  for (const m of messages) {
    if (m.kind !== 'tool') {
      out.push({ kind: 'msg', id: m.id, msg: m });
      continue;
    }
    const last = out[out.length - 1];
    const group = FOLD[m.tool]?.group;
    if (group && last?.kind === 'tools' && FOLD[last.tools[0].tool]?.group === group) {
      last.tools.push(m);
      last.label = runLabel(last.tools);
      last.status = worst(last.tools);
    } else out.push({ kind: 'tools', id: m.id, label: m.summary, status: m.status, tools: [m] });
  }
  return out;
}

/** The terminal's escape sequences (colors, cursor moves, titles) and other control characters, gone. */
export function stripAnsi(s: string): string {
  return (
    s
      // OSC (a title, a link): ESC ] … BEL or ESC \
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // CSI: ESC [ params final
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      // Any other two-character escape (charset, keypad mode)
      .replace(/\x1b[()#][0-9A-Za-z]|\x1b[@-_]/g, '')
      // What's left of the C0 controls, but tabs and line breaks
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
  );
}

/** A terminal's lines as plain text for the Chat view's fallback: no escapes, no trailing blanks, at most one empty line in a row. */
export function screenText(lines: readonly string[]): string {
  const out: string[] = [];
  for (const raw of lines) {
    const line = stripAnsi(raw).replace(/\r/g, '').replace(/\s+$/, '');
    if (!line && (!out.length || !out[out.length - 1])) continue;
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join('\n');
}
