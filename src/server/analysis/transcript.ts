// What a Claude Code session's transcript says about how a run went: when it started and stopped,
// how long the agent actually worked, its API and tool calls, what it cost, and how often a person
// had to type something before its pull request was opened. The spend is read by the same tracker
// the office keeps each worker's usage with (usage.ts), so the two always agree.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newTracker, scanTracker, trackerUsage } from '../usage.js';
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

export function readSession(transcript: string): SessionStats {
  const tracker = newTracker();
  tracker.transcript = transcript;
  scanTracker(tracker);
  const usage = trackerUsage(tracker);
  const stats: SessionStats = {
    model: usage.model,
    activeMs: 0,
    apiCalls: usage.calls,
    toolCalls: 0,
    tokens: { input: usage.input, output: usage.output, cacheWrite: usage.cacheWrite, cacheRead: usage.cacheRead },
    cost: usage.cost,
    humanPromptsAt: [],
  };
  let raw = '';
  try {
    raw = readFileSync(transcript, 'utf8');
  } catch {
    return stats;
  }
  const tools = new Set<string>();
  let prompts = 0;
  for (const text of raw.split('\n')) {
    if (!text) continue;
    let line: any;
    try {
      line = JSON.parse(text);
    } catch {
      continue;
    }
    const at = typeof line?.timestamp === 'string' ? Date.parse(line.timestamp) : NaN;
    if (Number.isFinite(at)) {
      stats.startedAt = Math.min(stats.startedAt ?? at, at);
      stats.endedAt = Math.max(stats.endedAt ?? at, at);
    }
    // Claude Code notes how long each turn took: added up, that's the time the agent spent working.
    if (line?.type === 'system' && line.subtype === 'turn_duration' && !line.isSidechain && typeof line.durationMs === 'number') stats.activeMs += line.durationMs;
    if (line?.type === 'pr-link' && typeof line.prNumber === 'number' && stats.prLinkedAt === undefined && Number.isFinite(at)) {
      stats.prLinkedAt = at;
      stats.prLinked = line.prNumber;
    }
    if (line?.type === 'assistant' && Array.isArray(line.message?.content)) {
      // A message with several blocks is logged once per block: a tool call is counted by its own id.
      for (const b of line.message.content) {
        if (b?.type === 'tool_use') tools.add(typeof b.id === 'string' ? b.id : `${line.uuid}:${tools.size}`);
        if (b?.type === 'text' && typeof b.text === 'string' && !line.isSidechain) stats.lastText = b.text;
      }
    }
    const typed = typedText(line);
    if (typed !== undefined) {
      prompts++;
      // The first is the task itself.
      if (prompts > 1 && !OFFICE_NOTE.test(typed.trim()) && Number.isFinite(at)) stats.humanPromptsAt.push(at);
    }
  }
  stats.toolCalls = tools.size;
  // An old transcript without turn timings: the wall clock is the best there is.
  if (!stats.activeMs && stats.startedAt !== undefined && stats.endedAt !== undefined) stats.activeMs = stats.endedAt - stats.startedAt;
  return stats;
}
