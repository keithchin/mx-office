// The roster's seam (TeamFloor, RosterDeps) made from the real office: a floor's worker manager,
// GitHub lists and toasts, and the analyzer's numbers. Hiring here is what office-workers' hire does
// (a free desk in its team's patch, else the next free one, a worktree fresh from GitHub when the project has a branch), as Claude Code with
// the role's model, then the role's fixed name.

import path from 'node:path';
import { nextFreeSeat } from '../../shared/layout.js';
import { zoneSeat } from '../../shared/zones.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import { analysisOf } from '../analysis/index.js';
import { teamLabel } from '../../shared/roster/card-team.js';
import { gh } from '../github.js';
import { findTranscript } from '../analysis/transcript.js';
import { judgeFor } from '../judge/index.js';
import { lastAssistantTextOf, lastWordsOf } from '../judge/turns.js';
import { summaryOf } from '../summary/index.js';
import { ensureTeamLabels } from '../teams/labels.js';
import { envDryRun } from './issues.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { Roster, rosterFor } from './index.js';
import { ghIssueMaker } from './issues.js';
import type { HireAsk, TeamFloor } from './types.js';
import { onSubagentEvent } from '../workers/subagents.js';

const adapters = new WeakMap<Floor, TeamFloor>();

export function teamFloor(ctx: Ctx, floor: Floor): TeamFloor {
  let t = adapters.get(floor);
  if (t) return t;
  t = {
    id: floor.id,
    name: floor.def.name,
    dir: floor.dir,
    workers: () => floor.workers.list(),
    worker: (id) => floor.workers.get(id),
    hire: (ask) => hire(ctx, floor, ask),
    stop: async (id) => {
      const { note, error } = await floor.sendHome(id);
      if (note) ctx.toastFloor(floor, note);
      if (error) ctx.toastFloor(floor, error, 'warn');
    },
    prompt: (id, text, by) => floor.workers.prompt(id, text, by ?? 'Agent Office'),
    wake: (id, prompt) => floor.workers.resume(id, prompt),
    rename: (id, name) => floor.workers.rename(id, name),
    cwdOf: (w: WorkerInfo) => (w.worktree ? path.resolve(floor.dir, w.worktree.path) : floor.dir),
    openPulls: () => floor.github.pulls.items.filter((p) => p.state === 'OPEN'),
    toast: (text, level) => ctx.toastFloor(floor, text, level),
    changed: (alert) => ctx.toFloor(floor, { t: 'roster.changed', floor: floor.id, ...(alert ? { alert } : {}) }),
    activity: (text) => summaryOf(ctx).noteTeam(floor.id, text),
    labelPr: async (n, team) => {
      // Dry run (the team setting, or the whole office): GitHub is left alone.
      if (envDryRun() || rosterOf(ctx).data(floor.id).settings.dryRunIssues) return 'skipped';
      const made = await ensureTeamLabels(floor, false);
      if (made.error) return made.error;
      try {
        await gh(['pr', 'edit', String(n), '--add-label', teamLabel(team)], floor.dir);
        return undefined;
      } catch (err) {
        return (err as Error).message;
      }
    },
    labelIssue: async (n, team) => {
      if (envDryRun() || rosterOf(ctx).data(floor.id).settings.dryRunIssues) return 'skipped';
      const made = await ensureTeamLabels(floor, false);
      if (made.error) return made.error;
      return (await floor.github.setLabels('issue', n, [teamLabel(team)], [])).error;
    },
    lastWords: (w) => {
      const said = lastWordsOf(w.id);
      if (said) return said;
      const file = findTranscript(w.sessionId, w.worktree ? path.resolve(floor.dir, w.worktree.path) : floor.dir);
      return file ? lastAssistantTextOf(file) : undefined;
    },
    judged: (made) => ctx.toFloor(floor, { t: 'judge.made', floor: floor.id, ...made }),
  };
  adapters.set(floor, t);
  return t;
}

async function hire(ctx: Ctx, floor: Floor, ask: HireAsk): Promise<WorkerInfo | string> {
  if (!floor.project.agentProviders.includes('claude')) return 'The team runs on Claude Code, which this office has no agent for';
  // In its team's patch of the floor when a desk is free there (the 2D view paints each team's
  // patch), else wherever anyone new would sit.
  const taken = (id: string) => floor.workers.deskOccupied(id);
  const desk = (ask.team && zoneSeat(ask.team, taken, floor.plan.wing)) || nextFreeSeat(taken, floor.plan.wing)?.id;
  if (!desk) return 'Every desk and bean bag is taken: send someone home first';
  const worktree = !!floor.project.branch;
  if (worktree) await floor.workers.fetchBase();
  if (!ctx.floors.has(floor.id)) return 'This floor closed';
  const r = floor.workers.spawn(desk, ask.by, ask.prompt, worktree, 'agent', 'claude', ask.model, undefined, undefined, ask.owner);
  if (typeof r === 'string') return r;
  floor.workers.rename(r.id, ask.name);
  return floor.workers.get(r.id) ?? r;
}

/** A few lines of the analyzer's numbers for a floor: runs, the top models by score, spend. */
function analysisLines(ctx: Ctx, floorId: string): string {
  try {
    const report = analysisOf(ctx).report([...ctx.floors.values()], { floor: floorId, by: 'model' });
    const runs = report.runs.filter((r) => r.floor === floorId);
    if (!runs.length) return '';
    const cost = runs.reduce((n, r) => n + (r.cost ?? 0), 0);
    const merged = runs.filter((r) => r.outcome === 'merged').length;
    const top = report.leaderboard.slice(0, 4).map((l) => `${l.label}: score ${Math.round(l.score)} over ${l.n} ranked runs, $${l.avgCost.toFixed(2)} a run`);
    return [`- ${runs.length} recorded runs, ${merged} merged, $${cost.toFixed(2)} in all`, ...top.map((t) => `- ${t}`)].join('\n');
  } catch {
    return '';
  }
}

/** The office's Jeff (server/judge/): made on first use. */
export const judgeOf = (ctx: Ctx) => judgeFor(ctx.cfg);

/** The office's roster: made on first use, with the real floors, GitHub and the analyzer behind it. */
export function rosterOf(ctx: Ctx): Roster {
  return rosterFor(ctx.cfg, () => {
    const roster = new Roster({
      dataDir: ctx.cfg.dataDir,
      floors: () => [...ctx.floors.values()].map((f) => teamFloor(ctx, f)),
      makeIssue: ghIssueMaker,
      analysis: (id) => analysisLines(ctx, id),
      now: () => Date.now(),
      judge: (text, questions, opts) => judgeOf(ctx).ask(text, questions, opts),
    });
    // A Lead's subagent runs, from its hooks: the team's track record (roster/subagents.ts).
    onSubagentEvent((workerId, ev) => {
      const floor = ctx.workerFloor(workerId);
      if (floor) roster.subagents.onEvent(teamFloor(ctx, floor), workerId, ev);
    });
    return roster;
  });
}
