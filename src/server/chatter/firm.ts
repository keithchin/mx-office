// The Firm's interviews as chatter (firm/desk.ts): a reviewer's question to the Lead it went to,
// that Lead's answer back, or the office saying nobody could answer. Read off the engagements the
// Firm keeps (its questions, not its prompts), each question and answer one message by its key.
// A seeded sample engagement is skipped: nobody said any of it.

import type { ChatterParty } from '../../shared/chatter.js';
import type { Engagement } from '../../shared/firm/engagement.js';
import { REVIEWER_BY_ID } from '../../shared/firm/roles.js';
import { ROLE_BY_ID, type RoleId } from '../../shared/roster/roles.js';
import { OFFICE, type ChatterDraft } from './bus.js';
import { BACKFILL_MS, type ChatterSource } from './sources.js';

function reviewerParty(e: Engagement, id: string): ChatterParty {
  const r = REVIEWER_BY_ID.get(id as never);
  const name = e.reviewers.find((x) => x.id === id)?.name ?? r?.name ?? id;
  return { name, kind: 'reviewer', role: r ? `${r.title}, The Firm` : 'The Firm', reviewer: id };
}

function leadParty(to: NonNullable<Engagement['questions'][number]['to']>): ChatterParty {
  const role = ROLE_BY_ID.get(to.role as RoleId);
  return { name: to.name, kind: 'agent', ...(role ? { roleId: role.id } : {}), ...(to.workerId ? { workerId: to.workerId } : {}) };
}

/** One engagement's questions and answers as drafts (newer than `since`). */
export function interviewDrafts(e: Engagement, since: number): ChatterDraft[] {
  if (e.sample) return [];
  const out: ChatterDraft[] = [];
  for (const q of e.questions) {
    const rev = reviewerParty(e, q.reviewer);
    const ref = { engagement: e.id };
    if (q.at >= since) {
      out.push({ kind: 'firm', from: rev, to: q.to ? leadParty(q.to) : { group: 'team' }, text: q.text, at: q.at, ref, key: `firm:${e.id}:${q.id}:q` });
    }
    const at = q.answeredAt ?? q.at;
    if (at < since) continue;
    if (q.status === 'answered' && q.to && q.answer) {
      out.push({ kind: 'firm', from: leadParty(q.to), to: rev, text: q.answer, at, ref, key: `firm:${e.id}:${q.id}:a` });
    } else if (q.status === 'unanswered') {
      out.push({ kind: 'firm', from: OFFICE, to: rev, text: `Nobody could answer ${q.id}: ${q.why ?? 'no one to ask'}.`, at, ref, key: `firm:${e.id}:${q.id}:a` });
    }
  }
  return out;
}

/** The Firm's interviews on each floor; `list` is the Firm's engagements (firm/adapter.ts firmOf). */
export function firmSource(list: () => Engagement[]): ChatterSource {
  return {
    id: 'firm',
    collect(floor, { now }) {
      let all: Engagement[];
      try {
        all = list();
      } catch {
        return [];
      }
      return all.filter((e) => e.floor === floor.id).flatMap((e) => interviewDrafts(e, now - BACKFILL_MS));
    },
  };
}
