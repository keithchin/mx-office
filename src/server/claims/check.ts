// The claims check (docs/site/using-the-office/claims-check.md): each claim an agent made in the last
// CLAIM_DAYS (shared/claims.ts: a BUILD-LOG row that says applied, an "applied <script>" in a journal,
// evidence page or commit subject, a PASS with counts, a pull request saying either) compared with what
// git holds. Deterministic, no LLM, read-only (repo.ts), and conservative: only a definite gap is a
// mismatch.
//
// Applied (an MDL script or batch): backed when a commit that changes the model (.mpr, mprcontents/),
// made at or after the apply ran (the BUILD-LOG row's own time; for words with no time, a day before the
// commit, a week before a PR opened), is on the claim's place (the default branch, or the agent branch the
// claim is only on) and is in the claim's own history, names the same script or batch, or is the same
// author's within a day. Not backed: such a commit only on a branch not merged there is "applied on
// <branch>, not on main" (unless a merged PR from that branch or identical model files show it arrived
// another way); none at all is "claimed applied, no model change in that commit".
//
// PASS: the committed result files the claim is about (named for a suite it names, under a path it names,
// else the result files its own commit changed), read at the place's tip: one showing failures is "claim
// says PASS; committed result shows N failed"; with none committed, a path it names that the .gitignore
// ignores is "evidence not committed". Merging the model, or committing a passing result, clears it.

import { createHash } from 'node:crypto';
import { git } from '../asks/sources.js';
import type { GhPull } from '../../shared/protocol.js';
import { BUILD_LOG_PATH, buildLogClaims, claimsIn, isEvidencePath, isJournalPath, isModelPath, type Claim, type ClaimMismatch } from '../../shared/claims.js';
import { rowsIn } from '../../shared/build-progress.js';
import { agentFromAuthor, openerFromBody } from '../../shared/review-gate.js';
import { ancestry, broughtBy, CLAIM_DAYS, fileAt, lastChange, readSnapshot, sameModelOn, treeFiles, type Commit, type Snapshot } from './repo.js';
import { ignoreRules, isIgnored, isResultFile, looksLikeResult, resultCounts, resultName } from './results.js';

const HOUR = 3_600_000;
/** How much earlier than a zoned BUILD-LOG time a model commit may be (clocks), and than an unzoned one (any time zone). */
const SLACK_ZONED = 10 * 60_000;
const SLACK_UNZONED = 14 * HOUR;
/** Words with no time of their own: a model commit this long before them still counts. */
const TEXT_WINDOW = 24 * HOUR;
const PR_WINDOW = 7 * 24 * HOUR;
/** A same-author model commit counts up to this long after the claim. */
const AFTER = 24 * HOUR;
/** At most this many result files read per claim. */
const RESULTS_MAX = 6;

/** A claim where it was made. */
interface Found {
  claim: Claim;
  /** The commit with it (a PR: its merge commit, or its branch tip). */
  at: Commit;
  place: string;
  tip: string;
  onMain: boolean;
  who: string;
  pr?: number;
  /** The earliest a model commit may be to back it (ms). */
  from: number;
}

const whoOf = (c: Commit) => agentFromAuthor(c.author) ?? c.author.replace(/\s*<.*$/, '').trim() ?? 'someone';
const keyRe = (k: string) => new RegExp(`(?<![\\w.-])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i');
const namesKey = (c: Commit, keys: readonly string[]) => keys.some((k) => keyRe(k).test(`${c.subject}\n${c.body}`));
const isModelCommit = (c: Commit) => c.parents.length < 2 && c.files.some(isModelPath);

/** Every claim in the window: in the commits (subjects and the lines added to the claim documents) and the pull requests. */
export function findClaims(s: Snapshot, pulls: readonly GhPull[], now: number): Found[] {
  const out: Found[] = [];
  const cutoff = now - CLAIM_DAYS * 24 * HOUR;
  const placeOf = (sha: string) => (s.onMain.has(sha) ? { place: s.main.branch, tip: s.main.sha, onMain: true } : s.branchOf.has(sha) ? { place: s.branchOf.get(sha)!, tip: s.branches.get(s.branchOf.get(sha)!)!.sha, onMain: false } : undefined);
  for (const c of s.commits.values()) {
    if (c.at < cutoff || c.parents.length > 1) continue;
    const where = placeOf(c.sha);
    if (!where) continue;
    const claims: Claim[] = [...claimsIn(c.subject, 'subject')];
    for (const f of s.added.get(c.sha) ?? []) {
      if (f.file === BUILD_LOG_PATH) claims.push(...buildLogClaims(f.lines));
      else if (isJournalPath(f.file)) claims.push(...claimsIn(f.lines.join('\n'), 'journal'));
      else if (isEvidencePath(f.file)) claims.push(...claimsIn(f.lines.join('\n'), 'evidence'));
    }
    const subjectRows = rowsIn(c.subject);
    for (const claim of claims) {
      // A gated row names no build-plan row; its commit's subject does when it names the same script or says applied.
      if (claim.source === 'build-log' && !claim.rows.length && subjectRows.length && (namesKey(c, claim.keys) || /\bappl(?:y|ied)\b/i.test(c.subject))) claim.rows = subjectRows;
      const zoned = (claim as Claim & { zoned?: boolean }).zoned;
      const from = claim.at !== undefined ? claim.at - (zoned ? SLACK_ZONED : SLACK_UNZONED) : c.at - TEXT_WINDOW;
      out.push({ claim, at: c, ...where, who: whoOf(c), from });
    }
  }
  for (const p of pulls) {
    const merged = p.state === 'MERGED' && p.mergeCommit;
    if (!merged && p.state !== 'OPEN') continue;
    const sha = merged ? p.mergeCommit! : s.branches.get(p.headRefName)?.sha;
    const c = sha ? s.commits.get(sha) : undefined;
    if (!c || c.at < cutoff || (merged && !s.onMain.has(c.sha))) continue;
    const where = merged ? { place: s.main.branch, tip: s.main.sha, onMain: true } : { place: p.headRefName, tip: c.sha, onMain: false };
    const opened = Date.parse(p.createdAt);
    for (const claim of claimsIn(`${p.title}\n${p.body ?? ''}`, 'pr')) out.push({ claim, at: c, ...where, who: openerFromBody(p.body) ?? p.author ?? 'someone', pr: p.number, from: (Number.isFinite(opened) ? opened : c.at) - PR_WINDOW });
  }
  return dedupe(out);
}

/** One of each claim: the same words about the same thing are one claim, kept where it's on the default branch, else the earliest. */
function dedupe(found: Found[]): Found[] {
  const best = new Map<string, Found>();
  for (const f of found) {
    const k = `${f.claim.kind}|${f.claim.keys.join(',')}|${f.claim.at ?? ''}|${f.claim.text.toLowerCase()}`;
    const had = best.get(k);
    if (!had || (f.onMain && !had.onMain) || (f.onMain === had.onMain && f.at.at < had.at.at)) best.set(k, f);
  }
  return [...best.values()];
}

/** What's reachable from a claim's place: the default branch's commits, plus the branch's own. */
const reach = (s: Snapshot, f: Found) => (sha: string) => s.onMain.has(sha) || (!f.onMain && !!s.branches.get(f.place)?.own.has(sha));

/** The verdict on an applied claim, or undefined when git backs it. */
async function checkApplied(s: Snapshot, f: Found, pulls: readonly GhPull[]): Promise<Pick<ClaimMismatch, 'verdict' | 'holder'> | undefined> {
  const { claim } = f;
  const reachable = reach(s, f);
  const history = ancestry(s, f.at.sha);
  const models = [...s.commits.values()].filter((x) => isModelCommit(x) && x.at >= f.from);
  const related = (x: Commit) => namesKey(x, claim.keys) || (x.author === f.at.author && x.at <= f.at.at + AFTER);
  if (models.some((x) => reachable(x.sha) && (history.has(x.sha) || related(x)))) return undefined;
  const holders = models.filter((x) => !reachable(x.sha) && s.branchOf.has(x.sha) && related(x)).sort((a, b) => Number(namesKey(b, claim.keys)) - Number(namesKey(a, claim.keys)) || a.at - b.at);
  for (const x of holders) {
    const branch = s.branchOf.get(x.sha)!;
    // Arrived another way: a merged PR from that branch after it, or the same model files on the place now.
    if (pulls.some((p) => p.state === 'MERGED' && p.headRefName === branch && Date.parse(p.mergedAt ?? '') >= x.at)) return undefined;
    if (await sameModelOn(s.dir, x, f.tip, isModelPath)) return undefined;
    return { verdict: 'branch-only', holder: { branch, commit: x.sha, subject: x.subject } };
  }
  // Nothing anywhere: only definite when the claim's own commit (or PR) changed no model either.
  if (f.at.files.some(isModelPath)) return undefined;
  return { verdict: 'no-model' };
}

/** The result files a PASS claim is about, at the place's tip. */
async function resultFilesFor(s: Snapshot, f: Found): Promise<string[]> {
  const files = (await treeFiles(s.dir, f.tip)).filter(isResultFile);
  const suites = new Set((f.claim.suites ?? []).map((x) => x.toLowerCase()));
  const named = files.filter((x) => suites.has(resultName(x)));
  const paths = (f.claim.paths ?? []).map((p) => p.replace(/^\.?\//, ''));
  const under = files.filter((x) => paths.some((p) => x === p || x.startsWith(p.endsWith('/') ? p : `${p}/`)));
  const picked = [...new Set([...named, ...under])];
  if (picked.length) return picked.slice(0, RESULTS_MAX);
  const tree = new Set(files);
  return f.at.files.filter((x) => looksLikeResult(x) && tree.has(x)).slice(0, RESULTS_MAX);
}

/** The verdict on a PASS claim, or undefined when git backs it (or can't say for certain). */
async function checkPass(s: Snapshot, f: Found): Promise<Pick<ClaimMismatch, 'verdict' | 'result' | 'ignored'> | undefined> {
  const files = await resultFilesFor(s, f);
  let read = 0;
  for (const file of files) {
    const text = await fileAt(s.dir, f.tip, file);
    const counts = text === undefined ? undefined : resultCounts(file, text);
    if (!counts) continue;
    read++;
    if (counts.failed > 0) return { verdict: 'failing', result: { file, commit: (await lastChange(s.dir, f.tip, file)) ?? f.tip, failed: counts.failed, passed: counts.passed } };
  }
  if (read || !f.claim.paths?.length) return undefined;
  const tree = new Set(await treeFiles(s.dir, f.tip));
  const rules = ignoreRules(await fileAt(s.dir, f.at.sha, '.gitignore'));
  const ignored = f.claim.paths.find((p) => !tree.has(p.replace(/^\.?\//, '')) && isIgnored(rules, p));
  return ignored ? { verdict: 'not-committed', ignored } : undefined;
}

const idOf = (f: Found, verdict: string) => createHash('sha1').update(`${verdict}|${f.at.sha}|${f.claim.kind}|${f.claim.keys.join(',')}|${f.claim.text}`).digest('hex').slice(0, 12);

/** The PR a commit came in by: the default branch's merge commit that brought it, or the open PR of its branch. */
async function prOf(s: Snapshot, f: Found, pulls: readonly GhPull[]): Promise<number | undefined> {
  if (f.pr !== undefined) return f.pr;
  if (!f.onMain) return pulls.find((p) => p.state === 'OPEN' && p.headRefName === f.place)?.number;
  const m = await broughtBy(s, f.at.sha);
  if (!m) return undefined;
  const byMerge = pulls.find((p) => p.mergeCommit === m)?.number;
  if (byMerge !== undefined) return byMerge;
  const c = s.commits.get(m);
  const n = c ? (/^Merge pull request #(\d+)/.exec(c.subject) ?? /\(#(\d+)\)$/.exec(c.subject)) : null;
  return n ? Number(n[1]) : undefined;
}

/** Every mismatch in a snapshot, newest first. */
export async function checkSnapshot(s: Snapshot, pulls: readonly GhPull[], now = Date.now()): Promise<ClaimMismatch[]> {
  const out: ClaimMismatch[] = [];
  for (const f of findClaims(s, pulls, now)) {
    const v = f.claim.kind === 'applied' ? await checkApplied(s, f, pulls) : await checkPass(s, f);
    if (!v) continue;
    const pr = await prOf(s, f, pulls).catch(() => undefined);
    const tasks = [...new Set([...`${f.at.subject}\n${f.at.body}`.matchAll(/\bTask:\s*(tsk_[\w-]+)/g)].map((x) => x[1]))];
    out.push({ id: idOf(f, v.verdict), ...v, claim: f.claim, commit: f.at.sha, subject: f.at.subject, who: f.who, place: f.place, onMain: f.onMain, ...(pr !== undefined ? { pr } : {}), ...(tasks.length ? { tasks } : {}), at: f.claim.at ?? f.at.at });
  }
  return out.sort((a, b) => b.at - a.at);
}

const cache = new Map<string, { key: string; p: Promise<ClaimMismatch[] | undefined> }>();

/** The project's mismatches now (undefined when git couldn't be read), worked out once per state of the refs and PR list. */
export async function claimsCheck(dir: string, main: { branch: string; sha: string }, pulls: readonly GhPull[] = [], now = Date.now()): Promise<ClaimMismatch[] | undefined> {
  const refs = (await git(['for-each-ref', '--format=%(objectname)', 'refs/remotes/origin'], dir)) ?? '';
  const pullKey = pulls.map((p) => `${p.number}:${p.state}:${p.mergeCommit ?? ''}:${p.updatedAt}`).join(',');
  const key = createHash('sha1').update(`${main.sha}|${refs}|${pullKey}|${Math.floor(now / (6 * HOUR))}`).digest('hex');
  const slot = `${dir}|${main.sha}`;
  const hit = cache.get(slot);
  if (hit && hit.key === key) return hit.p;
  const p = readSnapshot(dir, main, now).then((s) => (s ? checkSnapshot(s, pulls, now) : undefined));
  cache.set(slot, { key, p });
  p.catch(() => cache.get(slot)?.p === p && cache.delete(slot));
  while (cache.size > 50) cache.delete(cache.keys().next().value!);
  return p.catch(() => undefined);
}
