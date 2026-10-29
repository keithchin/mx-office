// The toolkit stage a project is in, for attributing spend: read the way the setup panel reads it, from
// the project's default branch on origin (gate-source.ts: a quiet fetch of origin/<default> at most every
// minute and a half, PROJECT.md, intake.md and index.html with `git show`), so the ledger and the setup
// panel agree even when the floor's folder sits on an old branch. The first stage not settled; past the
// build plan (Stage 4), the first of 5-7 gate-check hasn't passed. "—" without the toolkit's pipeline.
// Booking can't wait on git, so the stage is kept per floor and read again in the background at most
// once a minute; until the first read lands (and for a project with no remote) the floor's folder is read.
//
// Main lags the team (release 81): a team works its stage's documents on branches, and PROJECT.md reaches main
// only when they're merged, so spend was booked to "Stage P" for days while the team had confirmed Stage 0 and 1
// on its branches, and the forecast warned about Stage P wrongly. So the team's recent branches on origin (the
// newest BRANCH_MAX, committed within BRANCH_DAYS, their PROJECT.md only) and the floor folder's own branch are read too, each tip once
// (kept by commit), and when one has a later stage settled than main, that stage is used, and said: where it came
// from and what main still says (stageSourceOf, shown under the Budget tab's stage table).

import { dropKeys, onForgetFloor } from '../office/forget.js';
import { execFileOff } from '../offloop/exec.js';
import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STAGE_IDS, type StageId } from '../../shared/budget/types.js';
import { decisions, stageVerdicts } from '../summary/project.js';
import { branchInfo, fetchDefault, GATE_FILES, showAt } from '../wizard/gate-source.js';
import { setupView, setupViewOf } from '../wizard/setup.js';

/** How often at most a floor's stage is read from origin again. */
const REFRESH_MS = 60_000;

const settled = (status: string) => status === 'PASS' || status === 'WAIVED';

/** The stage from the gate files' text (read with `read`). */
export function stageFrom(view: ReturnType<typeof setupViewOf>, indexHtml: string | undefined): StageId {
  if (!view.stages.length) return '—';
  if (view.show) return (view.stages.find((s) => !settled(s.status))?.id as StageId | undefined) ?? '4';
  if (!indexHtml) return '5';
  const v = new Map(stageVerdicts(indexHtml).map((x) => [x.id, x.status]));
  return (['5', '6', '7'] as const).find((id) => !settled(v.get(id) ?? '')) ?? '7';
}

/** The stage from the floor's folder (no remote, or until origin has been read). */
export function folderStage(dir: string): StageId {
  try {
    let html: string | undefined;
    try {
      statSync(path.join(dir, 'index.html'));
      html = readFileSync(path.join(dir, 'index.html'), 'utf8');
    } catch {
      html = undefined;
    }
    return stageFrom(setupView(dir), html);
  } catch {
    return '—';
  }
}

/** Where the stage in use came from when main lags: the branch it's settled on, and what main says. */
export interface StageSource {
  main: StageId;
  branch: string;
}

const cache = new Map<string, { stage: StageId; at: number; via?: StageSource }>();
const reading = new Set<string>();
onForgetFloor((f) => (dropKeys(cache, f), dropKeys(reading, f)));

/** How many of the team's newest branches are read, and how recent they must be. */
export const BRANCH_MAX = 8;
export const BRANCH_DAYS = 14;

/** How far along a stage is (P first); '—' is before everything. */
const rank = (s: StageId) => (s === '—' ? -1 : STAGE_IDS.indexOf(s));

/** The later of two stages. */
export const laterStage = (a: StageId, b: StageId): StageId => (rank(b) > rank(a) ? b : a);

const gitOut = (dir: string, args: string[], input?: string) =>
  new Promise<string | undefined>((resolve) => execFileOff('git', args, { cwd: dir, ...(input !== undefined ? { input } : {}), timeout: 20_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } }, (err, out) => resolve(err ? undefined : out)));

/** The team's recent branches on origin not merged into the default yet, newest first: name and tip. */
export async function teamBranches(dir: string, def: string, now = Date.now()): Promise<{ name: string; sha: string }[]> {
  const out = await gitOut(dir, ['for-each-ref', '--sort=-committerdate', `--count=${BRANCH_MAX + 2}`, '--format=%(refname:short)%09%(objectname)%09%(committerdate:unix)', `--no-merged=refs/remotes/origin/${def}`, 'refs/remotes/origin']);
  if (!out) return [];
  const since = now / 1000 - BRANCH_DAYS * 86_400;
  return out
    .split(/\r?\n/)
    .map((l) => l.split('\t'))
    .filter(([name, sha, at]) => name && sha && name !== 'origin/HEAD' && name !== 'origin' && name !== `origin/${def}` && Number(at) >= since)
    .slice(0, BRANCH_MAX)
    .map(([name, sha]) => ({ name: name.replace(/^origin\//, ''), sha }));
}

/** stageFrom, with each stage the register's Decisions mark CONFIRMED counted as settled. */
export function registerStage(view: ReturnType<typeof setupViewOf>, register: string | undefined, indexHtml: string | undefined): StageId {
  const confirmed = new Set((register ? decisions(register) : []).filter((r) => /^confirmed/i.test(r.status)).map((r) => r.stage));
  if (!confirmed.size || !view.show) return stageFrom(view, indexHtml);
  const stages = view.stages.map((s) => (confirmed.has(s.id) ? { ...s, status: 'PASS' } : s));
  return stageFrom({ ...view, stages, show: !stages.every((s) => settled(s.status)) }, indexHtml);
}

/** Each PROJECT.md text a branch tip had, by its blob id (read once). */
const blobs = new Map<string, string>();
/** Per floor: the branch tips last looked at and what they came to, so an unchanged set costs one git call a minute. */
const lastLook = new Map<string, { key: string; best?: { stage: StageId; branch: string } }>();
onForgetFloor((f) => dropKeys(lastLook, f));

/**
 * The latest stage the team has settled on a branch main hasn't got yet, when it's later than main's: main's own
 * view with the stages a branch's PROJECT.md marks CONFIRMED counted as settled. Only PROJECT.md is read on the
 * branches (the register is what the team updates there), each version once: one `git for-each-ref` a minute while
 * nothing moved, one `git cat-file --batch-check` when a tip did, and the text of a PROJECT.md only when it's new.
 */
export async function branchStage(dir: string, info: { def: string; branch: string }, mainView: ReturnType<typeof setupViewOf>, main: StageId, mainHtml: string | undefined, now = Date.now()): Promise<(StageSource & { stage: StageId }) | undefined> {
  if (main === '—') return undefined;
  const branches = await teamBranches(dir, info.def, now);
  const key = `${main}|${info.branch}|${branches.map((b) => b.sha).join(',')}`;
  const last = lastLook.get(dir);
  let best: { stage: StageId; branch: string } | undefined;
  if (last?.key === key && info.branch === info.def) best = last.best;
  else {
    const stageWith = (register: string | undefined) => registerStage(mainView, register, mainHtml);
    if (branches.length) {
      const ids = await gitOut(dir, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], branches.map((b) => `${b.sha}:PROJECT.md`).join('\n') + '\n');
      const lines = (ids ?? '').split(/\r?\n/);
      for (const [i, b] of branches.entries()) {
        const [blob, type] = (lines[i] ?? '').split(' ');
        if (type !== 'blob') continue;
        let text = blobs.get(blob);
        if (text === undefined) {
          text = (await gitOut(dir, ['cat-file', '-p', blob])) ?? '';
          if (blobs.size > 200) blobs.clear();
          blobs.set(blob, text);
        }
        const s = stageWith(text);
        if (rank(s) > rank(best?.stage ?? main)) best = { stage: s, branch: b.name };
      }
    }
    // The floor's own folder, when it's on a branch of its own (its PROJECT.md as it is).
    if (info.branch !== info.def && info.branch !== 'HEAD') {
      const s = stageWith(await readFile(path.join(dir, 'PROJECT.md'), 'utf8').catch(() => undefined));
      if (rank(s) > rank(best?.stage ?? main)) best = { stage: s, branch: info.branch };
    }
    lastLook.set(dir, { key, ...(best ? { best } : {}) });
  }
  return best ? { ...best, main } : undefined;
}

/** Reads the stage from origin/<default> into the cache (the folder's when there's no remote). */
export async function refreshStage(dir: string, now = Date.now()): Promise<StageId> {
  let stage: StageId;
  try {
    const before = await branchInfo(dir);
    if (!before) stage = folderStage(dir);
    else {
      await fetchDefault(dir, before.def);
      const info = (await branchInfo(dir)) ?? before;
      const files: Partial<Record<(typeof GATE_FILES)[number], string>> = {};
      for (const f of GATE_FILES) {
        const text = await showAt(dir, info.sha, f);
        if (text !== undefined) files[f] = text;
      }
      // A stage the team CONFIRMED in the register counts as settled, on main as on its branches.
      stage = registerStage(setupViewOf(files), files['PROJECT.md'], files['index.html']);
      // Main lags the team: a later stage settled on its branches is the one in use (and said).
      const ahead = await branchStage(dir, info, setupViewOf(files), stage, files['index.html'], now).catch(() => undefined);
      if (ahead) {
        cache.set(dir, { stage: ahead.stage, at: now, via: { main: ahead.main, branch: ahead.branch } });
        return ahead.stage;
      }
    }
  } catch {
    stage = folderStage(dir);
  }
  cache.set(dir, { stage, at: now });
  return stage;
}

/** Where the stage in use came from when it isn't main's (a team branch ahead of main), as last read. */
export function stageSourceOf(dir: string): StageSource | undefined {
  return cache.get(dir)?.via;
}

/** The stage the project in `dir` is in now (as last read; a fresh read starts in the background when due). */
export function currentStage(dir: string): StageId {
  const hit = cache.get(dir);
  if ((!hit || Date.now() - hit.at > REFRESH_MS) && !reading.has(dir)) {
    reading.add(dir);
    void refreshStage(dir).finally(() => reading.delete(dir));
  }
  return hit?.stage ?? folderStage(dir);
}
