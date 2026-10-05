// An agent's last words when its turn ends, for Jeff's "is it waiting on you?" judgement. Claude Code's
// Stop hook carries them (`last_assistant_message`), and providers/claude.ts notes them here; a turn
// that ended without one (an older Claude Code, another provider's hook) falls back to the end of the
// session's transcript.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const MAX_CHARS = 16_000;
/** How much of a transcript's end is read for its last assistant message. */
const TAIL_BYTES = 512 * 1024;

const lastWords = new Map<string, { text: string; at: number }>();

/** From the Stop hook: what the agent said last. */
export function noteLastWords(workerId: string, text: unknown, now = Date.now()) {
  if (typeof text !== 'string' || !text.trim()) return;
  lastWords.set(workerId, { text: text.slice(-MAX_CHARS), at: now });
}

/** What the Stop hook said last for this worker, if within `maxAgeMs`. */
export function lastWordsOf(workerId: string, maxAgeMs = 10 * 60_000, now = Date.now()): string | undefined {
  const w = lastWords.get(workerId);
  return w && now - w.at <= maxAgeMs ? w.text : undefined;
}

export function forgetLastWords(workerId: string) {
  lastWords.delete(workerId);
}

/** The text of the last main-thread assistant message in a transcript's tail (its text blocks, joined). */
export function lastAssistantText(jsonl: string): string | undefined {
  let id: string | undefined;
  let parts: string[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"assistant"')) continue;
    let l: any;
    try {
      l = JSON.parse(line);
    } catch {
      continue;
    }
    if (l?.type !== 'assistant' || l.isSidechain || !Array.isArray(l.message?.content)) continue;
    const texts = l.message.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text as string);
    if (!texts.length) continue;
    // A message with several blocks is logged once per block, under one message id.
    const mid = typeof l.message.id === 'string' ? l.message.id : undefined;
    if (mid && mid === id) parts.push(...texts);
    else parts = texts;
    id = mid;
  }
  const text = parts.join('\n').trim();
  return text ? text.slice(-MAX_CHARS) : undefined;
}

/** The last assistant message in the transcript file, reading only its end. */
export function lastAssistantTextOf(file: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return lastAssistantText(buf.toString('utf8'));
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
