// What the Overview's Needs you card (./needs-card.ts) says, worked out without the page so the tests can
// check it: an escalation as a full card (its tag in words as well as colour, who raised it, the question,
// the options with the recommendation marked, why), a merged pull request that isn't verified as its own
// card with its three ways out, and every other actionable item (an agent asking, a ✋ sign-off, an
// approval…) as a row with a tag. And the answer each button sends, through the escalation's existing
// answer action (ui/pm/escalations.ts answer → the team's `escalation` action).

import { TRIGGER_LABEL } from '../../../shared/roster/autonomy';
import type { Escalation } from '../../../shared/roster/escalation';
import { ROLE_BY_ID } from '../../../shared/roster/roles';
import type { NeedItem, NeedKind } from '../needsyou/logic';

/** The tag's colour; every tag says what it is in words too. */
export type Tone = 'block' | 'normal' | 'verify' | 'later' | 'done';

export interface EscOption {
  /** A, B, C… */
  key: string;
  text: string;
  recommended: boolean;
}

export interface EscModel {
  id: string;
  kind: 'escalation' | 'verify';
  tag: string;
  tone: Tone;
  title: string;
  /** "Dylan · Lead Developer · via Ada · 18m ago · a design change" */
  meta: string;
  /** The question, in a paragraph (the details' first). */
  question?: string;
  options: EscOption[];
  /** "Why A: …", or "Recommends: …" when the recommendation names no option. */
  why?: { label: string; text: string };
}

/** "PR #79 merged, not verified: …": the escalation Testing raises for a merged task its checks didn't verify (server/roster/task-verify.ts). */
export const isNotVerified = (e: Pick<Escalation, 'title'>): boolean => /^PR #\d+ merged, not verified/.test(e.title);

const KEYS = 'ABCDEFGH';
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Which option the recommendation picks: the same words, or a recommendation that starts with (or names) an option. -1 for none. */
export function recommendedIndex(options: readonly string[], rec: string | undefined): number {
  if (!rec) return -1;
  const r = norm(rec);
  const exact = options.findIndex((o) => norm(o) === r);
  if (exact >= 0) return exact;
  const starts = options.findIndex((o) => norm(o) && r.startsWith(norm(o)));
  if (starts >= 0) return starts;
  const letter = r.match(/^(?:option\s+)?([a-h])\b/);
  if (letter && options.length > KEYS.indexOf(letter[1].toUpperCase())) return KEYS.indexOf(letter[1].toUpperCase());
  return options.findIndex((o) => norm(o).length > 3 && r.includes(norm(o)));
}

/** The first paragraph of `s`, at most about 320 characters. */
export function firstParagraph(s: string): string | undefined {
  const p = s.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((x) => x.replace(/\s+/g, ' ').trim()).find(Boolean);
  if (!p) return undefined;
  return p.length > 320 ? `${p.slice(0, 310).replace(/\s+\S*$/, '')}…` : p;
}

export interface EscContext {
  /** The team's lead (whoever covers Management), when it isn't the one who raised it: "via Ada". */
  leadName?: string;
  /** "18m ago", for when it was raised. */
  ago(at: number): string;
}

export function escalationModel(e: Escalation, c: EscContext): EscModel {
  const verify = isNotVerified(e);
  const role = e.role ? ROLE_BY_ID.get(e.role) : undefined;
  const loud = e.urgency === 'urgent' || e.urgency === 'critical' || e.trigger === 'blocked' || e.trigger === 'blocked-no-path';
  const rec = recommendedIndex(e.options, e.recommendation);
  const options = e.options.map((text, i) => ({ key: KEYS[i] ?? String(i + 1), text, recommended: i === rec }));
  const via = c.leadName && c.leadName !== e.by ? `via ${c.leadName}` : undefined;
  const meta = [e.by + (role ? ` · ${role.title}` : ''), via, c.ago(e.at), !verify && e.trigger ? TRIGGER_LABEL[e.trigger] : undefined].filter(Boolean).join(' · ');
  let why: EscModel['why'];
  if (e.recommendation && !verify) {
    const opt = rec >= 0 ? options[rec] : undefined;
    const rest = opt && norm(e.recommendation).startsWith(norm(opt.text)) ? e.recommendation.slice(opt.text.length).replace(/^[\s:;,.—–-]+/, '').trim() : e.recommendation.trim();
    if (opt && rest && norm(rest) !== norm(opt.text)) why = { label: `Why ${opt.key}:`, text: rest };
    else if (!opt) why = { label: 'Recommends:', text: rest };
  }
  return {
    id: e.id,
    kind: verify ? 'verify' : 'escalation',
    tag: verify ? 'Not verified' : loud ? 'Blocking' : 'Decision',
    tone: verify ? 'verify' : loud ? 'block' : 'normal',
    title: e.title,
    meta,
    question: firstParagraph(e.details),
    options,
    why,
  };
}

/**
 * What Send answer sends: your own words when you wrote some, else the option picked ("Go with: …", as
 * the escalation cards always put it). Undefined when there's nothing to send (no options, nothing written).
 */
export function answerFor(m: Pick<EscModel, 'options'>, pick: string | undefined, note: string): { verdict: 'reply'; text: string } | undefined {
  const own = note.trim();
  if (own) return { verdict: 'reply', text: own };
  const o = m.options.find((x) => x.key === pick) ?? m.options.find((x) => x.recommended) ?? undefined;
  return o ? { verdict: 'reply', text: `Go with: ${o.text}` } : undefined;
}

/** The three ways out of "merged, not verified", as the answer each sends (the escalation's own options). */
export function verifyAnswer(how: 'rerun' | 'back', note = ''): { verdict: 'reply'; text: string } {
  if (how === 'rerun') return { verdict: 'reply', text: 'Go with: Re-run checks' };
  const own = note.trim();
  return { verdict: 'reply', text: `Go with: Send back for rework${own ? `. ${own}` : ''}` };
}

const ROW_TAG: Record<NeedKind, string> = {
  asking: 'Asking you',
  finished: 'To review',
  lost: 'Fix',
  escalation: 'Decision',
  approval: 'To approve',
  idle: 'Idle',
  paused: 'Paused',
  pr: 'Failing checks',
  setup: 'Sign-off',
  live: 'Live app',
  floor: 'Elsewhere',
  audit: 'Audit',
  studio: 'Studio Pro',
  incident: 'Incident',
  budget: 'Budget',
  stuck: 'Stuck',
  fyi: 'FYI',
  offmain: 'Not on main',
  assumption: 'Consent',
  advisory: 'Advisory',
  review: 'Review',
  questions: 'Questions',
};

export interface RowModel {
  key: string;
  tag: string;
  tone: Tone;
  text: string;
}

/** An item that isn't an escalation, as a row: its tag (in words and colour) and its sentence. */
export function rowModel(n: NeedItem): RowModel {
  const tag = n.kind === 'setup' && n.key.startsWith('setup-') && n.key !== 'setup-stale' ? '✋ Sign-off' : n.kind === 'incident' && n.tag ? `Incident ${n.tag}` : ROW_TAG[n.kind];
  return { key: n.key, tag, tone: n.kind === 'floor' || n.level === 'info' ? 'later' : n.level === 'block' ? 'block' : 'normal', text: n.text };
}
