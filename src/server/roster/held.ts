// The prompts the office promised to type into an agent once its turn is over (deliver.ts holds them:
// an agent's `office-workers tell`, a person's phone reply, the Project Manager's subagent decisions),
// kept in the roster file (roster/<floor>.json `held`) like the relays' outbox, so a restart doesn't
// lose them. Each has an id, its idempotency key: holding the same prompt again keeps the one, and it
// leaves the list only once it's actually typed (or woken with). One that waited past its expiry (24
// hours unless the sender said otherwise) is dropped, with a line in the activity and the audit log.
//
// Only the onSent callbacks live in memory (Delivery keeps them by id): after a restart a held prompt
// still goes in, but whoever asked to hear when it did (the phone's "typed" tick) isn't told.

import { createHash } from 'node:crypto';
import type { Origin } from './deliver.js';

/** How long a held prompt waits for its agent's turn to end before it's let go. */
export const HELD_TTL_MS = 24 * 60 * 60 * 1000;
/** The most a floor keeps (the oldest go first): an agent stuck in a dialog mustn't grow it for ever. */
export const HELD_KEPT = 200;
/** The longest held prompt kept (office-workers tell takes 20000). */
const TEXT_MAX = 20_000;

export interface HeldPrompt {
  /** Idempotency key: the sender's, or one made from who it's for, who from and what it says. */
  id: string;
  workerId: string;
  origin: Origin;
  /** Who it's from, for the terminal's "last typed by". */
  by?: string;
  text: string;
  createdAt: number;
  /** When it's let go if it still hasn't gone in. */
  expiresAt: number;
}

/** The id a held prompt gets when its sender gave none: the same prompt to the same agent is the same one. */
export function heldId(workerId: string, origin: Origin, text: string, by = ''): string {
  return `h-${createHash('sha256').update(`${workerId}\0${origin}\0${by}\0${text}`).digest('hex').slice(0, 16)}`;
}

const ORIGINS: readonly Origin[] = ['person', 'office', 'agent'];
const str = (v: unknown, n: number) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);

/** The held prompts as they were saved, made whole: a bad one is dropped, a repeated id kept once. */
export function reviveHeld(raw: unknown): HeldPrompt[] {
  if (!Array.isArray(raw)) return [];
  const out: HeldPrompt[] = [];
  const ids = new Set<string>();
  for (const h of raw) {
    if (!h || typeof h !== 'object') continue;
    const r = h as Partial<HeldPrompt>;
    const id = str(r.id, 200);
    const workerId = str(r.workerId, 64);
    const text = str(r.text, TEXT_MAX);
    if (!id || !workerId || !text || ids.has(id) || !ORIGINS.includes(r.origin as Origin)) continue;
    const createdAt = typeof r.createdAt === 'number' ? r.createdAt : 0;
    const by = str(r.by, 200);
    ids.add(id);
    out.push({ id, workerId, origin: r.origin as Origin, ...(by ? { by } : {}), text, createdAt, expiresAt: typeof r.expiresAt === 'number' ? r.expiresAt : createdAt + HELD_TTL_MS });
  }
  return out.slice(-HELD_KEPT);
}

/** Adds a held prompt unless one with its id is already waiting. True when it was added. */
export function holdOnce(list: HeldPrompt[], h: HeldPrompt): boolean {
  if (list.some((x) => x.id === h.id)) return false;
  list.push({ ...h, text: h.text.slice(0, TEXT_MAX) });
  if (list.length > HELD_KEPT) list.splice(0, list.length - HELD_KEPT);
  return true;
}
