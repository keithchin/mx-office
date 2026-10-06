// A Claude Code session transcript (its JSONL, one entry a line) turned into the conversation the
// Command Center's Chat view shows (ConvoMsg, shared/protocol/convo.ts): what a person typed, the
// agent's replies, each tool call as a one-line summary with how it went, and AskUserQuestion. Pure:
// it's fed text and keeps what it has made, so the file can be read a piece at a time (tail.ts).
//
// What it leaves out: subagents' sidechains, Claude Code's own bookkeeping (meta lines, hook output,
// slash-command echoes, file history, cost), thinking, and the bodies of tool results, of which only
// a short preview of why one failed is kept, never what a tool printed or read.

import type { ConvoMsg, ConvoToolStatus } from '../../shared/protocol/convo.js';

/** The most messages it keeps: the browser shows the last 200, with "Show earlier" for the rest. */
export const MAX_MESSAGES = 400;
/** A message's text is cut to this much (a huge pasted log stays readable). */
export const MAX_TEXT = 12_000;
/** A failed tool's preview (why it failed), in characters. */
export const PREVIEW_CHARS = 160;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const base = (p: unknown) => (typeof p === 'string' && p ? (p.split(/[\\/]/).pop() ?? p) : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** A tool call in a few words, the way a person would say what the agent did: "Ran npm test". */
export function toolSummary(name: string, input: any): { summary: string; target?: string } {
  const i = input && typeof input === 'object' ? input : {};
  const file = base(i.file_path ?? i.notebook_path ?? i.path);
  switch (name) {
    case 'Bash':
    case 'PowerShell':
    {
      // The command itself when it's short; its description when it's a long one.
      const cmd = oneLine(str(i.command) ?? '');
      const said = str(i.description) ? oneLine(i.description) : '';
      return { summary: cmd && (cmd.length <= 60 || !said) ? `Ran ${clip(cmd, 90)}` : said ? clip(said, 90) : 'Ran a command' };
    }
    case 'Read':
    case 'NotebookRead':
      return { summary: `Read ${file ?? 'a file'}`, target: file };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { summary: `Edited ${file ?? 'a file'}`, target: file };
    case 'Write':
      return { summary: `Wrote ${file ?? 'a file'}`, target: file };
    case 'Grep':
      return { summary: `Searched for ${clip(oneLine(str(i.pattern) ?? '…'), 60)}` };
    case 'Glob':
      return { summary: `Listed ${clip(str(i.pattern) ?? 'files', 60)}` };
    case 'WebFetch':
      return { summary: `Fetched ${clip(str(i.url) ?? 'a page', 70)}` };
    case 'WebSearch':
      return { summary: `Searched the web for ${clip(oneLine(str(i.query) ?? '…'), 60)}` };
    case 'Task':
    case 'Agent':
      return { summary: `Asked a subagent: ${clip(oneLine(str(i.description) ?? str(i.prompt) ?? 'a task'), 70)}` };
    case 'TodoWrite':
      return { summary: 'Updated its to-do list' };
    default: {
      const detail = str(i.description) ?? str(i.command) ?? str(i.query) ?? file;
      const label = name.startsWith('mcp__') ? name.split('__').slice(1).join(' ') : name;
      return { summary: detail ? `${label}: ${clip(oneLine(detail), 70)}` : `Used ${label}` };
    }
  }
}

/** A tool result's text: a string, or its text blocks. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b: any) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n');
  return '';
}

/** The text a person typed in a user entry, or undefined for a tool result or Claude Code's own. */
function typed(l: any): string | undefined {
  if (l.isMeta || l.isCompactSummary) return undefined;
  const c = l.message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some((b: any) => b?.type === 'tool_result') ? c.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n') : undefined;
  if (typeof text !== 'string' || !text.trim()) return undefined;
  // Slash-command echoes, hook and system notes, and "[Request interrupted…]" are the CLI's own.
  if (/^\s*(<[a-z-]+>|\[Request interrupted|Caveat:)/i.test(text)) return undefined;
  return text;
}

const timeOf = (l: any) => {
  const t = typeof l.timestamp === 'string' ? Date.parse(l.timestamp) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

/**
 * The conversation so far, fed the transcript a piece at a time. `feed` returns the messages it made
 * or changed (a reply that grew, a tool whose result came in), for the browsers already showing the rest.
 */
export class TranscriptReader {
  private readonly list: ConvoMsg[] = [];
  private readonly byId = new Map<string, ConvoMsg>();
  /** The end of the last piece, when it stopped mid-line. */
  private rest = '';

  /** Everything it has, oldest first. */
  get messages(): readonly ConvoMsg[] {
    return this.list;
  }

  /** Takes the next piece of the file; a line cut off at its end waits for the rest. */
  feed(chunk: string): ConvoMsg[] {
    const text = this.rest + chunk;
    const lines = text.split('\n');
    this.rest = lines.pop() ?? '';
    const changed = new Map<string, ConvoMsg>();
    for (const line of lines) {
      if (!line.trim()) continue;
      let l: any;
      try {
        l = JSON.parse(line);
      } catch {
        continue;
      }
      for (const m of this.entry(l)) changed.set(m.id, m);
    }
    return [...changed.values()];
  }

  private put(m: ConvoMsg): ConvoMsg {
    const had = this.byId.get(m.id);
    if (had) {
      Object.assign(had, m);
      return had;
    }
    this.list.push(m);
    this.byId.set(m.id, m);
    if (this.list.length > MAX_MESSAGES) for (const old of this.list.splice(0, this.list.length - MAX_MESSAGES)) this.byId.delete(old.id);
    return m;
  }

  private entry(l: any): ConvoMsg[] {
    if (!l || typeof l !== 'object' || l.isSidechain) return [];
    const at = timeOf(l);
    if (l.type === 'user') {
      const text = typed(l);
      if (text !== undefined) return [this.put({ id: String(l.uuid ?? `u${this.list.length}`), kind: 'user', text: clip(text, MAX_TEXT), ...(at ? { at } : {}) })];
      const c = l.message?.content;
      if (!Array.isArray(c)) return [];
      return c.filter((b: any) => b?.type === 'tool_result' && typeof b.tool_use_id === 'string').flatMap((b: any) => this.result(b));
    }
    if (l.type !== 'assistant' || !Array.isArray(l.message?.content)) return [];
    const out: ConvoMsg[] = [];
    const mid = String(l.message.id ?? l.uuid ?? `a${this.list.length}`);
    for (const b of l.message.content) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        // One reply with several blocks is logged a line per block, under one message id.
        const id = `${mid}:text`;
        const had = this.byId.get(id);
        const joined = had?.kind === 'agent' ? `${had.text}\n\n${b.text}` : b.text;
        out.push(this.put({ id, kind: 'agent', text: clip(joined, MAX_TEXT), ...(at ? { at } : {}) }));
      } else if (b?.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
        if (b.name === 'AskUserQuestion') {
          const q = Array.isArray(b.input?.questions) ? b.input.questions[0] : b.input;
          const options = Array.isArray(q?.options) ? q.options.map((o: any) => (typeof o === 'string' ? o : str(o?.label) ?? '')).filter(Boolean).slice(0, 8) : [];
          out.push(this.put({ id: b.id, kind: 'ask', question: clip(str(q?.question) ?? 'The agent is asking you something', 600), options, answered: false, ...(at ? { at } : {}) }));
        } else {
          const { summary, target } = toolSummary(b.name, b.input);
          out.push(this.put({ id: b.id, kind: 'tool', tool: b.name, summary, status: 'running', ...(target ? { target } : {}), ...(at ? { at } : {}) }));
        }
      }
    }
    return out;
  }

  private result(b: any): ConvoMsg[] {
    const m = this.byId.get(b.tool_use_id);
    if (!m) return [];
    if (m.kind === 'ask') return [this.put({ ...m, answered: true })];
    if (m.kind !== 'tool') return [];
    const status: ConvoToolStatus = b.is_error ? 'error' : 'ok';
    // Only a failure says why, in a line: what a tool printed or read (a file, a page) stays in the office.
    const text = b.is_error ? oneLine(resultText(b.content)) : '';
    const preview = text ? clip(text, PREVIEW_CHARS) : undefined;
    return [this.put({ ...m, status, ...(preview ? { preview } : {}) })];
  }
}
