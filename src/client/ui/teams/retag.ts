// "Team: [▼]": moving a card to another team's board, in its hover preview and in the issue or PR window.
// The Project Manager (an admin) picks a team and the office's gh account swaps the card's `team:` label (gh.labels);
// everyone else sees the tag read-only. The board moves the card at once and puts it back if GitHub says
// no. Before the first tag on a floor the office makes any `team:` labels the repo is missing, in their
// colors (POST /api/teams/labels). In dry-run mode (the team setting, or AGENT_OFFICE_TEAMS_DRY_RUN=1)
// nothing is written to GitHub: the card moves on this page only, until the next look at GitHub.

import type { GhIssue, GhLabel, GhPull } from '../../../shared/protocol';
import { CARD_TEAMS, TEAM_LABEL_PREFIX, TEAM_META, teamFromLabels, teamLabel, type CardTeam } from '../../../shared/roster/card-team';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, toast } from '../dom';
import { labelWaiters } from '../github/api';
import type { Card } from '../kanban';
import { teamTag } from './tag';
import { canRetag, currentRoster } from './world';

type Kind = 'issue' | 'pull';
interface Target {
  kind: Kind;
  number: number;
}

let net: Net | null = null;
/** The connection gh.labels goes over (the 1D view's). */
export const useRetagNet = (n: Net) => (net = n);

/** Floors whose team labels are known to be there, and floors in dry-run mode, this visit. */
const ensured = new Map<string, { dryRun: boolean }>();

/** What changing a card's team relabels: the issue or PR it is (a queued task's issue, a worker's PR or issue). */
export function retagTarget(c: Card): Target | undefined {
  const o = c.of;
  if (o.kind === 'issue') return { kind: 'issue', number: o.it.number };
  if (o.kind === 'pull') return { kind: 'pull', number: o.p.number };
  if (o.kind === 'task') return o.t.issue ? { kind: 'issue', number: o.t.issue } : undefined;
  if (o.w.pr) return { kind: 'pull', number: o.w.pr.number };
  const task = store.queue.tasks.find((t) => t.workerId === o.w.id && t.issue);
  return task?.issue ? { kind: 'issue', number: task.issue } : undefined;
}

const itemOf = (t: Target): GhIssue | GhPull | undefined => (t.kind === 'issue' ? store.issues.items : store.pulls.items).find((i) => i.number === t.number);

/** Puts `labels` on the item in the store and redraws whatever follows it. */
function setLocal(t: Target, labels: GhLabel[]) {
  if (t.kind === 'issue') store.issues = { ...store.issues, items: store.issues.items.map((i) => (i.number === t.number ? { ...i, labels } : i)) };
  else store.pulls = { ...store.pulls, items: store.pulls.items.map((p) => (p.number === t.number ? { ...p, labels } : p)) };
  store.emit(t.kind === 'issue' ? 'issues' : 'pulls');
}

async function ensureLabels(floor: string): Promise<{ dryRun: boolean }> {
  const hit = ensured.get(floor);
  if (hit) return hit;
  const res = await fetch(`/api/teams/labels?floor=${encodeURIComponent(floor)}`, { method: 'POST', credentials: 'same-origin' });
  const body = (await res.json().catch(() => null)) as { made?: string[]; dryRun?: boolean; error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  if (body?.made?.length && !body.dryRun) toast(`🏷️ Made the team labels on GitHub: ${body.made.join(', ')}`);
  const r = { dryRun: !!body?.dryRun };
  ensured.set(floor, r);
  return r;
}

/**
 * Moves the issue or PR to team `to`: its `team:` labels swapped for `to`'s (none for Unassigned).
 * Resolves with the labels it has after (or before, when it failed and was put back).
 */
export async function retag(t: Target, to: CardTeam, via: Net | null = net): Promise<GhLabel[] | undefined> {
  const it = itemOf(t);
  const floor = store.floor;
  if (!it || !floor || !via) return undefined;
  const before = it.labels;
  const old = before.filter((l) => l.name.toLowerCase().startsWith(TEAM_LABEL_PREFIX));
  const add = to === 'unassigned' ? [] : [teamLabel(to)];
  const remove = old.map((l) => l.name).filter((n) => !add.includes(n.toLowerCase()));
  if (!remove.length && add.every((a) => before.some((l) => l.name.toLowerCase() === a))) return before;
  const after = [...before.filter((l) => !old.includes(l)), ...add.map((name) => ({ name, color: `#${TEAM_META[to].labelColor}` }))];
  const noun = `${t.kind === 'pull' ? 'PR' : 'Issue'} #${t.number}`;
  // The board moves the card now; GitHub catches up.
  setLocal(t, after);
  const rollback = (why: string) => {
    const cur = itemOf(t);
    if (cur && sameLabels(cur.labels, after)) setLocal(t, before);
    toast(`Couldn't move ${noun} to ${TEAM_META[to].name}: ${why}`, 'warn');
    return before;
  };
  let mode: { dryRun: boolean };
  try {
    mode = await ensureLabels(floor);
  } catch (err) {
    return rollback((err as Error).message);
  }
  if (mode.dryRun) {
    toast(`🧪 Dry run: ${noun} shows on ${TEAM_META[to].name}'s board here, but GitHub wasn't changed`);
    return after;
  }
  const key = `${t.kind}:${t.number}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      labelWaiters.delete(key);
      resolve(rollback('no answer from the office'));
    }, 45_000);
    labelWaiters.set(key, (msg) => {
      labelWaiters.delete(key);
      clearTimeout(timer);
      if (!msg.labels) return resolve(rollback(msg.error ?? 'GitHub did not take the label'));
      setLocal(t, msg.labels);
      toast(`🏷️ ${noun} is ${TEAM_META[to].name}'s now`);
      resolve(msg.labels);
    });
    via.send({ t: 'gh.labels', kind: t.kind, number: t.number, add, remove });
  });
}

const sameLabels = (a: GhLabel[], b: GhLabel[]) => a.length === b.length && a.every((l, i) => l.name === b[i].name);

/**
 * "Team: [▼]" for `target` now on team `team`: a picker for the Project Manager, the tag read-only for everyone
 * else. `onSaved` hears the labels after a change (the issue or PR window keeps its own copy).
 */
export function teamPicker(target: Target | undefined, team: CardTeam, onSaved?: (labels: GhLabel[]) => void, via?: Net): HTMLElement {
  const label = h('span.tm-pick-h', {}, 'Team');
  if (!target || !canRetag()) return h('span.tm-pick', {}, label, teamTag(team, true));
  const select = h(
    'select.tm-select',
    { 'aria-label': 'Team', title: "Move it to another team's board (swaps its team: label on GitHub)" },
    ...CARD_TEAMS.map((t) => h('option', { value: t, selected: t === team ? true : undefined }, `${TEAM_META[t].icon} ${TEAM_META[t].name}`)),
  ) as HTMLSelectElement;
  select.value = team;
  select.addEventListener('change', () => {
    const to = select.value as CardTeam;
    select.disabled = true;
    void retag(target, to, via ?? net).then((labels) => {
      select.disabled = false;
      if (labels) onSaved?.(labels);
    });
  });
  return h('label.tm-pick', { class: `tm-${team}` }, label, select);
}

/** "Team: [▼]" in the issue or PR window, for its own copy of the item (`onSaved` updates it). */
export const windowTeamPicker = (kind: Kind, it: GhIssue | GhPull, net: Net, onSaved: (labels: GhLabel[]) => void) =>
  teamPicker({ kind, number: it.number }, teamFromLabels(it.labels) ?? 'unassigned', onSaved, net);

/** The control in a card's hover preview. A Lead's own card is its role's team, whatever its PR says, so that one is read-only. */
export function retagControl(c: Card, team: CardTeam): HTMLElement {
  const o = c.of;
  const lead = o.kind === 'worker' && !!currentRoster()?.members.some((m) => m.workerId === o.w.id);
  return teamPicker(lead ? undefined : retagTarget(c), team);
}
