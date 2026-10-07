// Where the team chatter's messages are read from, as adapters the chatter asks on every look: each
// returns drafts with a stable key, and the chatter keeps only the keys it hasn't seen. The roster's
// (escalations and answers, the Project Manager's decisions, standups, handoff notes, subagent reviews)
// and the team journals' (journal.ts) are built in; The Firm's interviews plug in with
// registerChatterSource (firmSource is the empty one until it does).

import type { ChatterParty } from '../../shared/chatter.js';
import { journalPath, ROLE_BY_ID, ROLES, type RoleId } from '../../shared/roster/roles.js';
import { OP_ASK } from '../../shared/roster/subagents.js';
import { roleWord, subRef } from '../../shared/roster/subagent-names.js';
import type { Escalation } from '../../shared/roster/escalation.js';
import type { Roster } from '../roster/index.js';
import { excerpt } from '../roster/journal-io.js';
import type { RosterData } from '../roster/store.js';
import type { TeamFloor } from '../roster/types.js';
import { OFFICE, type ChatterDraft } from './bus.js';
import type { ChatterState } from './store.js';

/** Nothing older than this is turned into a message (the first look at a floor fills in the last week). */
export const BACKFILL_MS = 7 * 86_400_000;

export interface SourceCtx {
  roster: Roster;
  now: number;
  state: ChatterState;
}

export interface ChatterSource {
  id: string;
  collect(floor: TeamFloor, c: SourceCtx): ChatterDraft[];
}

export const JEFF: ChatterParty = { name: 'Jeff', role: 'Router', kind: 'jeff' };
export const human = (name: string): ChatterParty => ({ name, role: 'Project Manager', kind: 'human' });

function member(d: RosterData, role: RoleId, workerId?: string, name?: string): ChatterParty {
  const m = d.members[role];
  return { name: name ?? m.name, kind: 'agent', roleId: role, ...((workerId ?? m.workerId) ? { workerId: workerId ?? m.workerId } : {}) };
}

const raiser = (e: Escalation): ChatterParty => ({ name: e.by, kind: 'agent', workerId: e.workerId, ...(e.role ? { roleId: e.role } : {}) });

/** How an escalation reads in the thread: the agent's own words, or Jeff / the office saying why they raised it. */
export function escalationDraft(e: Escalation): ChatterDraft {
  const base = { kind: 'escalation' as const, to: { group: 'pm' as const }, at: e.at, ref: { escalationId: e.id }, key: `esc:${e.id}` };
  // Jeff's and the handoff note's are raised by the office for the agent: their details say so (roster/jeff.ts, members.ts).
  if (e.details.startsWith('Jeff noticed ')) return { ...base, from: JEFF, text: `${e.by} ended its turn waiting on you: ${e.title}` };
  if (e.details.includes('The office raised this on its behalf from its handoff note')) return { ...base, from: OFFICE, text: `${e.by}'s handoff note says it's waiting on you: ${e.title}` };
  const said = [e.title, e.recommendation ? `I'd go with: ${e.recommendation}` : '', e.details].filter(Boolean).join(' — ');
  return { ...base, from: raiser(e), text: said };
}

export function answerDraft(e: Escalation): ChatterDraft | undefined {
  const r = e.resolution;
  if (!r) return undefined;
  const text = r.verdict === 'approve' ? `Approved 👍${r.text ? ` ${r.text}` : ''}` : r.verdict === 'reject' ? `Rejected: ${r.text}` : r.verdict === 'dismiss' ? 'Noted, thanks 👍' : r.text;
  // Every answer comes from the Project Manager's console or approvals (http/routes/roster.ts): a person.
  return { kind: 'answer', from: human(r.by), to: raiser(e), text, at: r.at, ref: { escalationId: e.id }, key: `ans:${e.id}` };
}

const list = (label: string, items: string[]) => (items.length ? `${label}: ${items.join('; ')}.` : '');

/** The roster's own records: nothing here is new, it's what the Team tab shows, as who said what to whom. */
export const rosterSource: ChatterSource = {
  id: 'roster',
  collect(floor, { roster, now }) {
    const d = roster.data(floor.id);
    const out: ChatterDraft[] = [];
    const recent = (at: number | undefined) => at !== undefined && now - at <= BACKFILL_MS;
    for (const e of d.escalations) {
      if (recent(e.at)) out.push(escalationDraft(e));
      if (recent(e.resolution?.at)) out.push(answerDraft(e)!);
    }
    for (const p of d.proposals) {
      if (!p.decidedBy || !recent(p.decidedAt) || p.status === 'auto' || p.status === 'pending') continue;
      const why = p.reason ? ` ${p.reason}` : '';
      const text = p.status === 'approved' ? `Approved your proposal “${p.title}”${p.issue?.number ? `, it's issue #${p.issue.number} now` : ''}.${why}` : p.status === 'rejected' ? `Not doing “${p.title}”:${why}` : `Change “${p.title}”:${why}`;
      out.push({ kind: 'answer', from: human(p.decidedBy), to: member(d, p.role, undefined, p.by), text, at: p.decidedAt, ref: { standup: p.standup }, key: `prop:${p.id}:${p.status}` });
    }
    for (const a of d.subagentActions) {
      if (a.gate !== 'propose') continue;
      const what = `${OP_ASK[a.op]} ${subRef(d.subagentNames[`${a.lead}/${a.name}`], a.name)}${a.op === 'swap-model' && a.model ? ` to ${a.model}` : ''}`;
      if (recent(a.at)) out.push({ kind: 'escalation', from: member(d, a.lead, undefined, a.by), to: { group: 'pm' }, text: `I'd like to ${what}${a.reason ? `: ${a.reason}` : ''}`, at: a.at, ref: { subagent: a.name }, key: `sa:${a.id}` });
      if (a.decidedBy && recent(a.decidedAt) && a.status !== 'pending') out.push({ kind: 'answer', from: human(a.decidedBy), to: member(d, a.lead, undefined, a.by), text: `${a.status === 'rejected' ? 'No' : 'Yes'}, ${a.status === 'rejected' ? "don't" : 'go ahead and'} ${what}.${a.decision ? ` ${a.decision}` : ''}`, at: a.decidedAt, ref: { subagent: a.name }, key: `sa-dec:${a.id}` });
    }
    for (const s of d.standups) {
      if (!recent(s.startedAt)) continue;
      const asked = [...new Set([...s.waiting, ...s.reports.filter((r) => r.source === 'live').map((r) => r.role)])].map((r) => d.members[r].name);
      out.push({ kind: 'standup', from: OFFICE, to: { group: 'team' }, text: `Standup time 📋${s.by === 'schedule' ? '' : ` (${s.by} called it)`}: what did you get done, what's next, what's in the way?${asked.length ? ` Asking ${asked.join(', ')}; the rest come from their journals.` : ' Reading everyone from their journals.'}`, at: s.startedAt, ref: { standup: s.id }, key: `su:${s.id}` });
      // A report is only stamped by the standup: one seen while it's being collected is now, an older one its compile time.
      const at = now - s.startedAt < 30 * 60_000 ? now : (s.compiledAt ?? s.startedAt);
      for (const r of s.reports) {
        if (r.source === 'none') continue;
        const said = [list('Done', r.done), list('Next', r.next), list('Blockers', r.blockers)].filter(Boolean).join(' ') || (r.heading ?? 'Nothing to report.');
        out.push({ kind: 'standup', from: member(d, r.role, undefined, r.name), to: { group: 'team' }, text: r.source === 'journal' ? `${said} (from my journal)` : said, at, ref: { standup: s.id }, key: `sr:${s.id}:${r.role}` });
      }
      const pm = d.members[d.coverage.management];
      if (s.savedTo && s.compiledAt && pm.workerId) out.push({ kind: 'standup', from: OFFICE, to: member(d, d.coverage.management), text: `Here's the ${s.id} standup page (${s.savedTo}): summarise it and commit it.`, at: s.compiledAt, ref: { standup: s.id }, key: `sc:${s.id}` });
    }
    for (const r of ROLES) {
      const m = d.members[r.id];
      if (m.handoff && recent(m.handoff.at)) {
        const [heading, ...body] = m.handoff.text.split('\n');
        const what = heading.replace(/^#+\s*/, '').replace(/^\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?[\s—–:-]*/, '') || 'Handoff';
        out.push({ kind: 'handoff', from: member(d, r.id), to: { group: 'team' }, text: `${what}: ${excerpt(body.join('\n'), 300)}`, at: m.handoff.at, ref: { journal: `${journalPath(r.team)}#${heading.replace(/^#+\s*/, '')}` }, key: `ho:${r.id}:${m.handoff.at}` });
      }
      // Hired again after a handoff: the office primes the fresh session with that note (Members.hire).
      const w = m.workerId ? floor.worker(m.workerId) : undefined;
      if (w && m.handoff && w.createdAt > m.handoff.at && recent(w.createdAt)) {
        out.push({ kind: 'handoff', from: OFFICE, to: member(d, r.id, w.id), text: `Welcome back, ${m.name}: you start fresh from your handoff note (“${m.handoff.text.split('\n')[0].replace(/^#+\s*/, '')}”).`, at: w.createdAt, key: `hire:${r.id}:${w.id}` });
      }
    }
    for (const rec of Object.values(d.subagents)) {
      const lead = d.members[rec.lead];
      for (const run of rec.runs) {
        if (!recent(run.reviewedAt) || (run.outcome !== 'accept' && run.outcome !== 'rework')) continue;
        const text = run.outcome === 'accept' ? `Accepted ✅${run.note ? ` ${run.note}` : ''}` : `Needs rework 🔁${run.note ? ` ${run.note}` : ''}`;
        out.push({ kind: 'review', from: member(d, rec.lead), to: { name: d.subagentNames[`${rec.lead}/${rec.name}`] ?? rec.name, kind: 'agent', role: `${roleWord(rec.name)} (${lead.name}'s subagent)`, team: ROLE_BY_ID.get(rec.lead)!.team }, text, at: run.reviewedAt, ref: { subagent: rec.name }, key: `rv:${rec.lead}/${rec.name}:${run.id}:${run.reviewedAt}` });
      }
    }
    return out;
  },
};

/** The Firm's interviews (src/server/firm/): nothing until its Q&A registers a source of its own. */
export const firmSource: ChatterSource = { id: 'firm', collect: () => [] };

const extra: ChatterSource[] = [];

/** Adds a source (The Firm's `office-workers firm ask/answer`, say): its drafts' keys must be stable across looks. */
export function registerChatterSource(s: ChatterSource): () => void {
  const at = extra.findIndex((x) => x.id === s.id);
  if (at >= 0) extra.splice(at, 1);
  extra.push(s);
  return () => {
    const i = extra.indexOf(s);
    if (i >= 0) extra.splice(i, 1);
  };
}

export const registeredSources = (): readonly ChatterSource[] => extra;
