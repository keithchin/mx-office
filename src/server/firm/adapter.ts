// The Firm's seam (FirmDeps, FirmFloor) made from the real office: the floors and their project
// teams (roster), GitHub lists, the ranking, the analyzer, Jeff's log, the summary, the live app
// and the audit log as evidence; the office's Claude Code as the runner; toasts and the ledger.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AppStats, WorkerGrade } from '../../shared/firm/report.js';
import { ROLE_BY_ID, type RoleId } from '../../shared/roster/roles.js';
import { analysisOf } from '../analysis/index.js';
import type { Floor } from '../floor.js';
import { liveAppsOf } from '../liveapp/index.js';
import type { Ctx } from '../office/context.js';
import { rankingReport } from '../ranking/index.js';
import { isAsleepStatus } from '../roster/bench.js';
import { judgeOf, rosterOf, teamFloor } from '../roster/adapter.js';
import { summaryOf } from '../summary/index.js';
import { priceOf } from '../usage.js';
import { childEnv } from '../workers/env.js';
import { resolveCommand, writeOfficeCommands } from '../workers/process.js';
import { auditSource, type AuditSource } from './audit-source.js';
import { Firm } from './index.js';
import { pinCommit, prepareReviewer } from './isolation.js';
import { ClaudeHeadlessRunner } from './runner.js';
import type { FirmFloor, LeadState } from './types.js';

const firms = new WeakMap<object, Firm>();
let audit: AuditSource | undefined;
void auditSource().then((a) => (audit = a));

function leadOf(ctx: Ctx, floor: Floor, role: RoleId): LeadState {
  const roster = rosterOf(ctx);
  const m = roster.data(floor.id).members[role];
  const w = roster.workerOf(teamFloor(ctx, floor), m);
  const name = m.name;
  if (!w) return { role, name, state: 'benched' };
  if (m.phase === 'benching') return { role, name, state: 'benching', workerId: w.id };
  if (w.status === 'needs_input') return { role, name, state: 'asking', workerId: w.id };
  return { role, name, state: isAsleepStatus(w.status) ? 'asleep' : 'active', workerId: w.id };
}

function stats(ctx: Ctx, floor: Floor): AppStats {
  const pulls = floor.github.pulls.items;
  const issues = floor.github.issues.items;
  const checked = pulls.filter((p) => p.checks === 'pass' || p.checks === 'fail');
  let costToDate: number | undefined;
  try {
    costToDate = Math.round(summaryOf(ctx).summary(floor).spend.total * 100) / 100;
  } catch {
    // no summary yet
  }
  return {
    prsMerged: pulls.filter((p) => p.state === 'MERGED').length,
    prsOpen: pulls.filter((p) => p.state === 'OPEN').length,
    issuesOpen: issues.filter((i) => i.state === 'OPEN').length,
    issuesClosed: issues.filter((i) => i.state === 'CLOSED').length,
    ...(checked.length ? { ciPassRate: Math.round((checked.filter((p) => p.checks === 'pass').length / checked.length) * 100) / 100 } : {}),
    ...(costToDate !== undefined ? { costToDate } : {}),
  };
}

function grades(ctx: Ctx, floor: Floor): WorkerGrade[] {
  try {
    return rankingReport(ctx, floor.id).workers.slice(0, 30).map((w) => ({
      name: w.name,
      role: w.roleLabel,
      model: w.modelLabel,
      grade: (['A', 'B', 'C', 'D', 'F'].includes(String(w.grade)) ? w.grade : 'C') as WorkerGrade['grade'],
      rankingGrade: w.grade,
      output: `${w.tasks} task${w.tasks === 1 ? '' : 's'} (office ranking, not reviewed)`,
      slacking: false,
      evidence: 'From the office ranking only: the Partner did not grade this worker.',
    }));
  } catch {
    return [];
  }
}

/** Everything the office knows about a project, as JSON files for the reviewers. Each piece on its own: one failing leaves the rest. */
async function evidence(ctx: Ctx, floor: Floor): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const take = (name: string, f: () => unknown) => {
    try {
      out[name] = f();
    } catch (err) {
      out[name] = { error: (err as Error).message };
    }
  };
  take('github', () => ({
    repo: floor.def.repo,
    issues: floor.github.issues.items.map(({ body, ...i }) => ({ ...i, body: body?.slice(0, 1500) })),
    pulls: floor.github.pulls.items.map(({ body, ...p }) => ({ ...p, body: body?.slice(0, 1500) })),
    note: 'The office keeps the open items and the latest closed issues / merged PRs.',
  }));
  take('ranking', () => rankingReport(ctx, floor.id));
  take('roster', () => {
    const d = rosterOf(ctx).data(floor.id);
    return {
      members: Object.fromEntries(Object.entries(d.members).map(([role, m]) => [role, { title: ROLE_BY_ID.get(role as RoleId)?.title, name: m.name, model: m.model, phase: m.phase, benchedAt: m.benchedAt, handoff: m.handoff?.text?.slice(0, 2000) }])),
      settings: d.settings,
      escalations: d.escalations,
      standups: d.standups.slice(-10).map((s) => ({ ...s, page: typeof s.page === 'string' ? s.page.slice(0, 4000) : undefined })),
      spend: d.spend,
    };
  });
  take('summary', () => summaryOf(ctx).summary(floor));
  take('judge', () => rosterOf(ctx).jeff.summary(floor.id, judgeOf(ctx).status()));
  take('analysis', () => analysisOf(ctx).store.all().filter((r) => r.floor === floor.id).slice(-300));
  take('liveapp', () => liveAppsOf(ctx).stateOf(floor));
  out.audit = await (audit ?? (await auditSource())).read({ floor: floor.id, limit: 500 }).catch(() => []);
  return out;
}

function firmFloor(ctx: Ctx, floor: Floor): FirmFloor {
  return {
    id: floor.id,
    name: floor.def.name,
    dir: floor.dir,
    repo: floor.def.repo,
    branch: floor.project.branch,
    lead: (role) => leadOf(ctx, floor, role),
    // Through the roster's delivery: never typed into a question open in the Lead's terminal, and not past
    // the floor's spend cap (an interview is the office's prompt): refused, the question stays pending.
    deliver: (id, text, asleep) => {
      const w = floor.workers.get(id);
      if (!w) return 'No such worker';
      const r = rosterOf(ctx).delivery.send(teamFloor(ctx, floor), w, text, { origin: 'office', by: 'The Firm', wake: asleep });
      return r.status === 'refused' ? r.why : undefined;
    },
    rehire: async (role, task) => rosterOf(ctx).delivery.paused(teamFloor(ctx, floor)) ?? rosterOf(ctx).members.hire(teamFloor(ctx, floor), role, 'The Firm', undefined, task),
    stats: () => stats(ctx, floor),
    grades: () => grades(ctx, floor),
    evidence: () => evidence(ctx, floor),
  };
}

/** The office's Firm: made on first use, with the real floors, Claude Code and the evidence behind it. */
export function firmOf(ctx: Ctx): Firm {
  let f = firms.get(ctx.cfg);
  if (f) return f;
  const dataDir = ctx.cfg.dataDir;
  f = new Firm({
    dataDir,
    now: () => Date.now(),
    floor: (id) => {
      const fl = ctx.floors.get(id);
      return fl && firmFloor(ctx, fl);
    },
    runner: new ClaudeHeadlessRunner(resolveCommand('claude')),
    prepare: prepareReviewer,
    pin: (fl) => pinCommit(fl.dir, fl.branch),
    baseEnv: () => childEnv(),
    hookUrl: () => {
      try {
        return `http://127.0.0.1:${readFileSync(path.join(dataDir, 'hook-port'), 'utf8').trim()}`;
      } catch {
        return 'http://127.0.0.1:0';
      }
    },
    binDir: writeOfficeCommands(path.join(dataDir, 'firm')),
    priceOf,
    notify: (id, text, level) => {
      const fl = ctx.floors.get(id);
      if (fl) ctx.toastFloor(fl, text, level);
    },
    changed: (id) => {
      const fl = ctx.floors.get(id);
      // The 1D view's banner and Needs-you strip refetch on the team's change message.
      if (fl) ctx.toFloor(fl, { t: 'roster.changed', floor: id });
    },
    spend: (usd) => ctx.ledger.add({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: usd, calls: 0 }),
    record: (entry) => audit?.record(entry),
  });
  firms.set(ctx.cfg, f);
  const firm = f;
  // The reviewers' sessions are children of the office: they go when it goes.
  process.once('exit', () => firm.stop());
  return f;
}
