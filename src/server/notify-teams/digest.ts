// A floor's daily digest for Teams (level "Needs you + daily digest"): when it's due, and what's in it.
// It goes out once per standup slot: as soon as that morning's standup is compiled, or, when none is
// (no team, standups off, nothing happened), half an hour after the slot. Pure.

import type { GhPull } from '../../shared/protocol.js';
import type { NeedItem } from '../../shared/needsyou.js';
import { isRedNeed } from '../../shared/notify-teams.js';
import { lastSlot, type StandupSchedule } from '../../shared/roster/schedule.js';
import type { SetupView } from '../../shared/wizard.js';
import type { DigestData } from './cards.js';

/** With no standup compiled, the digest goes this long after the slot. */
export const DIGEST_FALLBACK_MS = 30 * 60_000;
/** A slot older than this gets no digest (the office was off all morning: tomorrow's will do). */
export const DIGEST_GRACE_MS = 12 * 3_600_000;

/**
 * The standup slot a digest is due for now, or undefined. `compiledAt` is when the floor's latest
 * standup was compiled; `lastDigest` the slot its last digest was for.
 */
export function digestDue(now: number, schedule: StandupSchedule, compiledAt: number | undefined, lastDigest: number | undefined): number | undefined {
  const slot = lastSlot(now, schedule);
  if (slot === undefined || now - slot > DIGEST_GRACE_MS) return undefined;
  if (lastDigest !== undefined && lastDigest >= slot) return undefined;
  if (compiledAt !== undefined && compiledAt >= slot) return slot;
  return now - slot >= DIGEST_FALLBACK_MS ? slot : undefined;
}

export interface DigestInput {
  floor: string;
  project: string;
  now: number;
  pulls: readonly GhPull[];
  /** Every Needs you item on the floor (collectNeeds), already in its order. */
  needs: readonly NeedItem[];
  spent?: number;
  cap?: number;
  setup?: SetupView;
  link?: string;
}

const DAY_MS = 24 * 3_600_000;

export function buildDigest(i: DigestInput): DigestData {
  const merges = i.pulls
    .filter((p) => p.state === 'MERGED' && i.now - (Date.parse(p.updatedAt) || 0) < DAY_MS)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((p) => ({ number: p.number, title: p.title }));
  const here = i.needs.filter((n) => n.kind !== 'floor');
  const redItems = here.filter(isRedNeed);
  const red = redItems.filter((n) => n.kind !== 'escalation').map((n) => n.text);
  const st = i.setup?.show ? i.setup.stages : undefined;
  const stages = st?.length
    ? {
        passed: st.filter((s) => s.status === 'PASS' || s.status === 'WAIVED').length,
        total: st.length,
        waiting: st.filter((s) => s.status === 'MANUAL').map((s) => `Stage ${s.id}`),
        ...(i.setup?.next ? { next: i.setup.next } : {}),
      }
    : undefined;
  // The Needs you rules already put open escalations in Jeff's order (else loudest, then oldest).
  const topEscalations = here
    .filter((n) => n.kind === 'escalation')
    .slice(0, 3)
    .map((n) => ({ title: n.text, urgency: n.tag ?? '', ...(n.rank ? { rank: n.rank.n } : {}) }));
  return {
    floor: i.floor,
    project: i.project,
    merges,
    openNeeds: here.length,
    redCount: redItems.length,
    red,
    ...(i.spent !== undefined ? { spent: i.spent } : {}),
    ...(i.cap !== undefined ? { cap: i.cap } : {}),
    ...(stages ? { stages } : {}),
    topEscalations,
    ...(i.link ? { link: i.link } : {}),
  };
}
