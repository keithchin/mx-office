// What's blocked on you, the Project Manager, right now: the rules behind the "Needs you" strip at the
// top of the 1D view's Command Center (client/ui/needsyou/) and behind what the office posts to Microsoft
// Teams (server/notify-teams/). Most urgent first, each with the one thing to press to fix it. Pure: the
// tests, the browser and the server all import it, so the rules are written once.

import type { FloorInfo, GhPull, LiveAppState, WorkerInfo } from './protocol.js';
import type { FirmFloorStatus } from './firm/engagement.js';
import type { Escalation } from './roster/escalation.js';
import { jeffOrder, rankChip, rankOf, rankTip, sortedByJeff } from './roster/jeff-rank.js';
import type { RosterView } from './roster/types.js';
import type { StudioState } from './studio.js';
import type { SetupView } from './wizard.js';
import { needingYou, waitingInOrder } from './waiting.js';
import type { BudgetAlert } from './budget/types.js';

/** Where an item's button takes you. */
export type NeedTarget =
  | { to: 'worker'; id: string }
  | { to: 'escalation'; id: string }
  | { to: 'approvals' }
  | { to: 'settings' }
  | { to: 'pr'; number: number }
  | { to: 'setup' }
  | { to: 'live' }
  | { to: 'git' }
  | { to: 'floor'; floor: string }
  | { to: 'firm'; url: string }
  /** The 💰 Budget tab; `resume` takes the budget's pause off the project. */
  | { to: 'budget'; resume?: boolean };

export type NeedKind = 'asking' | 'finished' | 'lost' | 'escalation' | 'approval' | 'paused' | 'pr' | 'setup' | 'live' | 'floor' | 'audit' | 'studio' | 'budget';

/** How far behind its default branch a floor's folder may fall before Needs you mentions it. */
export const STALE_COMMITS = 10;

export interface NeedItem {
  /** Stable across redraws. */
  key: string;
  kind: NeedKind;
  icon: string;
  /** One plain sentence. */
  text: string;
  /** A tag before it (an escalation's urgency), when there's one. */
  tag?: string;
  /** Jeff's rank of an escalation (1 = resolve first) with his chip's words and tooltip, when he sorted them. */
  rank?: { n: number; chip: string; tip: string };
  /** Since when it has waited (ms), when known. */
  since?: number;
  /** block: something is stopped until you act; warn: worth a look. */
  level: 'block' | 'warn';
  /** The button's words. */
  action: string;
  target: NeedTarget;
  /** A second button (the budget's Resume beside Raise budget). */
  alt?: { action: string; target: NeedTarget };
}

/** What Needs you reads of a project's budget (GET /api/budget): the alerts standing and the pause. */
export interface BudgetNeed {
  floor: string;
  alerts: readonly BudgetAlert[];
  paused?: string;
}

export interface NeedsInput {
  floor?: string;
  workers: Iterable<WorkerInfo>;
  /** The floor's team, once fetched (undefined while loading, or with no team). */
  roster?: RosterView;
  pulls: readonly GhPull[];
  floors: readonly FloorInfo[];
  /** The setup panel's view of a toolkit project, when it has one for this floor. */
  setup?: SetupView;
  live?: LiveAppState | null;
  /** The Firm's audit of this floor (ui/firm/banner.ts), when there's something to say. */
  firm?: FirmFloorStatus;
  /** Studio mode on this floor (ui/studio/): Studio Pro closed with model changes nobody committed. */
  studio?: StudioState;
  /** The project's budget alerts and pause (server/budget/). */
  budget?: BudgetNeed;
}

const URGENCY_RANK: Record<Escalation['urgency'], number> = { critical: 0, urgent: 1, important: 2, info: 3 };

/** Everything that needs you, most urgent first: this floor's, then other floors where someone's waiting. */
export function collectNeeds(i: NeedsInput): NeedItem[] {
  const out: NeedItem[] = [];
  const workers = [...i.workers];
  const r = i.roster?.floor === i.floor ? i.roster : undefined;
  const admin = !!r?.admin;

  // 1. Agents stopped on a question or a permission prompt, longest first.
  for (const w of needingYou(workers)) {
    if (w.kind !== 'agent' || w.lost) continue;
    out.push({ key: `ask-${w.id}`, kind: 'asking', icon: '🙋', text: `${w.name} is asking: ${w.activity ?? 'waiting on an answer'}`, since: w.waitingSince, level: 'block', action: 'Answer', target: { to: 'worker', id: w.id } });
  }
  // Agents that finished a turn nobody has looked at yet: the floor counts them as waiting too.
  for (const w of waitingInOrder(workers)) {
    if (w.status !== 'done' || w.kind !== 'agent' || w.lost) continue;
    const what = w.task?.summary ?? w.task?.name ?? w.title;
    out.push({ key: `done-${w.id}`, kind: 'finished', icon: '✅', text: `${w.name} finished${what ? `: ${what}` : ' its turn'} — not looked at yet`, since: w.waitingSince, level: 'warn', action: 'Review', target: { to: 'worker', id: w.id } });
  }
  // 2. Workers whose worktree was deleted outside agent-office.
  for (const w of workers.filter((x) => x.lost).sort((a, b) => a.createdAt - b.createdAt)) {
    out.push({ key: `lost-${w.id}`, kind: 'lost', icon: '🌿', text: `${w.name}'s worktree was deleted outside agent-office`, level: 'block', action: 'Fix', target: { to: 'worker', id: w.id } });
  }
  if (r) {
    // 3. Open escalations that aren't FYI: in Jeff's order when he ranked them, else loudest then oldest first.
    const byJeff = sortedByJeff(r.escalations, r.settings?.jeff?.priority);
    const open = jeffOrder(r.escalations.filter((e) => e.status === 'open' && !e.fyi), byJeff, (a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || a.at - b.at);
    for (const e of open) {
      const n = byJeff ? rankOf(e) : undefined;
      const loud = e.urgency === 'urgent' || e.urgency === 'critical';
      out.push({ key: `esc-${e.id}`, kind: 'escalation', icon: '🚩', tag: e.urgency.toUpperCase(), text: `${e.by} escalated: ${e.title}`, since: e.at, level: loud ? 'block' : 'warn', action: admin ? 'Answer' : 'View', target: { to: 'escalation', id: e.id }, ...(n !== undefined && e.jeffRank ? { rank: { n, chip: rankChip(n), tip: rankTip(e.jeffRank, n) } } : {}) });
    }
    // 4. Proposals and merges waiting on you (escalations are above; the cap is the paused line below).
    for (const a of r.approvals) {
      if (a.kind === 'escalation' || (a.kind === 'cap' && r.paused)) continue;
      const icon = a.kind === 'merge' ? '🔀' : a.kind === 'cap' ? '💸' : a.kind === 'subagent' ? '🧰' : '📝';
      const text = a.kind === 'proposal' ? `Proposal to approve: ${a.title}` : a.kind === 'subagent' ? `To approve: ${a.title}` : a.title;
      out.push({ key: `appr-${a.id}`, kind: 'approval', icon, text, level: 'warn', action: admin ? 'Review' : 'View', target: { to: 'approvals' } });
    }
    // 5. The cost cap: no hiring, and the office sends no prompts of its own; people's still go through.
    if (r.paused) out.push({ key: 'paused', kind: 'paused', icon: '💸', text: `Spend cap reached: office prompts paused; agents finish their current turn. ${r.paused}`, level: 'block', action: 'Settings', target: { to: 'settings' } });
  }
  // The budget: paused at 100 %, or its loudest standing alert (100 %, the forecast over, the threshold).
  const b = i.budget && i.budget.floor === i.floor ? i.budget : undefined;
  if (b) {
    const top = (['full', 'forecast', 'threshold'] as const).map((l) => b.alerts.find((a) => a.level === l && a.text)).find(Boolean);
    if (b.paused) out.push({ key: 'budget-paused', kind: 'budget', icon: '💸', text: 'Budget reached: project paused. No new hires and no office prompts; people’s messages still go through', since: b.alerts.find((a) => a.level === 'full')?.at, level: 'block', action: 'Raise budget', target: { to: 'budget' }, alt: { action: 'Resume', target: { to: 'budget', resume: true } } });
    else if (top) out.push({ key: `budget-${top.level}`, kind: 'budget', icon: '💸', text: top.text, since: top.at, level: top.level === 'full' ? 'block' : 'warn', action: top.level === 'full' ? 'Raise budget' : 'Budget', target: { to: 'budget' } });
  }
  // 6. Open, ready PRs whose checks fail.
  for (const p of i.pulls) {
    if (p.state !== 'OPEN' || p.isDraft || p.checks !== 'fail') continue;
    out.push({ key: `pr-${p.number}`, kind: 'pr', icon: '❌', text: `PR #${p.number} has failing checks: ${p.title}`, since: Date.parse(p.updatedAt) || undefined, level: 'warn', action: `Open PR #${p.number}`, target: { to: 'pr', number: p.number } });
  }
  // A toolkit stage at a ✋ gate, waiting for your sign-off (the setup panel below says which).
  for (const s of i.setup?.show ? i.setup.stages : []) {
    if (s.status !== 'MANUAL') continue;
    out.push({ key: `setup-${s.id}`, kind: 'setup', icon: '✋', text: `Stage ${s.id} (${s.title}) waits for your sign-off`, level: 'warn', action: 'Sign off', target: { to: 'setup' } });
  }
  // The floor's live app failed to start.
  if (i.live && i.live.floor === i.floor && i.live.status === 'failed') {
    out.push({ key: 'live', kind: 'live', icon: '🌐', text: `The live app failed${i.live.message ? `: ${i.live.message}` : ''}`, since: i.live.since, level: 'warn', action: 'Live app', target: { to: 'live' } });
  }
  // Studio Pro closed with model changes in the checkout: the agents build on main, so they need committing.
  if (i.studio && i.studio.floor === i.floor && !i.studio.open && i.studio.uncommitted) {
    const n = i.studio.uncommitted.files;
    out.push({ key: 'studio-commit', kind: 'studio', icon: '🧱', text: `Commit your Studio Pro changes so the agents build on them (${n} model file${n === 1 ? '' : 's'} changed)`, since: i.studio.uncommitted.since, level: 'warn', action: 'Git', target: { to: 'git' } });
  }
  // The Firm: its report on this floor is in, or its audit is past 80% of the budget.
  if (i.firm && i.firm.floor === i.floor) {
    const f = i.firm;
    if (f.reportReady) out.push({ key: `audit-${f.reportReady.report}`, kind: 'audit', icon: '📑', text: 'Audit report ready from The Firm', since: f.reportReady.at, level: 'warn', action: 'Read', target: { to: 'firm', url: `/firm?report=${encodeURIComponent(f.reportReady.report)}` } });
    if (f.budgetWarn) out.push({ key: `audit-budget-${f.budgetWarn.engagement}`, kind: 'audit', icon: '📑', text: `Audit budget at ${Math.min(100, Math.round((f.budgetWarn.spent / f.budgetWarn.budget) * 100))}%: $${f.budgetWarn.spent.toFixed(2)} of $${f.budgetWarn.budget.toFixed(2)}`, level: 'warn', action: 'View', target: { to: 'firm', url: '/firm' } });
  }
  // The floor's folder far behind (low priority, so last of this floor's) its default branch: the setup panel reads main, but agents and the live app use the folder.
  const stale = i.setup?.show ? i.setup.checkout : undefined;
  if (stale && stale.behind > STALE_COMMITS) out.push({ key: 'setup-stale', kind: 'setup', icon: '🌿', text: `This floor's folder is on ${stale.branch}, ${stale.behind} commits behind ${stale.defaultBranch}`, level: 'warn', action: 'Setup', target: { to: 'setup' } });
  // 7. Other floors where someone is waiting.
  for (const f of i.floors) {
    if (f.id === i.floor || f.cloning || !(f.waiting > 0)) continue;
    out.push({ key: `floor-${f.id}`, kind: 'floor', icon: '🙋', text: `${f.waiting} waiting on ${f.name}`, level: 'block', action: 'Go', target: { to: 'floor', floor: f.id } });
  }
  return out;
}

/** How many are on this floor: the count on the 🎛️ Command Center tab. */
export const hereCount = (items: readonly NeedItem[]) => items.filter((n) => n.kind !== 'floor').length;
