// A pull request's checks, for the board's hover preview and the PR window: the newest run of the
// repo's pr-checks workflow on the PR's branch, its screenshots (downloaded from the run's artifact
// once, then served from the office's data folder), and the sticky scorecard comment, read with
// analysis/scorecard.ts. Asked on a hover, so answers are kept a minute and downloads never repeat.

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { scorecardRows, shotLabel, type PrChecks, type PrShot } from '../../shared/prshots.js';
import { gh } from '../github.js';
import { parseScorecard, SCORECARD_MARKER } from '../analysis/scorecard.js';

/** How long (ms) an answer is reused before GitHub is asked again. */
const FRESH_MS = 60_000;
const SHOTS_MAX = 12;
const DONE = '.downloaded';

export type GhRun = (args: string[], cwd: string) => Promise<string>;

export interface PrShotsOptions {
  /** The workflow file whose runs carry the screenshots (AGENT_OFFICE_PR_CHECKS_WORKFLOW). */
  workflow: string;
  /** Artifact names to look in, the first one a run has wins (AGENT_OFFICE_PR_SHOTS_ARTIFACTS). */
  artifacts: string[];
}

export const prShotsOptions = (env: NodeJS.ProcessEnv = process.env): PrShotsOptions => ({
  workflow: env.AGENT_OFFICE_PR_CHECKS_WORKFLOW || 'pr-checks.yml',
  artifacts: (env.AGENT_OFFICE_PR_SHOTS_ARTIFACTS || 'screenshots,test-results')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});

/** Where `repo`'s PR `pr` run `run` is kept: <data>/pr-shots/<owner_name>/<pr>/<run>. */
export const shotsDir = (dataDir: string, repo: string, pr: number, run: number) => path.join(dataDir, 'pr-shots', repo.replace(/[^\w.-]+/g, '_'), String(pr), String(run));

export class PrShots {
  private cache = new Map<string, { at: number; p: Promise<PrChecks> }>();
  private downloads = new Map<string, Promise<void>>();

  constructor(
    private dataDir: string,
    private opts: PrShotsOptions = prShotsOptions(),
    private run: GhRun = (args, cwd) => gh(args, cwd, 120_000),
  ) {}

  /** What pr-checks says about PR `pr` of `repo` (head branch `head`, when the board knows it). */
  checks(repo: string, cwd: string, pr: number, head?: string): Promise<PrChecks> {
    const key = `${repo}#${pr}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.p;
    const p = this.look(repo, cwd, pr, head);
    this.cache.set(key, { at: Date.now(), p });
    p.catch(() => this.cache.delete(key));
    return p;
  }

  /** The file for a screenshot `name` of a run, if it's one of that run's pictures. */
  file(repo: string, pr: number, run: number, name: string): string | undefined {
    const dir = shotsDir(this.dataDir, repo, pr, run);
    const full = path.resolve(dir, name);
    if (!full.startsWith(path.resolve(dir) + path.sep) || !/\.png$/i.test(full) || !existsSync(full)) return undefined;
    return full;
  }

  private async look(repo: string, cwd: string, pr: number, head?: string): Promise<PrChecks> {
    const out: PrChecks = { pr, rows: [], shots: [] };
    const notes: string[] = [];
    // The comment and the run don't need each other: ask for both at once.
    const [comments, branch] = await Promise.all([
      this.run(['api', `repos/${repo}/issues/${pr}/comments`, '--paginate', '--jq', '.[].body | @json'], cwd).catch((err: Error) => {
        notes.push(`comments: ${err.message}`);
        return '';
      }),
      head ? Promise.resolve(head) : this.run(['pr', 'view', String(pr), '-R', repo, '--json', 'headRefName', '--jq', '.headRefName'], cwd).then((s) => s.trim()),
    ]);
    const bodies = comments
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string);
    const sticky = bodies.reverse().find((b) => b.includes(SCORECARD_MARKER));
    if (sticky) {
      out.headline = /^#+\s*(.+)$/m.exec(sticky)?.[1]?.trim();
      out.rows = scorecardRows(sticky);
      out.scorecard = parseScorecard(sticky);
    }
    const runs = JSON.parse(
      (await this.run(['run', 'list', '-R', repo, '--branch', branch, '--workflow', this.opts.workflow, '--limit', '1', '--json', 'databaseId,status,conclusion,headSha,url,createdAt'], cwd).catch((err: Error) => {
        notes.push(`runs: ${err.message}`);
        return '[]';
      })) || '[]',
    ) as { databaseId: number; status: string; conclusion: string; headSha: string; url: string; createdAt: string }[];
    const r = runs[0];
    if (r) {
      out.run = { id: r.databaseId, status: r.status, conclusion: r.conclusion, sha: r.headSha, url: r.url, createdAt: r.createdAt };
      try {
        await this.download(repo, cwd, pr, r.databaseId);
        out.shots = listShots(shotsDir(this.dataDir, repo, pr, r.databaseId));
      } catch (err) {
        notes.push(`screenshots: ${(err as Error).message}`);
      }
    }
    if (notes.length) out.note = notes.join(' · ');
    return out;
  }

  /** Downloads the run's screenshot artifact once; a run still going is looked at again next time. */
  private download(repo: string, cwd: string, pr: number, run: number): Promise<void> {
    const dir = shotsDir(this.dataDir, repo, pr, run);
    if (existsSync(path.join(dir, DONE))) return Promise.resolve();
    let p = this.downloads.get(dir);
    if (!p) {
      p = (async () => {
        const listed = JSON.parse(await this.run(['api', `repos/${repo}/actions/runs/${run}/artifacts`, '--jq', '[.artifacts[] | {name, expired}]'], cwd)) as { name: string; expired: boolean }[];
        const name = this.opts.artifacts.find((n) => listed.some((a) => a.name === n && !a.expired));
        if (!name) {
          if (listed.some((a) => this.opts.artifacts.includes(a.name))) throw new Error('the artifact has expired');
          return; // Not uploaded (yet): nothing kept, so the next look tries again.
        }
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        await this.run(['run', 'download', String(run), '-R', repo, '-n', name, '-D', dir], cwd);
        writeFileSync(path.join(dir, DONE), `${name}\n`);
      })().finally(() => this.downloads.delete(dir));
      this.downloads.set(dir, p);
    }
    return p;
  }
}

/**
 * The PNGs in a downloaded artifact, named by the test they came from. Playwright's HTML report keeps
 * the same pictures again under hashed names (playwright-report/data), so those only count when
 * there's nothing else.
 */
export function listShots(dir: string): PrShot[] {
  const all: string[] = [];
  const walk = (d: string) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const full = path.join(d, n);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.png$/i.test(n)) all.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir);
  const named = all.filter((f) => !f.includes('playwright-report/data/'));
  return (named.length ? named : all)
    .sort()
    .slice(0, SHOTS_MAX)
    .map((name) => {
      const parts = name.split('/');
      return { name, label: shotLabel(parts.at(-2) ?? '', parts.at(-1)!) };
    });
}

const offices = new WeakMap<object, PrShots>();

export function prShotsOf(ctx: { cfg: { dataDir: string } }): PrShots {
  let s = offices.get(ctx.cfg);
  if (!s) {
    s = new PrShots(ctx.cfg.dataDir);
    offices.set(ctx.cfg, s);
  }
  return s;
}
