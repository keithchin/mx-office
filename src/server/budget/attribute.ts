// Splitting one worker's spend since it was last booked into who made it (the session or one of its
// subagents) and on which model. The total is the worker manager's own delta, the very one it books into
// the office's Ledger, so the project ledger never counts a cent the office ledger doesn't; the split
// follows the transcript's per-message estimate (Usage.parts). When there's nothing to split by (Claude
// Code's end-of-session tally corrected the total, or a session from before parts were kept), it all goes
// to the session's own model.

import type { Usage } from '../../shared/protocol.js';
import type { Seen } from './ledger.js';

export interface Piece {
  /** The subagent type, or '' for the session itself. */
  sub: string;
  model: string;
  cost: number;
  calls: number;
}

type Parts = NonNullable<Usage['parts']>;

/** What changed in `after` since `before`, by part. */
function partsDelta(before: Parts | undefined, after: Parts | undefined): [string, { cost: number; calls: number }][] {
  const out: [string, { cost: number; calls: number }][] = [];
  for (const [k, v] of Object.entries(after ?? {})) {
    const b = before?.[k];
    const cost = v.cost - (b?.cost ?? 0);
    const calls = v.calls - (b?.calls ?? 0);
    if (cost > 1e-9 || calls > 0) out.push([k, { cost: Math.max(0, cost), calls: Math.max(0, calls) }]);
  }
  return out;
}

const keyOf = (k: string) => {
  const i = k.indexOf('|');
  return i < 0 ? { sub: '', model: k } : { sub: k.slice(0, i), model: k.slice(i + 1) };
};

/**
 * The worker's spend since `seen`, split. `usage` is its usage now; `fallbackModel` names the session's
 * model when the usage doesn't (the model it was hired on).
 */
export function splitDelta(seen: Seen | undefined, usage: Usage, fallbackModel: string): Piece[] {
  const cost = usage.cost - (seen?.cost ?? 0);
  const calls = usage.calls - (seen?.calls ?? 0);
  if (Math.abs(cost) < 1e-9 && calls === 0) return [];
  const main = usage.model ?? fallbackModel;
  const parts = partsDelta(seen?.parts, usage.parts);
  const partCost = parts.reduce((n, [, v]) => n + v.cost, 0);
  if (cost <= 0 || partCost <= 1e-9) return [{ sub: '', model: main, cost, calls }];
  // Each part gets its share of the authoritative delta, so the pieces always add up to it exactly.
  const pieces = parts.map(([k, v]) => ({ ...keyOf(k), cost: (cost * v.cost) / partCost, calls: v.calls }));
  // The calls the parts didn't see (rare) go to the session.
  const left = calls - pieces.reduce((n, p) => n + p.calls, 0);
  if (left > 0) {
    const own = pieces.find((p) => !p.sub && p.model === main);
    if (own) own.calls += left;
    else pieces.push({ sub: '', model: main, cost: 0, calls: left });
  }
  for (const p of pieces) if (!p.model) p.model = main;
  return pieces;
}

/** What to remember of the usage for the next delta. */
export const seenOf = (u: Usage): Seen => ({ cost: u.cost, calls: u.calls, ...(u.parts ? { parts: structuredClone(u.parts) } : {}) });

/** The issue a worker is on: its queue task's, else the one its prompt names ("Work on GitHub issue #4"). */
export function issueOf(taskIssue: number | undefined, prompt: string | undefined): number | undefined {
  if (taskIssue !== undefined) return taskIssue;
  const m = prompt ? /\bissue #(\d{1,7})\b/i.exec(prompt) : null;
  return m ? Number(m[1]) : undefined;
}
