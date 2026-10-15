// Transcript evidence for a dispatch (Slice 1B-1, plan §2.3): did the typed message itself reach the
// agent's session? Read only the session file the dispatch recorded before typing, from the offset it
// recorded, a bounded amount, off the event loop (fs/promises). Only an entry of type `user` whose typed
// text (convo/transcript.ts `typed`: not a tool result, not Claude Code's own meta lines, not a
// subagent's sidechain) carries the dispatch's payload, with the marker as the payload's own last line,
// counts. Assistant messages, tool results, quoted text and other sessions prove nothing, even when they
// contain the marker. A missing, shortened (rotated) or unreadable file is `unavailable`, never inferred.

import { promises as fsp } from 'node:fs';
import { typed } from '../convo/transcript.js';
import type { DispatchRecord } from '../../shared/dispatch.js';

/** The most of a transcript one check reads after the recorded offset. */
export const EVIDENCE_MAX_BYTES = 8 * 1024 * 1024;

export type Evidence = { found: true; at?: string } | { found: false; why: 'no-match' | 'unavailable'; note: string };

/** Line endings and trailing spaces evened out, as a terminal may change them. */
const norm = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n');

/** Whether `text` holds `block` as whole lines: starting at a line's start, ending at a line's end. */
export function holdsBlock(text: string, block: string): boolean {
  const t = norm(text);
  const b = norm(block).trim();
  if (!b) return false;
  let from = 0;
  for (;;) {
    const i = t.indexOf(b, from);
    if (i < 0) return false;
    const end = i + b.length;
    if ((i === 0 || t[i - 1] === '\n') && (end === t.length || t[end] === '\n')) return true;
    from = i + 1;
  }
}

/** Whether one transcript line is the typed message carrying `r`'s payload in `r`'s session. */
export function isTypedEvidence(line: string, r: Pick<DispatchRecord, 'payload' | 'marker' | 'sessionId'>): boolean {
  let l: any;
  try {
    l = JSON.parse(line);
  } catch {
    return false;
  }
  if (!l || typeof l !== 'object' || l.type !== 'user' || l.isSidechain) return false;
  if (r.sessionId && typeof l.sessionId === 'string' && l.sessionId !== r.sessionId) return false;
  const text = typed(l);
  if (text === undefined) return false;
  // The marker must be the payload's last line (it is by construction); a payload without it proves nothing.
  if (!norm(r.payload).trim().endsWith(r.marker)) return false;
  // The whole entry as typed: the office's notes before it are kept, so the raw text is what's searched.
  const raw = typeof l.message?.content === 'string' ? l.message.content : Array.isArray(l.message?.content) ? l.message.content.filter((b: any) => b?.type === 'text').map((b: any) => String(b.text ?? '')).join('\n') : text;
  return holdsBlock(raw, r.payload);
}

/** Reads the recorded session from the recorded offset and looks for the typed message. */
export async function transcriptEvidence(r: Pick<DispatchRecord, 'payload' | 'marker' | 'sessionId' | 'transcriptPath' | 'transcriptOffset'>, max = EVIDENCE_MAX_BYTES): Promise<Evidence> {
  if (!r.transcriptPath || r.transcriptOffset === undefined) return { found: false, why: 'unavailable', note: 'no transcript was recorded for this session' };
  let h: fsp.FileHandle | undefined;
  try {
    h = await fsp.open(r.transcriptPath, 'r');
    const size = (await h.stat()).size;
    if (size < r.transcriptOffset) return { found: false, why: 'unavailable', note: 'the transcript is shorter than when the answer was sent (rotated or replaced)' };
    const len = Math.min(size - r.transcriptOffset, max);
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const { bytesRead } = await h.read(buf, got, len - got, r.transcriptOffset + got);
      if (bytesRead <= 0) break;
      got += bytesRead;
    }
    const text = buf.subarray(0, got).toString('utf8');
    for (const line of text.split('\n')) {
      if (line.trim() && isTypedEvidence(line, r)) return { found: true };
    }
    return { found: false, why: 'no-match', note: size - r.transcriptOffset > max ? 'not in the part of the transcript read' : 'no typed message with the marker in the session' };
  } catch (err) {
    return { found: false, why: 'unavailable', note: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'the transcript is gone' : "the transcript couldn't be read" };
  } finally {
    await h?.close().catch(() => undefined);
  }
}

/** The text of an assistant entry: its text blocks and its tool calls' input (an `office-workers escalate` reply included). */
function assistantText(l: any): string {
  const c = l?.message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.map((b: any) => (b?.type === 'text' ? String(b.text ?? '') : b?.type === 'tool_use' ? JSON.stringify(b.input ?? '') : '')).join('\n');
}

/**
 * Acknowledged (Slice 1B-4): the dispatch's typed message is in its recorded session AND a later assistant
 * turn in that same session cites `citation` (`ESC-<id> rev <n>`), in its words or in a tool call (its
 * escalation reply). An assistant turn merely following the answer is not enough; another session, a
 * sidechain, or the citation before the typed message proves nothing. Off the event loop, bounded like
 * transcriptEvidence; a missing file is simply not acknowledged.
 */
export async function citedAfter(r: Pick<DispatchRecord, 'payload' | 'marker' | 'sessionId' | 'transcriptPath' | 'transcriptOffset'>, citation: string, max = EVIDENCE_MAX_BYTES): Promise<boolean> {
  if (!r.transcriptPath || r.transcriptOffset === undefined || !citation) return false;
  let h: fsp.FileHandle | undefined;
  try {
    h = await fsp.open(r.transcriptPath, 'r');
    const size = (await h.stat()).size;
    if (size < r.transcriptOffset) return false;
    const len = Math.min(size - r.transcriptOffset, max);
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const { bytesRead } = await h.read(buf, got, len - got, r.transcriptOffset + got);
      if (bytesRead <= 0) break;
      got += bytesRead;
    }
    let typedSeen = false;
    const needle = citation.toLowerCase();
    for (const line of buf.subarray(0, got).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      if (!typedSeen) {
        typedSeen = isTypedEvidence(line, r);
        continue;
      }
      let l: any;
      try {
        l = JSON.parse(line);
      } catch {
        continue;
      }
      if (!l || l.type !== 'assistant' || l.isSidechain) continue;
      if (r.sessionId && typeof l.sessionId === 'string' && l.sessionId !== r.sessionId) continue;
      if (citesExactly(assistantText(l).toLowerCase(), needle)) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    await h?.close().catch(() => undefined);
  }
}

/** Whether `text` holds `needle` with no digit straight after it ("rev 2" is not "rev 21"). */
export function citesExactly(text: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const i = text.indexOf(needle, from);
    if (i < 0) return false;
    if (!/[0-9]/.test(text[i + needle.length] ?? '')) return true;
    from = i + 1;
  }
}
