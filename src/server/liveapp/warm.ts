// Keep warm: a project whose live app should be ready when people arrive has it started when the office
// starts (its settings, ./prefs.ts), so nobody waits a cold start (one to two minutes). Nothing in the office
// stops a live app for being idle, so once up it stays up until someone stops it or the office closes.
//
// It costs memory: a running live app (mxcli, mxbuild, the Mendix runtime and the web bundler) holds about
// 1.5 to 2 GB (the QB0 measurements), and up to 2.5 cores while it builds. So the apps start one at a time,
// a little after the office is up, and only while the machine has room for one more (WARM_FREE_BYTES free);
// one that doesn't fit says so on its Live app tab instead.

import os from 'node:os';
import type { Ctx } from '../office/context.js';
import { liveAppsOf } from './index.js';

/** What a running live app holds at most (measured: 1.5–2 GB). */
export const LIVE_APP_BYTES = 2 * 1024 ** 3;
/** Free memory a warm start wants: the app's, and half a gigabyte to spare. */
export const WARM_FREE_BYTES = LIVE_APP_BYTES + 512 * 1024 ** 2;
/** How long after the office starts the first warm start begins (the office's own start comes first). */
const WARM_DELAY_MS = 20_000;

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

/** Whether one more live app fits in memory now, and the words when it doesn't. */
export function warmFits(free: number, total: number): { ok: boolean; why?: string } {
  if (free >= WARM_FREE_BYTES) return { ok: true };
  return { ok: false, why: `Keep warm didn't start it: ${gb(free)} of ${gb(total)} memory free, and a live app needs about ${gb(LIVE_APP_BYTES)}. ▶ Start runs it anyway.` };
}

export interface WarmDeps {
  free(): number;
  total(): number;
  delayMs: number;
}

/** Starts the keep-warm projects' live apps a little after the office starts; returns what cancels that. */
export function startLiveWarm(ctx: Pick<Ctx, 'cfg' | 'floors' | 'toFloor'>, d: WarmDeps = { free: os.freemem, total: os.totalmem, delayMs: WARM_DELAY_MS }): () => void {
  let stopped = false;
  const timer = setTimeout(() => void warmUp(ctx, d, () => stopped).catch((err) => console.error('agent-office: live app keep warm failed', err)), d.delayMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** One at a time: each start waits until the one before is up (or gave up), then looks at memory again. */
export async function warmUp(ctx: Pick<Ctx, 'cfg' | 'floors' | 'toFloor'>, d: Pick<WarmDeps, 'free' | 'total'>, stopped: () => boolean = () => false): Promise<string[]> {
  const started: string[] = [];
  const apps = liveAppsOf(ctx);
  for (const floor of [...ctx.floors.values()]) {
    if (stopped()) break;
    if (!apps.prefsOf(floor.id).keepWarm) continue;
    const app = apps.of(floor);
    if (app.status !== 'stopped' && app.status !== 'failed') continue;
    const fits = warmFits(d.free(), d.total());
    if (!fits.ok) {
      app.say(fits.why!);
      continue;
    }
    await app.start('keep warm');
    started.push(floor.id);
    const end = Date.now() + apps.cfg.readyTimeoutMs;
    const status = (): string => app.status;
    while (!stopped() && status() === 'starting' && Date.now() < end) await new Promise((r) => setTimeout(r, 1_000));
  }
  return started;
}
