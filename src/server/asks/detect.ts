// What the surfaced asks' look finds besides AWAITING-PM items (server/asks/service.ts): one detector per
// kind of thing the Project Manager would otherwise only hear of by asking. Pure: the service hands it
// what was read everywhere (sources.ts) and what main.ts worked out of main and the branches.
//   - offmain (S6): agents' journals, standups and handoffs on branches not merged, older than a day.
//   - assumption (S7): PROJECT.md decisions ASSUMED without the Project Manager's (or client's) consent.
//   - advisory (S8): the toolkit's gate advisories (.claude/.gate-advisories), printed only to an agent.
//   - review (S8): BRDs whose review status is draft or pending, and design artifacts, ready for review.
//   - gate: the review gate's cards (server/review-gate/), worked out by main.ts and passed through.
//   - claims: the claims check's card (server/claims/), worked out by main.ts and passed through.

import type { AskAct, AskItem, BranchStandup } from '../../shared/asks.js';
import { askedOf, claimsTell } from '../../shared/claims.js';
import type { Read } from './sources.js';

export const ADVISORIES = '.claude/.gate-advisories';
export const PROJECT_MD = 'PROJECT.md';
/** The files the detectors read from every place (besides the team journals). */
export const DETECT_FILES: string[] = [PROJECT_MD, ADVISORIES];

/** Docs-type changes older than this on a branch not on main are worth a row. */
export const OFFMAIN_MS = 24 * 3_600_000;

/** An agent branch ahead of main (main.ts). */
export interface AheadBranch {
  who: string;
  branch: string;
  sha: string;
  /** Commits on it that main hasn't. */
  commits: number;
  /** Those that change docs/team, docs/standups or a handoff, and when the oldest of them was made (ms). */
  docs: number;
  oldestDocsAt?: number;
}

/** A BRD's file and text, and where it was read. */
export interface BrdText {
  file: string;
  text: string;
}

export interface DetectInput {
  reads: readonly Read[];
  now: number;
  /** Main's PROJECT.md. */
  mainProject?: string;
  ahead?: readonly AheadBranch[];
  /** Whoever covers Management, for the button's words. */
  lead?: string;
  /** The lead's newest standup on its branch when it's newer than main's (main.ts). */
  standup?: BranchStandup;
  /** BRDs on main and in the worktrees, and the design artifacts there (paths). */
  brds?: readonly BrdText[];
  design?: readonly string[];
  /** The review gate's info cards (server/review-gate/): PRs that skipped review, direct and force pushes, baseline resets and waivers. */
  gate?: readonly AskItem[];
  /** The claims check's card (server/claims/): claims of applied model changes or passing tests that git doesn't back. */
  claims?: readonly AskItem[];
}

export interface Detected {
  items: AskItem[];
  standup?: BranchStandup;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// ---- S6: work that never reached main ------------------------------------------------------------------

export function offMain(ahead: readonly AheadBranch[], now: number, lead = 'the lead'): AskItem | undefined {
  const old = ahead.filter((b) => b.docs > 0 && b.oldestDocsAt !== undefined && now - b.oldestDocsAt >= OFFMAIN_MS);
  if (!old.length) return undefined;
  const n = old.reduce((x, b) => x + b.docs, 0);
  const per = old.map((b) => `${b.who}: ${b.commits} commit${b.commits === 1 ? '' : 's'}`);
  return {
    id: `offmain-${hash(old.map((b) => `${b.branch}@${b.sha}`).join('|'))}`,
    kind: 'offmain',
    level: 'info',
    text: `${n} agent update${n === 1 ? " isn't" : "s aren't"} on main (standups, journals, handoffs) · ${per.join(' · ')}`,
    since: Math.min(...old.map((b) => b.oldestDocsAt!)),
    lines: old.map((b) => `${b.who} (${b.branch}): ${b.commits} commits ahead, ${b.docs} with docs`),
    acts: [{ act: 'docs-pr', label: `Ask ${lead} to open a docs PR` }, { act: 'seen', label: 'Hide' }],
  };
}

/** The "Blocked on you" lines of a standup page: its section's bullets, or the bullets after a **Blocked on you** label. */
export function blockedOnYouOf(page: string): string[] {
  const lines = page.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let on = false;
  for (const l of lines) {
    if (/^#{1,6}\s+Blocked on you\b/i.test(l) || /^\s*[-*]?\s*\*\*Blocked on you\*\*/i.test(l)) {
      on = true;
      const rest = l.replace(/^.*Blocked on you\**\s*[:—-]?\s*/i, '').trim();
      if (rest && !/^(none|nothing)\.?$/i.test(rest)) out.push(rest);
      continue;
    }
    if (!on) continue;
    if (/^#{1,6}\s/.test(l) || /^\s*\*\*[^*]+\*\*/.test(l)) break;
    const b = /^\s*[-*]\s+(.*\S)/.exec(l);
    // The summary's next label ("- **Next** …") ends it.
    if (b && /^\*\*[^*]+\*\*/.test(b[1])) break;
    if (b && !/^(none|nothing)\.?$/i.test(b[1])) out.push(b[1]);
    else if (l.trim() && !b) break;
  }
  return out;
}

// ---- S7: assumptions without your consent --------------------------------------------------------------

export interface Assumption {
  stage: string;
  decision: string;
  notes: string;
}

const NO_CONSENT = /\b(not asked|wasn't asked|was not asked|without asking|never asked|not consulted|hasn't answered|has not answered|not answered|no answer|did not object|didn't object|no objection|not confirmed|unconfirmed|to be (re-?)?confirmed)\b/i;
const CONSENT = /\bconsent(?:By|At|ed)?\b|\byou decide\b|\bexplicitly cho(?:se|sen)\b|\b(?:chose|approved|agreed|accepted|confirmed by)\b|use assumption/i;

/** Whether an ASSUMED row's notes record a person's consent (the toolkit's consentBy/consentAt, or plain words for it). */
export const hasConsent = (notes: string) => !NO_CONSENT.test(notes) && CONSENT.test(notes);

/** PROJECT.md's Decisions rows whose Status starts with ASSUMED and that have no consent. */
export function assumptionsWithoutConsent(text: string): Assumption[] {
  const out: Assumption[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let inDecisions = false;
  let cols: string[] | undefined;
  for (const l of lines) {
    if (/^##\s/.test(l)) {
      inDecisions = /^##\s+Decisions\b/i.test(l);
      cols = undefined;
      continue;
    }
    if (!inDecisions || !l.trim().startsWith('|')) {
      if (!l.trim().startsWith('|')) cols = undefined;
      continue;
    }
    const cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
    if (!cols) {
      cols = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    const st = cols.findIndex((c) => c === 'status');
    const dec = cols.findIndex((c) => c === 'decision');
    const notes = cols.findIndex((c) => /^notes?$|consent|by/.test(c));
    if (st < 0 || dec < 0) continue;
    if (!/^\s*ASSUMED\b/i.test(cells[st] ?? '')) continue;
    const n = notes >= 0 ? (cells[notes] ?? '') : cells.filter((_, i) => i !== st && i !== dec).join(' ');
    if (hasConsent(`${cells[st]} ${n}`)) continue;
    out.push({ stage: (cells[0] ?? '').replace(/[`*]/g, ''), decision: cells[dec].replace(/[`*]/g, ''), notes: n });
  }
  return out;
}

const key = (a: Assumption) => a.decision.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);

export function assumptions(mainProject: string | undefined, reads: readonly Read[]): AskItem | undefined {
  const copies = [mainProject, ...reads.map((r) => r.files.get(PROJECT_MD))].filter((t): t is string => !!t);
  if (!copies.length) return undefined;
  // A row any copy records consent for is settled; a row only a worktree has is new, and counts too.
  const consented = new Set<string>();
  const found = new Map<string, Assumption>();
  for (const t of copies) {
    const flagged = assumptionsWithoutConsent(t);
    for (const a of flagged) if (!found.has(key(a))) found.set(key(a), a);
    for (const l of t.split('\n')) if (/\bASSUMED\b/.test(l) && hasConsent(l)) consented.add(l.toLowerCase().replace(/[^a-z0-9]+/g, ' '));
  }
  const list = [...found.values()].filter((a) => ![...consented].some((c) => c.includes(key(a))));
  if (!list.length) return undefined;
  const n = list.length;
  return {
    id: `assumed-${hash(list.map(key).join('|'))}`,
    kind: 'assumption',
    level: 'warn',
    text: `${n} assumption${n === 1 ? '' : 's'} made without your consent: ${list.map((a) => clip(`${a.stage ? `Stage ${a.stage}: ` : ''}${a.decision}`, 90)).join('; ')}`,
    lines: list.map((a) => `${a.stage ? `Stage ${a.stage}: ` : ''}${a.decision}${a.notes ? ` (${clip(a.notes, 160)})` : ''}`),
    acts: [{ act: 'agree', label: 'Agree' }, { act: 'discuss', label: 'Discuss' }],
  };
}

// ---- S8: gate advisories and what's ready for review ------------------------------------------------------

/** An advisory key in words (bin/gate-check.sh's advise calls). */
export function advisoryWords(k: string): string {
  if (k === 'source-sufficiency') return 'Source sufficiency not established';
  if (k === 'source-ledger') return 'Source files not yet accounted for (blocks Stage 1)';
  const st = /^stage(\w+)$/i.exec(k);
  if (st) return `Stage ${st[1].toUpperCase()} not complete`;
  return k;
}

export function advisories(reads: readonly Read[], lead = 'the lead'): AskItem[] {
  const out: AskItem[] = [];
  for (const r of reads) {
    const text = r.files.get(ADVISORIES);
    if (!text) continue;
    const where = r.place.kind === 'checkout' ? 'the project folder' : `${r.place.who}'s copy`;
    for (const k of new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[\w.-]{1,60}$/.test(l)))) {
      out.push({
        id: `adv-${hash(`${k}@${r.place.kind}:${r.place.who}`)}`,
        kind: 'advisory',
        level: 'warn',
        text: `Gate advisory in ${where}: ${advisoryWords(k)} (${k})`,
        acts: [{ act: 'ask-lead', label: `Ask ${lead}` }, { act: 'seen', label: 'Mark as seen' }],
      });
    }
  }
  return out;
}

/** Whether a BRD waits for a person's review: its reviewStatus, or any use case's, is draft or pending. */
export function brdPending(text: string): boolean {
  try {
    const j = JSON.parse(text) as { reviewStatus?: unknown; useCases?: { reviewStatus?: unknown }[] };
    const open = (v: unknown) => typeof v === 'string' && /^(draft|pending)$/i.test(v.trim());
    return open(j.reviewStatus) || (Array.isArray(j.useCases) && j.useCases.some((u) => open(u?.reviewStatus)));
  } catch {
    return false;
  }
}

export function readyForReview(brds: readonly BrdText[], design: readonly string[]): AskItem | undefined {
  const pending = [...new Set(brds.filter((b) => brdPending(b.text)).map((b) => b.file.split('/').pop()!))].sort();
  const files = [...new Set(design)].sort();
  const system = files.some((f) => /(^|\/)design-system\.html$/i.test(f));
  const proto = files.some((f) => /(^|\/)prototype\.html$/i.test(f));
  const wires = files.filter((f) => /(^|\/)wireframes\/[^/]+\.html$/i.test(f)).map((f) => f.split('/').pop()!);
  const wireN = new Set(wires).size;
  const parts = [pending.length ? `${pending.length} BRD${pending.length === 1 ? '' : 's'}` : '', system ? 'design system' : '', proto ? 'prototype' : '', wireN ? `${wireN} wireframe${wireN === 1 ? '' : 's'}` : ''].filter(Boolean);
  if (!parts.length) return undefined;
  return {
    id: `review-${hash([...pending, ...files].join('|'))}`,
    kind: 'review',
    level: 'info',
    text: `Ready for your review: ${parts.join(', ')}`,
    lines: [...pending.map((p) => `BRD ${p}`), ...files],
    acts: [{ act: 'documents', label: 'Documents' }, { act: 'seen', label: 'Mark as seen' }],
  };
}

// ---- All of them ----------------------------------------------------------------------------------------

/** Everything the look found. */
export function detectAsks(i: DetectInput): Detected {
  const items: AskItem[] = [];
  const consent = assumptions(i.mainProject, i.reads);
  if (consent) items.push(consent);
  items.push(...advisories(i.reads, i.lead));
  const off = offMain(i.ahead ?? [], i.now, i.lead);
  if (off) items.push(off);
  const review = readyForReview(i.brds ?? [], i.design ?? []);
  if (review) items.push(review);
  items.push(...(i.gate ?? []));
  items.push(...(i.claims ?? []));
  return { items, ...(i.standup ? { standup: i.standup } : {}) };
}

/** What a button sends whoever covers Management, as the Project Manager. */
export function actMessage(act: AskAct, it: AskItem, by: string, now = Date.now()): string | undefined {
  const date = new Date(now).toISOString().slice(0, 10);
  const list = (it.lines ?? [it.text]).map((l, n) => `${n + 1}. ${l}`).join('\n');
  switch (act) {
    case 'docs-pr':
      return `The Project Manager asks: agents' journals, standups and handoffs are not on main yet, so the office and the other Leads can't see them:\n${list}\nOpen a docs-only pull request with those pages (docs/team, docs/standups and the handoffs), or ask their Leads to, so they reach main today.`;
    case 'agree':
      return `The Project Manager (${by}) agrees with these assumptions:\n${list}\nRecord the consent in PROJECT.md's Decisions: keep each row ASSUMED and add consentBy: ${by} and consentAt: ${date} to its notes (the toolkit's consent fields), in your next docs pull request.`;
    case 'discuss':
      return `The Project Manager (${by}) wants to discuss these assumptions before agreeing:\n${list}\nRaise them with office-workers escalate: one escalation, each assumption a numbered question with the options, the risk if it's wrong and your recommendation.`;
    case 'ask-lead':
      if (it.kind === 'claims') return claimsTell(askedOf(it.acts.find((a) => a.act === 'ask-lead')?.label), it.lines ?? [it.text]);
      if (it.kind === 'gate') return `The Project Manager asks about this (the office's review gate): ${it.text}.
${list}
Find out what happened and answer in one line what you'll do about it: have it reviewed now by another Lead (a "Review:" comment on the PR listing the checks run with their results and the files read), or escalate (office-workers escalate) what only I can decide. From now on follow the Playbook's review rule.`;
      return `The Project Manager asks about this: ${it.text}. The toolkit's gate-check printed it only to the agent that ran it. Deal with it, or if only I can clear it, escalate it (office-workers escalate) with options and a recommendation.`;
    default:
      return undefined;
  }
}
