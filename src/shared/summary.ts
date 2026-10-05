// A floor's project summary (GET /api/summary): what the project is for, where it stands, who's on
// it, what just happened and what's in the way. The server puts the facts together (server/summary/)
// and the board's panel shows them (client/ui/summary.ts); both read this shape.

export interface StageVerdict {
  /** "P", "0".."7", or a check's mark. */
  id: string;
  title: string;
  status: 'PASS' | 'PENDING' | 'FAIL' | 'WAIVED' | 'MANUAL' | string;
  detail?: string;
}

export interface SummaryAgent {
  id: string;
  name: string;
  color: string;
  model?: string;
  status: string;
  /** One line: what it's on and what it's doing right now. */
  doing: string;
  /** How long it has waited on a person, while it does. */
  waitingMs?: number;
  /** How long since anything about it last changed, while it's working. */
  quietMs?: number;
}

export type ActivityKind = 'started' | 'finished' | 'needs' | 'pr-opened' | 'pr-merged' | 'pr-closed' | 'approved' | 'issue-opened' | 'issue-closed' | 'team';

export interface ActivityItem {
  at: number;
  kind: ActivityKind;
  text: string;
}

export interface Risk {
  level: 'warn' | 'bad';
  text: string;
}

export interface ProjectSummary {
  floor: string;
  name: string;
  repo?: string;
  /** What the project is for, from its README (or a toolkit project's intake), and which file said so. */
  goal?: string;
  goalFrom?: string;
  /** Where it stands: a toolkit project's current stage and its stage verdicts and decisions. */
  phase?: { label: string; from: string; stages: StageVerdict[]; decisions: { stage: string; decision: string; status: string }[] };
  progress: {
    issuesOpen: number;
    /** Closed lately (GitHub's list the board keeps is the latest 40), so "40+" when it's full. */
    issuesClosed: number;
    issuesClosedCapped: boolean;
    prsOpen: number;
    prsMerged: number;
    prsMergedCapped: boolean;
    queued: number;
    running: number;
    done: number;
  };
  agents: SummaryAgent[];
  needsHuman: { count: number; longestMs: number };
  /** USD spent by this floor's workers: today (by the day each run last did something) and all told. */
  spend: { today: number; total: number };
  activity: ActivityItem[];
  risks: Risk[];
  /** Two to four plain sentences: the small model's, from the facts above, or a template's when it can't. */
  narrative: string;
  narrativeBy: 'llm' | 'template';
  generatedAt: number;
}

/** "3 agents working · 1 needs you · 2 PRs open": a floor card's one line on the home page. */
export function oneLine(s: Pick<ProjectSummary, 'agents' | 'needsHuman' | 'progress' | 'phase'>): string {
  const working = s.agents.filter((a) => a.status === 'working').length;
  const parts = [
    s.phase ? s.phase.label.replace(/\*\*/g, '').split(/[,(]/)[0].trim() : '',
    working ? `${working} agent${working === 1 ? '' : 's'} working` : s.agents.length ? 'agents idle' : 'nobody working',
    s.needsHuman.count ? `🙋 ${s.needsHuman.count} need${s.needsHuman.count === 1 ? 's' : ''} you` : '',
    s.progress.prsOpen ? `${s.progress.prsOpen} PR${s.progress.prsOpen === 1 ? '' : 's'} open` : '',
    s.progress.queued ? `${s.progress.queued} queued` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}
