// Change answer's requests (server/change-answer/): one decision's detail (current answer, history, linked
// work) is fetched only when a person expands its history or opens its dialog, once per revision: the
// answer is kept by floor, decision and revision, so expanding again, or opening the dialog after the
// history, fetches nothing. No card fetches anything when it's drawn. A change sent drops the decision's
// copies (its revision moved on). No DOM here, so the tests drive it.

import type { AnswerDetail, ChangeBody } from '../../../shared/change-answer';

const cache = new Map<string, Promise<AnswerDetail | string>>();
const keyOf = (floor: string, decision: string, rev: number) => `${floor}|${decision}|${rev}`;

/** The decision's detail at revision `rev`, fetched once (an error is a string, and isn't kept). */
export function loadDetail(floor: string, decision: string, rev: number): Promise<AnswerDetail | string> {
  const k = keyOf(floor, decision, rev);
  let p = cache.get(k);
  if (!p) {
    p = fetch(`/api/answers/detail?floor=${encodeURIComponent(floor)}&decision=${encodeURIComponent(decision)}`, { credentials: 'same-origin' })
      .then(async (res) => {
        const out = (await res.json().catch(() => ({}))) as AnswerDetail & { error?: string };
        return res.ok && out.decision ? out : (out.error ?? 'The office could not read it just now');
      })
      .catch(() => 'The office could not be reached');
    cache.set(k, p);
    void p.then((d) => typeof d === 'string' && cache.delete(k));
  }
  return p;
}

/** Forgets every copy of a decision (after a change, or a 409 that says it moved on). */
export function forgetDetail(floor: string, decision: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${floor}|${decision}|`)) cache.delete(k);
}

export type ChangeOutcome = { ok: true; rev: number; note?: string; detail?: AnswerDetail } | { ok: false; status: number; error: string };

/** Send change: the new answer, with the revision the dialog showed (a 409 when it changed meanwhile). */
export async function sendChange(body: ChangeBody): Promise<ChangeOutcome> {
  try {
    const res = await fetch('/api/answers/change', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as { rev?: number; note?: string; detail?: AnswerDetail; error?: string };
    forgetDetail(body.floor, body.decision);
    if (!res.ok || typeof out.rev !== 'number') return { ok: false, status: res.status, error: out.error ?? 'The office could not do that just now' };
    if (out.detail) cache.set(keyOf(body.floor, body.decision, out.detail.rev), Promise.resolve(out.detail));
    return { ok: true, rev: out.rev, ...(out.note ? { note: out.note } : {}), ...(out.detail ? { detail: out.detail } : {}) };
  } catch {
    return { ok: false, status: 0, error: 'The office could not be reached' };
  }
}

/** The decision as it is now, whatever revision it's at (after a 409): fetched, then kept at its own revision. */
export async function freshDetail(floor: string, decision: string): Promise<AnswerDetail | string> {
  forgetDetail(floor, decision);
  const d = await loadDetail(floor, decision, -1);
  cache.delete(keyOf(floor, decision, -1));
  if (typeof d !== 'string') cache.set(keyOf(floor, decision, d.rev), Promise.resolve(d));
  return d;
}
