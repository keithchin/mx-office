// Home (/start, client/start.ts): the office's landing page, "what needs me, and how is everything going?"
// across every client and project. Its address, what GET /api/start answers (server/start/) and the pure
// rules the page draws by: the top of Needs you, the active projects' order and red flag, the clients'
// spend, the recent milestones and the office's health. No DOM or Node, so the server, the page and the
// tests (tests/start-page.test.ts) read the same rules. Every number comes from something the office
// recorded; what nobody recorded is left out or said to be unknown, never guessed.

import { settingsHref } from './settings-sections.js';

/** Home's address: where the Mx Office wordmark, the 🏠 and a bare `/` go. */
export const HOME_PAGE = '/start';

/** A red Needs-you item of some project (the desktop tray's shape, server/desktop/status.ts). */
export interface StartNeed {
  id: string;
  floor: string;
  project: string;
  who: string;
  summary: string;
  urgency: string;
  level: 'block' | 'warn';
  /** The office path its Open goes to, without the leading slash ("lite?floor=…"). */
  path: string;
}

/** What the office keeps of one project's live app, when anyone ever opened one (LiveAppState, cut down). */
export interface StartLive {
  status: 'stopped' | 'starting' | 'running' | 'updating' | 'stopping' | 'failed';
  /** Started since the office started (else "not started", not "stopped"). */
  started?: boolean;
  appPort?: number;
  viewPort?: number;
}

/** One project's facts only the server has: its stuck and failing work, and its live app. */
export interface StartProject {
  floor: string;
  /** Its red Needs-you items. */
  needs: number;
  /** Stuck detection's items on it (Needs you's kind `stuck`). */
  stuck: number;
  /** Its open PRs with failing checks (Needs you's kind `pr`). */
  failing: number;
  /** Undefined when nobody opened its live app since the office started: unknown, not "down". */
  live?: StartLive;
}

/** A milestone the office recorded: a PR merged, a live-app milestone told ready, a delivery accepted. */
export interface StartActivity {
  at: number;
  floor: string;
  kind: 'pr-merged' | 'live-ready' | 'accepted';
  text: string;
}

/** GET /api/start. */
export interface StartView {
  generatedAt: number;
  needs: StartNeed[];
  projects: StartProject[];
  activity: StartActivity[];
  health: {
    /** The agents' Claude credentials: fine, rejected by Claude (an alert), or a choice an admin still has to make. */
    claude: 'ok' | 'failing' | 'decision';
    /** A newer build of the office is ready (built since this one started): restart to pick it up. */
    update?: { sha: string; release?: number };
  };
  /** Projects whose Needs you couldn't be read this time. */
  unread?: string[];
}

/** How many Needs-you items Home shows. */
export const NEEDS_SHOWN = 5;
/** How many project rows Home shows before "All N projects". */
export const ACTIVE_SHOWN = 8;
/** How many milestones Home shows. */
export const ACTIVITY_SHOWN = 6;

/** The items to show: blocking ones first, then the rest, each kept in the order the office gave. */
export function topNeeds(needs: readonly StartNeed[], n = NEEDS_SHOWN): StartNeed[] {
  return needs
    .map((x, i) => ({ x, i }))
    .sort((a, b) => Number(b.x.level === 'block') - Number(a.x.level === 'block') || a.i - b.i)
    .slice(0, n)
    .map((r) => r.x);
}

/** "See all": each project with items, the most first, so every item is one click from its Command Center. */
export function needsByProject(needs: readonly StartNeed[]): { floor: string; project: string; count: number }[] {
  const by = new Map<string, { floor: string; project: string; count: number }>();
  for (const n of needs) {
    const e = by.get(n.floor) ?? { floor: n.floor, project: n.project, count: 0 };
    e.count++;
    by.set(n.floor, e);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.project.localeCompare(b.project));
}

/** Which client each project is in (a project is in at most one). */
export function clientIndex(portfolios: readonly { id: string; label: string; projectIds: readonly string[] }[]): Map<string, { id: string; label: string }> {
  const m = new Map<string, { id: string; label: string }>();
  for (const p of portfolios) for (const f of p.projectIds) m.set(f, { id: p.id, label: p.label });
  return m;
}

/** A project row's red flag: what's stuck or failing on it, in words, or undefined when nothing is. */
export function redFlag(p: Pick<StartProject, 'stuck' | 'failing'> | undefined): string | undefined {
  if (!p) return undefined;
  const parts = [p.stuck && `${p.stuck} stuck`, p.failing && `${p.failing} failing PR${p.failing === 1 ? '' : 's'}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/** Its live app in a word, and whether it's ready to open: "unknown" when the office never looked. */
export function liveWord(live: StartLive | undefined): { text: string; ready: boolean; tone: 'good' | 'bad' | 'mute' } {
  if (!live) return { text: 'Live app: unknown', ready: false, tone: 'mute' };
  if (live.status === 'running' && (live.viewPort || live.appPort)) return { text: 'Live app ready', ready: true, tone: 'good' };
  if (live.status === 'failed') return { text: 'Live app failed', ready: false, tone: 'bad' };
  if (live.status === 'starting' || live.status === 'updating') return { text: 'Live app starting', ready: false, tone: 'mute' };
  return { text: live.started ? 'Live app stopped' : 'Live app not started', ready: false, tone: 'mute' };
}

/** The team in a few words, from the floor's own counts: "2 working · 1 asking · 3 idle", or "No agents". */
export function teamWords(f: { workers: number; busy: number; waiting: number }): string {
  if (!f.workers) return 'No agents';
  const idle = Math.max(0, f.workers - f.busy - f.waiting);
  return [f.busy && `${f.busy} working`, f.waiting && `${f.waiting} asking`, idle && `${idle} idle`].filter(Boolean).join(' · ');
}

/** A client card's spend: what its projects spent, and a budget only when every one of them has one. */
export function clientSpend(projectIds: readonly string[], floors: readonly { id: string; spent: number; budget?: number }[] | undefined): { spent: number; budget?: number; unbudgeted: number } | undefined {
  if (!floors) return undefined;
  let spent = 0;
  let budget = 0;
  let unbudgeted = 0;
  for (const id of projectIds) {
    const f = floors.find((x) => x.id === id);
    if (!f) {
      unbudgeted++;
      continue;
    }
    spent += f.spent;
    if (f.budget) budget += f.budget;
    else unbudgeted++;
  }
  return { spent, ...(projectIds.length && !unbudgeted ? { budget } : {}), unbudgeted };
}

/** The newest milestones across every project. */
export function latestActivity(items: readonly StartActivity[], n = ACTIVITY_SHOWN): StartActivity[] {
  return [...items].sort((a, b) => b.at - a.at).slice(0, n);
}

/** One item of the health strip; `ok` ones are drawn quietly. */
export interface HealthItem {
  id: 'agents' | 'spend' | 'claude' | 'update';
  text: string;
  ok: boolean;
  href?: string;
}

/** The office's health: agents running, today's spend, the agents' Claude credentials, an update ready. */
export function healthItems(h: { working: number; today?: number; dailyBudget?: number; claude?: StartView['health']['claude']; update?: StartView['health']['update'] }, usd: (n: number) => string): HealthItem[] {
  const out: HealthItem[] = [{ id: 'agents', text: `${h.working} agent${h.working === 1 ? '' : 's'} working`, ok: true }];
  if (h.today !== undefined) {
    const over = h.dailyBudget !== undefined && h.today >= h.dailyBudget;
    out.push({ id: 'spend', text: `${usd(h.today)} spent today${h.dailyBudget !== undefined ? ` of ${usd(h.dailyBudget)}` : ''}`, ok: !over });
  }
  if (h.claude === 'failing') out.push({ id: 'claude', text: 'Claude is rejecting the agents’ credentials', ok: false, href: settingsHref('connections') });
  else if (h.claude === 'decision') out.push({ id: 'claude', text: 'Claude credentials: a choice is waiting', ok: false, href: settingsHref('connections') });
  else if (h.claude === 'ok') out.push({ id: 'claude', text: 'Credentials OK', ok: true });
  if (h.update) out.push({ id: 'update', text: `Update ready${h.update.release ? `: release ${h.update.release}` : ` (${h.update.sha})`}`, ok: false });
  return out;
}
