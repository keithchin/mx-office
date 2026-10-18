// What the office reads, with git, for the build's progress and the BRDs' whereabouts (shared/build-progress.ts,
// shared/brd-path.ts), on the commit its gate-check described (origin/<default>) and the team's pushed
// branches: the build plan, docs/BUILD-LOG.md and mdlsource/ at that commit, its commits' subjects and the
// files each changed (the rows they name), the pull requests merged into it (merge commits "Merge pull
// request #N" and squashes "Title (#N)") with the build files each changed, the origin branches ahead of it
// that change build files (their own commits and BUILD-LOG, and their open PR from GitHub's list when the
// office has one), and the knowledge bases' brd/ folders. Read-only: `git show`, `git log`, `git ls-tree`,
// `git diff` in the floor's folder, off the event loop; nothing is fetched, written or run in the project.
// Kept per floor for a minute while the commit is the same (each branch's reading per commit pair for longer).

import { execFileOff } from '../offloop/exec.js';
import { claimsCheck } from '../claims/check.js';
import { claimedRows } from '../../shared/claims.js';
import { buildLog, isBuildPath, planRows, rowsByPlace, rowsIn, withClaimed, type BuildBranch, type BuildEvidence, type BuildLogInfo, type BuildPr, type CommitLine } from '../../shared/build-progress.js';
import type { BrdLayout } from '../../shared/brd-path.js';
import type { GhPull } from '../../shared/protocol/github.js';
import { dropKeys, onForgetFloor } from '../office/forget.js';

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

function git(args: string[], cwd: string, timeout = 20_000): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFileOff('git', args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout, env: ENV, windowsHide: true }, (err, out) => resolve(err ? undefined : String(out)));
  });
}

/** How long one floor's evidence is handed out again for the same commit (ms). */
export const BUILD_EVIDENCE_FRESH_MS = 60_000;
/** At most this many commits looked at on the default branch, and this many origin branches. */
const LOG_MAX = 1000;
const BRANCHES_MAX = 25;

const cache = new Map<string, { sha: string; at: number; p: Promise<{ build: BuildEvidence; kb: BrdLayout }> }>();
const branchReads = new Map<string, Promise<BranchRead | undefined>>();
onForgetFloor((f) => dropKeys(cache, f));

/** `git log` output with `--format=%x01%s%x02%b%x03 --name-only`: each commit's subject, body and files. */
function commitsOf(out: string | undefined): (CommitLine & { body: string })[] {
  if (!out) return [];
  return out
    .split('\x01')
    .slice(1)
    .map((block) => {
      const [head, rest = ''] = block.split('\x03');
      const [subject, body = ''] = head.split('\x02');
      return { subject: subject.trim(), body, files: rest.split('\n').map((f) => f.trim()).filter(Boolean) };
    });
}

const FORMAT = '--format=%x01%s%x02%b%x03';

/** The pull requests merged into `sha`'s first-parent history that changed build files, newest first. */
export async function mergedBuildPrs(dir: string, sha: string, pulls: readonly GhPull[] = []): Promise<BuildPr[]> {
  const out = await git(['log', '--first-parent', `-n${LOG_MAX}`, FORMAT, '--name-only', '--diff-merges=first-parent', '--no-renames', sha], dir, 60_000);
  const prs: BuildPr[] = [];
  for (const c of commitsOf(out)) {
    const merge = /^Merge pull request #(\d+) from \S+/.exec(c.subject);
    const squash = merge ? null : /^(.*\S)\s+\(#(\d+)\)$/.exec(c.subject);
    if (!merge && !squash) continue;
    const files = c.files.filter(isBuildPath).length;
    if (!files) continue;
    const number = Number(merge ? merge[1] : squash![2]);
    const gh = pulls.find((p) => p.number === number);
    const title = gh?.title || (merge ? c.body.split('\n').find((l) => l.trim())?.trim() || c.subject : squash![1]);
    const rows = rowsIn(title);
    prs.push({ number, title, files, ...(rows.length ? { rows } : {}) });
  }
  return prs;
}

/** One origin branch ahead of the default branch: how far, the build files it changes, its own commits and BUILD-LOG. */
interface BranchRead {
  ahead: number;
  files: number;
  commits: CommitLine[];
  log?: BuildLogInfo;
}

function readBranch(dir: string, sha: string, tip: string): Promise<BranchRead | undefined> {
  const k = `${dir}\0${sha}\0${tip}`;
  let p = branchReads.get(k);
  if (!p) {
    p = Promise.all([git(['rev-list', '--count', `${sha}..${tip}`], dir), git(['diff', '--name-only', '--no-renames', `${sha}...${tip}`], dir, 60_000)]).then(async ([n, names]) => {
      if (n === undefined || names === undefined) return undefined;
      const ahead = Number(n.trim()) || 0;
      const files = names.split('\n').filter((f) => f.trim() && isBuildPath(f.trim())).length;
      if (!ahead || !files) return { ahead, files, commits: [] };
      const [log, text] = await Promise.all([git(['log', '--no-merges', `-n${LOG_MAX}`, FORMAT, '--name-only', '--no-renames', `${sha}..${tip}`], dir, 60_000), git(['show', `${tip}:docs/BUILD-LOG.md`], dir)]);
      const l = buildLog(text);
      return { ahead, files, commits: commitsOf(log), ...(l ? { log: l } : {}) };
    });
    if (branchReads.size > 500) branchReads.clear();
    branchReads.set(k, p);
  }
  return p;
}

/** The origin branches ahead of `sha` that change build files, with their open PR and what they hold; open PRs naming rows whose branch isn't here too. */
export async function openBuildBranches(dir: string, def: string, sha: string, pulls: readonly GhPull[] = []): Promise<(BuildBranch & { read?: BranchRead; prRows?: number[] })[]> {
  const refs = (await git(['for-each-ref', '--sort=-committerdate', `--count=${BRANCHES_MAX + 2}`, '--format=%(refname)%02%(objectname)', 'refs/remotes/origin'], dir)) ?? '';
  const out: (BuildBranch & { read?: BranchRead; prRows?: number[] })[] = [];
  const seen = new Set<string>();
  for (const line of refs.split('\n')) {
    const [ref, tip] = line.trim().split('\x02');
    if (!ref || !tip) continue;
    const branch = ref.replace(/^refs\/remotes\/origin\//, '');
    if (branch === 'HEAD' || branch === def || seen.size >= BRANCHES_MAX) continue;
    seen.add(branch);
    const read = await readBranch(dir, sha, tip);
    if (!read || !read.ahead || !read.files) continue;
    const pr = pulls.find((p) => p.state === 'OPEN' && p.headRefName === branch);
    const prRows = pr ? rowsIn(pr.title) : [];
    out.push({ branch, ahead: read.ahead, files: read.files, ...(pr ? { pr: { number: pr.number, title: pr.title, ...(pr.isDraft ? { draft: true } : {}) } } : {}), read, ...(prRows.length ? { prRows } : {}) });
  }
  // An open PR whose branch was never fetched into this folder: counted only when its title names build rows.
  for (const p of pulls) {
    if (p.state !== 'OPEN' || seen.has(p.headRefName) || (p.baseRefName && p.baseRefName !== def)) continue;
    const prRows = rowsIn(p.title);
    if (prRows.length) out.push({ branch: p.headRefName, pr: { number: p.number, title: p.title, ...(p.isDraft ? { draft: true } : {}) }, prRows });
  }
  return out;
}

/** The knowledge bases at `sha` and the BRDs in each one's brd/ (shared/brd-path.ts). */
export async function brdLayoutAt(dir: string, sha: string): Promise<BrdLayout> {
  const names = async (p: string) => ((await git(['ls-tree', '--name-only', p ? `${sha}:${p}` : `${sha}^{tree}`], dir)) ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const analysis = await names('analysis');
  const nested: string[] = [];
  for (const d of analysis.filter((n) => n !== 'knowledge-base')) if ((await names(`analysis/${d}`)).includes('knowledge-base')) nested.push(`analysis/${d}/knowledge-base`);
  const flat = analysis.includes('knowledge-base');
  const root = (await names('')).includes('knowledge-base');
  const brds: Record<string, string[]> = {};
  for (const kb of [...nested, ...(flat ? ['analysis/knowledge-base'] : []), ...(root ? ['knowledge-base'] : [])]) {
    const files = (await names(`${kb}/brd`)).filter((f) => f.endsWith('.brd.json'));
    if (files.length) brds[kb] = files.map((f) => `${kb}/brd/${f}`);
  }
  return { nested, flat, root, brds };
}

/** Everything at once for one commit: the build evidence and the BRD layout. */
export async function readEvidence(dir: string, def: string, sha: string, pulls: readonly GhPull[] = []): Promise<{ build: BuildEvidence; kb: BrdLayout }> {
  const [plan, log, scripts, history, merged, open, kb] = await Promise.all([
    git(['show', `${sha}:architecture/build-plan.md`], dir),
    git(['show', `${sha}:docs/BUILD-LOG.md`], dir),
    git(['ls-tree', '-r', '--name-only', sha, '--', 'mdlsource'], dir),
    git(['log', '--no-merges', `-n${LOG_MAX}`, FORMAT, '--name-only', '--no-renames', sha], dir, 60_000),
    mergedBuildPrs(dir, sha, pulls),
    openBuildBranches(dir, def, sha, pulls),
    brdLayoutAt(dir, sha),
  ]);
  const p = planRows(plan);
  const l = buildLog(log);
  const n = (scripts ?? '').split('\n').filter((f) => /\.mdl$/i.test(f.trim()) && !/\.test\.mdl$/i.test(f.trim())).length;
  const rows = rowsByPlace({ commits: commitsOf(history), log: l, merged }, open.map((b) => ({ commits: b.read?.commits ?? [], log: b.read?.log, prRows: b.prRows })), p?.total);
  // Rows a claim calls applied that git doesn't back on the default branch (server/claims/): claimed, not evidenced.
  const claimed = claimedRows((await claimsCheck(dir, { branch: def, sha }, pulls).catch(() => undefined)) ?? []);
  const branches: BuildBranch[] = open.map(({ read: _read, prRows: _rows, ...b }, i) => ({ ...b, ...(rows.perBranch[i].length ? { rows: rows.perBranch[i] } : {}) }));
  return {
    build: { branch: def, sha, ...(p ? { plan: p } : {}), merged, open: branches, ...(l ? { log: l } : {}), ...(n ? { scripts: n } : {}), rows: withClaimed({ main: rows.main, branch: rows.branch, mentioned: rows.mentioned }, claimed) },
    kb,
  };
}

/** The floor's evidence for `sha`, shared for BUILD_EVIDENCE_FRESH_MS while the commit is the same. Never throws (undefined on a failure). */
export async function evidenceFor(dir: string, def: string, sha: string, pulls: readonly GhPull[] = [], now = Date.now()): Promise<{ build: BuildEvidence; kb: BrdLayout } | undefined> {
  const hit = cache.get(dir);
  let p = hit && hit.sha === sha && now - hit.at < BUILD_EVIDENCE_FRESH_MS ? hit.p : undefined;
  if (!p) {
    p = readEvidence(dir, def, sha, pulls);
    cache.set(dir, { sha, at: now, p });
    p.catch(() => cache.get(dir)?.p === p && cache.delete(dir));
  }
  return p.catch(() => undefined);
}
