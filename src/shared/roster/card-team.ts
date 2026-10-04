// Which team a card on the board belongs to (docs/teams.md, "Sub-boards"). The main board shows every
// card with its team's tag, and each team's page shows only its own, so the PM sees the whole project
// from above and each Lead's lane up close. A card's team comes from what GitHub and the office already
// know, cheapest first, so no model is ever asked:
//   1. a `team:<team>` label on the issue or PR (what the CTO, a Lead or an approved proposal set);
//   2. a worker that is a roster member is on its role's team;
//   3. a PR without a label: its author worker's team, else the team of an issue it closes;
//   4. a queued task: its issue's team; a worker that isn't a member: its task's issue, else its PR;
//   5. otherwise Unassigned.
// Pure: the browser and the tests import it.

import type { GhIssue, GhLabel, GhPull, QueueTask, WorkerInfo } from '../protocol.js';
import { ROLES, type TeamId } from './roles.js';

export type CardTeam = TeamId | 'unassigned';

export const TEAM_IDS: readonly TeamId[] = ['management', 'design', 'development', 'testing', 'analysis'];
/** Every chip the filter bar offers, in the order it shows them. */
export const CARD_TEAMS: readonly CardTeam[] = [...TEAM_IDS, 'unassigned'];
export const isCardTeam = (v: unknown): v is CardTeam => typeof v === 'string' && (CARD_TEAMS as readonly string[]).includes(v);

export const TEAM_LABEL_PREFIX = 'team:';
export const teamLabel = (t: TeamId) => `${TEAM_LABEL_PREFIX}${t}`;

export interface TeamMeta {
  /** The team as a heading ("Testing"), and short for a tag on a card ("Test"). */
  name: string;
  short: string;
  icon: string;
  /** Its GitHub label's color (hex without #), close to the theme token the page draws it in. */
  labelColor: string;
  /** What the label says it's for, in the repo's list of labels. */
  labelDescription: string;
}

/** The team's look and words. The icons are the Leads' own (shared/roster/roles.ts), so a tag and the org chart agree. */
export const TEAM_META: Record<CardTeam, TeamMeta> = {
  management: { name: 'Management', short: 'PM', icon: '🧭', labelColor: 'ff8a5b', labelDescription: "The Project Manager's lane: plan, coordination, standups" },
  design: { name: 'Design', short: 'Design', icon: '🎨', labelColor: '9d4edd', labelDescription: "The Lead Designer's lane: Atlas, wireframes, layouts, branding" },
  development: { name: 'Development', short: 'Dev', icon: '🛠️', labelColor: '5bc0eb', labelDescription: "The Lead Developer's lane: the app's code and MDL" },
  testing: { name: 'Testing', short: 'Test', icon: '🧪', labelColor: '06d6a0', labelDescription: "The Lead Tester's lane: tests, quality, the test framework" },
  analysis: { name: 'Analysis', short: 'Analysis', icon: '📈', labelColor: 'ffd166', labelDescription: "The Chief Analyst's lane: requirements, BRD, insight memos" },
  unassigned: { name: 'Unassigned', short: 'None', icon: '◌', labelColor: 'cccccc', labelDescription: '' },
};

/** The role that leads a team, from the roster's table. */
export const leadOf = (t: TeamId) => ROLES.find((r) => r.team === t)!;

/** The team a `team:<team>` label names, case and spaces forgiven; the first such label wins. */
export function teamFromLabels(labels: readonly Pick<GhLabel, 'name'>[] | undefined): TeamId | undefined {
  for (const l of labels ?? []) {
    const n = l.name.trim().toLowerCase();
    if (!n.startsWith(TEAM_LABEL_PREFIX)) continue;
    const t = n.slice(TEAM_LABEL_PREFIX.length).trim();
    if ((TEAM_IDS as readonly string[]).includes(t)) return t as TeamId;
  }
  return undefined;
}

/** What the mapping looks at: the floor's lists, and which worker each roster member is. */
export interface TeamWorld {
  issues: readonly GhIssue[];
  pulls: readonly GhPull[];
  tasks: readonly QueueTask[];
  workers: readonly WorkerInfo[];
  /** Roster members that are hired: their worker and their role's team. */
  members: readonly { workerId?: string; team: TeamId }[];
}

const memberTeam = (world: TeamWorld, workerId: string | undefined) => (workerId ? world.members.find((m) => m.workerId === workerId)?.team : undefined);

export function issueTeam(it: Pick<GhIssue, 'labels'>): CardTeam {
  return teamFromLabels(it.labels) ?? 'unassigned';
}

const issueNo = (world: TeamWorld, n: number | undefined): TeamId | undefined => {
  if (!n) return undefined;
  const it = world.issues.find((i) => i.number === n);
  return it ? teamFromLabels(it.labels) : undefined;
};

export function pullTeam(p: GhPull, world: TeamWorld): CardTeam {
  const labelled = teamFromLabels(p.labels);
  if (labelled) return labelled;
  const author = world.workers.find((w) => w.pr?.number === p.number || w.pastPrs?.includes(p.number));
  const byAuthor = memberTeam(world, author?.id);
  if (byAuthor) return byAuthor;
  for (const n of p.closes) {
    const t = issueNo(world, n);
    if (t) return t;
  }
  return 'unassigned';
}

export function taskTeam(t: Pick<QueueTask, 'issue'>, world: TeamWorld): CardTeam {
  return issueNo(world, t.issue) ?? 'unassigned';
}

export function workerTeam(w: WorkerInfo, world: TeamWorld): CardTeam {
  const member = memberTeam(world, w.id);
  if (member) return member;
  // A worker hired for an issue (the queue, ▶ Start) has a task naming it.
  const task = world.tasks.find((t) => t.workerId === w.id && t.issue);
  const byIssue = issueNo(world, task?.issue);
  if (byIssue) return byIssue;
  // Its PR's own label: the worker carries on what its PR is about.
  const pr = w.pr && world.pulls.find((p) => p.number === w.pr!.number);
  return pr ? (teamFromLabels(pr.labels) ?? 'unassigned') : 'unassigned';
}
