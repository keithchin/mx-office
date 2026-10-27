// What a Developer change's receipt may merge for a local-only project (rules and words in
// shared/merge-target.ts): every branch that may carry the change, at the commit that would merge, with what it
// is (model or code applied, a script draft, notes only) and the checks recorded at exactly that commit. The
// branches: `dev/DC-n`, the branch of the worker it was handed to, a branch an agent asked to have merged for it
// (an escalation naming the change and a commit on that branch), and branches whose own commits name it. Merge
// asks are read from the team's escalations (open, or answered in the last three days). Git off the event loop;
// a commit's facts are kept by describe.ts.

export { mergeAsks } from './asks.js';

import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { gitGraphsOf, runGit, type Git } from '../gitgraph/index.js';
import { mergeAsks } from './asks.js';
import { askNames, judge, pickTarget, targetKind, type MergeAsk, type MergeOption, type MergeTargets, type TargetVia } from '../../shared/merge-target.js';
import { kindAt, resultsAt } from './describe.js';
import { isAncestor, ref, targetOf } from './index.js';

/** The change as targets needs it. */
export interface TargetChange {
  id: string;
  aliases?: readonly string[];
  workerId?: string;
}

/** Each branch that may carry the change, with its facts, and what the receipt picks. */
export async function mergeTargetsFor(ctx: Ctx, floor: Floor, c: TargetChange, opts: { git?: Git; asks?: readonly MergeAsk[] } = {}): Promise<MergeTargets> {
  const git = opts.git ?? runGit;
  const g = await gitGraphsOf(ctx).graph(floor);
  const main = g.defaultBranch;
  const target = await targetOf(git, floor.dir, main);
  const ids = [c.id, ...(c.aliases ?? [])];
  const asks = (opts.asks ?? mergeAsks(ctx, floor.id)).filter((a) => askNames(a, ids));
  const local = g.branches.filter((b) => b.name !== main && b.where !== 'remote');
  const found = new Map<string, { via: Set<TargetVia>; owner?: string; asked?: { sha: string; by: string; at: number } }>();
  const add = (branch: string, via: TargetVia, owner?: string) => {
    const had = found.get(branch) ?? { via: new Set<TargetVia>() };
    had.via.add(via);
    if (owner && !had.owner) had.owner = owner;
    found.set(branch, had);
    return had;
  };
  for (const b of local) {
    if (b.name === `dev/${c.id}`) add(b.name, 'dc-branch', b.worker?.name);
    if (c.workerId && b.worker?.id === c.workerId) add(b.name, 'worker', b.worker.name);
  }
  // An agent's request to merge a commit for this change: the branch it names, or the branch that has the commit.
  for (const a of asks) {
    for (const sha of a.shas) {
      const full = await ref(git, floor.dir, sha);
      if (!full) continue;
      const named = local.filter((b) => a.branches.includes(b.name));
      const on: typeof local = [];
      for (const b of named.length ? named : local) if (b.sha === full || (await isAncestor(git, floor.dir, full, b.sha))) on.push(b);
      for (const b of on.slice(0, 2)) {
        const had = add(b.name, 'asked', b.worker?.name);
        if (!had.asked || had.asked.at < a.at) had.asked = { sha: full, by: a.by, at: a.at };
      }
    }
  }
  // Branches whose own commits name the change (the lead's work often says "DC-9" only in a subject).
  const name = new RegExp(`(^|[^\\w-])(${ids.map((x) => x.replace(/-/g, '\\-')).join('|')})(?![\\w-])`);
  for (const b of local.filter((x) => x.ahead > 0 && !found.has(x.name)).slice(0, 12)) {
    const subjects = await git(['log', '-n30', '--format=%s', `${target}..${b.sha}`], floor.dir).catch(() => '');
    if (name.test(subjects)) add(b.name, 'named', b.worker?.name);
  }
  const options: MergeOption[] = [];
  for (const [branch, f] of [...found].slice(0, 6)) {
    const head = await ref(git, floor.dir, `refs/heads/${branch}`);
    if (!head) continue;
    const sha = f.asked && (f.asked.sha === head || (await isAncestor(git, floor.dir, f.asked.sha, head))) ? f.asked.sha : head;
    if (await isAncestor(git, floor.dir, sha, target)) continue;
    const [what, results, subject] = await Promise.all([
      kindAt(git, floor.dir, target, sha),
      resultsAt(ctx, floor.id, sha),
      git(['log', '-1', '--format=%s', sha], floor.dir).then(
        (s) => s.trim(),
        () => '',
      ),
    ]);
    const kind = what.kind === 'notes' ? 'notes' : targetKind(what.paths);
    const checks = [...results.checks, ...results.journeys];
    const j = judge({ kind, checks, sha });
    const asked = f.asked && f.asked.sha === sha ? { by: f.asked.by, at: f.asked.at } : undefined;
    options.push({ branch, sha, head, subject, ...(f.owner ? { owner: f.owner } : {}), via: [...f.via], kind, files: what.files, checks, ...(asked ? { asked } : {}), ok: j.ok, ...(j.why ? { why: j.why } : {}), gate: j.gate });
  }
  // The likeliest first: asked, then the worker's, then dev/DC-n, then named.
  const rank = (o: MergeOption) => (o.asked ? 0 : o.via.includes('worker') ? 1 : o.via.includes('dc-branch') ? 2 : 3) + (o.ok ? 0 : 10);
  return pickTarget(options.sort((a, b) => rank(a) - rank(b)));
}
