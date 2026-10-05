// The standup page: what each Lead reported (live, or from its journal without waking it), their
// proposals and what the Project Manager decided, as the markdown docs/standups/<date>.md holds. Pure, so the
// tests can check the page and the proposal bookkeeping without an office.

import { randomBytes } from 'node:crypto';
import { AUTONOMY, DECISION_LABEL, needsApproval, type AutonomyLevel } from '../../shared/roster/autonomy.js';
import type { JournalEntry, ParsedProposal } from '../../shared/roster/journal.js';
import { parseStandup } from '../../shared/roster/journal.js';
import { ROLE_BY_ID, type RoleId } from '../../shared/roster/roles.js';
import type { Proposal, Standup, StandupReportView } from '../../shared/roster/types.js';

/** A standup's id: its date, or date-2, date-3… for another one the same day. */
export function standupId(date: string, taken: Iterable<string>): string {
  const ids = new Set(taken);
  if (!ids.has(date)) return date;
  for (let n = 2; ; n++) if (!ids.has(`${date}-${n}`)) return `${date}-${n}`;
}

/** A Lead's report from a journal entry (or none), and its proposals as cards for the Project Manager. */
export function reportFrom(role: RoleId, name: string, source: StandupReportView['source'], entry: JournalEntry | undefined): { report: StandupReportView; proposals: ParsedProposal[] } {
  if (!entry) return { report: { role, name, source: 'none', done: [], next: [], blockers: [] }, proposals: [] };
  const r = parseStandup(entry.body);
  // A handoff or other entry without standup sections still says something: its first lines are what it did.
  const done = r.done.length || r.next.length || r.blockers.length ? r.done : entry.body.split('\n').filter((l) => l.trim() && !l.startsWith('#')).slice(0, 3).map((l) => l.replace(/\*\*/g, '').replace(/^\s*[-*]\s+/, '').trim());
  return { report: { role, name, source, heading: entry.heading, done, next: r.next, blockers: r.blockers }, proposals: r.proposals };
}

/**
 * Turns a Lead's proposals into cards. What needs the Project Manager at `level` waits as pending; the rest the
 * team may decide itself, so it's marked auto (and becomes an issue straight away).
 */
export function toProposals(parsed: ParsedProposal[], standup: string, role: RoleId, by: string, level: AutonomyLevel): Proposal[] {
  const team = ROLE_BY_ID.get(role)!.team;
  return parsed.map((p) => ({ id: randomBytes(5).toString('hex'), standup, role, team, by, kind: p.kind, title: p.title, detail: p.detail, status: needsApproval(level, p.kind) ? 'pending' : 'auto' }));
}

const bullets = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- none');

function decision(p: Proposal): string {
  switch (p.status) {
    case 'pending':
      return '⏳ awaiting the Project Manager';
    case 'auto':
      return `✅ within the team's autonomy${p.issue?.number ? ` → #${p.issue.number}` : ''}`;
    case 'approved':
      return `✅ approved by ${p.decidedBy ?? 'the Project Manager'}${p.issue?.number ? ` → #${p.issue.number}` : p.issue?.dryRun ? ' (dry run, no issue)' : ''}`;
    case 'rejected':
      return `❌ rejected by ${p.decidedBy ?? 'the Project Manager'}: ${p.reason ?? 'no reason given'}`;
    case 'change':
      return `✏️ change requested by ${p.decidedBy ?? 'the Project Manager'}: ${p.reason ?? ''}`;
  }
}

/** The page, from the standup's reports and its proposals (by id). */
export function compilePage(s: Standup, proposals: Proposal[], level: AutonomyLevel, project: string): string {
  const mine = proposals.filter((p) => s.proposalIds.includes(p.id));
  const out = [`# Standup ${s.date} — ${project}`, '', `Run by ${s.by} · autonomy level ${level} (${AUTONOMY[level].name}) · compiled by Agent Office and summarised by the Project Coordinator for the Project Manager.`, ''];
  for (const r of s.reports) {
    const role = ROLE_BY_ID.get(r.role)!;
    const from = r.source === 'live' ? '' : r.source === 'journal' ? ' _(not at their desk: from the team journal)_' : ' _(no report and no journal entry)_';
    out.push(`## ${role.icon} ${role.title} — ${r.name}${from}`, '');
    if (r.source === 'none') {
      out.push('');
      continue;
    }
    if (r.heading && r.source === 'journal') out.push(`Latest entry: _${r.heading}_`, '');
    out.push('**Done**', bullets(r.done), '', '**Next**', bullets(r.next), '', '**Blockers**', bullets(r.blockers), '');
    const props = mine.filter((p) => p.role === r.role);
    if (props.length) out.push('**Proposals**', ...props.map((p) => `- [${p.kind}] ${p.title}${p.detail ? ` — ${p.detail}` : ''} · ${decision(p)}`), '');
  }
  const pending = mine.filter((p) => p.status === 'pending');
  out.push('## Needs the Project Manager', '', pending.length ? pending.map((p) => `- ${p.by}: ${p.title} (${DECISION_LABEL[p.kind]})`).join('\n') : '- nothing', '');
  return out.join('\n');
}
