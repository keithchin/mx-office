// First-run setup's confirm-before-install, kept on the server: planning a fix hands back a random
// token, and the office keeps the plan's steps under it. Running takes only that token (single use,
// ten minutes, for whoever asked), so nothing runs that the page didn't show and the admin didn't say
// yes to, and nothing the browser sends picks a command. A run without a token is refused.

import { randomBytes } from 'node:crypto';
import type { FixId, FixStep } from '../../shared/first-run-fix.js';

const TTL_MS = 10 * 60_000;

interface Held {
  steps: FixStep[];
  owner: string;
  expiresAt: number;
}

const held = new Map<string, Held>();

/** Keeps `steps` for `owner` and gives back the token a run must carry, with when it lapses. */
export function holdPlan(steps: FixStep[], owner: string, now = Date.now()): { confirm: string; expiresAt: number } {
  for (const [k, h] of held) if (h.expiresAt <= now) held.delete(k);
  const confirm = randomBytes(18).toString('base64url');
  const expiresAt = now + TTL_MS;
  held.set(confirm, { steps, owner, expiresAt });
  return { confirm, expiresAt };
}

/**
 * The confirmed steps for `confirm` (used up), less the optional ones the admin left out; or why
 * there are none.
 */
export function takePlan(confirm: unknown, owner: string, skip: unknown = [], now = Date.now()): { steps: FixStep[] } | { error: string } {
  if (typeof confirm !== 'string' || !confirm) return { error: 'Nothing runs without a confirm: plan the fix and say yes to it first' };
  const h = held.get(confirm);
  if (!h || h.owner !== owner) return { error: 'That confirm isn’t one this office gave you (or it was used already): plan the fix again' };
  held.delete(confirm);
  if (h.expiresAt <= now) return { error: 'That confirm ran out: plan the fix again' };
  const left = new Set(Array.isArray(skip) ? (skip as FixId[]) : []);
  return { steps: h.steps.filter((s) => !(s.optional && left.has(s.id))) };
}
