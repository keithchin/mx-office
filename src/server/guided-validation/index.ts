// Guided validation wired to the office (store.ts, scenarios.ts): the served revision from the live apps, the
// scenarios at a commit from the project's folder, a "Something's wrong" correction through the Developer change
// queue (server/dev-changes/: DC-<n>, queued like every request from the Developer view and handed to the team
// lead when it's its turn, so it never refuses for want of a lead at work), the changes a "Please try this" card
// marks, and the audit log. Made once per office.

import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { audit } from '../audit/index.js';
import { liveAppsIfMade } from '../liveapp/index.js';
import { devChangesOf } from '../dev-changes/index.js';
import { requestTitle } from '../../shared/change-requests.js';
import type { ValidationView } from '../../shared/guided-validation.js';
import { ValidationBook } from './store.js';
import { scenarioDefs, validationAt } from './scenarios.js';

const books = new WeakMap<object, ValidationBook>();

/** The revision the project's live app serves now, while it runs. */
export function servedNow(ctx: Ctx, floorId: string): string | undefined {
  const live = liveAppsIfMade(ctx)?.peek(floorId);
  return live?.status === 'running' || live?.status === 'updating' ? live.served?.sha : undefined;
}

export function validationBook(ctx: Ctx): ValidationBook {
  let b = books.get(ctx.cfg);
  if (b) return b;
  b = new ValidationBook({
    dataDir: ctx.cfg.dataDir,
    now: () => Date.now(),
    served: (floorId) => servedNow(ctx, floorId),
    async scenarios(floorId, revision) {
      const floor = ctx.floors.get(floorId);
      return floor ? (await scenarioDefs(floor.dir, revision)).list : [];
    },
    async correct(floorId, ask) {
      const r = await devChangesOf(ctx).changes.intake(floorId, { text: ask.text, page: ask.page, pageMoved: ask.pageMoved, revision: ask.revision, source: ask.revision, ref: ask.ref, of: ask.of, via: ask.via, by: ask.by, ...(ask.owner ? { owner: ask.owner } : {}) });
      return typeof r === 'string' ? r : { id: r.change.id, ...(r.change.activated?.taskId ? { taskId: r.change.activated.taskId } : {}) };
    },
    async change(floorId, id) {
      const c = await devChangesOf(ctx).store.get(floorId, id).catch(() => undefined);
      return c ? { title: requestTitle(c.text) || id, ...(c.page ? { page: c.page } : {}), ...(c.ref ? { ref: c.ref } : {}) } : undefined;
    },
    record: (e) => audit.record(e),
  });
  books.set(ctx.cfg, b);
  return b;
}

/** The Review section's view of `revision` on `floor`. */
export function validationOf(ctx: Ctx, floor: Floor, revision: string): Promise<ValidationView> {
  const book = validationBook(ctx);
  return validationAt({ dataDir: ctx.cfg.dataDir, floorId: floor.id, dir: floor.dir, revision, marks: book.at(floor.id, revision), corrections: book.corrections(floor.id) });
}
