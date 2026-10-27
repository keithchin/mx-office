// A data-impact hold keeping the Developer change queue waiting, raised in Needs you through stuck detection's
// sources (stuck/sources.ts): in the rebuild run a hold from an earlier change kept the next one queued for 15
// minutes, said only far up a receipt's findings. Now, when the active change is merged but held (the queue's why
// is `held`) and changes wait behind it, Needs you shows one item: which changes wait, the hold, and, when the
// office finds it stale (data-impact/stale.ts: the change is over, the live preview already has it, or the
// candidate changes no model of its own), that it can be released with a reason. "Open the hold" opens the hold's
// own dialog. Resolved by itself once the hold is approved, released or gone.

import type { Ctx } from '../office/context.js';
import { registerStuckSource } from '../stuck/sources.js';
import { heldIn } from '../data-impact/seams.js';
import { staleWhy } from '../data-impact/stale.js';
import { ENV_LIVE } from '../../shared/data-impact.js';
import { activeOf, queuedOf } from '../../shared/dev-changes.js';
import type { StuckDraft } from '../../shared/stuck.js';
import { devChangesOf } from './index.js';

/** The held-queue item for one project, if its queue waits on a hold. */
export async function heldQueueDraft(ctx: Ctx, floorId: string): Promise<StuckDraft | undefined> {
  const floor = ctx.floors.get(floorId);
  if (!floor) return undefined;
  const { store, changes } = devChangesOf(ctx);
  if (!store.waiting(floorId)) return undefined;
  const all = await store.all(floorId);
  const active = activeOf(all);
  const why = changes.whyQueued(floorId, all);
  if (!active || why?.why !== 'held') return undefined;
  const waiting = queuedOf(all).map((c) => c.id);
  if (!waiting.length) return undefined;
  const env = `candidate:${active.id}`;
  const held = heldIn(ctx, floorId, env) ?? heldIn(ctx, floorId, ENV_LIVE);
  if (!held) return undefined;
  const stale = await staleWhy(ctx, floor, held).catch(() => undefined);
  return {
    id: `held-${active.id}`,
    kind: 'held',
    since: held.at,
    blocks: waiting,
    evidence: [{ label: `${held.reason} (${held.env}: ${held.base.slice(0, 7)} → ${held.target.slice(0, 7)})` }, ...(stale ? [{ label: `Stale: ${stale}` }] : [])],
    hold: { env: held.env, change: active.id, target: held.target, waiting, ...(stale ? { stale } : {}) },
  };
}

/** Registers the source (the office's start); returns what takes it away. */
export function startHeldQueue(ctx: Ctx): () => void {
  return registerStuckSource(async (f) => {
    const d = await heldQueueDraft(ctx, f.id);
    return d ? [d] : [];
  });
}
