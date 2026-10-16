// An existing app's adoption, after the Project Manager pressed Adopt on the ✋ card, as an operation with
// stages: apply (mxcli theme in a temporary worktree on the branch agent-office/design-<theme>) → commit (the
// candidate) → push (that branch, never the default one, never forced) → merge (someone merges it: seen when
// the candidate commit is on origin/<default>, `git merge-base --is-ancestor`) → activate (only then does the
// project's binding change). Its record (DesignAdoption, ./projects.ts) is written before each consequential
// step, and `reconcileAdoption` puts it right with git after a restart: a step that was running is done when
// git shows it (the commit on the branch, the remote-tracking branch holding it), else it failed and Retry
// does it again. Until it's merged the project keeps its last active binding (or none) and the version is a
// candidate on its branch. A failure leaves the ✋ proposal and says the stage; Retry carries on from there.
//
// The branch is never deleted or rewritten when it holds commits the office didn't make: a branch whose every
// commit is already in the project's HEAD is started again from HEAD; any other is built on as it is (review
// edits and unrelated commits kept), and a local branch that has diverged from origin's is left for a person.

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findMpr } from '../liveapp/checkout.js';
import { git, gitRun, isAncestor, remoteDefault, revParse } from '../toolkit-pin/git.js';
import { ADOPTION_STAGES, type AdoptionStageId, type DesignAdoption, type PackageManifest, type ProjectDesignBinding } from '../../shared/design/types.js';
import { applyPackage, mxcliVersion } from './apply.js';
import type { AdoptEnv } from './adopt.js';
import { bindingOf } from './adopt.js';
import { PROJECT_FILE, writeProjectRecord } from './projects.js';
import { scanTheme } from './scan.js';
import { stageWords } from '../../shared/design/words.js';

/** Where a test stops the office as if it had been killed (the record is as it was written up to there). */
export type AdoptionPoint = 'prepared' | 'applied' | 'committed' | 'pushed';

export interface AdoptionEnv extends AdoptEnv {
  checkpoint?(point: AdoptionPoint): Promise<void>;
}

export type AdoptionResult = { ok: boolean; detail: string; adoption?: DesignAdoption };

const INTERRUPTED = 'the office stopped during this step';
export const branchOf = (m: Pick<PackageManifest, 'themeName'>) => `agent-office/design-${m.themeName}`;
export const settled = (a: DesignAdoption | undefined) => !a || a.status === 'active' || a.status === 'discarded';

function freshAdoption(env: AdoptEnv, floor: string, m: PackageManifest, by: string): DesignAdoption {
  const now = env.now();
  return { id: `ado_${now.toString(36)}_${m.digest.slice(0, 8)}`, key: `${floor}|${m.digest}`, floor, systemId: m.id, name: m.name, n: m.version, digest: m.digest, by, since: now, updatedAt: now, status: 'running', stages: Object.fromEntries(ADOPTION_STAGES.map((s) => [s, { state: 'pending' }])) as DesignAdoption['stages'] };
}

/** The record with `stage` set (and the status that follows), saved before the caller goes on. */
async function save(env: AdoptEnv, a: DesignAdoption, change: Partial<DesignAdoption> = {}, stage?: [AdoptionStageId, DesignAdoption['stages'][AdoptionStageId]['state'], string?]): Promise<DesignAdoption> {
  const next: DesignAdoption = { ...a, ...change, stages: { ...a.stages }, updatedAt: env.now() };
  if (stage) next.stages[stage[0]] = { state: stage[1], at: env.now(), ...(stage[2] ? { detail: stage[2].slice(0, 300) } : {}) };
  for (const k of Object.keys(change) as (keyof DesignAdoption)[]) if (change[k] === undefined) delete next[k];
  await env.projects.setAdoption(next);
  return next;
}

const fail = (env: AdoptEnv, a: DesignAdoption, stage: AdoptionStageId, detail: string, change: Partial<DesignAdoption> = {}) => save(env, a, { ...change, status: 'failed', failed: { stage, detail: detail.slice(0, 300), at: env.now() } }, [stage, 'failed', detail]);

const hasOrigin = async (dir: string) => (await gitRun(['remote', 'get-url', 'origin'], dir)).ok;

/** The project file on `ref` records this very package (a squash merge carries the content, not the commit). */
async function recordedOn(dir: string, ref: string, digest: string): Promise<boolean> {
  try {
    const d = (JSON.parse((await git(['show', `${ref}:${PROJECT_FILE}`], dir)) ?? '{}') as { design?: { digest?: unknown } }).design;
    return d?.digest === digest;
  } catch {
    return false;
  }
}

/**
 * The default branch the candidate is on: origin's when the project has a remote (as fetched), else its local
 * main/master. On it means the commit is an ancestor of it, or (a squash merge) its agent-office.project.json
 * records this package's digest.
 */
export async function mergedInto(dir: string, sha: string, digest: string): Promise<string | undefined> {
  const remote = await remoteDefault(dir);
  const refs = remote ? [[remote, `refs/remotes/origin/${remote}`]] : (await hasOrigin(dir)) ? [] : [['main', 'refs/heads/main'], ['master', 'refs/heads/master']];
  for (const [name, ref] of refs) {
    if (!(await revParse(dir, ref))) continue;
    if ((await isAncestor(dir, sha, ref)) || (await recordedOn(dir, ref, digest))) return name;
  }
  return undefined;
}

/** The candidate commit the office made for this adoption on `ref`, when it's there (found by the package digest in its message). */
async function ourCommit(dir: string, a: DesignAdoption, ref: string): Promise<string | undefined> {
  if (!(await revParse(dir, ref))) return undefined;
  const out = await git(['log', '--format=%H', '-1', `--grep=digest ${a.digest}`, '--fixed-strings', ...(a.base ? [`${a.base}..${ref}`] : [ref])], dir);
  return out || undefined;
}

async function dropWorktree(dir: string, wt: string | undefined) {
  if (!wt) return;
  await gitRun(['worktree', 'remove', '--force', '--force', wt], dir, 60_000);
  await rm(wt, { recursive: true, force: true }).catch(() => undefined);
  await gitRun(['worktree', 'prune'], dir);
}

/**
 * The worktree on the adoption's branch: a new branch from `base`; a branch whose commits are all in `base`
 * started again from it (nothing lost); otherwise the branch as it is (local, or origin's when the local one
 * is behind it or missing), its commits kept. Diverged local and origin branches are refused.
 */
async function openBranch(dir: string, branch: string, base: string, tmp: string): Promise<{ ok: true; created: boolean; preserved: number } | { ok: false; detail: string }> {
  const local = await revParse(dir, `refs/heads/${branch}`);
  const remote = await revParse(dir, `refs/remotes/origin/${branch}`);
  let tip = local ?? remote;
  if (local && remote && local !== remote) {
    if (await isAncestor(dir, local, remote)) tip = remote;
    else if (!(await isAncestor(dir, remote, local))) return { ok: false, detail: `${branch} and origin/${branch} have diverged: nothing is forced, bring them together by hand, then Retry` };
  }
  const add = async (args: string[]) => {
    const r = await gitRun(['worktree', 'add', ...args], dir, 120_000);
    return r.ok ? undefined : `couldn't check out ${branch}: ${r.err.slice(0, 200)}`;
  };
  if (!tip) {
    const err = await add(['-b', branch, tmp, base]);
    return err ? { ok: false, detail: err } : { ok: true, created: true, preserved: 0 };
  }
  if (await isAncestor(dir, tip, base)) {
    // Every commit on it is in the project already: start it again from there (-B moves it; nothing is lost).
    const err = await add(['-B', branch, tmp, base]);
    return err ? { ok: false, detail: err } : { ok: true, created: false, preserved: 0 };
  }
  const err = tip === local ? await add([tmp, branch]) : await add(['-B', branch, tmp, tip]);
  if (err) return { ok: false, detail: err };
  const theirs = ((await git(['log', '--format=%s', `${base}..${tip}`], dir)) ?? '').split('\n').filter((s) => s && !s.startsWith('design: adopt '));
  return { ok: true, created: false, preserved: theirs.length };
}

/** Apply and commit on the branch (the candidate); the record says where it got to. */
async function applyAndCommit(env: AdoptionEnv, a: DesignAdoption, floorDir: string, m: PackageManifest, approval: ProjectDesignBinding['approval']): Promise<DesignAdoption> {
  const mxcli = env.mxcli();
  if (!mxcli) return fail(env, a, 'apply', 'mxcli isn’t set up on the office’s machine (🔌 Connections › Paths): the design system can’t be applied');
  const mprHere = findMpr(floorDir);
  if (!mprHere) return fail(env, a, 'apply', 'no .mpr in the project: nothing to apply the design system to');
  const base = await revParse(floorDir, 'HEAD');
  if (!base) return fail(env, a, 'apply', 'the project folder has no commit to build on');
  const branch = branchOf(m);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ao-design-'));
  a = await save(env, a, { status: 'running', branch, base, worktree: tmp, failed: undefined }, ['apply', 'started']);
  await env.checkpoint?.('prepared');
  let created = false;
  let sha: string | undefined;
  try {
    const opened = await openBranch(floorDir, branch, base, tmp);
    if (!opened.ok) return await fail(env, a, 'apply', opened.detail);
    created = opened.created;
    const mpr = path.join(tmp, path.relative(floorDir, mprHere));
    const appDir = path.dirname(mpr);
    const scan = await scanTheme(appDir);
    const version = await mxcliVersion(mxcli, env.run);
    const r = await applyPackage({ appDir, mpr, themeName: m.themeName!, tokensFile: path.join(env.packageDir(m.id, m.version), 'tokens.css'), title: `${m.name} v${m.version}`, mxcli, run: env.run, log: env.log });
    if (!r.ok) return await fail(env, a, 'apply', r.detail, { preserved: opened.preserved });
    const warnings = version !== m.compat.mxcli ? [`Applied with mxcli ${version}; the package was published with mxcli ${m.compat.mxcli}.`] : undefined;
    const own = scan.start === `mxcli:${m.themeName}`;
    const binding: ProjectDesignBinding = { ...bindingOf(m, approval, own ? (a.binding?.start ?? scan.start) : scan.start), applied: { at: env.now(), fences: r.fences, mxcli: version, branch }, ...(warnings ? { warnings } : {}) };
    try {
      await writeProjectRecord(tmp, binding);
    } catch (err) {
      return await fail(env, a, 'apply', (err as Error).message, { preserved: opened.preserved });
    }
    a = await save(env, a, { binding, preserved: opened.preserved }, ['apply', 'done', r.detail]);
    await env.checkpoint?.('applied');
    a = await save(env, a, {}, ['commit', 'started']);
    await gitRun(['-c', 'core.safecrlf=false', 'add', '-A'], tmp, 120_000);
    const staged = !(await gitRun(['diff', '--cached', '--quiet'], tmp)).ok;
    if (staged) {
      const who = (await gitRun(['config', 'user.email'], tmp)).out.trim() ? [] : ['-c', 'user.name=Agent Office', '-c', 'user.email=agent-office@localhost'];
      const c = await gitRun([...who, '-c', 'core.safecrlf=false', 'commit', '-q', '-m', `design: adopt ${m.name} v${m.version}`, '-m', `Branded Atlas package ${m.id} v${m.version} (digest ${m.digest}), applied with mxcli theme as ${m.themeName}. Approved by ${approval.by} on the decision card. Only theme/web, theme/mxcli-themes and agent-office.project.json change.`], tmp, 120_000);
      if (!c.ok) return await fail(env, a, 'commit', `the commit failed: ${(c.err || c.out).slice(0, 200)}`);
    }
    sha = await revParse(tmp, 'HEAD');
    await env.checkpoint?.('committed');
    if (!sha) return await fail(env, a, 'commit', 'the commit isn’t there after committing');
    return await save(env, a, { commit: sha }, ['commit', 'done', staged ? `committed ${sha.slice(0, 7)} on ${branch}` : `nothing new to commit: ${branch} at ${sha.slice(0, 7)} already has it`]);
  } finally {
    await dropWorktree(floorDir, tmp);
    // A branch made just now that never got a commit (still at base: nothing of anyone's on it) goes again; any other stays.
    if (created && !sha && (await revParse(floorDir, `refs/heads/${branch}`)) === base) await gitRun(['branch', '-D', branch], floorDir);
    const now = env.projects.adoption(a.floor);
    if (now?.worktree === tmp) await save(env, now, { worktree: undefined });
  }
}

/** Push the candidate's branch (never forced, never the default branch). */
async function push(env: AdoptionEnv, a: DesignAdoption, floorDir: string): Promise<DesignAdoption> {
  if (!(await hasOrigin(floorDir))) return save(env, a, { remote: 'no-remote' }, ['push', 'skipped', 'the project has no remote: the branch is local']);
  a = await save(env, a, {}, ['push', 'started']);
  // The branch as it is when it holds the candidate (review edits on top go too), else the candidate itself.
  const tip = await revParse(floorDir, `refs/heads/${a.branch}`);
  const what = tip && (await isAncestor(floorDir, a.commit!, tip)) ? `refs/heads/${a.branch}` : a.commit;
  const r = await gitRun(['push', '-q', 'origin', `${what}:refs/heads/${a.branch}`], floorDir, 5 * 60_000);
  await env.checkpoint?.('pushed');
  if (!r.ok) return fail(env, a, 'push', `committed locally, not pushed: ${(r.err || r.out).slice(0, 200)}`, { remote: 'failed' });
  return save(env, a, { remote: 'pushed', status: 'candidate', failed: undefined }, ['push', 'done', `pushed ${a.branch}`]);
}

/** Merged into the default branch? Then the candidate becomes the project's binding (one write); else it stays a candidate. */
export async function checkMerge(env: AdoptEnv, a: DesignAdoption, floorDir: string): Promise<DesignAdoption> {
  if (!a.commit || !a.binding || settled(a)) return a;
  const into = await mergedInto(floorDir, a.commit, a.digest);
  if (!into) {
    if (a.status === 'failed') return a;
    return a.status === 'candidate' && a.stages.merge.state === 'pending' ? a : save(env, a, { status: 'candidate' }, ['merge', 'pending']);
  }
  const done: DesignAdoption = { ...a, status: 'active', into, failed: undefined, updatedAt: env.now(), stages: { ...a.stages, merge: { state: 'done', at: env.now(), detail: `${a.commit.slice(0, 7)} is on ${into}` }, activate: { state: 'done', at: env.now() } } };
  delete done.failed;
  await env.projects.activate(done, a.binding);
  return done;
}

/** Adopt (or Retry): carries on from where the record stopped. */
export async function runAdoption(env: AdoptionEnv, floor: string, floorDir: string, m: PackageManifest, approval: ProjectDesignBinding['approval']): Promise<AdoptionResult> {
  const key = `${floor}|${m.digest}`;
  let a = env.projects.adoption(floor);
  if (a && !settled(a) && a.key !== key) return { ok: false, detail: `${a.name} v${a.n}'s adoption is still open on this project: discard it first` };
  if (!a || a.key !== key || a.status === 'discarded') a = freshAdoption(env, floor, m, approval.by);
  else if (a.status === 'active') return { ok: true, detail: `${m.name} v${m.version} is already adopted (merged into ${a.into ?? 'the default branch'})`, adoption: a };
  if (m.kind === 'atlas') {
    // Atlas defaults change no file: the decision itself is the evidence, and the office's book records it.
    const mprHere = findMpr(floorDir);
    if (!mprHere) return { ok: false, detail: 'no .mpr in the project: nothing to apply the design system to', adoption: await fail(env, a, 'apply', 'no .mpr in the project') };
    const scan = await scanTheme(path.dirname(mprHere));
    const skipped = { state: 'skipped' as const, at: env.now(), detail: 'Atlas defaults: no file changes' };
    const done: DesignAdoption = { ...a, status: 'active', updatedAt: env.now(), stages: { apply: skipped, commit: skipped, push: skipped, merge: skipped, activate: { state: 'done', at: env.now() } } };
    delete done.failed;
    await env.projects.activate(done, bindingOf(m, approval, scan.start));
    return { ok: true, detail: `${m.name} v${m.version} (Atlas defaults) recorded; no file changed`, adoption: done };
  }
  if (!a.commit || a.stages.commit.state !== 'done') {
    a = await applyAndCommit(env, a, floorDir, m, approval);
    if (a.status === 'failed') return { ok: false, detail: `${stageWords(a.failed!.stage)} failed: ${a.failed!.detail}`, adoption: a };
  }
  if (a.stages.push.state !== 'done' && a.stages.push.state !== 'skipped') a = await push(env, a, floorDir);
  a = await checkMerge(env, a, floorDir);
  if (a.status === 'active') return { ok: true, detail: `${m.name} v${m.version} adopted: ${a.commit!.slice(0, 7)} is on ${a.into}`, adoption: a };
  if (a.status === 'failed') return { ok: false, detail: a.failed!.detail, adoption: a };
  return { ok: true, detail: `${m.name} v${m.version} committed on ${a.branch}${a.remote === 'pushed' ? ' and pushed' : ' (a local branch: the project has no remote)'}: a candidate until it's merged into the default branch`, adoption: a };
}

/** Whether origin has the candidate on its branch (the remote-tracking branch, else asking origin). */
async function onRemote(dir: string, a: DesignAdoption): Promise<boolean> {
  if (!a.commit || !a.branch) return false;
  const tracking = await revParse(dir, `refs/remotes/origin/${a.branch}`);
  if (tracking && (await isAncestor(dir, a.commit, tracking))) return true;
  const there = ((await git(['ls-remote', 'origin', `refs/heads/${a.branch}`], dir, 60_000)) ?? '').split(/\s/)[0];
  return !!there && (there === a.commit || (await isAncestor(dir, a.commit, there)));
}

/** A candidate committed before a restart and not pushed: local only when there's no remote, else the push failed. */
async function notPushed(env: AdoptEnv, a: DesignAdoption, dir: string): Promise<DesignAdoption> {
  if (!(await hasOrigin(dir))) return save(env, a, { remote: 'no-remote', status: 'candidate' }, ['push', 'skipped', 'the project has no remote: the branch is local']);
  return fail(env, a, 'push', `committed locally, not pushed: ${INTERRUPTED}`, { remote: 'failed' });
}

/** After a restart (or before a view): a step that was running is put right from what git shows. */
export async function reconcileAdoption(env: AdoptEnv, floor: string, floorDir: string): Promise<DesignAdoption | undefined> {
  let a = env.projects.adoption(floor);
  if (!a || settled(a)) return a;
  if (a.worktree) {
    await dropWorktree(floorDir, a.worktree);
    a = await save(env, a, { worktree: undefined });
  }
  const st = a.stages;
  if (st.apply.state === 'started' || (a.status === 'running' && st.apply.state === 'pending')) return fail(env, a, 'apply', `${INTERRUPTED}: Retry applies it again`);
  if (st.commit.state === 'started' || (a.status === 'running' && st.commit.state === 'pending')) {
    const sha = a.branch ? await ourCommit(floorDir, a, `refs/heads/${a.branch}`) : undefined;
    if (!sha) return fail(env, a, 'commit', `${INTERRUPTED} and no commit was made: Retry commits it`);
    a = await save(env, a, { commit: sha, status: 'candidate' }, ['commit', 'done', `committed ${sha.slice(0, 7)} on ${a.branch} (found after a restart)`]);
    if (a.stages.push.state === 'pending') a = await notPushed(env, a, floorDir);
  } else if (st.push.state === 'started') {
    a = (await onRemote(floorDir, a)) ? await save(env, a, { remote: 'pushed', status: 'candidate', failed: undefined }, ['push', 'done', `pushed ${a.branch} (found after a restart)`]) : await fail(env, a, 'push', `committed locally, not pushed: ${INTERRUPTED}`, { remote: 'failed' });
  } else if (a.status === 'running' && a.commit && st.push.state === 'pending') {
    a = await notPushed(env, a, floorDir);
  }
  return checkMerge(env, a, floorDir);
}

/** Discard (or Keep existing design over it): the record says so; the branch is deleted only when the office alone made it and it was never pushed. */
export async function discardAdoption(env: AdoptEnv, floor: string, floorDir: string): Promise<{ adoption?: DesignAdoption; branchKept?: string }> {
  const a = env.projects.adoption(floor);
  if (!a || settled(a)) return {};
  await dropWorktree(floorDir, a.worktree);
  let branchKept: string | undefined = a.branch;
  if (a.branch && a.commit && a.remote !== 'pushed' && !a.preserved) {
    const tip = await revParse(floorDir, `refs/heads/${a.branch}`);
    const parent = tip ? await revParse(floorDir, `${tip}^`) : undefined;
    // Only the office's own commit on top of where it started: nothing of anyone else's goes with it.
    if (tip === a.commit && parent && parent === a.base && (await gitRun(['branch', '-D', a.branch], floorDir)).ok) branchKept = undefined;
  } else if (a.branch && !a.commit && (await revParse(floorDir, `refs/heads/${a.branch}`)) === a.base && !a.preserved) {
    if ((await gitRun(['branch', '-D', a.branch], floorDir)).ok) branchKept = undefined;
  }
  if (branchKept && !(await revParse(floorDir, `refs/heads/${branchKept}`))) branchKept = undefined;
  const out = await save(env, a, { status: 'discarded', worktree: undefined });
  return { adoption: out, ...(branchKept ? { branchKept } : {}) };
}
