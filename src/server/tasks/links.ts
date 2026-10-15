// The task links of a decision revision, wired to the office (Slice 1B-4): evaluate.ts on what the office
// already keeps (the dispatcher's records and answer history, the floor's cached PR list, the build plan the
// stuck look read at main, the members' task verifications, the acceptance records) plus local git (git.ts).
// Each result is kept a minute. Change answer's detail asks for it when its dialog opens; the follow-through
// feed only peeks (never waits on git), and the follow-through look warms what it follows, so nothing here
// polls on its own.

import type { Ctx } from '../office/context.js';
import { rosterOf } from '../roster/adapter.js';
import { ROLES } from '../../shared/roster/roles.js';
import type { DecisionLinks } from '../../shared/task-links.js';
import { NO_WORK_REQUIRED } from '../../shared/task-links.js';
import { acceptanceStore } from '../acceptance/index.js';
import { readRepo, PLAN_MD } from '../stuck/repo.js';
import { mdTables } from '../stuck/parse.js';
import { citedAfter } from '../dispatch/evidence.js';
import { evaluateLinks, type Verification } from './evaluate.js';
import { branchCommits, commitsSince, contains } from './git.js';

const TTL_MS = 60_000;
const KEPT = 300;

export class TaskLinks {
  private cache = new Map<string, { at: number; p: Promise<DecisionLinks | undefined>; v?: DecisionLinks }>();

  constructor(private ctx: Ctx) {}

  /** The links of `decision` at `rev`, worked out now or within the last minute. */
  get(floorId: string, decision: string, rev: number): Promise<DecisionLinks | undefined> {
    const key = `${floorId}\0${decision}\0${rev}`;
    const now = Date.now();
    const had = this.cache.get(key);
    if (had && now - had.at < TTL_MS) return had.p;
    const entry: { at: number; p: Promise<DecisionLinks | undefined>; v?: DecisionLinks } = { at: now, p: Promise.resolve(undefined), ...(had?.v ? { v: had.v } : {}) };
    entry.p = this.evaluate(floorId, decision, rev)
      .then((v) => {
        if (v) entry.v = v;
        return v;
      })
      .catch((err: unknown) => {
        console.error(`agent-office: task links: couldn't work out ${decision} rev ${rev}: ${(err as Error).message}`);
        return had?.v;
      });
    this.cache.set(key, entry);
    while (this.cache.size > KEPT) this.cache.delete(this.cache.keys().next().value!);
    return entry.p;
  }

  /** What was last worked out, without waiting (the feed's); starts a fresh look in the background when it's old. */
  peek(floorId: string, decision: string, rev: number): DecisionLinks | undefined {
    const had = this.cache.get(`${floorId}\0${decision}\0${rev}`);
    if (!had || Date.now() - had.at >= TTL_MS) void this.get(floorId, decision, rev);
    return had?.v;
  }

  private async evaluate(floorId: string, decision: string, rev: number): Promise<DecisionLinks | undefined> {
    const floor = this.ctx.floors.get(floorId);
    if (!floor) return undefined;
    const roster = rosterOf(this.ctx);
    const dispatcher = roster.dispatch;
    await dispatcher.ready(floorId);
    const line = (await dispatcher.answers.history(floorId, decision)).find((l) => l.rev === rev);
    if (!line) return undefined;
    const dir = floor.dir;
    const [commits, repo] = await Promise.all([commitsSince(dir, line.at - 60_000), readRepo(dir).catch(() => undefined)]);
    const planRows: { file: string; line: number; text: string }[] = [];
    for (const t of repo?.plan?.text ? mdTables(repo.plan.text) : []) for (const r of t.rows) planRows.push({ file: PLAN_MD, line: r.line, text: r.cells.join(' | ') });
    const verifications: Verification[] = [];
    try {
      const d = roster.data(floorId);
      for (const r of ROLES) {
        const m = d.members[r.id];
        for (const t of [...(m.prevTasks ?? []), m.task]) if (t?.taskId && t.verify) verifications.push({ taskId: t.taskId, pr: t.verify.pr, ...(t.verify.revision ? { revision: t.verify.revision } : {}), state: t.verify.state });
      }
    } catch {
      // no team on it
    }
    const acceptances = acceptanceStore(this.ctx.cfg.dataDir, floorId)
      .all()
      .flatMap((l) => (l.op === 'accept' ? [{ id: l.record.id, version: l.record.version, by: l.record.acceptedBy.name, at: l.record.acceptedAt, ...(l.record.decisions ? { decisions: l.record.decisions } : {}) }] : []));
    const note = line.kind === 'no-work-required' ? (line.note ?? line.text.replace(new RegExp(`^${NO_WORK_REQUIRED}:?\\s*`), '')) : undefined;
    return evaluateLinks(
      {
        decision,
        rev,
        answerAt: line.at,
        kind: line.kind,
        by: line.by,
        ...(note ? { note } : {}),
        dispatches: dispatcher.store.list(floorId).filter((r) => r.decision === decision && r.answerRev === rev),
        commits,
        pulls: floor.github.pulls.items,
        planRows,
        verifications,
        acceptances,
        now: Date.now(),
      },
      {
        acknowledged: (r, citation) => citedAfter(r, citation),
        onBranch: (branch) => branchCommits(dir, branch, line.at - 60_000),
        contains: (sha, into) => contains(dir, sha, into),
      },
    );
  }
}

const services = new WeakMap<object, TaskLinks>();

/** The office's task links: made on first use, then the same one. */
export function taskLinksOf(ctx: Ctx): TaskLinks {
  let s = services.get(ctx.cfg);
  if (!s) services.set(ctx.cfg, (s = new TaskLinks(ctx)));
  return s;
}
