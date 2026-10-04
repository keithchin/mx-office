// The board on the 2D view: the floor's work as a pipeline, from GitHub issue to merged pull
// request, with the agents in between. Each card is something the office already has (an issue, a
// queued task, a worker, a PR); dragging an issue onto Queued queues it, onto In progress hires an
// agent for it. No three.js here: the 2D view imports it.

import type { GhIssue, GhPull, QueueTask, WorkerInfo } from '../../shared/protocol';
import { isAsleep } from '../../shared/status';
import { store } from '../state';
import { modelBadge } from './provider';
import { clip, h, STATUS_LABEL, timeAgo } from './dom';
import './kanban.css';

export type Column = 'backlog' | 'queued' | 'progress' | 'human' | 'review' | 'done';

export interface KanbanActions {
  openWorker(id: string): void;
  openIssue(it: GhIssue): void;
  openPull(it: GhPull): void;
  /** Dropped on In progress, or ▶: an agent for the issue (the hire form, filled in, to pick the model). */
  start(it: GhIssue): void;
  /** Dropped on Queued, or 📋: the next free agent takes it. */
  queue(it: GhIssue): void;
}

const COLUMNS: { id: Column; title: string; hint: string }[] = [
  { id: 'backlog', title: '📌 Backlog', hint: 'Open issues nobody has taken' },
  { id: 'queued', title: '📋 Queued', hint: 'Waiting for the next free agent' },
  { id: 'progress', title: '🤖 In progress', hint: 'Agents working' },
  { id: 'human', title: '🙋 Needs a human', hint: 'Agents waiting on someone' },
  { id: 'review', title: '🔀 In review', hint: 'Open pull requests' },
  { id: 'done', title: '✅ Done', hint: 'Merged and closed, latest first' },
];

/** How many of the latest finished cards Done shows. */
const DONE_SHOWN = 12;

interface Card {
  key: string;
  column: Column;
  title: string;
  lines: string[];
  /** A thin stripe down the card's edge: the worker's color, or the PR's checks. */
  stripe?: string;
  open(): void;
  /** Backlog cards: what can be dragged, and the buttons that do the same without dragging. */
  issue?: GhIssue;
}

const usd = (n: number) => `$${n.toFixed(n < 10 ? 2 : 0)}`;
const CHECK_COLOR: Record<GhPull['checks'], string | undefined> = { pass: 'var(--good)', fail: 'var(--bad)', pending: '#e0a800', none: undefined };

/** Every card on the floor, in its column. */
export function cards(a: KanbanActions): Card[] {
  const issues = store.issues.items;
  const pulls = store.pulls.items;
  const tasks = store.queue.tasks;
  const workers = [...store.workers.values()].filter((w) => w.kind === 'agent');
  const openPulls = pulls.filter((p) => p.state === 'OPEN');

  // An issue already somewhere further along isn't in the backlog too.
  const along = new Set<number>();
  for (const t of tasks) if (t.issue && t.status !== 'done') along.add(t.issue);
  for (const p of openPulls) for (const n of p.closes) along.add(n);

  const out: Card[] = [];
  for (const it of issues) {
    if (it.state !== 'OPEN' || it.taken || along.has(it.number)) continue;
    out.push({ key: `i${it.number}`, column: 'backlog', title: `#${it.number} ${it.title}`, lines: [labelsOf(it), `opened by ${it.author} ${timeAgo(Date.parse(it.createdAt))}`].filter(Boolean), open: () => a.openIssue(it), issue: it });
  }
  for (const t of tasks) if (t.status === 'queued') out.push(taskCard(t, a));
  // A worker whose PR is open shows on the PR's card, in review, rather than twice.
  const prOf = new Map<number, WorkerInfo>();
  for (const w of workers) {
    if (w.pr && openPulls.some((p) => p.number === w.pr!.number) && w.status !== 'needs_input') prOf.set(w.pr.number, w);
    else out.push(workerCard(w, a));
  }
  for (const p of openPulls) out.push(pullCard(p, prOf.get(p.number), a));
  const done = [
    ...pulls.filter((p) => p.state === 'MERGED').map((p) => ({ at: p.updatedAt, card: pullCard(p, undefined, a, 'done') })),
    ...issues.filter((i) => i.state === 'CLOSED').map((i) => ({ at: i.updatedAt, card: { key: `i${i.number}`, column: 'done' as const, title: `#${i.number} ${i.title}`, lines: ['issue closed'], open: () => a.openIssue(i) } })),
  ];
  done.sort((x, y) => y.at.localeCompare(x.at));
  out.push(...done.slice(0, DONE_SHOWN).map((d) => d.card));
  return out;
}

function labelsOf(it: { labels: { name: string }[] }) {
  return it.labels.map((l) => `🏷 ${l.name}`).join(' ');
}

function taskCard(t: QueueTask, a: KanbanActions): Card {
  const issue = t.issue ? store.issues.items.find((i) => i.number === t.issue) : undefined;
  return {
    key: `t${t.id}`,
    column: 'queued',
    title: t.issue ? `#${t.issue} ${t.title}` : t.title,
    lines: [[t.model, t.effort].filter(Boolean).join(' · ') || 'default model', `queued by ${t.addedBy} ${timeAgo(t.addedAt)}`],
    open: () => (issue ? a.openIssue(issue) : undefined),
  };
}

function workerCard(w: WorkerInfo, a: KanbanActions): Card {
  const human = w.status === 'needs_input';
  const badge = modelBadge(w.provider, w.model, w.effort, w.usage?.model);
  const cost = w.usage?.cost ? usd(w.usage.cost) : undefined;
  const doing = human ? `🙋 ${w.activity ?? 'Waiting on an answer'}` : isAsleep(w.status) ? '💤 Asleep' : (w.task?.summary ?? w.activity);
  return {
    key: `w${w.id}`,
    column: human ? 'human' : 'progress',
    title: `${w.name}: ${w.task?.name ?? w.title ?? (w.prompt ? clip(w.prompt, 70) : 'no task yet')}`,
    lines: [doing ? clip(doing, 110) : '', [STATUS_LABEL[w.status] ?? w.status, badge, cost].filter(Boolean).join(' · '), human && w.waitingSince ? `waiting ${timeAgo(w.waitingSince)}` : ''].filter(Boolean),
    stripe: w.color,
    open: () => a.openWorker(w.id),
  };
}

function pullCard(p: GhPull, w: WorkerInfo | undefined, a: KanbanActions, column: Column = 'review'): Card {
  const checks = p.checks === 'none' ? '' : `checks ${p.checks}`;
  const review = p.reviewDecision ? p.reviewDecision.toLowerCase().replace(/_/g, ' ') : '';
  return {
    key: `p${p.number}`,
    column,
    title: `PR #${p.number} ${p.title}`,
    lines: [
      w ? `🤖 ${w.name}${w.usage?.cost ? ` · ${usd(w.usage.cost)}` : ''}` : `by ${p.author}`,
      [`+${p.additions} −${p.deletions}`, checks, review, p.isDraft ? 'draft' : ''].filter(Boolean).join(' · '),
      p.closes.length ? `closes ${p.closes.map((n) => `#${n}`).join(', ')}` : '',
    ].filter(Boolean),
    stripe: column === 'review' ? CHECK_COLOR[p.checks] : undefined,
    open: () => a.openPull(p),
  };
}

/** The board, drawn into `root` (again on every change: it's small). */
export function renderBoard(root: HTMLElement, a: KanbanActions) {
  const all = cards(a);
  const spent = [...store.workers.values()].reduce((n, w) => n + (w.usage?.cost ?? 0), 0);
  const summary = h(
    'p.kb-summary',
    {},
    [`🤖 ${all.filter((c) => c.column === 'progress').length} working`, `🙋 ${all.filter((c) => c.column === 'human').length} need a human`, `🔀 ${all.filter((c) => c.column === 'review').length} in review`, spent ? `💰 ${usd(spent)} on this floor's agents` : ''].filter(Boolean).join(' · '),
  );
  root.replaceChildren(summary, h('div.kb-columns', {}, ...COLUMNS.map((col) => column(col, all.filter((c) => c.column === col.id), a))));
}

function column(col: (typeof COLUMNS)[number], list: Card[], a: KanbanActions): HTMLElement {
  const drop = col.id === 'queued' ? a.queue : col.id === 'progress' ? a.start : undefined;
  const el = h(
    'section.kb-col',
    { class: col.id, 'data-col': col.id, 'aria-label': col.title },
    h('header.kb-col-h', { title: col.hint }, h('span', {}, col.title), h('span.kb-n', {}, String(list.length))),
    h('ol.kb-cards', {}, ...(list.length ? list.map((c) => card(c, a)) : [h('li.kb-empty', {}, col.hint)])),
  );
  if (drop) {
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      el.classList.add('kb-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('kb-over'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('kb-over');
      const n = Number(e.dataTransfer?.getData(DRAG_TYPE));
      const it = store.issues.items.find((i) => i.number === n);
      if (!it) return;
      e.preventDefault();
      drop(it);
    });
  }
  return el;
}

const DRAG_TYPE = 'application/x-agent-office-issue';

function card(c: Card, a: KanbanActions): HTMLElement {
  const it = c.issue;
  const li = h(
    'li.kb-card',
    { style: c.stripe ? `--stripe:${c.stripe}` : undefined, draggable: it ? 'true' : undefined },
    h('button.kb-open', { type: 'button', onclick: c.open }, h('span.kb-title', {}, c.title), ...c.lines.map((l) => h('span.kb-line', {}, l))),
    it
      ? h(
          'div.kb-acts',
          {},
          h('button.btn.kb-act', { type: 'button', title: 'Queue it: the next free agent takes it', onclick: () => a.queue(it) }, '📋 Queue'),
          h('button.btn.kb-act.primary', { type: 'button', title: 'Start an agent on it now (pick the model)', onclick: () => a.start(it) }, '▶ Start'),
        )
      : null,
  );
  if (it) li.addEventListener('dragstart', (e) => e.dataTransfer?.setData(DRAG_TYPE, String(it.number)));
  return li;
}
