// Lock in wired to the office (the work is ./service.ts): one service per office, made on first use. Its checks are
// ./checks.ts officeLockInChecks (slice 6's runner replaces it at merge); the commit path is the background proof's
// (expert/service.ts commitNow); data impact is the local merge's (local-merge/describe.ts); the push is the
// session branch's push (expert/push.ts); the licence comes from the cached Deploy API read (team-server/); demo
// users from the readiness check's look at the model (expert-ready/model.ts); the deploy request is an ask in
// Needs you (roster escalations); phases are phased delivery's (phases/); Studio Pro opens through the existing
// Edit in Studio Pro pieces (studio/), which never start it in a test office. Pages hear "roster.changed".
//
// A test office may script the checks, the licence and demo users with AGENT_OFFICE_TEST_LOCKIN=<file.json>
// ({ "checks": { "journeys": { "status": "failed", … } }, "licence": "free", "demoUsers": { "on": true, "count": 6 } })
// for screenshots and the docs. Outside test mode that variable is ignored.

import { readFileSync, statSync } from 'node:fs';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { audit, human } from '../audit/index.js';
import { runGit } from '../gitgraph/index.js';
import { testModeOf } from '../testmode.js';
import { tokensWithheld } from '../testcreds.js';
import { credential } from '../connections/resolve.js';
import { officeGitEnv } from '../workers/git-identity.js';
import { teamServerOf } from '../team-server/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { startNext } from '../../shared/phases/derive.js';
import { runProofGit } from '../expert/git.js';
import { pushBranch, pushTarget } from '../expert/push.js';
import { decisionCount, expertProofOf } from '../expert/index.js';
import type { Licence, LockInCheck, LockInCheckKind, LockInPhase, LockInView } from '../../shared/expert-lockin.js';
import { officeLockInChecks, scriptedLockInChecks, type LockInChecks } from './checks.js';
import { LockInService, type LFloor } from './service.js';

export { LockInService } from './service.js';
export type { LockInChecks } from './checks.js';

interface Script {
  checks?: Partial<Record<LockInCheckKind, string | Partial<LockInCheck>>>;
  licence?: Licence;
  demoUsers?: { on: boolean; count?: number };
  delayMs?: number;
}

/** The test office's script, only in test mode. */
function scriptFor(dir: string): Script | undefined {
  const f = process.env.AGENT_OFFICE_TEST_LOCKIN;
  if (!f || !testModeOf(dir).on) return undefined;
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as Script;
  } catch {
    return undefined;
  }
}

const demoCache = new Map<string, { key: string; at: number; v: LockInView['demoUsers'] }>();

/** Demo users in the model now (the readiness check's look), kept a minute per .mpr. */
async function demoUsersOf(dir: string): Promise<LockInView['demoUsers']> {
  const { mprOf } = await import('../expert-ready/checks.js');
  const mpr = await mprOf(dir);
  if (!mpr) return { on: false, known: false };
  let key = '';
  try {
    const st = statSync(mpr);
    key = `${st.mtimeMs}:${st.size}`;
  } catch {
    return { on: false, known: false };
  }
  const hit = demoCache.get(mpr);
  if (hit && hit.key === key && Date.now() - hit.at < 60_000) return hit.v;
  const { lookAtModel } = await import('../expert-ready/model.js');
  const look = await lookAtModel(mpr);
  const v = look.demo ? { on: look.demo.on, count: look.demo.count, known: true } : { on: false, known: false };
  demoCache.set(mpr, { key, at: Date.now(), v });
  return v;
}

const offices = new WeakMap<object, LockInService>();

/** The office's one. `checks`: a stand-in for the tests (or slice 6's runner). */
export function lockInOf(ctx: Ctx, checks?: LockInChecks): LockInService {
  let s = offices.get(ctx.cfg);
  if (s) return s;
  const real = (f: LFloor): Floor | undefined => ctx.floors.get(f.id);
  const office = checks ?? officeLockInChecks(ctx);
  s = new LockInService({
    git: runProofGit,
    dataDir: ctx.cfg.dataDir,
    checks: (f) => {
      const sc = scriptFor(f.dir);
      return sc ? scriptedLockInChecks(sc.checks ?? {}, sc.delayMs) : office;
    },
    commit: (f) => expertProofOf(ctx).commitNow(f.id, f.dir),
    busy: (f) => {
      const w = real(f)?.workers.list().find((x) => x.kind === 'agent' && !x.worktree && (x.status === 'working' || x.status === 'starting'));
      return w ? 'The session is working' : undefined;
    },
    identity: () => {
      const e = officeGitEnv();
      return { name: e.GIT_COMMITTER_NAME, email: e.GIT_COMMITTER_EMAIL };
    },
    impact: async (f, base, sha) => {
      const floor = real(f);
      if (!floor) return { status: 'unknown', lines: ['The project is gone'] };
      const { impactAt, kindAt } = await import('../local-merge/describe.js');
      const what = await kindAt(runGit, f.dir, base, sha);
      return impactAt(ctx, floor, runGit, what.fork, sha, what.files);
    },
    push: async (f, branch) => {
      const floor = real(f);
      const t = await pushTarget(runProofGit, f.dir, { record: floor ? teamServerOf(ctx).recordOf(floor) : undefined, localOnly: tokensWithheld() });
      if ('off' in t) return { off: t.off };
      await pushBranch(runProofGit, f.dir, t, branch, () => credential('mendix'));
      return 'ok';
    },
    licence: async (f) => {
      const sc = scriptFor(f.dir);
      if (sc?.licence) return sc.licence;
      const ts = teamServerOf(ctx);
      if (!ts.recordOf(f)) return 'unknown';
      const envs = await ts.environments(f);
      const type = envs?.app?.licenseType;
      if (type) return /free/i.test(type) ? 'free' : 'licensed';
      return 'unknown';
    },
    demoUsers: async (f) => {
      const sc = scriptFor(f.dir);
      if (sc?.demoUsers) return { ...sc.demoUsers, known: true };
      return demoUsersOf(f.dir);
    },
    raiseDeploy: (f, ask) => {
      const floor = real(f);
      if (!floor) return { error: 'The project is gone' };
      try {
        const session = floor.workers.list().find((w) => w.kind === 'agent' && !w.worktree);
        const e = rosterOf(ctx).escalations.raiseFor(teamFloor(ctx, floor), { workerId: session?.id ?? 'expert-lockin', by: `Lock in (${ask.by})` }, { urgency: 'important', trigger: 'milestone', title: ask.title, details: ask.details, options: ['Approved: I deploy it from the Portal', 'Not now'] }, `🚀 Lock in: ${ask.by} requests a deploy`);
        return `ESC-${e.id}`;
      } catch (err) {
        return { error: `The deploy request couldn't be raised: ${(err as Error).message.slice(0, 160)}` };
      }
    },
    phase: async (f) => {
      const floor = real(f);
      if (!floor) return undefined;
      const { viewOf } = await import('../phases/index.js');
      const v = await viewOf(ctx, floor, undefined);
      if (v.plan.state !== 'approved') return undefined;
      const cur = v.phases.find((p) => p.status === 'active' || p.status === 'checkpoint');
      if (!cur) return undefined;
      const p: LockInPhase = { id: cur.id, name: cur.name, order: cur.order, of: v.phases.length, rowsDone: cur.rowsDone, rows: cur.rows.length, complete: cur.rows.length > 0 && cur.rowsDone === cur.rows.length };
      return p;
    },
    closePhase: (f, phaseId, by) => closePhaseNow(ctx, f, phaseId, by),
    openStudio: async (f, by) => {
      const floor = real(f);
      if (!floor) return { ok: false, error: 'The project is gone' };
      const [{ studioRouteDeps }, { studioOpened }] = await Promise.all([import('../http/routes/studio.js'), import('../studio/index.js')]);
      const t = studioRouteDeps.studioTargetOf(floor);
      let dir = floor.dir;
      let note: string | undefined;
      if (t) {
        const p = await t.provider.prepare(floor, by);
        if ('error' in p) return { ok: false, error: p.error };
        dir = p.dir;
        note = p.note;
      }
      const r = studioRouteDeps.openInStudio(dir);
      if (!r.ok) return { ok: false, error: r.error };
      studioOpened({ floor: floor.id, by, at: Date.now(), mpr: r.mpr, ...(r.version ? { version: r.version } : {}) });
      audit.record({ floor: floor.id, actor: human(by), action: 'studio.open', target: { kind: 'project', id: floor.id, label: floor.def.name }, summary: `Opened the project in Studio Pro to publish (Lock in)${t ? ' (its Team Server Studio copy)' : ''}`, details: { mpr: r.mpr, via: r.via }, severity: 'notice' });
      return { ok: true, ...(note ? { note } : {}) };
    },
    audit: (f, by, action, summary, details) => audit.record({ floor: f.id, actor: human(by), action, target: { kind: 'floor', id: f.id, label: f.name }, summary, ...(details ? { details } : {}), severity: 'notice' }),
    changed: (id) => {
      const floor = ctx.floors.get(id);
      if (floor) ctx.toFloor(floor, { t: 'roster.changed', floor: id });
    },
    reattach: (f) => void expertProofOf(ctx).attach(f.id, f.dir, true),
    projectDecisions: (f) => decisionCount(f.dir),
    now: () => Date.now(),
  });
  offices.set(ctx.cfg, s);
  return s;
}

/** Marks the phase in progress done (phased delivery's store), the next one started; audited, pages told. */
async function closePhaseNow(ctx: Ctx, f: LFloor, phaseId: string, by: string): Promise<string | undefined> {
  // Lazily: phases/ pulls in the security gate and the budget.
  const { phasesOf } = await import('../phases/index.js');
  const s = phasesOf(ctx);
  const now = Date.now();
  let started: string | undefined;
  let name = phaseId;
  const r = s.d.store.update(f.id, (p) => {
    const ph = p.phases.find((x) => x.id === phaseId);
    if (!ph) return `There is no phase ${phaseId}`;
    if (ph.status !== 'active' && ph.status !== 'checkpoint') return `${ph.name} is ${ph.status}, not in progress`;
    name = ph.name;
    ph.status = 'done';
    ph.endedAt = now;
    started = startNext(p.phases, now)?.name;
  });
  if (typeof r === 'string') return r;
  s.d.record(f.id, { kind: 'pm', name: by }, 'phases.done', `${by} closed ${name} at Lock in: done${started ? `; ${started} started` : ''}`, { phase: phaseId, via: 'lock-in' });
  s.d.changed(f.id);
  return undefined;
}
