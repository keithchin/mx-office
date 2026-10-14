// The version banner's decisions (ui/version/index.ts draws them): what the page says about the office's
// build, from what GET /api/office/version answered and the build the page itself is from. In order:
// a restart under way, a page newer than the server (rebuilt, not restarted: its new actions fail), a
// page older than the server (restarted, not reloaded), a newer build ready (admins), and, once, that
// the office restarted and what it runs now. Pure: no DOM, no fetch.

import { buildLabel, countdown, pageVsServer, type BuildInfo, type OfficeVersionView } from '../../../shared/build-info';

export type BannerKind = 'restart' | 'stale-server' | 'reload' | 'ready' | 'restarted';

export interface Banner {
  kind: BannerKind;
  text: string;
  /** What it offers: Restart anyway (admins, while it waits), the restart's settings, a reload. */
  actions: ('anyway' | 'settings' | 'reload')[];
  /** Kept until this changes, once closed with ✕. */
  key: string;
  tone: 'info' | 'warn' | 'good';
}

/** What the page knows of the server: its answer, or that it has no such route (an office from before this). */
export type ServerKnown = { view: OfficeVersionView } | { missing: true };

/** "08:32" today, "13 Oct 11:35" another day. */
export function when(at: number, now = Date.now()): string {
  const d = new Date(at);
  const hm = d.toTimeString().slice(0, 5);
  return new Date(now).toDateString() === d.toDateString() ? hm : `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${hm}`;
}

function restartBanner(v: OfficeVersionView, clockSkew: number): Banner | undefined {
  const r = v.restart;
  if (!r) return undefined;
  const key = `restart:${v.running.startedAt}`;
  if (r.phase === 'building') return { kind: 'restart', text: '🔁 Restart under way: building the latest version first…', actions: ['settings'], key, tone: 'info' };
  if (r.phase === 'exiting') return { kind: 'restart', text: '🔁 Restarting now: this page reconnects when the new office is up and says what it runs.', actions: [], key, tone: 'info' };
  const who = r.waitingOn.length ? `waiting on ${r.waitingOn.length}: ${r.waitingOn.join(', ')}` : 'pausing the projects';
  if (!v.admin) return { kind: 'restart', text: `🔁 The office restarts once its agents finish their turn (${who}).`, actions: [], key, tone: 'info' };
  const left = r.deadline === undefined ? undefined : r.deadline - (Date.now() + clockSkew);
  const time = left === undefined ? '' : left > 0 ? ` It asks what to do in ${countdown(left)}.` : ` ${countdown(-left)} past its time limit: it goes on by itself once nobody is busy.`;
  return { kind: 'restart', text: `🔁 Restart under way, not done yet: ${who}.${time}`, actions: r.waitingOn.length ? ['anyway', 'settings'] : ['settings'], key, tone: left !== undefined && left <= 0 ? 'warn' : 'info' };
}

/**
 * The banner for `known` (the server's answer) and `page` (the page's own build). `restartedFrom` is the
 * start time of the office this tab saw before, when it differs from the one answering now.
 */
export function bannerFor(known: ServerKnown, page: BuildInfo | undefined, opts: { clockSkew?: number; restartedFrom?: number } = {}): Banner | undefined {
  if ('missing' in known) {
    if (!page) return undefined;
    return { kind: 'stale-server', text: `This page is from ${buildLabel(page)}, but the office server still runs an older build: some actions fail until it restarts (⚙️ Settings › Workers › Restart safely).`, actions: ['settings'], key: `stale:${page.sha}`, tone: 'warn' };
  }
  const v = known.view;
  const restart = restartBanner(v, opts.clockSkew ?? 0);
  if (restart) return restart;
  const vs = pageVsServer(page, v.running);
  if (vs === 'page-newer' && page) {
    const act = v.admin ? (v.loop ? ' Restart safely to bring the server up to it.' : ' Restart the office to bring the server up to it.') : ' Ask an admin to restart the office.';
    return { kind: 'stale-server', text: `This page is from ${buildLabel(page)}, but the office server still runs ${buildLabel(v.running)} (started ${when(v.running.startedAt)}): new actions fail until it restarts.${act}`, actions: v.admin ? ['settings'] : [], key: `stale:${page.sha}:${v.running.startedAt}`, tone: 'warn' };
  }
  if (vs === 'page-older') return { kind: 'reload', text: `The office now runs ${buildLabel(v.running)}: reload this page to use it.`, actions: ['reload'], key: `reload:${v.running.startedAt}`, tone: 'info' };
  if (opts.restartedFrom !== undefined && opts.restartedFrom !== v.running.startedAt) return { kind: 'restarted', text: `Restarted: now running ${buildLabel(v.running)}, started ${when(v.running.startedAt)}.`, actions: [], key: `restarted:${v.running.startedAt}`, tone: 'good' };
  if (v.ready && v.admin) return { kind: 'ready', text: `A newer build is ready (${buildLabel(v.ready)}). ${v.loop ? 'Restart safely to use it.' : 'Restart the office to use it.'}`, actions: ['settings'], key: `ready:${v.ready.sha}:${v.ready.builtAt ?? ''}`, tone: 'info' };
  return undefined;
}

/** How long until the next look: often while a restart is under way, rarely otherwise. */
export const nextLookMs = (known: ServerKnown | undefined) => (known && 'view' in known && known.view.restart ? 2_000 : 60_000);
