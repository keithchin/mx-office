// The four token categories on the ledger's rows (design systems, Increment 1 measurement): input, output, cache
// read and cache write, never summed into one figure. A worker's delta since it was last booked comes from its
// session usage; when the delta goes to one row it is observed, when it's split across the session and its
// subagents it's shared out by cost (the split the ledger already uses) and marked estimated, and when there's
// no baseline to subtract from or a category went down (Claude Code's end-of-session tally replaced the
// running figure) it is missing, never 0. Pure.

import type { Usage } from '../../shared/protocol.js';
import type { RowTokens, UsageFlag } from '../../shared/budget/types.js';
import type { Piece } from './attribute.js';

export type TokenSeen = RowTokens;

export const tokensOfUsage = (u: Usage): RowTokens => ({ input: u.input || 0, output: u.output || 0, cacheRead: u.cacheRead || 0, cacheWrite: u.cacheWrite || 0 });

/** Each piece's tokens and how sure they are. `before` undefined with `fresh` false: no baseline (missing). */
export function splitTokens(before: TokenSeen | undefined, fresh: boolean, usage: Usage, pieces: readonly Piece[]): { tokens?: RowTokens; usage: UsageFlag }[] {
  const now = tokensOfUsage(usage);
  const base = before ?? (fresh ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } : undefined);
  if (!base) return pieces.map(() => ({ usage: 'missing' }));
  const d: RowTokens = { input: now.input - base.input, output: now.output - base.output, cacheRead: now.cacheRead - base.cacheRead, cacheWrite: now.cacheWrite - base.cacheWrite };
  if (Object.values(d).some((v) => v < 0)) return pieces.map(() => ({ usage: 'missing' }));
  if (pieces.length === 1) return [{ tokens: d, usage: 'observed' }];
  const total = pieces.reduce((n, p) => n + Math.max(0, p.cost), 0);
  const calls = pieces.reduce((n, p) => n + p.calls, 0);
  const share = (p: Piece) => (total > 0 ? Math.max(0, p.cost) / total : calls > 0 ? p.calls / calls : 1 / pieces.length);
  const out = pieces.map((p) => ({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as RowTokens, usage: 'estimated' as UsageFlag, s: share(p) }));
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
    let left = d[k];
    out.forEach((o, i) => {
      const v = i === out.length - 1 ? left : Math.round(d[k] * o.s);
      o.tokens[k] = Math.max(0, Math.min(v, left));
      left -= o.tokens[k];
    });
  }
  return out.map(({ tokens, usage }) => ({ tokens, usage }));
}

/** Two rows' flags merged: the less sure one wins (missing > estimated > observed). */
export function worseFlag(a: UsageFlag | undefined, b: UsageFlag | undefined): UsageFlag | undefined {
  const rank = { observed: 0, estimated: 1, missing: 2 } as const;
  if (!a) return b;
  if (!b) return a;
  return rank[a] >= rank[b] ? a : b;
}

export function addTokens(a: RowTokens | undefined, b: RowTokens | undefined): RowTokens | undefined {
  if (!a) return b && { ...b };
  if (!b) return a;
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}
