// The data-impact guard on external commits (seams.ts checkExternal): when the push check (review-gate/pushes.ts,
// from T3's persisted baseline) finds commits that reached the default branch without a pull request, the range
// from the baseline's old tip to the new one is assessed under env `external:<branch>`. A finding is its own
// Needs-you card with its findings; it holds nothing else (the live preview's guard still holds its own update
// independently, env live-preview), and no Developer change's state moves because of it.

import type { AskItem } from '../../shared/asks.js';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { modelOf } from '../model/index.js';
import type { ExternalMove } from '../review-gate/pushes.js';
import { dataImpactOf } from './index.js';
import { checkExternal } from './seams.js';

const short = (sha: string) => sha.slice(0, 7);

/** The push check's hook for a project: assesses an external range off the look's own path (never awaited by it). */
export function externalCheck(ctx: Ctx, floor: Floor): ExternalMove {
  return ({ branch, base, target }) => {
    const units = modelOf(ctx).units;
    void checkExternal(ctx, branch, { floorId: floor.id, dir: floor.dir, base, target, units })
      .catch((err: Error) => console.error(`agent-office: data impact of the external push on ${branch} couldn't be assessed: ${err.message}`))
      .finally(() => units.blobs(floor.dir).close());
  };
}

/** One Needs-you card per external range the guard flagged on the project. */
export function externalItems(ctx: Pick<Ctx, 'cfg' | 'accounts' | 'meOf'>, floorId: string, lead?: string): AskItem[] {
  const holds = dataImpactOf(ctx).guard.store.get(floorId).holds;
  const out: AskItem[] = [];
  for (const [env, h] of Object.entries(holds)) {
    if (!h || !env.startsWith('external:')) continue;
    const branch = env.slice('external:'.length);
    const f = h.assessment?.findings ?? [];
    out.push({
      id: `data-impact-${env}-${short(h.base)}-${short(h.target)}`,
      kind: 'gate',
      level: 'warn',
      text: h.status === 'unknown' ? `Commits pushed to ${branch} without a pull request (${short(h.base)} → ${short(h.target)}): data impact unknown` : `Commits pushed to ${branch} without a pull request (${short(h.base)} → ${short(h.target)}) may affect stored data: ${f.length} finding${f.length === 1 ? '' : 's'}`,
      since: h.at,
      lines: [...f.slice(0, 6).map((x) => `${x.unit}: ${x.risk}`), ...(f.length > 6 ? [`…and ${f.length - 6} more`] : []), h.reason, 'Flagged only: it holds no other work. The live preview’s own guard still holds its update until approved there.'],
      evidence: [{ label: 'Findings', where: `/api/data-impact?floor=${encodeURIComponent(floorId)}&env=${encodeURIComponent(env)}`, revision: h.target }],
      acts: [...(lead ? [{ act: 'ask-lead' as const, label: `Ask ${lead} about it` }] : []), { act: 'seen', label: 'Hide' }],
    });
  }
  return out;
}
