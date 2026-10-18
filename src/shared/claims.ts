// The claims check's words (server/claims/, docs/site/using-the-office/claims-check.md): what counts as an
// agent's claim that a model change was applied or that tests passed, read from the BUILD-LOG's gated
// rows, the team's journals and evidence pages, commit subjects and pull requests, and what the office
// says when git doesn't back it. Every pattern is here, in one place, with its tests
// (tests/claims-patterns.test.ts). Deterministic and conservative: a claim must be explicit (an
// "applied" naming an MDL script or batch, a PASS with counts or "all … pass"), and a sentence that
// plans, hedges or negates ("will apply", "not applied", "pending", "draft") is never one. Pure: the
// server, the build progress and the tests import it.

import { rowsIn } from './build-progress.js';

export type ClaimKind = 'applied' | 'pass';
/** Where the words were: a BUILD-LOG gated row, a journal (docs/team/*.md), an evidence page, a commit subject, a pull request. */
export type ClaimSource = 'build-log' | 'journal' | 'evidence' | 'subject' | 'pr';

export interface Claim {
  kind: ClaimKind;
  source: ClaimSource;
  /** The words, trimmed and shortened. */
  text: string;
  /** applied: what names the script or batch ("06-orders-page", "10f"); a commit naming one of them is about it. */
  keys: string[];
  /** applied: the script as written ("mdlsource/3-orders/06-orders-page.mdl", "patch: 10f-apply.sh"). */
  script?: string;
  /** The build-plan rows it names. */
  rows: number[];
  /** A BUILD-LOG row's own time (ms): the apply ran then. */
  at?: number;
  /** pass: the suites it names ("order-submit", "J-01") and the paths. */
  suites?: string[];
  paths?: string[];
}

/** Files that are the Mendix model: the .mpr and its mprcontents/ (MPR v2). */
export const isModelPath = (f: string) => /(^|\/)[^/]+\.mpr$/i.test(f) || /(^|\/)mprcontents\//i.test(f);

/** Where claims are read from besides commit subjects and pull requests. */
export const BUILD_LOG_PATH = 'docs/BUILD-LOG.md';
export const isJournalPath = (f: string) => /^docs\/team\/[^/]+\.md$/i.test(f);
export const isEvidencePath = (f: string) => /(^|\/)[^/]*evidence[^/]*\.md$/i.test(f);
export const CLAIM_DOC_PATHS = [BUILD_LOG_PATH, 'docs/team/*.md', ':(glob)**/*evidence*.md'];

/** A sentence that plans, hedges or negates: never a claim. */
const NOT_A_CLAIM =
  /\b(?:will|would|should|could|can|may|might|must|shall|to\s+be|going\s+to|plan(?:s|ned|ning)?|next|todo|tbd|once|if|until|unless|before|need(?:s|ed)?\s+to|not|never|no\s+longer|without|pending|awaiting|draft(?:s|ed)?|re-?apply|un-?applied|reverted|rolled\s+back|failed\s+to|cannot|expected|supposed)\b|n['’]t\b/i;

/** Whether the sentence only plans, hedges or negates. */
export const plansOrNegates = (s: string) => NOT_A_CLAIM.test(s) || /^\s*(?:draft|journal)\b/i.test(s);

/** The sentences of a text: each line, split at ". ", "; ", "! ", "? ". A table row stays one. */
export function sentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .flatMap((l) => (/^\s*\|/.test(l) ? [l] : l.split(/(?<=[.;!?])\s+/)))
    .map((s) => s.trim())
    .filter(Boolean);
}

const clip = (s: string, n = 160) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// ---- Applied claims ------------------------------------------------------------------------------------

/** An MDL script ("mdlsource/3-orders/06-orders-page.mdl", "02-domain.mdl") or a numbered apply script ("10f-apply.sh"); never a test script. */
const SCRIPT_RE = /(?:[\w.-]+\/)*((?:\d{1,3}[a-z]?-)?[a-z0-9][\w-]*)\.(mdl|sh)\b/gi;
/** A batch id next to the claim word: "applied 10f", "Apply 07c:", "12h applied", "batch 10f", "applied 01-frame". */
const BATCH_AFTER = /\b(?:applied|apply)\b:?\s+(?:batch\s+)?(\d{2}[a-z](?![\w])|\d{2}[a-z]?-[a-z][\w-]*)(?!\s+ago)/gi;
const BATCH_BEFORE = /\b(?:batch\s+)?(\d{2}[a-z]|\d{2}[a-z]?-[a-z][\w-]*)\s+(?:(?:and|&)\s+[\w-]+\s+)?(?:is\s+|was\s+|now\s+)?(?:✅\s*)?applied\b/gi;
const BATCH_WORD = /\bbatch(?:es)?\s+(\d{2}[a-z]?)\b/gi;

/** What names a script or batch: its file name without the extension, and its batch id when that has a letter ("10f"). */
export function keysOf(name: string): string[] {
  const base = name.replace(/^.*\//, '').replace(/\.(mdl|sh)$/i, '').trim().toLowerCase();
  if (!base) return [];
  const id = /^(\d{1,3}[a-z])(?:-|$)/.exec(base)?.[1];
  return [...new Set([base, ...(id ? [id] : [])])];
}

/** The scripts and batches a sentence names, as keys; the first script as written. */
export function scriptsIn(s: string): { keys: string[]; script?: string } {
  const keys = new Set<string>();
  let script: string | undefined;
  for (const m of s.matchAll(SCRIPT_RE)) {
    const base = m[1];
    if (/\.test$/i.test(base) || /(^|[-_.])test$/i.test(base)) continue;
    // A shell script is an apply script only when numbered or under mdlsource/ (bin/*.sh is the toolkit's).
    if (m[2].toLowerCase() === 'sh' && !/^\d{1,3}[a-z]?-/.test(base) && !/mdlsource\//i.test(m[0])) continue;
    script ??= m[0];
    for (const k of keysOf(base)) keys.add(k);
  }
  for (const re of [BATCH_AFTER, BATCH_BEFORE, BATCH_WORD]) for (const m of s.matchAll(re)) for (const k of keysOf(m[1])) keys.add(k);
  return { keys: [...keys], ...(script ? { script } : {}) };
}

/** "applied" as the sentence's verb (a commit subject may say "Apply 10f: …", the imperative a commit uses). */
const APPLIED = /(?:✅\s*)?\bapplied\b/i;
const APPLY_SUBJECT = /^\s*apply\b/i;

/** An applied claim in one sentence, or undefined. */
export function appliedClaim(s: string, source: ClaimSource): Claim | undefined {
  if (!(APPLIED.test(s) || (source === 'subject' && APPLY_SUBJECT.test(s)))) return undefined;
  if (plansOrNegates(s)) return undefined;
  const { keys, script } = scriptsIn(s);
  if (!keys.length) return undefined;
  return { kind: 'applied', source, text: clip(s), keys, ...(script ? { script } : {}), rows: rowsIn(s) };
}

// ---- BUILD-LOG gated rows ----------------------------------------------------------------------------

/** A gated row's time: "2026-10-16T15:45:28+0800" (the offset written with or without its colon). Without an offset it's read as UTC, and the check allows a day around it. */
export function logTime(s: string): { at: number; zoned: boolean } | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)\s*(Z|[+-]\d{2}:?\d{2})?/.exec(s.trim());
  if (!m) return undefined;
  const zone = m[3] ? (m[3] === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2')) : 'Z';
  const at = Date.parse(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}${zone}`);
  return Number.isFinite(at) ? { at, zoned: !!m[3] } : undefined;
}

/** The BUILD-LOG's gated row (`| when | \`script\` | gate | result | detail |`) as an applied claim when its result says applied (✅ applied, ⚠️ applied, LINT ROSE), else undefined. */
export function buildLogClaim(line: string): (Claim & { zoned: boolean }) | undefined {
  const m = /^\|\s*(\d{4}-\d{2}-\d{2}[T ][^|]*?)\s*\|\s*`?([^|`]+?)`?\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/.exec(line.trim());
  if (!m) return undefined;
  const [, when, script, gate, result] = m;
  if (!/^(?:✅|⚠️|⚠)?\s*applied\b/iu.test(result) || /^(fail|not-run|blocked)/i.test(gate)) return undefined;
  const t = logTime(when);
  const name = script.replace(/^[a-z]+:\s*/i, '').trim();
  const keys = keysOf(name);
  if (!t || !keys.length) return undefined;
  return { kind: 'applied', source: 'build-log', text: clip(`${script.trim()} ${result.trim()}`), keys, script: script.trim(), rows: rowsIn(line), at: t.at, zoned: t.zoned };
}

// ---- PASS claims ---------------------------------------------------------------------------------------

/** "PASS 35/0/0" (passed/failed/skipped) or "PASS 7/7" (passed/total): all pass when the second is 0 or equals the first. */
const PASS_SLASH = /\bPASS(?:ED)?\s+(\d+)\s*\/\s*(\d+)(?:\s*\/\s*\d+)?/gi;
/** "7/7 pass", "12/12 passed", "13/13 green". */
const SLASH_PASS = /\b(\d+)\s*\/\s*(\d+)\s+(?:pass(?:ed|es|ing)?|green)\b/gi;
/** "35 passed, 0 failed", "35 PASS / 0 FAIL". */
const ZERO_FAIL = /\b(\d+)\s+pass(?:ed)?\s*[,/·]\s*0\s+fail(?:ed|ures?|s)?\b/gi;
/** "journeys 7/7", "tests: 12/12". */
const NOUN_SLASH = /\b(?:journeys?|tests?|checks?|walks?|scenarios?)\s*[:=]?\s*(\d+)\s*\/\s*(\d+)\b/gi;
/** "all journeys pass", "all 12 tests passed", "all checks green". */
const ALL_PASS = /\ball\s+(?:\d+\s+)?(?:journeys?|tests?|checks?|walks?|scenarios?)\s+(?:(?:are|were)\s+)?(?:pass(?:ed|ing)?|green)\b/i;
/** "order-submit PASS", "T-ORDER: PASS", "J-01 — PASS" (PASS in capitals, after a named suite). */
const NAMED_PASS = /(?:^|[\s|,(])((?:[A-Z]+-[A-Z0-9][\w-]*)|(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)+))\s*(?::|—|–|-)?\s*PASS(?:ED)?\b(?!\s+\d+\s*\/\s*[1-9])/;

/** Whether the sentence claims everything passed: a count with no failures, "all … pass", or a named suite's PASS. */
export function allPassClaimed(s: string): boolean {
  const counts: [RegExp, (a: number, b: number) => boolean][] = [
    [PASS_SLASH, (a, b) => a > 0 && (b === 0 || a === b)],
    [SLASH_PASS, (a, b) => a > 0 && a === b],
    [ZERO_FAIL, (a) => a > 0],
    [NOUN_SLASH, (a, b) => a > 0 && a === b],
  ];
  let any = false;
  let short = false;
  for (const [re, ok] of counts)
    for (const m of s.matchAll(re)) {
      any = true;
      if (!ok(Number(m[1]), Number(m[2]))) short = true;
    }
  // A count that isn't all-pass ("PASS 21/14", "6/8 pass") makes the sentence no all-pass claim at all.
  if (any) return !short;
  return ALL_PASS.test(s) || NAMED_PASS.test(s);
}

/** Suite names ("order-submit", "J-01", "T-ORDER") and paths ("tests/e2e/artifacts/run-3/") a sentence names. */
export function suitesIn(s: string): { suites: string[]; paths: string[] } {
  const paths = new Set<string>();
  for (const m of s.matchAll(/(?:^|[\s`'"(|,])((?:[\w.-]+\/)+[\w.-]*)/g)) {
    const p = m[1].replace(/[.,;:)]+$/, '');
    if (p.includes('/') && !/^https?:/i.test(p) && !/^\d+\/\d+/.test(p)) paths.add(p);
  }
  const suites = new Set<string>();
  const bare = s.replace(/(?:[\w.-]+\/)+[\w.-]*/g, ' ');
  for (const m of bare.matchAll(/\b([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/g)) suites.add(m[1]);
  for (const m of bare.matchAll(/\b([A-Z]+-[A-Z0-9][\w-]*)\b/g)) suites.add(m[1]);
  return { suites: [...suites], paths: [...paths] };
}

/** A PASS claim in one sentence, or undefined. */
export function passClaim(s: string, source: ClaimSource): Claim | undefined {
  if (!/pass|green/i.test(s) || plansOrNegates(s) || !allPassClaimed(s)) return undefined;
  const { suites, paths } = suitesIn(s);
  return { kind: 'pass', source, text: clip(s), keys: [], rows: rowsIn(s), suites, paths };
}

/** Every claim in a text (a commit subject, a pull request, a journal's or evidence page's added lines). */
export function claimsIn(text: string, source: ClaimSource): Claim[] {
  const out: Claim[] = [];
  for (const s of sentences(text)) {
    if (source !== 'build-log' && /^\s*\|\s*\d{4}-\d{2}-\d{2}/.test(s)) continue; // a gated row copied into prose
    const a = appliedClaim(s, source);
    if (a) out.push(a);
    const p = passClaim(s, source);
    if (p) out.push(p);
  }
  return out;
}

/** The BUILD-LOG's added lines as claims: its gated rows, and the claims in its notes. */
export function buildLogClaims(added: readonly string[]): Claim[] {
  const out: Claim[] = [];
  for (const l of added) {
    const row = buildLogClaim(l);
    if (row) out.push(row);
    else if (!/^\s*\|/.test(l)) out.push(...claimsIn(l, 'build-log').filter((c) => c.kind === 'pass'));
  }
  return out;
}

// ---- Verdicts and the card ---------------------------------------------------------------------------

/**
 * What git says about a claim. no-model: claimed applied, but no commit with model files backs it;
 * branch-only: the model change is on a branch not merged into the claim's place; failing: a committed
 * result shows failures; not-committed: the evidence it names is in a git-ignored path.
 */
export type ClaimVerdict = 'no-model' | 'branch-only' | 'failing' | 'not-committed';

export interface ClaimMismatch {
  /** Stable while the claim and its verdict are the same. */
  id: string;
  verdict: ClaimVerdict;
  claim: Claim;
  /** The commit with the claim, its subject, and who wrote it (an agent's name, else the author). */
  commit: string;
  subject: string;
  who: string;
  /** Where the claim is: the default branch, or the agent branch it is only on. */
  place: string;
  onMain: boolean;
  /** The pull request it came in by (or is part of), when known. */
  pr?: number;
  /** branch-only: where the model change is. */
  holder?: { branch: string; commit: string; subject: string };
  /** failing: the committed result and its counts. */
  result?: { file: string; commit: string; failed: number; passed: number };
  /** not-committed: the path it names, git-ignored. */
  ignored?: string;
  /** The tasks its commit names ("Task: tsk_…"). */
  tasks?: string[];
  /** Its time (ms). */
  at: number;
}

const sha7 = (s: string) => s.slice(0, 7);

/** The mismatch in one line, as the card and the tell say it. */
export function mismatchLine(m: ClaimMismatch, links?: { commit(sha: string): string; branch(b: string): string; pr(n: number): string }): string {
  const c = `${sha7(m.commit)}${links ? ` (${links.commit(m.commit)})` : ''}`;
  const where = `${m.claim.source === 'pr' ? `PR #${m.pr}` : `commit ${c}`}${m.pr && m.claim.source !== 'pr' ? `, PR #${m.pr}${links ? ` (${links.pr(m.pr)})` : ''}` : ''} on ${m.place}`;
  const said = `${m.who}: “${m.claim.text}” (${where})`;
  switch (m.verdict) {
    case 'no-model':
      return `${said}: claimed applied, no model change in that commit (no .mpr or mprcontents/ change backs it on ${m.place} or any branch)`;
    case 'branch-only':
      return `${said}: applied on ${m.holder!.branch}${links ? ` (${links.branch(m.holder!.branch)})` : ''}, not on ${m.place}; the model change is commit ${sha7(m.holder!.commit)} “${clip(m.holder!.subject, 80)}”`;
    case 'failing':
      return `${said}: claim says PASS; committed result shows ${m.result!.failed} failed (${m.result!.file} at ${sha7(m.result!.commit)}: ${m.result!.passed} passed, ${m.result!.failed} failed)`;
    case 'not-committed':
      return `${said}: evidence not committed (${m.ignored} is git-ignored, so nobody else can see the run)`;
  }
}

/** What would fix it, in the words the tell uses. */
export function mismatchFix(m: ClaimMismatch): string {
  switch (m.verdict) {
    case 'no-model':
      return `commit the model change the apply made (the .mpr / mprcontents/ files) and bring it to ${m.place} through a reviewed pull request, or correct the claim (“${clip(m.claim.text, 60)}”) if it was never applied`;
    case 'branch-only':
      return `merge the commit holding the model (${sha7(m.holder!.commit)} on ${m.holder!.branch}) into ${m.place} through a reviewed pull request, then re-run the journeys and checks on ${m.place}`;
    case 'failing':
      return `re-run the tests on ${m.place} and commit the result file that shows them passing (replacing ${m.result!.file}), or correct the claim to what the committed result says`;
    case 'not-committed':
      return `re-run on ${m.place} and commit the passing result file outside the ignored folder (${m.ignored}), e.g. under reports/testing/, so the claim has evidence anyone can read`;
  }
}

/** The rows a mismatch on the default branch takes off "built on main": the rows the claim names. */
export const claimedRows = (ms: readonly ClaimMismatch[]): number[] => [...new Set(ms.filter((m) => m.onMain).flatMap((m) => m.claim.rows))].sort((a, b) => a - b);

/** The Project Manager's durable tell for "Ask <agent> to fix" (`who` from the button's words): each mismatch exactly, with its fix (the card's lines). */
export function claimsTell(who: string, lines: readonly string[]): string {
  const items = lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
  return `The Project Manager asks ${who} to fix claims that git doesn't back (the office's claims check compared each claim with the commits, branches and committed results; it ran no model or test):\n${items}\nIf that isn't you, pass each one to whoever made it (office-workers tell) and see it done. Until then those build-plan rows read "claimed, not evidenced" and the tasks closed on them stay "claimed (unverified)". Answer in one line what will be done, or escalate (office-workers escalate) what only I can decide.`;
}

/** Who a card's "Ask <who> to fix" button names. */
export const askedOf = (label: string | undefined) => /^Ask (.+) to fix$/.exec(label ?? '')?.[1] ?? 'the team';
