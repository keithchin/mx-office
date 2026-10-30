// The card sweep (release 82, team flow #2): open escalations whose subject is done are closed by the office with
// the reason recorded (./rules.ts says which), so Needs you's count is what's really waiting. Every two minutes,
// one project at a time, and soon after an escalation is raised or a merge lands (sweepSoon); local git only, off
// the event loop (`rev-parse`, `merge-base --is-ancestor`, `for-each-ref`), nothing fetched. A closed card keeps
// its words and says "Closed by the office: <reason>"; nothing is sent to the agent, and the person can see it in
// the card's history. Audited as `escalation.auto-resolved`.

import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { runGit, type Git } from '../gitgraph/index.js';
import { mainOf } from '../testing/repo.js';
import { audit, office } from '../audit/index.js';
import type { Escalation } from '../../shared/roster/escalation.js';
import type { Roster } from '../roster/index.js';
import { onEscalationRaised } from '../roster/raise-hooks.js';
import type { TeamFloor } from '../roster/types.js';
import { answeredElsewhere, commitAskOf, judgeCommitAsk, type AskFacts, type CommitAsk, type Sweep } from './rules.js';

/** How often each project's open cards are looked at. */
export const SWEEP_MS = 2 * 60_000;
/** At most this many cards' git facts per look (the newest first): a backlog is worked down over a few looks. */
const PER_LOOK = 25;

async function full(git: Git, dir: string, sha: string): Promise<string | undefined> {
  return (await git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], dir).catch(() => '')).trim() || undefined;
}

const ancestor = (git: Git, dir: string, a: string, b: string) =>
  git(['merge-base', '--is-ancestor', a, b], dir).then(
    () => true,
    () => false,
  );

/** What git says about one card's commits and branches, against every main tip given (origin's and the local one). */
export async function factsOf(git: Git, dir: string, ask: CommitAsk, mains: readonly string[], refs: ReadonlySet<string>): Promise<AskFacts> {
  const commits: AskFacts['commits'] = [];
  for (const s of ask.shas.slice(0, 6)) {
    const sha = await full(git, dir, s);
    if (!sha) continue;
    let onMain = false;
    for (const m of mains) if (!onMain && (sha === m || (await ancestor(git, dir, sha, m)))) onMain = true;
    commits.push({ sha, onMain });
  }
  const branches = ask.branches.slice(0, 6).map((name) => ({ name, exists: refs.has(name) }));
  return { commits, branches };
}

/** The branch names that exist here: local heads and origin's (without the remote's name). */
export async function branchNames(git: Git, dir: string): Promise<Set<string>> {
  const out = await git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'], dir).catch(() => '');
  const names = new Set<string>();
  for (const l of out.split('\n').map((x) => x.trim()).filter(Boolean)) {
    if (l.startsWith('refs/heads/')) names.add(l.slice('refs/heads/'.length));
    else if (l.startsWith('refs/remotes/')) names.add(l.slice('refs/remotes/'.length).replace(/^[^/]+\//, ''));
  }
  return names;
}

/** Which of a project's open cards are done: the pure rules over what git says. */
export async function sweepEscalations(all: readonly Escalation[], dir: string, git: Git, mains: readonly string[], mainName: string, now: number): Promise<Sweep[]> {
  const out: Sweep[] = [...answeredElsewhere(all)];
  const taken = new Set(out.map((s) => s.id));
  const asks = all
    .filter((e) => e.status === 'open' && !taken.has(e.id))
    .map((e) => ({ e, ask: commitAskOf(e) }))
    .filter((x): x is { e: Escalation; ask: CommitAsk } => !!x.ask)
    .sort((a, b) => b.e.at - a.e.at)
    .slice(0, PER_LOOK);
  if (!asks.length || !mains.length) return out;
  const refs = await branchNames(git, dir);
  for (const { e, ask } of asks) {
    const v = judgeCommitAsk(e, ask, await factsOf(git, dir, ask, mains, refs), mainName, now);
    if (v) out.push(v);
  }
  return out;
}

/** Closes one card as done (resolved, nothing sent), with its reason recorded; false when it isn't open any more. */
export function autoResolve(roster: Roster, floor: TeamFloor, s: Sweep): boolean {
  const e = roster.data(floor.id).escalations.find((x) => x.id === s.id);
  if (!e || e.status !== 'open') return false;
  e.status = 'resolved';
  e.resolution = { verdict: 'dismiss', text: `Closed by the office: ${s.reason}`, by: 'The office', at: roster.deps.now(), delivered: false, auto: { kind: s.kind, reason: s.reason } };
  audit.record({ floor: floor.id, actor: office(), action: 'escalation.auto-resolved', target: { kind: 'escalation', id: e.id, label: e.title }, summary: `Closed by the office, its subject is done: ${s.reason}: ${e.title}`, details: { kind: s.kind, reason: s.reason, by: e.by }, severity: 'info' });
  floor.activity?.(`🧹 Closed ${e.by}'s card, its subject is done (${s.reason}): ${e.title}`);
  return true;
}

/** The main tips to test against: origin's default branch (or HEAD) and the local branch of the same name. */
async function mainsOf(git: Git, dir: string): Promise<{ name: string; shas: string[] } | undefined> {
  const m = await mainOf(dir).catch(() => undefined);
  if (!m) return undefined;
  const local = await full(git, dir, `refs/heads/${m.branch}`);
  return { name: m.branch, shas: [...new Set([m.sha, ...(local ? [local] : [])])] };
}

/** One project's look: what's done is closed. Never throws; how many it closed. */
export async function sweepFloor(ctx: Ctx, floor: Floor, git: Git = runGit): Promise<number> {
  try {
    const { rosterOf, teamFloor } = await import('../roster/adapter.js');
    const roster = rosterOf(ctx);
    const all = roster.data(floor.id).escalations;
    if (!all.some((e) => e.status === 'open')) return 0;
    const mains = await mainsOf(git, floor.dir);
    const done = await sweepEscalations(all, floor.dir, git, mains?.shas ?? [], mains?.name ?? 'main', Date.now());
    if (!ctx.floors.has(floor.id)) return 0;
    const tf = teamFloor(ctx, floor);
    let n = 0;
    for (const s of done) if (autoResolve(roster, tf, s)) n++;
    if (n) roster.touch(tf);
    return n;
  } catch (err) {
    console.error(`agent-office: card sweep on ${floor.id}: ${(err as Error).message}`);
    return 0;
  }
}

let soonHook: ((floorId: string) => void) | undefined;

/** A look at one project soon (an escalation was raised, a merge landed); nothing before the sweep started. */
export function sweepSoon(floorId: string) {
  soonHook?.(floorId);
}

/** Starts the looks; returns what stops them. */
export function startCardSweep(ctx: Ctx): () => void {
  const due = new Set<string>();
  let running = false;
  let soonTimer: ReturnType<typeof setTimeout> | undefined;
  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (due.size) {
        const id = due.values().next().value!;
        due.delete(id);
        const f = ctx.floors.get(id);
        if (f) await sweepFloor(ctx, f);
      }
    } finally {
      running = false;
    }
  };
  soonHook = (floorId) => {
    due.add(floorId);
    clearTimeout(soonTimer);
    soonTimer = setTimeout(() => void drain(), 5_000);
    soonTimer.unref?.();
  };
  // A card just raised may already be done (a merge ask for a commit merged meanwhile).
  const offRaise = onEscalationRaised((floorId) => sweepSoon(floorId));
  const tick = setInterval(() => {
    for (const id of ctx.floors.keys()) due.add(id);
    void drain();
  }, SWEEP_MS);
  tick.unref?.();
  const first = setTimeout(() => {
    for (const id of ctx.floors.keys()) due.add(id);
    void drain();
  }, 45_000);
  first.unref?.();
  return () => {
    offRaise();
    clearInterval(tick);
    clearTimeout(first);
    clearTimeout(soonTimer);
    soonHook = undefined;
  };
}
