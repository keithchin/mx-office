// Jeff, the Router: the office's quick judge (server/judge/) put to work on a floor. Two judgements,
// each off, shadow or on in the team settings (shadow by default):
//   - waiting: an agent's turn just ended. Is it waiting on the Project Manager? The office's rule says
//     so when it has an open escalation that isn't an FYI (or it's asking at its terminal). On: when
//     Jeff is sure and the rule isn't, he raises the escalation for it, once per turn.
//   - triage: a new issue appeared on the board. Which team is it for? The rule is its `team:` label,
//     if it has one. On: an unlabelled issue gets Jeff's team when he's confident.
// Shadow logs both verdicts side by side (judge/<floor>.jsonl) and never acts, so the Project Manager
// can see on the Analysis tab where Jeff agrees with the office before letting him act.

import path from 'node:path';
import type { GhIssue, WorkerInfo } from '../../shared/protocol.js';
import { summarize, type JeffMode, type JeffStatus, type JudgeKind, type JudgeRow, type JudgeSummary } from '../../shared/judge.js';
import { TEAM_IDS, TEAM_META, leadOf, teamFromLabels, teamLabel } from '../../shared/roster/card-team.js';
import type { TeamId } from '../../shared/roster/roles.js';
import { JudgeLog } from '../judge/log.js';
import { clipState, type Questions, type Verdict } from '../judge/pure.js';
import type { Roster } from './index.js';
import type { TeamFloor } from './types.js';

/** Jeff's noul at or above this, with a kind that needs an answer, is "waiting on you". */
export const WAITING_AT = 0.7;
/** Jeff labels an unlabelled issue only this sure of the team. */
export const TRIAGE_AT = 0.75;
/** New issues judged per look at the board, so a bulk import doesn't become a burst of calls. */
const TRIAGE_PER_LOOK = 5;
const TEXT_LOGGED = 300;

export const WAITING_QUESTIONS: Questions = {
  waiting: {
    type: 'noul',
    instructions: 'The agent ends by asking the Project Manager (the human) a question, or for a decision, approval or sign-off, and is waiting for the answer before it can continue.',
  },
  kind: {
    type: 'choice',
    instructions: 'What does the end of the agent\'s message ask of the Project Manager (the human)?',
    criteria: {
      question: 'A question it needs answered before it can go on',
      permission: 'Permission to do something: run, merge, deploy, spend, delete',
      'sign-off': 'A review, approval or sign-off of finished work',
      fyi: 'Nothing: it reports progress or results for information',
      none: 'Nothing at all for the Project Manager: it is mid-work or talking to someone else',
    },
  },
};

const PRIORITIES = ['low: nice to have, no rush', 'normal: part of the plan', 'high: blocks other work or a user-visible problem', 'urgent: broken now, or a deadline today'];

export function triageQuestions(): Questions {
  const criteria: Record<string, string> = {};
  for (const t of TEAM_IDS) criteria[t] = `${TEAM_META[t].labelDescription}. ${leadOf(t).mission}`;
  return {
    team: { type: 'choice', instructions: 'Which team of this Mendix project should take this GitHub issue?', criteria },
    priority: { type: 'score', instructions: 'How urgent is this issue?', criteria: PRIORITIES },
  };
}

/** The line an escalation is titled with: its last question, else its last line, plain and short. */
export function questionLine(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^[\s>#*_`-]+|[*_`]+$/g, '').trim())
    .filter(Boolean);
  const q = [...lines].reverse().find((l) => l.includes('?')) ?? lines[lines.length - 1] ?? '';
  return q.length > 120 ? `${q.slice(0, 119)}…` : q;
}

const pct = (n: number) => n.toFixed(2);

export class Jeff {
  readonly log: JudgeLog;
  /** Open issue numbers seen per floor; the first look is the baseline, judged never. */
  private seen = new Map<string, Set<number>>();
  private asking = new Set<string>();

  constructor(private roster: Roster) {
    this.log = new JudgeLog(path.join(roster.deps.dataDir, 'judge'));
  }

  private mode(floor: TeamFloor, kind: JudgeKind): JeffMode {
    return this.roster.data(floor.id).settings.jeff[kind];
  }

  /** The office's own rule: an open escalation of its own that isn't an FYI, or asking at its terminal. */
  ruleWaiting(floor: TeamFloor, w: WorkerInfo): boolean {
    if (w.status === 'needs_input') return true;
    const role = this.roster.roleOf(floor, w.id);
    return this.roster.data(floor.id).escalations.some((e) => e.status === 'open' && !e.fyi && (e.workerId === w.id || (!!role && e.role === role)));
  }

  /** An agent's turn just ended: is it waiting on the Project Manager? */
  async onTurnEnd(floor: TeamFloor, w: WorkerInfo): Promise<void> {
    const judge = this.roster.deps.judge;
    const mode = this.mode(floor, 'waiting');
    if (!judge || mode === 'off' || w.kind !== 'agent') return;
    const key = `${floor.id}:${w.id}`;
    if (this.asking.has(key)) return;
    const text = floor.lastWords?.(w);
    if (!text?.trim()) return;
    this.asking.add(key);
    try {
      const v = await judge(text, WAITING_QUESTIONS, { keep: 'tail' });
      if (!v || v.answers.waiting?.type !== 'noul' || v.answers.kind?.type !== 'choice') return;
      const noul = v.answers.waiting.noul;
      const kind = v.answers.kind;
      const says = noul >= WAITING_AT && kind.choice !== 'none' && kind.choice !== 'fyi';
      const now = floor.worker(w.id) ?? w;
      const rule = this.ruleWaiting(floor, now);
      let acted = false;
      // Only while its turn is still over: a person (or anything else) may have moved it on meanwhile.
      if (mode === 'on' && says && !rule && (now.status === 'done' || now.status === 'idle')) {
        const title = questionLine(text) || `${now.name} is waiting on you`;
        const details = [`Jeff noticed ${now.name} ended its turn waiting on you (${kind.choice}, ${Math.round(noul * 100)}% sure). Answer here and it goes to ${now.name} as its next prompt.`, '', 'Its last message:', '', clipState(text, 2000)].join('\n');
        this.roster.escalations.raiseFor(
          floor,
          { workerId: now.id, by: now.name, role: this.roster.roleOf(floor, now.id) },
          { urgency: 'important', trigger: 'blocked', title, details, options: [] },
          `🧑‍⚖️ Jeff (Router) escalated to the Project Manager for ${now.name}: it ended its turn waiting on you`,
        );
        acted = true;
      }
      this.record(floor, v, {
        kind: 'waiting',
        subject: `${now.name} (${now.id})`,
        jeff: says ? 'waiting' : 'not waiting',
        detail: `noul ${pct(noul)} · ${kind.choice} ${pct(kind.confidence)}`,
        rule: rule ? 'waiting' : 'not waiting',
        agree: says === rule,
        acted,
        text: clipState(text, TEXT_LOGGED),
        verdict: says ? '→ PM' : 'carry on',
      });
    } finally {
      this.asking.delete(key);
    }
  }

  /** The floor's issues came back from GitHub: new open ones are triaged. */
  async onIssues(floor: TeamFloor, issues: readonly Pick<GhIssue, 'number' | 'title' | 'state' | 'body' | 'labels'>[]): Promise<void> {
    const open = issues.filter((i) => i.state === 'OPEN');
    const seen = this.seen.get(floor.id);
    if (!seen) return void this.seen.set(floor.id, new Set(open.map((i) => i.number)));
    const fresh = open.filter((i) => !seen.has(i.number));
    for (const i of fresh) seen.add(i.number);
    const judge = this.roster.deps.judge;
    const mode = this.mode(floor, 'triage');
    if (!judge || mode === 'off') return;
    for (const it of fresh.slice(0, TRIAGE_PER_LOOK)) await this.triage(floor, it, mode);
  }

  private async triage(floor: TeamFloor, it: Pick<GhIssue, 'number' | 'title' | 'body' | 'labels'>, mode: JeffMode) {
    const text = `${it.title}\n\n${it.body ?? ''}`;
    const v = await this.roster.deps.judge!(text, triageQuestions(), { keep: 'head' });
    if (!v || v.answers.team?.type !== 'choice') return;
    const team = v.answers.team.choice as TeamId;
    const conf = v.answers.team.confidence;
    const pri = v.answers.priority?.type === 'score' ? v.answers.priority.level?.split(':')[0] : undefined;
    const rule = teamFromLabels(it.labels);
    let acted = false;
    if (mode === 'on' && !rule && conf >= TRIAGE_AT && floor.labelIssue) {
      const err = await floor.labelIssue(it.number, team);
      if (!err) {
        acted = true;
        floor.activity?.(`🧑‍⚖️ Jeff (Router) labelled #${it.number} ${teamLabel(team)}`);
      } else if (err !== 'skipped') floor.toast(`Jeff couldn't label #${it.number} ${teamLabel(team)}: ${err}`, 'warn');
    }
    this.record(floor, v, {
      kind: 'triage',
      subject: `#${it.number} ${it.title}`.slice(0, 120),
      jeff: team,
      detail: `${team} ${pct(conf)}${pri ? ` · priority ${pri}` : ''}`,
      rule: rule ?? 'none',
      agree: rule ? rule === team : null,
      acted,
      text: clipState(text, TEXT_LOGGED, 'head'),
      verdict: `→ ${TEAM_META[team].name}`,
    });
  }

  private record(floor: TeamFloor, v: Verdict, r: Omit<JudgeRow, 'at' | 'by' | 'model' | 'ms'> & { verdict: string }) {
    const { verdict, ...rest } = r;
    const at = this.roster.deps.now();
    this.log.append(floor.id, { at, by: v.by, model: v.model, ms: v.ms, ...rest });
    floor.judged?.({ kind: r.kind, by: v.by, verdict, agree: r.agree, acted: r.acted, at });
  }

  summary(floorId: string, status: JeffStatus): JudgeSummary {
    return summarize(floorId, this.log.read(floorId), this.roster.data(floorId).settings.jeff, status, this.roster.deps.now());
  }
}
