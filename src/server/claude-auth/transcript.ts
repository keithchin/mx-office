// How an agent's last turn ended, read off the end of its Claude Code transcript: Claude Code writes a
// synthetic assistant entry when the API refuses a request (isApiErrorMessage, with `error` naming why:
// authentication_failed for a key or sign-in it rejected, "Invalid API key · Fix external API key" on the
// screen). The office's hooks don't hear that turn end (no Stop fires on an API error), so this is how it
// knows. Pure.

export type TurnVerdict = { kind: 'auth-failed' | 'ok'; at: number };

/** The words of an authentication failure, for a Claude Code that doesn't name the error yet. */
const AUTH_WORDS = /invalid api key|authentication_failed|authentication_error|oauth token has expired|oauth token (was )?revoked|please run \/login/i;

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : '')).join('\n');
}

/**
 * The last main-conversation assistant entry in `tail` (the end of a transcript; a cut-off first line is
 * skipped): an authentication failure, a real answer (ok), or nothing to say (another API error, nothing yet).
 */
export function lastVerdict(tail: string): TurnVerdict | undefined {
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    let e: Record<string, any>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e?.type !== 'assistant' || e.isSidechain) continue;
    const at = Date.parse(e.timestamp) || 0;
    if (e.isApiErrorMessage) {
      if (e.error === 'authentication_failed' || AUTH_WORDS.test(textOf(e.message?.content))) return { kind: 'auth-failed', at };
      // A rate limit, an overload, a bad request: nothing about the credentials either way.
      return undefined;
    }
    // Claude Code's own placeholders ("No response requested.") aren't the API answering.
    if (e.message?.model === '<synthetic>') continue;
    return { kind: 'ok', at };
  }
  return undefined;
}
