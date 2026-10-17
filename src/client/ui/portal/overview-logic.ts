// What the Portal Overview's right-hand cards say (ui/portal/overview.ts draws them), worked out
// without the page: the Team card's faces (the agents, the ones that need someone first, then the
// working ones, at most a handful and "+N"), the Technical contact (the Project Coordinator, or the Solo
// Lead on a Solo team), the Details rows (only those the office knows), and the key a dismissed
// Needs-you alert is remembered under. Pure, so tests/portal-nav.test.ts runs it.

import { VIA_SUBAGENT } from '../../../shared/roster/member-subagents';
import { WAITING_BG } from '../../../shared/roster/background-work';

export interface TeamFace {
  id: string;
  name: string;
  color: string;
  /** 'needs' someone, 'working', or 'idle' (asleep, done, offline). */
  dot: 'needs' | 'working' | 'idle';
  title: string;
}

interface WorkerLike {
  id: string;
  name: string;
  color: string;
  status: string;
  kind?: string;
  role?: string;
}

const DOT_ORDER: Record<TeamFace['dot'], number> = { needs: 0, working: 1, idle: 2 };
const STATUS_WORD: Record<string, string> = { needs_input: 'needs you', working: 'working', idle: 'idle', done: 'done', exited: 'stopped', offline: 'offline', asleep: 'asleep' };

/** A worker's dot: someone asked, at work, or neither. */
export function faceDot(status: string): TeamFace['dot'] {
  return status === 'needs_input' ? 'needs' : status === 'working' || status === 'starting' ? 'working' : 'idle';
}

/** The Team card's faces: the agents (not shells), most urgent first, at most `max`; `more` is how many didn't fit. */
export function teamFaces(workers: Iterable<WorkerLike>, max = 6): { faces: TeamFace[]; more: number; total: number } {
  const agents = [...workers].filter((w) => w.kind === undefined || w.kind === 'agent');
  const faces = agents
    .map((w, i) => ({ w, i, dot: faceDot(w.status) }))
    .sort((a, b) => DOT_ORDER[a.dot] - DOT_ORDER[b.dot] || a.i - b.i)
    .map(({ w, dot }): TeamFace => ({ id: w.id, name: w.name, color: w.color, dot, title: `${w.name}${w.role ? `, ${w.role}` : ''}: ${STATUS_WORD[w.status] ?? w.status}` }));
  return { faces: faces.slice(0, max), more: Math.max(0, faces.length - max), total: faces.length };
}

interface MemberLike {
  role: string;
  name: string;
  title: string;
  status?: string;
  model?: string;
  workerId?: string;
}

/** The Technical contact: the Project Coordinator ('pm'), or the Solo Lead when the team is just one. */
export function technicalContact<M extends MemberLike>(members: readonly M[] | undefined): M | undefined {
  if (!members?.length) return undefined;
  return members.find((m) => m.role === 'pm') ?? members.find((m) => m.role === 'solo-lead');
}

export interface DetailFacts {
  repo?: string;
  branch?: string;
  /** The project's checkout on the office's machine, when it isn't on GitHub. */
  dir?: string;
  mendix?: string;
  toolkit?: { sha: string; date?: string; state: string };
  /** The newest commit on the default branch (the Git tab's graph), or the delivery branch's head; when and what, when known. */
  lastCommit?: { sha: string; branch?: string; when?: string; subject?: string };
  budget?: { spent: number; total?: number; text: string };
  live?: { status: string; url?: string };
  /** Created with "Keep this project off GitHub": no GitHub link, and it says so. */
  localOnly?: boolean;
}

export interface DetailRow {
  label: string;
  value: string;
  href?: string;
  /** In the mono face (a commit, a path). */
  mono?: boolean;
  /** Opens outside the office (a new tab). */
  external?: boolean;
  /** A tab to open instead of a link. */
  tab?: string;
  /** A second, quieter line under the value (a commit's date and subject). */
  sub?: string;
}

const short = (sha: string) => sha.slice(0, 7);

/** The Details card's rows, in the portal's order, for what the office knows (a row it doesn't know is left out). */
/** What the Overview says for a project kept off GitHub. */
export const LOCAL_ONLY_LABEL = 'Local only: not on GitHub';

export function detailRows(f: DetailFacts): DetailRow[] {
  const rows: DetailRow[] = [];
  if (f.localOnly) rows.push({ label: 'Repository', value: LOCAL_ONLY_LABEL, sub: f.dir ?? f.repo });
  else if (f.repo) rows.push({ label: 'Repository', value: f.repo, href: `https://github.com/${f.repo}`, external: true });
  else if (f.dir) rows.push({ label: 'Folder', value: f.dir, mono: true });
  if (f.branch) rows.push({ label: 'Branch', value: f.branch, mono: true, tab: 'git' });
  if (f.mendix) rows.push({ label: 'Mendix version', value: f.mendix, tab: 'model' });
  if (f.toolkit) rows.push({ label: 'Toolkit', value: `${f.toolkit.state === 'pinned' ? 'Pinned at' : 'At'} ${short(f.toolkit.sha)}${f.toolkit.date ? ` · ${f.toolkit.date}` : ''}`, mono: true });
  if (f.lastCommit) {
    const sub = [f.lastCommit.when, f.lastCommit.subject && clipSubject(f.lastCommit.subject)].filter(Boolean).join(' · ');
    rows.push({ label: 'Last commit', value: `${short(f.lastCommit.sha)}${f.lastCommit.branch ? ` on ${f.lastCommit.branch}` : ''}`, mono: true, tab: 'git', ...(sub ? { sub } : {}) });
  }
  if (f.budget) rows.push({ label: 'Budget', value: f.budget.text, tab: 'budget' });
  if (f.live) rows.push(f.live.url && f.live.status === 'running' ? { label: 'Live app', value: f.live.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), href: f.live.url, external: true } : { label: 'Live app', value: f.live.status, tab: 'live' });
  return rows;
}

/** A commit's subject, its first line, at most 72 characters. */
export function clipSubject(s: string): string {
  const line = s.split(/\r?\n/)[0].trim();
  return line.length > 72 ? `${line.slice(0, 71)}…` : line;
}

/** "Oct 9, 2026, 14:05" for an ISO date, in the viewer's locale (en-US by default); '' when it isn't one. */
export function commitWhen(iso: string, locale = 'en-US'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "$1,608 of $2,000 spent (80 %)", or just what's spent when there's no budget. */
export function budgetText(spent: number, total?: number): string {
  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  if (!total) return `${usd(spent)} spent`;
  return `${usd(spent)} of ${usd(total)} spent (${Math.round((spent / total) * 100)} %)`;
}

/** What a dismissed Needs-you alert is remembered under: the floor and what it said, so something new shows it again. */
export const alertKey = (floor: string, text: string) => `${floor}|${text.replace(/\s+/g, ' ').trim()}`;

// ---- The Team card's rows (the roster's members, as the panel's lead sees them) --------------------------

export type TeamDot = 'work' | 'idle' | 'wait' | 'off';

export interface TeamMemberLike {
  role: string;
  name: string;
  title: string;
  status: string;
  workerId?: string;
  activity?: string;
  task?: string;
  waitingOnPm?: boolean;
}

export interface TeamRowView {
  role: string;
  name: string;
  title: string;
  /** What it's doing, in a line. */
  what: string;
  dot: TeamDot;
  status: string;
  workerId?: string;
  /** Whoever covers Management: the team-lead panel's agent. */
  lead: boolean;
  /** The lead isn't hired: the row offers to hire one. */
  missing?: boolean;
}

/**
 * The Team card: every hired member, the lead (whoever covers Management) first, each with a dot and its
 * status in words; the lead's row says it isn't hired when it isn't. `live` is the member's worker as the
 * page has it (its status wins over the roster's, which is fetched now and then). `subs`: how many of a
 * member's subagents are at work now; one idle or asleep while a subagent of its works reads as working.
 * `bg`: how many of its Monitors and background commands run now; one idle while they do reads "Waiting
 * on background work" (shared/roster/background-work.ts), never idle.
 */
export function teamRows(members: readonly TeamMemberLike[], leadRole: string, live: (id: string) => { status: string; activity?: string } | undefined, subs: (role: string) => number = () => 0, bg: (role: string) => number = () => 0): TeamRowView[] {
  const rows: TeamRowView[] = [];
  for (const m of members) {
    if (m.status === 'not-hired') {
      if (m.role === leadRole) rows.push({ role: m.role, name: m.title, title: m.title, what: 'Not hired: no one covers Management', dot: 'off', status: 'Not hired', lead: true, missing: true });
      continue;
    }
    const w = m.workerId ? live(m.workerId) : undefined;
    const s = w?.status;
    const [dot, status]: [TeamDot, string] =
      m.status === 'benched' ? ['off', 'Benched']
      : m.status === 'benching' ? ['wait', 'Writing handoff']
      : s === 'needs_input' || m.status === 'needs-you' ? ['wait', 'Asking you']
      : s === 'working' || s === 'starting' || (!s && m.status === 'working') ? ['work', 'Working']
      : s === 'exited' || s === 'offline' || m.status === 'asleep' ? ['off', 'Asleep']
      : m.waitingOnPm ? ['wait', 'Waiting on you']
      : ['idle', 'Ready'];
    // Its turn is over but a subagent it sent off is still at it: working, not idle.
    const free = dot === 'idle' || (dot === 'off' && m.status !== 'benched');
    // …or a Monitor or a background command it left running. Asleep, its session (and what ran in it) is over.
    const waits = bg(m.role) > 0 && dot === 'idle';
    const via = !waits && subs(m.role) > 0 && free;
    const [shownDot, shownStatus]: [TeamDot, string] = waits ? ['work', WAITING_BG] : via ? ['work', VIA_SUBAGENT] : [dot, status];
    const what = (dot === 'off' && m.status === 'benched' ? 'Session cleared to save money' : waits ? 'Its turn is over; Claude Code wakes it when its background work reports' : via ? 'Waiting on its subagent' : (w?.activity ?? m.activity ?? m.task ?? (dot === 'idle' ? 'Waiting for work' : ''))).replace(/\s+/g, ' ').trim();
    rows.push({ role: m.role, name: m.name, title: m.title, what, dot: shownDot, status: shownStatus, workerId: m.workerId, lead: m.role === leadRole });
  }
  return rows.sort((a, b) => Number(b.lead) - Number(a.lead));
}

// ---- The Budget card ---------------------------------------------------------------------------------

export interface BudgetLike {
  spent: number;
  today: number;
  settings: { total?: number; autoPause: boolean; threshold?: number };
  officeThreshold: number;
  forecast?: { atCompletion: number; over?: number };
  paused?: string;
}

export interface BudgetFacts {
  spent: string;
  /** "of $330", with a budget. */
  of?: string;
  /** Share of the budget spent, 0–100, with a budget. */
  pct?: number;
  tone: 'good' | 'warn' | 'bad';
  rows: [label: string, value: string][];
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const whole = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** What the Budget card says: spent of the budget, today, the forecast at the end, the alert and auto-pause. */
export function budgetFacts(v: BudgetLike): BudgetFacts {
  const total = v.settings.total;
  const pct = total ? Math.min(100, Math.round((v.spent / total) * 100)) : undefined;
  const threshold = v.settings.threshold ?? v.officeThreshold;
  const rows: [string, string][] = [['Today', money(v.today)]];
  if (v.forecast) rows.push(['Forecast', `${whole(v.forecast.atCompletion)} at the end: ${v.forecast.over ? `over by ${whole(v.forecast.over)}` : total ? 'within budget' : 'no budget set'}`]);
  if (total) {
    rows.push(['Alert', `at ${threshold}% (${whole((total * threshold) / 100)})`]);
    rows.push(['Auto-pause', v.paused ? 'paused now: budget reached' : v.settings.autoPause ? `at 100% (${whole(total)})` : 'off']);
  }
  const tone = v.paused || (pct ?? 0) >= 100 ? 'bad' : (pct ?? 0) >= threshold || v.forecast?.over ? 'warn' : 'good';
  return { spent: money(v.spent), ...(total ? { of: `of ${whole(total)}`, pct } : {}), tone, rows };
}
