// Expert mode's background proof wired to the office (service.ts does the work): one service per office, made on
// first use; worker updates on Expert projects reach it from the floors' workerChanged (office/floors.ts); the
// status GET /api/expert/proof (http/routes/expert.ts) puts the branch and commit beside the existing budget,
// stuck detection and the toolkit's decision log, all read from caches (no new scans). Pages hear "roster.changed"
// when the proof changes, as they do for the budget and phases.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import { isExpertProject } from './mode.js';
import { type ExpertProof, type ProofBudget, type ProofStuck } from '../../shared/expert-proof.js';
import { stuckTitle } from '../../shared/stuck.js';
import { budgetOf } from '../budget/index.js';
import { budgetPaused } from '../budget/control.js';
import { pausedForBudget } from '../budget/pause.js';
import { totalOf } from '../budget/ledger.js';
import { stuckFloor, stuckOf } from '../stuck/index.js';
import { decisions as decisionRows } from '../summary/project.js';
import { credential } from '../connections/resolve.js';
import { teamServerOf } from '../team-server/index.js';
import { tokensWithheld } from '../testcreds.js';
import { officeGitEnv } from '../workers/git-identity.js';
import { onForgetFloor } from '../office/forget.js';
import { runProofGit } from './git.js';
import { pushBranch, pushTarget } from './push.js';
import { ExpertProofService } from './service.js';
import { lockInDecisions } from '../expert-lockin/book.js';

export { ExpertProofService } from './service.js';

export { isExpertProject } from './mode.js';

const offices = new WeakMap<object, ExpertProofService>();

/** The office's one. */
export function expertProofOf(ctx: Ctx): ExpertProofService {
  let s = offices.get(ctx.cfg);
  if (s) return s;
  const svc = new ExpertProofService({
    git: runProofGit,
    target: (floorId, dir) => {
      const floor = ctx.floors.get(floorId);
      return pushTarget(runProofGit, dir, { record: floor ? teamServerOf(ctx).recordOf(floor) : undefined, localOnly: tokensWithheld() });
    },
    push: (dir, t, branch) => pushBranch(runProofGit, dir, t, branch, () => credential('mendix')),
    identity: () => {
      const e = officeGitEnv();
      return { name: e.GIT_COMMITTER_NAME, email: e.GIT_COMMITTER_EMAIL };
    },
    now: () => Date.now(),
    changed: (floorId) => {
      const floor = ctx.floors.get(floorId);
      if (floor) ctx.toFloor(floor, { t: 'roster.changed', floor: floorId });
    },
  });
  offices.set(ctx.cfg, svc);
  onForgetFloor((f) => svc.forget(f.id));
  return svc;
}

/** A worker's update on any floor: only an Expert project's session counts. */
export function expertOnWorker(ctx: Ctx, floor: Floor, w: WorkerInfo | string) {
  if (typeof w === 'string' || !isExpertProject(floor)) return;
  expertProofOf(ctx).onWorker(floor.id, floor.dir, w);
}

/** The office starts: every Expert project attached (its session branch taken) a little after the floors open. */
export function startExpertProof(ctx: Ctx): () => void {
  const t = setTimeout(() => {
    for (const f of ctx.floors.values()) if (isExpertProject(f)) void expertProofOf(ctx).attach(f.id, f.dir);
  }, 15_000);
  t.unref?.();
  return () => {
    clearTimeout(t);
    offices.get(ctx.cfg)?.stop();
  };
}

const decisionCache = new Map<string, { stamp: string; n: number }>();

/** Rows in the folder's PROJECT.md ## Decisions (re-read only when the file changed). */
export async function decisionCount(dir: string): Promise<number> {
  const f = path.join(dir, 'PROJECT.md');
  try {
    const st = await stat(f);
    const stamp = `${st.mtimeMs}:${st.size}`;
    const hit = decisionCache.get(f);
    if (hit?.stamp === stamp) return hit.n;
    const n = decisionRows(await readFile(f, 'utf8')).length;
    decisionCache.set(f, { stamp, n });
    return n;
  } catch {
    return 0;
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

function budgetOfFloor(ctx: Ctx, floor: Floor): ProofBudget | null {
  try {
    const b = budgetOf(ctx);
    const ref = { id: floor.id, name: floor.def.name, dir: floor.dir };
    const f = b.file(ref);
    return {
      spentUsd: round(totalOf(f.ledger)),
      totalUsd: f.settings.total ?? null,
      todayUsd: round(f.ledger.days[b.today]?.cost ?? 0),
      paused: budgetPaused(b, ref) || pausedForBudget(floor.id) === true,
    };
  } catch {
    return null;
  }
}

async function stuckOfFloor(ctx: Ctx, floor: Floor, p: { working: boolean; idleSince: number } | undefined): Promise<ProofStuck | null> {
  try {
    const now = Date.now();
    const view = await stuckOf(ctx).view(stuckFloor(floor), true);
    const first = view.items[0];
    return { stuck: view.items.length > 0, idleSec: !p || p.working ? 0 : Math.max(0, Math.round((now - p.idleSince) / 1000)), ...(first ? { reason: stuckTitle(first, now) } : {}) };
  } catch {
    return null;
  }
}

/** GET /api/expert/proof: the strip's numbers, exactly ExpertProof's fields. */
export async function expertProofView(ctx: Ctx, floor: Floor): Promise<ExpertProof> {
  const svc = expertProofOf(ctx);
  if (isExpertProject(floor)) await svc.attach(floor.id, floor.dir);
  const p = svc.proof(floor.id);
  const [stuck, decisions] = await Promise.all([stuckOfFloor(ctx, floor, p), decisionCount(floor.dir)]);
  // Lock in's own rows in the decision log count too (expert-lockin/book.ts).
  return { branch: p?.branch ?? '', commit: p?.commit ?? null, budget: budgetOfFloor(ctx, floor), stuck, decisions: decisions + lockInDecisions(ctx.cfg.dataDir, floor.id) };
}
