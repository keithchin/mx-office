// "A milestone became ready in the live app", for features that act on it (walkthroughs/: record the
// milestone's passing journeys). Told once per milestone, the same moment the toast and Needs you row are
// (./news.ts), with the reading it came from. A listener's failure never reaches the live app.

import type { LiveReadiness, ReadinessNews } from '../../shared/liveapp/readiness.js';
import type { Ctx } from '../office/context.js';

export type ReadyCtx = Pick<Ctx, 'cfg' | 'floors' | 'toFloor'> & Partial<Pick<Ctx, 'toastFloor'>>;
type Listener = (ctx: ReadyCtx, floorId: string, news: ReadinessNews, readiness: LiveReadiness) => unknown;

const listeners = new Set<Listener>();

/** Listens; returns how to stop. */
export function onLiveReady(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitLiveReady(ctx: ReadyCtx, floorId: string, news: ReadinessNews, readiness: LiveReadiness) {
  for (const fn of listeners) {
    try {
      const r = fn(ctx, floorId, news, readiness);
      if (r instanceof Promise) r.catch((err) => console.error('agent-office: live app ready listener failed', err));
    } catch (err) {
      console.error('agent-office: live app ready listener failed', err);
    }
  }
}
