// An agent's reply to a team phone message, read off its Claude Code transcript (server/convo/): the
// text it wrote after the user message that carried the person's words, up to the next thing typed to
// it. Tool calls, thinking and tool output are left out (the transcript reader already drops them);
// the Markdown stays. Pure but for reading the file.

import type { ConvoMsg } from '../../shared/protocol/convo.js';
import { TranscriptTail } from '../convo/tail.js';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The reply to the newest user message that contains `needle`: the agent's text messages after it,
 * joined, until the next user message. Undefined when no user message has the needle yet (it's still
 * held, or the turn that reads it hasn't been written); '' when it has but the agent said nothing.
 */
export function replyAfter(messages: readonly ConvoMsg[], needle: string): string | undefined {
  const n = norm(needle);
  if (!n) return undefined;
  let at = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === 'user' && norm(m.text).includes(n)) {
      at = i;
      break;
    }
  }
  if (at < 0) return undefined;
  const said: string[] = [];
  for (const m of messages.slice(at + 1)) {
    if (m.kind === 'user') break;
    if (m.kind === 'agent' && m.text.trim()) said.push(m.text.trim());
  }
  return said.join('\n\n');
}

/** replyAfter, on the last part of a transcript file; undefined when the file can't be read. */
export function replyFromFile(file: string, needle: string): string | undefined {
  const tail = new TranscriptTail(file);
  // A long turn may write more than one step: read on to the end.
  for (let i = 0; i < 8; i++) {
    const r = tail.read();
    if (!r) return undefined;
    if (!r.messages.length && !r.reset) break;
  }
  return replyAfter(tail.reader.messages, needle);
}
