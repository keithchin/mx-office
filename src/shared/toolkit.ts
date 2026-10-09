// A project's pinned mxcli-project-toolkit (server/toolkit-pin/): which toolkit commit the project runs
// on, how many newer commits the fork has and what kind they are, and the Update toolkit preview (the
// gate verdicts before and after). Pure: the setup panel, the progress bar's chip and the server all
// import it, and the tests pin the classification and the verdict diff here.

/** What a toolkit commit changes, from its conventional prefix and the files it touches. */
export type CommitKind = 'fix' | 'new' | 'gate' | 'other';

export interface ToolkitCommit {
  sha: string;
  /** Committer date, YYYY-MM-DD. */
  date: string;
  subject: string;
  kinds: CommitKind[];
  /** The files it touched (at most a few dozen kept). */
  files?: string[];
}

/** Files whose change can turn a stage verdict: gate-check itself, its tables, the runbook's stage gates and the checkpoints. */
export const GATE_RULE_FILES: readonly RegExp[] = [
  /^bin\/gate-check\.sh$/,
  /^bin\/lib\/(artifact-check\.sh|artifact-manifest\.tsv|obligation-check\.sh|obligations\.tsv|entry-mode\.sh|closeout\.sh)$/,
  /^skills\/conversion-runbook\.md$/i,
  /^skills\/checkpoints\//,
];

/** fix / new / gate rule change, from a commit's subject (`fix(gate-check): …`, `new: …`, `feat!: …`) and its files. */
export function classifyCommit(subject: string, files: readonly string[] = []): CommitKind[] {
  const out: CommitKind[] = [];
  const prefix = /^\s*([A-Za-z]+)(?:\([^)]*\))?!?:/.exec(subject)?.[1]?.toLowerCase();
  if (prefix === 'fix' || prefix === 'hotfix' || /^\s*windows:/i.test(subject)) out.push('fix');
  else if (prefix === 'new' || prefix === 'feat' || prefix === 'feature') out.push('new');
  if (files.some((f) => GATE_RULE_FILES.some((re) => re.test(f))) || /^\s*[a-z]+\((gate-check|gates?|runbook)[^)]*\)/i.test(subject)) out.push('gate');
  return out.length ? out : ['other'];
}

const KIND_WORD: Record<CommitKind, string> = { fix: 'fix', new: 'new', gate: 'gate-rule', other: 'other' };

/** "fix/new/gate-rule changes" for a list of commits (in that order; "other" only when nothing else). */
export function kindsSummary(commits: readonly Pick<ToolkitCommit, 'kinds'>[]): string {
  const seen = new Set(commits.flatMap((c) => c.kinds));
  const order: CommitKind[] = ['fix', 'new', 'gate'];
  const named = order.filter((k) => seen.has(k));
  if (!named.length) return seen.size ? 'other changes' : '';
  return `${named.map((k) => KIND_WORD[k]).join('/')} changes`;
}

/** Counts by kind (a commit can be fix and gate-rule both). */
export function kindCounts(commits: readonly Pick<ToolkitCommit, 'kinds'>[]): Record<CommitKind, number> {
  const out: Record<CommitKind, number> = { fix: 0, new: 0, gate: 0, other: 0 };
  for (const c of commits) for (const k of c.kinds) out[k]++;
  return out;
}

/** One entry of a project's toolkit history (agent-office.project.json `toolkit.history`). */
export interface ToolkitHistoryEntry {
  commit: string;
  at: string;
  by: string;
  action: 'pin' | 'update' | 'rollback' | 'create';
  from?: string;
}

/** What a project records of its toolkit, committed in agent-office.project.json under `toolkit`. */
export interface ToolkitPinRecord {
  /** The full toolkit commit the project is pinned to. */
  commit: string;
  at: string;
  by: string;
  /** Where the toolkit came from (the fork's origin URL), for another office cloning the project. */
  repo?: string;
  /** Newest last, at most a few dozen. */
  history?: ToolkitHistoryEntry[];
}

/** How the office knows the project's toolkit commit. */
export type PinSource = 'record' | 'ack' | 'snapshot' | 'none';

export interface ToolkitStatus {
  floor: string;
  /** The office's toolkit clone is a git repository (else nothing can be pinned). */
  git: boolean;
  /** pinned: the project runs on its own read-only copy at `commit`. detected: not pinned, commit worked out (from PROJECT.md's ack or the copied scripts). unknown: neither. */
  state: 'pinned' | 'detected' | 'unknown';
  source: PinSource;
  /** The commit (pinned or detected), its date and subject. */
  commit?: { sha: string; date?: string; subject?: string };
  /** For a detected commit: how sure ("PROJECT.md's Toolkit commit line", "12 of 14 copied scripts match"). */
  detail?: string;
  /** The folder the project's scripts run from: the pin, or the shared clone when it isn't pinned. */
  runsFrom: string;
  /** The newest commit of the fork's default branch the office has fetched. */
  latest?: { sha: string; date?: string; branch: string };
  /** Commits on the fork after the project's commit (no merges), newest first, at most 30 listed. */
  newer: { count: number; commits: ToolkitCommit[]; summary: string };
  /** The previous pin, for a rollback. */
  previous?: string;
  /** When the fork was last fetched, and whether a fetch is running. */
  fetchedAt?: number;
  fetching: boolean;
  /** The fork against Maurits' upstream, when the clone has an `upstream` remote (read-only). */
  upstream?: { remote: string; branch: string; behind: number; ahead: number; url?: string };
  /** Something wrong (the pinned commit isn't in the clone, the pin folder was edited…). */
  problems: string[];
  /** A preview or update running for this floor now. */
  job?: { id: string; kind: 'preview' | 'apply'; status: ToolkitJobStatus };
  admin?: boolean;
}

export const short = (sha: string | undefined) => (sha ? sha.slice(0, 7) : '?');

/** "toolkit 7b4b4cf (2026-10-08) · 3 newer commits available (fix/new/gate-rule changes)". */
export function toolkitLine(s: Pick<ToolkitStatus, 'state' | 'commit' | 'newer' | 'source'>): string {
  if (!s.commit) return 'toolkit version unknown — pin now';
  const head = `toolkit ${s.state === 'detected' ? '≈ ' : ''}${short(s.commit.sha)}${s.commit.date ? ` (${s.commit.date})` : ''}`;
  const n = s.newer.count;
  const more = n ? ` · ${n} newer commit${n === 1 ? '' : 's'} available${s.newer.summary ? ` (${s.newer.summary})` : ''}` : ' · up to date';
  return `${head}${more}${s.state === 'detected' ? ' · not pinned' : ''}`;
}

// ---- The Update toolkit preview -------------------------------------------------------------------

export interface StageVerdict {
  id: string;
  title?: string;
  status: string;
  detail?: string;
}

export interface VerdictChange {
  id: string;
  title?: string;
  before?: string;
  after?: string;
  /** gate-check's reason on the new toolkit (or the old one's, when the stage went away). */
  why?: string;
}

/** A stage's id on gate-check's dashboard: P, 0 to 7, build-ready. */
export const STAGE_ID = /^(P|[0-7]|build-ready)$/i;

const RANK: Record<string, number> = { PASS: 3, WAIVED: 3, MANUAL: 2, PENDING: 1, FAIL: 0 };

/** The stages whose verdict differs between the two runs, in the dashboard's order. */
export function verdictDiff(before: readonly StageVerdict[], after: readonly StageVerdict[]): VerdictChange[] {
  const b = new Map(before.map((v) => [v.id, v]));
  const a = new Map(after.map((v) => [v.id, v]));
  // Stages only: the dashboard's other rows (protocol freshness, which always differs against a new toolkit) aren't verdicts.
  const ids = [...new Set([...before.map((v) => v.id), ...after.map((v) => v.id)])].filter((id) => STAGE_ID.test(id));
  const out: VerdictChange[] = [];
  for (const id of ids) {
    const x = b.get(id);
    const y = a.get(id);
    if (x?.status === y?.status) continue;
    out.push({ id, title: y?.title ?? x?.title, before: x?.status, after: y?.status, why: (y ?? x)?.detail });
  }
  return out;
}

/** Whether a change made a stage worse (PASS → FAIL, say). */
export const worse = (c: VerdictChange) => (RANK[c.after ?? ''] ?? -1) < (RANK[c.before ?? ''] ?? -1);

/** "Stage 2 PASS → FAIL because …". */
export function changeText(c: VerdictChange): string {
  return `Stage ${c.id}${c.title ? ` (${c.title})` : ''} ${c.before ?? 'not shown'} → ${c.after ?? 'not shown'}${c.why ? ` because ${c.why}` : ''}`;
}

export type ToolkitJobStatus = 'running' | 'ready' | 'done' | 'failed';

export interface ToolkitJobView {
  id: string;
  kind: 'preview' | 'apply';
  floor: string;
  /** The commit the project is on (undefined when unknown) and the one it would move to. */
  from?: string;
  to: string;
  action: 'update' | 'rollback' | 'pin';
  status: ToolkitJobStatus;
  startedAt: number;
  finishedAt?: number;
  /** What happened, a line at a time (the last 200). */
  log: string[];
  error?: string;
  /** Preview: the commits between, and the verdicts on the project's default branch with the old toolkit and the new. */
  commits?: ToolkitCommit[];
  before?: StageVerdict[];
  after?: StageVerdict[];
  changes?: VerdictChange[];
  /** The project's current stage is mid-way: updating now changes its rules part-way through. */
  stageWarning?: string;
  /** Apply: the commit made in the project and where it went. */
  commit?: string;
  pushed?: string;
}

/** A stage the setup panel shows as in progress (its gate not passed yet) is mid-way; one not started is at a boundary. */
export function stageWarning(next: { id: string; title?: string; status: string } | undefined): string | undefined {
  if (!next || next.status !== 'FAIL') return undefined;
  return `Stage ${next.id}${next.title ? ` (${next.title})` : ''} is in progress: its gate hasn't passed yet. Updating now changes its rules part-way through; the recommended moment is right after a stage passes.`;
}
