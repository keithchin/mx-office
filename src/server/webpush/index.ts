// Web Push for the phone version (/m): the red Needs-you items as notifications on a phone's home-screen
// app (iOS 16.4+, Android, desktop browsers), even with the office's page closed. The protocol is ours
// (crypto.ts, sender.ts: no web-push package), the keys are made once (keys.ts), the phones kept per
// person and device (store.ts), and what goes to which phone is notifier.ts. Polls every floor like the
// Teams notifications do (their gather.ts), only while some phone is subscribed. Started by office/timers.ts.

import path from 'node:path';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { floorNeeds } from '../notify-teams/gather.js';
import { PushNotifier, pushItemsOf } from './notifier.js';
import { VapidStore } from './keys.js';
import { sendPush, type Fetch, type PushPayload } from './sender.js';
import { PushSubscriptions, type PushSub } from './store.js';

export const PUSH_POLL_MS = 20_000;

/**
 * Whether a worker's current turn is one the office started (a nudge, a standup, a relay): those never
 * buzz a phone. The worker manager keeps it on its own record, not on what browsers see.
 */
export function officeTurnOf(floor: Floor, workerId: string): boolean {
  const records = (floor.workers as unknown as { workers?: Map<string, { officeTurn?: boolean }> }).workers;
  return !!records?.get(workerId)?.officeTurn;
}

export class OfficePush {
  readonly subs: PushSubscriptions;
  readonly keys: VapidStore;
  readonly notifier: PushNotifier;
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly fetchImpl: Fetch = fetch as unknown as Fetch,
    keys = new VapidStore(),
  ) {
    const dir = ctx.cfg.dataDir;
    this.keys = keys;
    this.subs = new PushSubscriptions(path.join(dir, 'push-subscriptions.json'));
    this.notifier = new PushNotifier({ now: Date.now, subs: () => this.subs.list(), send: (s, p, urgent) => this.send(s, p, urgent).then(() => undefined), file: path.join(dir, 'push-state.json') });
  }

  start() {
    this.timer = setInterval(() => void this.poll(), PUSH_POLL_MS);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** One push to one phone; a phone its push service has forgotten is dropped. Why not, if it didn't go. */
  async send(sub: PushSub, payload: PushPayload, urgent = true): Promise<string | undefined> {
    const keys = this.keys.current();
    if (!keys) return 'No push key yet';
    const r = await sendPush(sub, payload, keys, this.fetchImpl, { urgency: urgent ? 'high' : 'normal' });
    if (r.ok) return void this.subs.noteResult(sub.id);
    if (r.gone) this.subs.drop(sub.id);
    else this.subs.noteResult(sub.id, r.error);
    return r.error;
  }

  /** One look at every floor; never throws, never overlaps. */
  async poll(): Promise<void> {
    if (this.polling || !this.subs.list().length || !this.keys.current()) return;
    this.polling = true;
    try {
      for (const floor of this.ctx.floors.values()) {
        try {
          const f = await floorNeeds(this.ctx, floor);
          await this.notifier.observe(floor.id, pushItemsOf({ id: floor.id, name: floor.def.name }, f.needs, (id) => officeTurnOf(floor, id)));
        } catch (err) {
          console.error(`agent-office: push: couldn't look at ${floor.id}: ${(err as Error).message}`);
        }
      }
      await this.notifier.tick();
    } finally {
      this.polling = false;
    }
  }
}

const offices = new WeakMap<object, OfficePush>();

export function pushOf(ctx: Ctx): OfficePush {
  let p = offices.get(ctx.cfg);
  if (!p) offices.set(ctx.cfg, (p = new OfficePush(ctx)));
  return p;
}

export function startWebPush(ctx: Ctx): () => void {
  const p = pushOf(ctx);
  p.start();
  return () => p.stop();
}
