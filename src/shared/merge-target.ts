// Which commit a Developer change's receipt may merge, for a local-only project (server/local-merge/targets.ts,
// ui/local-merge/receipt.ts). The real rebuild run found the receipt tied DC-n to `dev/DC-n` only, where the
// coordinator drafts (a notes-only journal, or a script that failed the mxbuild gate and was never applied to
// the model), while the lead's implementation sat on another branch (`office/<worker>-<id>`). "Review and merge"
// would have put the draft on main and called the change implemented.
//
// Now each branch that may carry the change is an option with what it is and its gate state:
//   - `dev/DC-n`, the branch of the worker the change was handed to, a branch an agent asked to have merged for
//     it (its escalation names the change and a commit), and branches whose commits name it
//   - notes only (journal, docs), a script draft (mdlsource/ changed, the model itself not), or a commit with a
//     failed check recorded at it is never offered
//   - one option an agent asked to merge, among those that may merge, is the pick; else the only one that may;
//     else none: the PM chooses from the list (nothing chosen by default)
// Pure: the browser imports it too.

import type { LocalMergeFiles } from './local-merge.js';

/** What a commit is, for merging: model or code applied, a script draft only, or notes only. */
export type TargetKind = 'change' | 'script' | 'notes';

/** How the option was found. */
export type TargetVia = 'dc-branch' | 'worker' | 'asked' | 'named';

/** A check recorded at exactly the option's commit. */
export interface TargetCheck {
  name: string;
  verdict: string;
}

/** One branch that may carry the change, at the commit that would merge. */
export interface MergeOption {
  branch: string;
  sha: string;
  /** The branch's head now (the option's commit, or a later one when an agent asked for an older commit). */
  head: string;
  subject: string;
  owner?: string;
  via: TargetVia[];
  kind: TargetKind;
  files: LocalMergeFiles;
  checks: TargetCheck[];
  /** The agent that asked to merge exactly this commit for the change, and when. */
  asked?: { by: string; at: number };
  /** Whether it may be merged from the receipt, and if not why not. */
  ok: boolean;
  why?: string;
  /** Its gate state in words: "✓ 2 checks passed at @abc1234", "no checks recorded at @abc1234", "✗ smoke failed at @abc1234". */
  gate: string;
}

/** What the receipt offers: the commit it picked (when that is clear), and every option with its state. */
export interface MergeTargets {
  pick?: { branch: string; sha: string };
  options: MergeOption[];
  /** One line on why it picked what it did, or why it didn't. */
  words: string;
}

const short = (sha: string) => sha.slice(0, 7);

const APPLIED = /(^|\/)[^/]+\.mpr$|(^|\/)mprcontents\//i;
const SCRIPT = /^mdlsource\//i;
const NOTES = /\.(md|markdown|txt|rst|adoc)$|^(docs|journal|journals|notes)\//i;

/** What the changed paths make the commit: the model (.mpr, mprcontents/) or code changed; only mdlsource/ scripts (and notes); only notes. */
export function targetKind(paths: readonly string[]): TargetKind {
  const ps = paths.map((p) => p.trim()).filter(Boolean);
  if (ps.some((p) => APPLIED.test(p))) return 'change';
  if (ps.some((p) => !SCRIPT.test(p) && !NOTES.test(p))) return 'change';
  return ps.some((p) => SCRIPT.test(p)) ? 'script' : 'notes';
}

/** The gate state of an option's commit, in words, and whether a check failed there. */
export function gateWords(sha: string, checks: readonly TargetCheck[]): { failed: boolean; words: string } {
  const failed = checks.filter((c) => c.verdict === 'failed' || c.verdict === 'error');
  if (failed.length) return { failed: true, words: `✗ ${failed.map((c) => c.name).join(', ')} failed at @${short(sha)}` };
  const passed = checks.filter((c) => c.verdict === 'passed');
  if (passed.length && passed.length === checks.length) return { failed: false, words: `✓ ${passed.length} check${passed.length === 1 ? '' : 's'} passed at @${short(sha)}` };
  if (checks.length) return { failed: false, words: `${checks.map((c) => `${c.name} ${c.verdict}`).join(', ')} at @${short(sha)}` };
  return { failed: false, words: `no checks recorded at @${short(sha)}` };
}

/** Whether an option may merge from the receipt, and why not. */
export function judge(o: Pick<MergeOption, 'kind' | 'checks' | 'sha'>): { ok: boolean; why?: string; gate: string } {
  const g = gateWords(o.sha, o.checks);
  if (o.kind === 'notes') return { ok: false, why: 'notes only: no model or code change', gate: g.words };
  if (o.kind === 'script') return { ok: false, why: 'a script draft: mdlsource/ changed but the model itself didn’t (never applied)', gate: g.words };
  if (g.failed) return { ok: false, why: `its gate failed (${g.words})`, gate: g.words };
  return { ok: true, gate: g.words };
}

/** Picks what the receipt merges: the asked-for option that may merge, else the only one that may, else none. */
export function pickTarget(options: readonly MergeOption[]): MergeTargets {
  const may = options.filter((o) => o.ok);
  const asked = may.filter((o) => o.asked);
  const pick = asked.length === 1 ? asked[0] : may.length === 1 && asked.length === 0 ? may[0] : undefined;
  let words: string;
  if (pick) words = `@${short(pick.sha)} on ${pick.branch}: ${pick.asked ? `${pick.asked.by} asked to merge it for this change` : 'the only branch with this change’s model or code work'} (${pick.gate})`;
  else if (!options.length) words = 'No branch carries this change yet';
  else if (!may.length) words = `Nothing to merge yet: ${options.map((o) => `${o.branch} is ${o.why}`).join('; ')}`;
  else words = `${may.length} branches may carry this change: choose the one to review and merge`;
  return { ...(pick ? { pick: { branch: pick.branch, sha: pick.sha } } : {}), options: [...options], words };
}

/** An agent's request to merge a commit, read from an escalation (its title, details, options, recommendation). */
export interface MergeAsk {
  id: string;
  by: string;
  at: number;
  /** The change ids it names (DC-n, CR-n), as written. */
  ids: string[];
  /** The commits it names (7 to 40 hex digits): checked against the branches before use. */
  shas: string[];
  /** The branch names it mentions (anything with a slash that could be one): checked against the project's. */
  branches: string[];
}

const MERGE_WORD = /\bmerg(e|es|ed|ing)\b/i;
const IDS = /\b(?:DC|CR|MCR)-\d{1,6}\b/g;
const SHAS = /(?<![\w/@.-])@?([0-9a-f]{7,40})(?![\w-])/gi;
const BRANCHES = /(?<![\w./-])((?:[\w.-]+\/)+[\w.-]*\w)/g;

/** The merge request an escalation makes, or undefined when it doesn't ask for a merge of a named commit. */
export function mergeAskOf(e: { id: string; by: string; at: number; title: string; details?: string; options?: readonly string[]; recommendation?: string }): MergeAsk | undefined {
  const text = [e.title, e.details ?? '', ...(e.options ?? []), e.recommendation ?? ''].join('\n');
  if (!MERGE_WORD.test(text)) return undefined;
  // Digits only would be a number, not a commit: a sha has at least one letter a-f... or is long.
  const shas = [...text.matchAll(SHAS)].map((m) => m[1].toLowerCase()).filter((s) => /[a-f]/.test(s) || s.length >= 12);
  if (!shas.length) return undefined;
  const branches = [...text.matchAll(BRANCHES)].map((m) => m[1]).filter((b) => !/^https?:/i.test(b) && !/\.(md|mdl|ts|js|json|png|txt)$/i.test(b));
  return { id: e.id, by: e.by, at: e.at, ids: [...new Set(text.match(IDS) ?? [])], shas: [...new Set(shas)], branches: [...new Set(branches)] };
}

/** Whether a merge ask names the change (its DC id, or the request id it answers to). */
export const askNames = (a: Pick<MergeAsk, 'ids'>, ids: readonly string[]) => a.ids.some((x) => ids.includes(x));
