// Reading a team journal (docs/team/<team>.md): dated `## YYYY-MM-DD …` entries, newest at the bottom.
// A standup entry has `### Done`, `### Next`, `### Blockers` and `### Proposals` sections; a handoff
// note (written before a Lead is benched) is an entry whose heading says "Handoff". The office reads
// journals instead of asking agents, so a benched or sleeping Lead is summarised without waking it.

import { isDecisionKind, type DecisionKind } from './autonomy.js';

export interface JournalEntry {
  heading: string;
  /** YYYY-MM-DD from the heading. */
  date: string;
  body: string;
}

const ENTRY = /^##\s+(?!#)(.*\b(\d{4}-\d{2}-\d{2})\b.*)$/;

/** Every dated entry, in file order. Text before the first entry (the journal's title) is skipped. */
export function parseJournal(text: string): JournalEntry[] {
  const out: JournalEntry[] = [];
  let cur: JournalEntry | undefined;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const m = ENTRY.exec(line);
    if (m) {
      if (cur) out.push(finish(cur));
      cur = { heading: m[1].trim(), date: m[2], body: '' };
    } else if (cur) cur.body += `${line}\n`;
  }
  if (cur) out.push(finish(cur));
  return out;
}
const finish = (e: JournalEntry): JournalEntry => ({ ...e, body: e.body.trim() });

/** The latest entry, or the latest whose heading matches `kind` ("standup", "handoff"), optionally on `date`. */
export function latestEntry(entries: JournalEntry[], kind?: string, date?: string): JournalEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (kind && !e.heading.toLowerCase().includes(kind.toLowerCase())) continue;
    if (date && e.date !== date) continue;
    return e;
  }
  return undefined;
}

export interface ParsedProposal {
  kind: DecisionKind;
  title: string;
  detail: string;
}

export interface StandupReport {
  done: string[];
  next: string[];
  blockers: string[];
  proposals: ParsedProposal[];
}

/** The `### Section` bullet lists of an entry, by lower-cased section name. */
function sections(body: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let cur: string[] | undefined;
  for (const raw of body.split('\n')) {
    const h = /^###\s+(.+?)\s*$/.exec(raw);
    if (h) {
      cur = [];
      out.set(h[1].toLowerCase().replace(/[^a-z]/g, ''), cur);
      continue;
    }
    const item = /^\s*[-*]\s+(.*\S)\s*$/.exec(raw);
    if (cur && item && !/^(none|n\/a|nothing)\.?$/i.test(item[1])) cur.push(item[1]);
  }
  return out;
}

/**
 * A proposal line: `[design] Title — why`, `[kind] Title: why`, or plain `Title` (a task). An unknown
 * kind in brackets is kept as part of the title, so nothing a Lead wrote is lost.
 */
export function parseProposal(line: string): ParsedProposal | undefined {
  let rest = line.trim();
  let kind: DecisionKind = 'task';
  const k = /^\[([a-z-]+)\]\s*(.*)$/i.exec(rest);
  if (k && isDecisionKind(k[1].toLowerCase())) {
    kind = k[1].toLowerCase() as DecisionKind;
    rest = k[2];
  }
  const split = /^(.*?)\s+(?:—|–|--)\s+(.*)$/.exec(rest) ?? /^([^:]{3,120}):\s+(.*)$/.exec(rest);
  const title = (split ? split[1] : rest).replace(/\*\*/g, '').trim().slice(0, 120);
  if (!title) return undefined;
  return { kind, title, detail: (split ? split[2] : '').trim().slice(0, 1000) };
}

export function parseStandup(body: string): StandupReport {
  const s = sections(body);
  const get = (...names: string[]) => names.flatMap((n) => s.get(n) ?? []);
  return {
    done: get('done', 'yesterday'),
    next: get('next', 'today', 'nextsteps'),
    blockers: get('blockers', 'blocked'),
    proposals: get('proposals', 'proposal').map(parseProposal).filter((p): p is ParsedProposal => !!p),
  };
}

/** What a GitHub issue for an approved proposal says, and which labels it carries. */
export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
}

/** An approved proposal as a GitHub issue on the board, labelled with the team that proposed it. */
export function proposalIssue(p: { title: string; detail: string; kind: DecisionKind; team: string; by: string; standup: string }, approvedBy: string, level: number, note?: string): IssueDraft {
  return {
    title: p.title,
    body: [
      p.detail || '_No detail given._',
      '',
      `Proposed by ${p.by} (${p.team} team) at the ${p.standup} standup, as ${p.kind === 'task' ? 'a task' : `a ${p.kind} change`}.`,
      `Approved by ${approvedBy} in Agent Office at autonomy level ${level}.${note ? `\n\nProject Manager's note: ${note}` : ''}`,
    ].join('\n'),
    labels: [`team:${p.team}`],
  };
}
