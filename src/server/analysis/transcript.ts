// What a Claude Code session's transcript says about how a run went: when it started and stopped,
// how long the agent actually worked, its API and tool calls, what it cost, and how often a person
// had to type something before its pull request was opened. The spend is read by the same tracker
// the office keeps each worker's usage with (usage.ts), so the two always agree.

import { existsSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newTracker, scanTrackerStep, trackerUsage, type UsageTracker } from '../usage.js';
import type { RunTokens } from '../../shared/analysis.js';

export interface SessionStats {
  model?: string;
  startedAt?: number;
  endedAt?: number;
  activeMs: number;
  apiCalls: number;
  toolCalls: number;
  tokens: RunTokens;
  cost: number;
  /** When a person typed into it after the first prompt (not the office's own notes). */
  humanPromptsAt: number[];
  /** When Claude Code first linked a pull request to the session, if it did. */
  prLinkedAt?: number;
  prLinked?: number;
  /** The agent's last words, for the analyzer's note when there's no PR description. */
  lastText?: string;
}

/** Where Claude Code keeps a project's sessions: the folder's path with every non-alphanumeric as '-'. */
export const projectsDir = () => path.join(os.homedir(), '.claude', 'projects');
export const encodeProjectDir = (dir: string) => path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-');

/**
 * The transcript of a session: under the folder it ran in when that's known, else wherever it is
 * (a worker that changed directory logs under that folder instead).
 */
export function findTranscript(sessionId: string | undefined, cwd?: string): string | undefined {
  if (!sessionId || !/^[\w-]{8,80}$/.test(sessionId)) return undefined;
  const root = projectsDir();
  if (cwd) {
    const guess = path.join(root, encodeProjectDir(cwd), `${sessionId}.jsonl`);
    if (existsSync(guess)) return guess;
  }
  try {
    for (const d of readdirSync(root)) {
      const f = path.join(root, d, `${sessionId}.jsonl`);
      if (existsSync(f)) return f;
    }
  } catch {
    // no Claude projects folder at all
  }
  return undefined;
}

/** The office's own prompts to a worker (carry on after a restart, a queue's nudge) aren't a person stepping in. */
const OFFICE_NOTE = /^(<|\[|Caveat:)|the office restarted|carry on where you left off/i;

/** A user line that a person typed: plain text, not a tool's result or Claude Code's own bookkeeping. */
function typedText(line: any): string | undefined {
  if (line?.type !== 'user' || line.isMeta || line.isSidechain) return undefined;
  const c = line.message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some((b: any) => b?.type === 'tool_result') ? c.find((b: any) => b?.type === 'text')?.text : undefined;
  return typeof text === 'string' && text.trim() ? text : undefined;
}

/** What a session's own lines add up to so far, taken a line at a time (see SessionReader). */
class SessionTally {
  startedAt?: number;
  endedAt?: number;
  activeMs = 0;
  prLinkedAt?: number;
  prLinked?: number;
  lastText?: string;
  humanPromptsAt: number[] = [];
  private tools = new Set<string>();
  private prompts = 0;

  take(line: any) {
    const at = typeof line?.timestamp === 'string' ? Date.parse(line.timestamp) : NaN;
    if (Number.isFinite(at)) {
      this.startedAt = Math.min(this.startedAt ?? at, at);
      this.endedAt = Math.max(this.endedAt ?? at, at);
    }
    // Claude Code notes how long each turn took: added up, that's the time the agent spent working.
    if (line?.type === 'system' && line.subtype === 'turn_duration' && !line.isSidechain && typeof line.durationMs === 'number') this.activeMs += line.durationMs;
    if (line?.type === 'pr-link' && typeof line.prNumber === 'number' && this.prLinkedAt === undefined && Number.isFinite(at)) {
      this.prLinkedAt = at;
      this.prLinked = line.prNumber;
    }
    if (line?.type === 'assistant' && Array.isArray(line.message?.content)) {
      // A message with several blocks is logged once per block: a tool call is counted by its own id.
      for (const b of line.message.content) {
        if (b?.type === 'tool_use') this.tools.add(typeof b.id === 'string' ? b.id : `${line.uuid}:${this.tools.size}`);
        if (b?.type === 'text' && typeof b.text === 'string' && !line.isSidechain) this.lastText = b.text;
      }
    }
    const typed = typedText(line);
    if (typed !== undefined) {
      this.prompts++;
      // The first is the task itself.
      if (this.prompts > 1 && !OFFICE_NOTE.test(typed.trim()) && Number.isFinite(at)) this.humanPromptsAt.push(at);
    }
  }

  get toolCalls() {
    return this.tools.size;
  }
}

/**
 * A session's transcript (and its subagents'), read once and then only what's appended: the analyzer
 * records a run again at every turn's end and every open PR's refresh, and reading a long session
 * whole (tens of MB with its subagents) held the event loop for up to a second each time.
 */
export class SessionReader {
  private tracker: UsageTracker = newTracker();
  private tally = new SessionTally();

  constructor(readonly transcript: string) {
    this.tracker.transcript = transcript;
  }

  /** Reads up to `maxBytes` more (all of it when not given). True once it has read to the end. */
  step(maxBytes?: number): boolean {
    const main = this.tracker.files[this.transcript]?.offset ?? 0;
    let size = 0;
    try {
      size = statSync(this.transcript).size;
    } catch {
      return true;
    }
    if (size < main) {
      // Shorter than what was read: not the file it was. Start over.
      this.tracker = newTracker();
      this.tracker.transcript = this.transcript;
      this.tally = new SessionTally();
    }
    return scanTrackerStep(this.tracker, { maxBytes, onLine: (l) => this.tally.take(l) }).done;
  }

  stats(): SessionStats {
    const usage = trackerUsage(this.tracker);
    const t = this.tally;
    const stats: SessionStats = {
      model: usage.model,
      activeMs: t.activeMs,
      apiCalls: usage.calls,
      toolCalls: t.toolCalls,
      tokens: { input: usage.input, output: usage.output, cacheWrite: usage.cacheWrite, cacheRead: usage.cacheRead },
      cost: usage.cost,
      humanPromptsAt: [...t.humanPromptsAt],
      ...(t.startedAt !== undefined ? { startedAt: t.startedAt } : {}),
      ...(t.endedAt !== undefined ? { endedAt: t.endedAt } : {}),
      ...(t.prLinkedAt !== undefined ? { prLinkedAt: t.prLinkedAt, prLinked: t.prLinked } : {}),
      ...(t.lastText !== undefined ? { lastText: t.lastText } : {}),
    };
    // An old transcript without turn timings: the wall clock is the best there is.
    if (!stats.activeMs && stats.startedAt !== undefined && stats.endedAt !== undefined) stats.activeMs = stats.endedAt - stats.startedAt;
    return stats;
  }
}

/** A whole session read at once, from the start (the CLI's backfill and the tests). */
export function readSession(transcript: string): SessionStats {
  const r = new SessionReader(transcript);
  r.step();
  return r.stats();
}

/** How much a session read takes before it lets the event loop go on: a few milliseconds of parsing. */
export const SESSION_STEP_BYTES = 512 * 1024;
const KEEP_READERS = 100;
const readers = new Map<string, SessionReader>();

/**
 * The session as readSession gives it, for the live office: each transcript's reader is kept, so only
 * what was appended since the last look is read, and that a slice at a time with the event loop free
 * in between (a session read for the first time can be tens of MB).
 */
export async function readSessionLive(transcript: string, stepBytes = SESSION_STEP_BYTES): Promise<SessionStats> {
  let r = readers.get(transcript);
  if (r) readers.delete(transcript);
  else r = new SessionReader(transcript);
  // Newest last: the oldest goes when there are too many.
  readers.set(transcript, r);
  if (readers.size > KEEP_READERS) readers.delete(readers.keys().next().value!);
  while (!r.step(stepBytes)) await new Promise<void>((done) => setImmediate(done));
  return r.stats();
}
