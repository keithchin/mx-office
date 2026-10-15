// The floor's decision-card settings (GET /api/decisions, server/decisions/): the person's Separate choices
// and the status checks run after "I've done it". Fetched for the floor on first use, again when the audit
// log says a decision changed ({t:'audit.new'} with decisions.*), and every few minutes. No per-card fetch:
// one small view per floor, read by every Needs-you surface through ui/needsyou/input.ts.

import type { DecisionSplit } from '../../../shared/decisions/types';
import type { ServerMsg } from '../../../shared/protocol';

export interface CheckView {
  kind: string;
  label: string;
  ok: boolean;
  text: string;
  at: number;
  faked?: boolean;
}

interface View {
  floor: string;
  splits: DecisionSplit[];
  admin: boolean;
  checks: Record<string, CheckView>;
}

const POLL_MS = 5 * 60_000;
let view: View | undefined;
let asked: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
const subs = new Set<() => void>();

async function refresh(floor: string) {
  try {
    const res = await fetch(`/api/decisions?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    if (!res.ok || floor !== asked) return;
    const next = (await res.json()) as View;
    if (JSON.stringify(next) === JSON.stringify(view)) return;
    setDecisionsView(next);
  } catch {
    // Next time.
  }
}

function follow(floor: string | null | undefined) {
  if (!floor || typeof fetch !== 'function' || floor === asked) return;
  asked = floor;
  view = undefined;
  void refresh(floor);
  if (!polling) {
    polling = true;
    setInterval(() => asked && void refresh(asked), POLL_MS);
  }
}

/** The floor's Separate choices as last fetched (the first call for a floor starts fetching). */
export function decisionSplits(floor: string | null | undefined): DecisionSplit[] | undefined {
  follow(floor);
  return view && view.floor === floor ? view.splits : undefined;
}

/** The status check after I've done it on an escalation, when one ran. */
export const decisionCheck = (escalation: string): CheckView | undefined => view?.checks[escalation];

/** Replaces the view with what an action answered. */
export function setDecisionsView(v: View) {
  if (asked && v.floor !== asked) return;
  view = v;
  for (const fn of subs) fn();
}

export function onDecisionsChanged(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Every message from the office: fetched again when the audit log says a decision card changed. */
export function decisionsFeedMessage(msg: ServerMsg) {
  if (!asked || msg.t !== 'audit.new' || !msg.event.action.startsWith('decisions.') || (msg.floor !== asked && msg.event.floor !== asked)) return;
  clearTimeout(timer);
  const f = asked;
  timer = setTimeout(() => void refresh(f), 300);
}
