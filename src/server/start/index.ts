// Home's server side (GET /api/start, http/routes/start.ts; the page is client/start.ts): what only the
// server knows about every project, put together from what the office already keeps, never asked of
// GitHub or worked out a second way:
// - Needs you across everything: each project's red items exactly as the desktop tray, Teams and the
//   phone's pushes get them (notify-teams/gather.ts floorNeeds → redItems, as server/desktop/status.ts),
//   and per project how many of its items are stuck detection's (kind `stuck`) or failing PRs (kind `pr`).
// - Each project's live app as the office's live apps hold it (liveapp/ peek), or nothing when nobody
//   opened one since the office started (the page says "unknown").
// - Each project's business status (business-status/, shared/business-status.ts): the same words its
//   progress bar, Overview, phone card and Teams digest use.
// - The recent milestones the office recorded: PRs merged (the PR list's mergedAt), live-app milestones
//   told ready (liveapp/news.ts, on the app's readiness) and deliveries accepted (acceptance/).
// - The office's health: the agents' Claude credentials (claude-auth/: an alert or a pending choice, no
//   key ever) and a newer build ready (restart/build.ts).
// One answer is kept for a few seconds and shared by everyone asking meanwhile, so many Home tabs cost
// one look. Nothing here polls: it's worked out when a page asks.

import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { floorNeeds, redItems } from '../notify-teams/gather.js';
import { desktopNeedOf } from '../desktop/status.js';
import { liveAppsIfMade } from '../liveapp/index.js';
import { claudeAuthView } from '../claude-auth/index.js';
import { buildOf } from '../restart/build.js';
import { acceptanceStore } from '../acceptance/index.js';
import { businessSummaryOf } from '../business-status/index.js';
import type { StartActivity, StartLive, StartProject, StartView } from '../../shared/start.js';

/** How long one answer is reused. */
export const START_TTL_MS = 10_000;
/** Milestones kept per project before the newest are picked across all of them. */
const PER_FLOOR = 6;
// redItems builds its Open link against an address; desktopNeedOf takes this one off again (as the tray's).
const BASE = 'http://desktop.invalid/';

const kept = new WeakMap<Ctx, { at: number; view: Promise<StartView> }>();

/** Home's answer: reused for a few seconds, one look at a time. */
export function startView(ctx: Ctx, now = Date.now()): Promise<StartView> {
  const hit = kept.get(ctx);
  if (hit && now - hit.at < START_TTL_MS) return hit.view;
  const view = buildStartView(ctx, now);
  kept.set(ctx, { at: now, view });
  view.catch(() => kept.delete(ctx));
  return view;
}

function liveOf(ctx: Ctx, floor: Floor): StartLive | undefined {
  const s = liveAppsIfMade(ctx)?.peek(floor.id);
  if (!s) return undefined;
  return { status: s.status, ...(s.started ? { started: true } : {}), ...(s.appPort ? { appPort: s.appPort } : {}), ...(s.viewPort ? { viewPort: s.viewPort } : {}), ...(s.served ? { served: s.served.sha.slice(0, 7) } : {}), ...(s.target && s.status !== 'running' ? { target: s.target.sha.slice(0, 7) } : {}), ...(s.status === 'running' && s.failure?.kind === 'update' ? { updateFailed: true } : {}) };
}

/** The milestones the office recorded for one project, newest first. */
export function floorActivity(ctx: Ctx, floor: Floor): StartActivity[] {
  const out: StartActivity[] = [];
  for (const p of floor.github.pulls.items) {
    const at = p.state === 'MERGED' && p.mergedAt ? Date.parse(p.mergedAt) : NaN;
    if (at > 0) out.push({ at, floor: floor.id, kind: 'pr-merged', text: `PR #${p.number} merged: ${p.title}` });
  }
  for (const n of liveAppsIfMade(ctx)?.peek(floor.id)?.readiness?.news ?? []) {
    if (n.kind === 'ready' && n.at > 0) out.push({ at: n.at, floor: floor.id, kind: 'live-ready', text: `Live app ready: ${n.title}` });
  }
  try {
    for (const l of acceptanceStore(ctx.cfg.dataDir, floor.id).all()) {
      if (l.op === 'accept') out.push({ at: l.record.acceptedAt, floor: floor.id, kind: 'accepted', text: `Delivery ${l.record.version} accepted by ${l.record.acceptedBy.name}` });
    }
  } catch {
    // Not a project id the store takes, or no record: nothing accepted to tell.
  }
  return out.sort((a, b) => b.at - a.at).slice(0, PER_FLOOR);
}

function claudeHealth(): StartView['health']['claude'] {
  try {
    // The office-level note (Home's health strip): the page shows 'decision' to admins only (shared/start.ts).
    const v = claudeAuthView(true);
    return v.failure ? 'failing' : v.decision ? 'decision' : 'ok';
  } catch {
    return 'ok';
  }
}

async function buildStartView(ctx: Ctx, now: number): Promise<StartView> {
  const needs: StartView['needs'] = [];
  const projects: StartProject[] = [];
  const activity: StartActivity[] = [];
  const unread: string[] = [];
  for (const floor of ctx.floors.values()) {
    const p: StartProject = { floor: floor.id, needs: 0, stuck: 0, failing: 0 };
    try {
      const f = await floorNeeds(ctx, floor, now);
      p.stuck = f.needs.filter((n) => n.kind === 'stuck').length;
      p.failing = f.needs.filter((n) => n.kind === 'pr').length;
      for (const r of redItems(floor, f, BASE)) {
        needs.push(desktopNeedOf(r));
        p.needs++;
      }
    } catch (err) {
      console.error(`agent-office: home: couldn't read ${floor.id}'s Needs you: ${(err as Error).message}`);
      unread.push(floor.id);
    }
    const live = liveOf(ctx, floor);
    if (live) p.live = live;
    const business = await businessSummaryOf(ctx, floor);
    if (business) p.business = business;
    projects.push(p);
    activity.push(...floorActivity(ctx, floor));
  }
  const ready = buildOf(ctx).ready();
  return {
    generatedAt: now,
    needs,
    projects,
    activity: activity.sort((a, b) => b.at - a.at).slice(0, 20),
    health: { claude: claudeHealth(), ...(ready ? { update: { sha: ready.sha, ...(ready.release ? { release: ready.release } : {}) } } : {}) },
    ...(unread.length ? { unread } : {}),
  };
}
