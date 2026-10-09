// A subagent's detail, from its card in the Workers tab or from it in the 2D view: who hired it, what
// it's on now, its last runs (how long, how they ended, the Lead's verdict), its reviews, where it
// stands, and the way to its Lead's terminal or Chat view (it works inside its Lead's session, so that's
// where its work shows). The Project Manager gets Warn, Bench, Model and Reinstate here too, through the
// same gates as on the Team tab (ui/roster/subagents.ts). It isn't hired or sent home like a worker:
// its Lead sends it off.

import { cardNow, shortSpan, subagentCards, type SubagentCard } from '../../../shared/roster/subagent-cards';
import type { LiveRunView } from '../../../shared/roster/subagent-live';
import { modelWord } from '../../../shared/roster/subagents';
import type { RosterView } from '../../../shared/roster/types';
import { h, openModal, timeAgo, type Modal } from '../dom';
import { subagentActions } from '../roster/subagents';
import './subagents.css';

export interface SubagentDetailDeps {
  /** Opens a worker's terminal (with its Chat view, when that's what the person picked). */
  openWorker(id: string): void;
  /** The roster after an action on it came back. */
  onRoster?(v: RosterView): void;
}

const VERDICT: Record<string, string> = { accept: '✅ accepted', rework: '🔁 sent back', failed: '❌ failed', pending: '⏳ unreviewed' };
const STATUS: Record<LiveRunView['status'], string> = { working: '🔨 working', done: '✔️ done', failed: '❌ failed', lost: '❔ lost track' };

function runRow(r: LiveRunView, now: number): HTMLElement {
  const took = r.status === 'working' ? `for ${shortSpan(now - (r.resumedAt ?? r.startedAt))}` : r.durationMs !== undefined ? `took ${shortSpan(r.durationMs)}` : '';
  return h(
    'li.sw-run',
    { class: `sw-${r.status}` },
    h('span.sw-run-task', {}, r.task ?? '(no description)'),
    h('span.sw-run-meta', {}, [STATUS[r.status], timeAgo(r.startedAt), took, r.background ? 'background' : '', r.model ? modelWord(r.model) : ''].filter(Boolean).join(' · ')),
    r.outcome ? h('span.sw-run-verdict', { title: r.note ?? '' }, `${VERDICT[r.outcome] ?? r.outcome}${r.note ? `: ${r.note}` : ''}`) : null,
  );
}

function body(c: SubagentCard, v: RosterView, deps: SubagentDetailDeps, redraw: (v: RosterView) => void, close: () => void): HTMLElement {
  const now = Date.now();
  const s = v.subagents.find((x) => x.lead === c.lead && x.name === c.name);
  const chips = [
    `🧠 ${modelWord(c.model)}`,
    `${c.runs} run${c.runs === 1 ? '' : 's'}`,
    c.unreviewed ? `${c.unreviewed} unreviewed` : '',
    c.grade ? `grade ${c.grade} (${c.score}%)` : 'not graded yet',
    c.state === 'warning' ? `⚠️ on warning (${c.warnings})` : c.state === 'benched' ? `🪑 benched${c.benchedUntil ? ` until ${new Date(c.benchedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}` : 'active',
    c.underperforming ? `📉 ${c.why ?? 'underperforming'}` : '',
    c.defined ? '' : 'made by its Lead',
  ].filter(Boolean);
  return h(
    'div.sw-body',
    {},
    h('p.sw-now', { class: `sw-${c.status}` }, cardNow(c, now)),
    h('div.sw-chips', {}, ...chips.map((t) => h('span.sw-chip', {}, t))),
    c.lastWarning ? h('p.sw-note', {}, `⚠️ Last warning: ${c.lastWarning}`) : null,
    c.benchReason ? h('p.sw-note', {}, `🪑 Benched: ${c.benchReason}`) : null,
    h('div.sw-lead', {}, h('span', {}, `${c.firstName} is ${c.leadName}'s ${c.name} subagent and works inside ${c.leadName}'s Claude Code session: its work shows in ${c.leadName}'s terminal and Chat view.`), c.leadWorkerId ? h('button.btn.small', { type: 'button', onclick: () => (close(), deps.openWorker(c.leadWorkerId!)) }, `💬 Open ${c.leadName}`) : h('span.sw-dim', {}, `${c.leadName} isn't at work now.`)),
    h('h4', {}, 'Recent runs'),
    c.recent.length ? h('ul.sw-runs', {}, ...c.recent.map((r) => runRow(r, now))) : h('p.sw-dim', {}, 'None seen yet: the office lists runs from when this was turned on.'),
    h('h4', {}, `${c.leadName}'s reviews`),
    c.reviews.length
      ? h('ul.sw-runs', {}, ...c.reviews.map((r) => h('li.sw-run', {}, h('span.sw-run-task', {}, r.task ?? '(no description)'), h('span.sw-run-meta', {}, [VERDICT[r.outcome] ?? r.outcome, timeAgo(r.reviewedAt ?? r.at), modelWord(r.model)].join(' · ')), r.note ? h('span.sw-run-verdict', {}, r.note) : null)))
      : h('p.sw-dim', {}, `No verdicts yet (\`office-workers subagent review\`).`),
    s ? h('div.sw-actions', {}, subagentActions(v, s, redraw)) : null,
  );
}

/** Opens the detail of subagent `key` (`<lead>/<name>`) on the floor's team `v`. */
export function openSubagentDetail(v: RosterView, key: string, deps: SubagentDetailDeps): Modal | undefined {
  const find = (view: RosterView) => subagentCards(view, { includeNeverRun: true }).find((c) => c.key === key);
  const c = find(v);
  if (!c) return undefined;
  // Its first name over its role; a rename shows at once.
  const title = (x: SubagentCard) => h('h2', { title: `Dispatched as ${x.name}` }, `🧩 ${x.firstName}`, h('small.sw-hired', {}, ` · ${x.role} (${x.leadName}'s subagent)`));
  const head = h('header', {}, title(c));
  const slot = h('div.body');
  const win = h('div.modal.sw-window', { role: 'dialog', 'aria-label': c.label }, head, slot);
  let modal: Modal | undefined;
  const draw = (view: RosterView) => {
    const now = find(view);
    if (!now) return modal?.close();
    head.firstElementChild?.replaceWith(title(now));
    slot.replaceChildren(body(now, view, deps, draw, () => modal?.close()));
    deps.onRoster?.(view);
  };
  slot.replaceChildren(body(c, v, deps, draw, () => modal?.close()));
  modal = openModal(win, { doing: `looking at ${c.tag}` });
  return modal;
}
