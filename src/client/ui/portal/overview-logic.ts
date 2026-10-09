// What the Portal Overview's right-hand cards say (ui/portal/overview.ts draws them), worked out
// without the page: the Team card's faces (the agents, the ones that need someone first, then the
// working ones, at most a handful and "+N"), the Technical contact (the Project Coordinator, or the Solo
// Lead on a Solo team), the Details rows (only those the office knows), and the key a dismissed
// Needs-you alert is remembered under. Pure, so tests/portal-nav.test.ts runs it.

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
  /** The newest commit the office knows on the delivery branch (or what the live app runs). */
  lastCommit?: { sha: string; branch?: string };
  budget?: { spent: number; total?: number; text: string };
  live?: { status: string; url?: string };
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
}

const short = (sha: string) => sha.slice(0, 7);

/** The Details card's rows, in the portal's order, for what the office knows (a row it doesn't know is left out). */
export function detailRows(f: DetailFacts): DetailRow[] {
  const rows: DetailRow[] = [];
  if (f.repo) rows.push({ label: 'Repository', value: f.repo, href: `https://github.com/${f.repo}`, external: true });
  else if (f.dir) rows.push({ label: 'Folder', value: f.dir, mono: true });
  if (f.branch) rows.push({ label: 'Branch', value: f.branch, mono: true, tab: 'git' });
  if (f.mendix) rows.push({ label: 'Mendix version', value: f.mendix, tab: 'model' });
  if (f.toolkit) rows.push({ label: 'Toolkit', value: `${f.toolkit.state === 'pinned' ? 'Pinned at' : 'At'} ${short(f.toolkit.sha)}${f.toolkit.date ? ` · ${f.toolkit.date}` : ''}`, mono: true });
  if (f.lastCommit) rows.push({ label: 'Last commit', value: `${short(f.lastCommit.sha)}${f.lastCommit.branch ? ` on ${f.lastCommit.branch}` : ''}`, mono: true, tab: 'git' });
  if (f.budget) rows.push({ label: 'Budget', value: f.budget.text, tab: 'budget' });
  if (f.live) rows.push(f.live.url && f.live.status === 'running' ? { label: 'Live app', value: f.live.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), href: f.live.url, external: true } : { label: 'Live app', value: f.live.status, tab: 'live' });
  return rows;
}

/** "$1,608 of $2,000 spent (80 %)", or just what's spent when there's no budget. */
export function budgetText(spent: number, total?: number): string {
  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  if (!total) return `${usd(spent)} spent`;
  return `${usd(spent)} of ${usd(total)} spent (${Math.round((spent / total) * 100)} %)`;
}

/** What a dismissed Needs-you alert is remembered under: the floor and what it said, so something new shows it again. */
export const alertKey = (floor: string, text: string) => `${floor}|${text.replace(/\s+/g, ' ').trim()}`;
