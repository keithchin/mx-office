// The board on the 1D view: the floor's work as a pipeline, from GitHub issue to merged pull
// request, with the agents in between. Each card is something the office already has (an issue, a
// queued task, a worker, a PR): just its title on the board, the rest in a preview on hover
// (ui/kanban-preview.ts). Dragging an issue onto Queued queues it, onto In progress hires an agent
// for it. No three.js here: the 1D view imports it.

import type { GhIssue, GhPull, QueueTask, WorkerInfo } from '../../shared/protocol';
import { isAsleep } from '../../shared/status';
import { store } from '../state';
import { modelBadge } from './provider';
import { usageLabel } from './usage';
import { clip, h, STATUS_LABEL, timeAgo } from './dom';
import { hidePreview, previewKey, previewOnHover, type Preview } from './kanban-preview';
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
  /** A thin stripe down the card's edge: the worker's color, or the PR's checks. */
  stripe?: string;
  open(): void;
  /** What its hover preview shows (made when it opens, so it's current). */
  preview(): Preview;
  /** Backlog cards: what can be dragged, and the buttons that do the same without dragging. */
  issue?: GhIssue;
}

const usd = (n: number) => `$${n.toFixed(n < 10 ? 2 : 0)}`;
const when = (iso: string) => timeAgo(Date.parse(iso));
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
  for (const it of issues) if (it.state === 'OPEN' && !it.taken && !along.has(it.number)) out.push(issueCard(it, 'backlog', a));
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
    ...issues.filter((i) => i.state === 'CLOSED').map((i) => ({ at: i.updatedAt, card: issueCard(i, 'done', a) })),
  ];
  done.sort((x, y) => y.at.localeCompare(x.at));
  out.push(...done.slice(0, DONE_SHOWN).map((d) => d.card));
  return out;
}

function issueCard(it: GhIssue, column: Column, a: KanbanActions): Card {
  const open = () => a.openIssue(it);
  return {
    key: `i${it.number}`,
    column,
    title: `#${it.number} ${it.title}`,
    open,
    issue: column === 'backlog' ? it : undefined,
    preview: () => ({
      title: `Issue #${it.number} ${it.title}`,
      status: it.state === 'OPEN' ? 'open' : 'closed',
      fields: [
        ['Labels', it.labels.map((l) => l.name).join(', ')],
        ['Opened', `by ${it.author} ${when(it.createdAt)}`],
        ['Assignees', it.assignees.join(', ')],
        ['Comments', it.comments ? String(it.comments) : undefined],
      ],
      description: it.body || undefined,
      open,
    }),
  };
}

function taskCard(t: QueueTask, a: KanbanActions): Card {
  const issue = t.issue ? store.issues.items.find((i) => i.number === t.issue) : undefined;
  const open = () => (issue ? a.openIssue(issue) : undefined);
  return {
    key: `t${t.id}`,
    column: 'queued',
    title: t.issue ? `#${t.issue} ${t.title}` : t.title,
    open,
    preview: () => ({
      title: t.title,
      status: 'queued',
      fields: [
        ['Model', [t.model, t.effort].filter(Boolean).join(' · ') || 'office default'],
        ['Issue', t.issue ? `#${t.issue}` : undefined],
        ['Queued', `by ${t.addedBy} ${timeAgo(t.addedAt)}`],
      ],
      description: issue?.body || t.prompt,
      open,
    }),
  };
}

function workerCard(w: WorkerInfo, a: KanbanActions): Card {
  const human = w.status === 'needs_input';
  const open = () => a.openWorker(w.id);
  return {
    key: `w${w.id}`,
    column: human ? 'human' : 'progress',
    title: `${w.name}: ${w.task?.name ?? w.title ?? (w.prompt ? clip(w.prompt, 70) : 'no task yet')}`,
    stripe: w.color,
    open,
    preview: () => {
      const now = human ? `🙋 ${w.activity ?? 'Waiting on an answer'}` : isAsleep(w.status) ? '💤 Asleep' : (w.task?.summary ?? w.activity);
      return {
        title: `${w.name}: ${w.task?.name ?? w.title ?? 'agent'}`,
        status: STATUS_LABEL[w.status] ?? w.status,
        fields: [
          ['Now', now],
          ['Model', modelBadge(w.provider, w.model, w.effort, w.usage?.model)],
          ['Tokens', w.usage ? usageLabel(w.usage, w.provider) : undefined],
          ['Cost', w.usage?.cost ? usd(w.usage.cost) : undefined],
          ['Branch', w.worktree?.branch],
          ['PR', w.pr ? `#${w.pr.number}` : undefined],
          ['Waiting', human && w.waitingSince ? timeAgo(w.waitingSince) : undefined],
        ],
        description: w.prompt,
        workerId: w.id,
        open,
      };
    },
  };
}

function pullCard(p: GhPull, w: WorkerInfo | undefined, a: KanbanActions, column: Column = 'review'): Card {
  const open = () => a.openPull(p);
  return {
    key: `p${p.number}`,
    column,
    title: `PR #${p.number} ${p.title}`,
    stripe: column === 'review' ? CHECK_COLOR[p.checks] : undefined,
    open,
    preview: () => ({
      title: `PR #${p.number} ${p.title}`,
      status: p.isDraft ? 'draft' : p.state.toLowerCase(),
      fields: [
        ['Agent', w ? `${w.name} · ${modelBadge(w.provider, w.model, w.effort, w.usage?.model) ?? ''}` : undefined],
        ['Tokens', w?.usage ? usageLabel(w.usage, w.provider) : undefined],
        ['Cost', w?.usage?.cost ? usd(w.usage.cost) : undefined],
        ['Author', `${p.author} · ${when(p.createdAt)}`],
        ['Changes', `+${p.additions} −${p.deletions}`],
        ['Checks', p.checks === 'none' ? undefined : p.checks],
        ['Review', p.reviewDecision ? p.reviewDecision.toLowerCase().replace(/_/g, ' ') : undefined],
        ['Branch', `${p.headRefName} → ${p.baseRefName}`],
        ['Closes', p.closes.length ? p.closes.map((n) => `#${n}`).join(', ') : undefined],
      ],
      description: p.body || undefined,
      workerId: w?.id,
      open,
    }),
  };
}

/** The board, drawn into `root` (again on every change: it's small). */
export function renderBoard(root: HTMLElement, a: KanbanActions) {
  const all = cards(a);
  // A card that's gone (taken, merged) takes its preview with it.
  const k = previewKey();
  if (k && !all.some((c) => c.key === k)) hidePreview();
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
    h('button.kb-open', { type: 'button', onclick: c.open }, h('span.kb-title', {}, c.title)),
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
  previewOnHover(li, c.key, c.preview);
  return li;
}
