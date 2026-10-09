// The project progress bar's answer (GET /api/progress, shared/progress.ts): the phases worked out from
// the setup view, the deliverables scan, the ledger and the acceptance file (gather.ts), one answer per
// floor shared for a little while so a page switching tabs, a second viewer and Home's cards don't each
// redo it; an Accept or a Reopen lets go of it at once. Nothing is polled: a page asks when something
// it heard of changed (ui/progress/).

import { dropKeys, onForgetFloor } from '../office/forget.js';
import { lastAccepted, type Cycle } from '../../shared/acceptance.js';
import { derivePhases, type ProgressAcceptance, type ProjectProgress } from '../../shared/progress.js';
import { entryOf } from '../budget/plan-source.js';
import { acceptanceStore, changedNow, onAcceptanceChange } from '../acceptance/index.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { brdCount, gather, stageDeliverables, stageSpend } from './gather.js';

/** An answer is handed out again for this long (ms). */
export const PROGRESS_FRESH_MS = 15_000;
const cache = new Map<string, { at: number; p: Promise<Omit<ProjectProgress, 'admin'>> }>();
onForgetFloor((f) => dropKeys(cache, f));
onAcceptanceChange((floorId) => {
  for (const k of cache.keys()) if (k.startsWith(`${floorId}|`)) cache.delete(k);
});

/** What the bar says about the delivery cycles. */
export function progressAcceptance(cycles: readonly Cycle[], changed: string[]): ProgressAcceptance {
  const cur = cycles[cycles.length - 1];
  const earlier = cycles
    .slice(0, -1)
    .filter((c) => c.record)
    .reverse()
    .map((c) => ({ version: c.record!.version, at: c.record!.acceptedAt }));
  return { version: cur.version, cycle: cur.n, ...(cur.record ? { accepted: { at: cur.record.acceptedAt, by: cur.record.acceptedBy.name }, changed } : {}), earlier };
}

async function compute(ctx: Ctx, floor: Floor, mini: boolean): Promise<Omit<ProjectProgress, 'admin'>> {
  const g = await gather(ctx, floor, mini);
  const cycles = acceptanceStore(ctx.cfg.dataDir, floor.id).cycles();
  const cur = cycles[cycles.length - 1];
  const acceptance = progressAcceptance(cycles, await changedNow(ctx, floor, cycles, mini));
  const toolkit = !!g.setup?.toolkit;
  const entry = entryOf(g.setup?.entry);
  let spend: ReturnType<typeof stageSpend> | undefined;
  try {
    // A later cycle counts what it spent since it opened.
    spend = stageSpend(ctx, floor, cur.opened?.at);
  } catch {
    spend = undefined;
  }
  const phases = derivePhases({
    toolkit,
    entry,
    verdicts: g.setup?.verdicts ?? [],
    decisions: g.setup?.decisions ?? [],
    ...(g.deliverables ? { deliverables: stageDeliverables(g.deliverables), brds: brdCount(g.deliverables) } : {}),
    spend,
    acceptance,
    ...(g.setup ? { setupShown: g.setup.show } : {}),
  });
  const note = toolkit && !entry ? 'The entry mode isn’t recorded, so every stage is shown' : cycles.length > 1 && !cur.record ? `${cur.version} under way since ${new Date(cur.opened!.at).toISOString().slice(0, 10)}; ${lastAccepted(cycles)} stays accepted` : undefined;
  return { floor: floor.id, toolkit, ...(g.setup?.entry ? { entry: g.setup.entry } : {}), phases, acceptance, ...(note ? { note } : {}), ...(mini ? { mini: true } : {}), generatedAt: Date.now() };
}

/** The floor's progress, shared for PROGRESS_FRESH_MS; `mini` (Home's cards) skips the deliverables scan. Never throws. */
export async function progressOf(ctx: Ctx, floor: Floor, admin: boolean, mini = false, now = Date.now()): Promise<ProjectProgress> {
  const key = `${floor.id}|${mini ? 'mini' : 'full'}`;
  const hit = cache.get(key);
  let p = hit && now - hit.at < PROGRESS_FRESH_MS ? hit.p : undefined;
  if (!p) {
    p = compute(ctx, floor, mini);
    cache.set(key, { at: now, p });
    p.catch(() => cache.get(key)?.p === p && cache.delete(key));
  }
  try {
    return { ...(await p), admin };
  } catch {
    const acceptance = progressAcceptance(acceptanceStore(ctx.cfg.dataDir, floor.id).cycles(), []);
    return { floor: floor.id, toolkit: false, phases: derivePhases({ toolkit: false, verdicts: [], decisions: [], acceptance }), acceptance, note: "The project's progress couldn't be read just now", generatedAt: now, admin };
  }
}
