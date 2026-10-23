// Guided validation wired to the office (store.ts, scenarios.ts): the served revision from the live apps, the
// scenarios at a commit from the project's folder, a "Something's wrong" correction through the change
// requests' own book (server/change-requests/: the task minted and handed to the team lead as any request
// is), and the audit log. Made once per office.

import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { audit } from '../audit/index.js';
import { liveAppsIfMade } from '../liveapp/index.js';
import { changeRequestBook } from '../change-requests/index.js';
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
      const r = await changeRequestBook(ctx).request(floorId, ask);
      return typeof r === 'string' ? r : { id: r.id, taskId: r.taskId };
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
