// Whether a data-impact hold is stale (the rule and its words: shared/data-impact-stale.ts): the facts gathered
// from the Developer change record (for a candidate:DC-n hold), the live preview's served revision, and local git
// (whether the target is in what the live preview runs; whether the target changes the model itself since it left
// main). Asked when a hold is shown or released, and by the held-queue stuck source; git off the event loop, a
// commit pair's answers kept (commits never change). The DC record and the live app are loaded lazily, so this
// feature doesn't import theirs at start.

import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import type { HeldFact } from '../../shared/data-impact.js';
import { staleReason, type StaleFacts } from '../../shared/data-impact-stale.js';
import { git } from '../asks/sources.js';
import { contains } from '../tasks/git.js';
import { defaultBranch, floorRef } from '../liveapp/checkout.js';

const ownKept = new Map<string, Promise<boolean | undefined>>();
const MODEL = /(^|\/)[^/]+\.mpr$|(^|\/)mprcontents\//i;

/** Whether `target` changes the model itself since it left `main` (merge-base); undefined when git can't tell. */
export function ownModelChange(dir: string, target: string, main: string): Promise<boolean | undefined> {
  const key = `${dir}|${target}|${main}`;
  let p = ownKept.get(key);
  if (!p) {
    p = (async () => {
      const base = (await git(['merge-base', main, target], dir))?.trim();
      if (!base) return undefined;
      if (base === target) return false;
      const out = await git(['diff', '--name-only', '--no-renames', base, target], dir);
      return out === undefined ? undefined : out.split('\n').some((l) => MODEL.test(l.trim()));
    })();
    ownKept.set(key, p);
    if (ownKept.size > 300) ownKept.delete(ownKept.keys().next().value!);
  }
  return p;
}

/** The facts about a hold the stale rule reads. */
export async function staleFacts(ctx: Ctx, floor: Floor, held: Pick<HeldFact, 'env' | 'target'>): Promise<StaleFacts> {
  const f: StaleFacts = { env: held.env, target: held.target };
  if (held.env.startsWith('candidate:')) {
    const id = held.env.slice(10);
    try {
      const { devChangesOf } = await import('../dev-changes/index.js');
      const c = (await devChangesOf(ctx).store.all(floor.id)).find((x) => x.id === id);
      if (c) {
        const over = c.cancelled ? 'cancelled' : c.superseded ? 'superseded' : c.queue === 'settled' ? 'done (settled in the queue)' : undefined;
        const newest = c.candidates.filter((x) => !x.late).at(-1)?.sha;
        f.change = { id, ...(over ? { over } : {}), ...(newest ? { newest } : {}) };
      }
    } catch {
      f.change = { id };
    }
    const main = await defaultBranch(floor.dir)
      .then((b) => floorRef(floor.dir, b))
      .catch(() => undefined);
    if (main?.sha) {
      const own = await ownModelChange(floor.dir, held.target, main.sha.trim()).catch(() => undefined);
      if (own !== undefined) f.ownModel = own;
    }
  }
  try {
    const { liveAppsIfMade } = await import('../liveapp/index.js');
    const live = liveAppsIfMade(ctx)?.peek(floor.id);
    const served = live?.served?.sha ?? live?.lastServed?.sha;
    if (served) {
      f.served = served;
      f.servedHas = served === held.target || !!(await contains(floor.dir, held.target, served).catch(() => false));
    }
  } catch {
    /* no live app: nothing served */
  }
  return f;
}

/** Why the hold is stale, or undefined (it still guards something, or the office can't tell). */
export async function staleWhy(ctx: Ctx, floor: Floor, held: Pick<HeldFact, 'env' | 'target'>): Promise<string | undefined> {
  return staleReason(await staleFacts(ctx, floor, held).catch(() => ({ env: held.env, target: held.target, change: { id: '' } })));
}
