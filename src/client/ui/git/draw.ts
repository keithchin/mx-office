// The Git tab's metro map, drawn from layout.ts: an SVG of the lines and stations with the robots
// standing at the branch tips, and a label beside each line's end (HTML over the SVG, so the chips and
// pills are the 1D view's own). Colors are the theme's tokens; a worker's line is its own color.

import { STALE_BEHIND, type GitBranch, type GitCommit, type GitGraph } from '../../../shared/gitgraph';
import { clip, h, STATUS_LABEL } from '../dom';
import { age, layout, type Lane, type Layout } from './layout';
import { BOT_H, BOT_W, robotUrl } from './robot';

const NS = 'http://www.w3.org/2000/svg';
/** The lines without a worker take these, in turn. */
const PALETTE = 6;

type SvgAttrs = Record<string, string | number | undefined>;

/** An SVG element, as h() makes HTML ones. */
function s(tag: string, attrs: SvgAttrs = {}, ...children: (SVGElement | string)[]): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

export interface MapActions {
  open(b: GitBranch): void;
  /** Whether clicking does anything (it has a worker or a pull request to open). */
  opens(b: GitBranch): boolean;
}

/** The tooltip card, shown over the map. */
export interface Tip {
  branch(b: GitBranch, at: MouseEvent | HTMLElement): void;
  commit(c: GitCommit, at: MouseEvent): void;
  hide(): void;
}

/** "↑3 ↓12": how far a branch is ahead of and behind the default branch. */
export const aheadBehind = (b: GitBranch) => `↑${b.ahead} ↓${b.behind}`;

/** A pull request's pill class: its checks, or draft, merged, closed. */
export function prTone(pr: NonNullable<GitBranch['pr']>): string {
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  if (pr.isDraft) return 'draft';
  return pr.checks;
}

export function drawMap(g: GitGraph, a: MapActions, tip: Tip): HTMLElement {
  const L = layout(g);
  const svg = s('svg', { class: 'gp-svg', width: L.width, height: L.height, viewBox: `0 0 ${L.width} ${L.height}`, role: 'img', 'aria-label': `Branch map of ${g.defaultBranch}` });
  svg.append(trunk(L, g, tip));
  const labels: HTMLElement[] = [];
  // Deepest rows first, so a line dropping past a shallower one goes under it.
  [...L.lanes].sort((x, y) => y.row - x.row).forEach((lane) => svg.append(drawLane(lane, L.lanes.indexOf(lane), L.trunkY, a, tip)));
  L.lanes.forEach((lane, i) => labels.push(label(lane, i, a, tip)));
  const sign = h('div.gp-sign', { style: `left:${L.headX + 54}px;top:${L.trunkY - 15}px` }, h('span', {}, '🚉'), g.defaultBranch);
  return h('div.gp-canvas', { style: `width:${L.width}px;height:${L.height}px` }, svg, sign, ...labels);
}

function trunk(L: Layout, g: GitGraph, tip: Tip): SVGElement {
  const x0 = (L.stations[0]?.x ?? L.headX) - 40;
  const x1 = L.headX + 70;
  const group = s('g', { class: 'gp-trunk' });
  // A railway: the bed, the rail, and the sleepers across it.
  group.append(s('line', { class: 'gp-bed', x1: x0, y1: L.trunkY, x2: x1, y2: L.trunkY }));
  group.append(s('line', { class: 'gp-rail', x1: x0, y1: L.trunkY, x2: x1, y2: L.trunkY }));
  group.append(s('line', { class: 'gp-sleepers', x1: x0, y1: L.trunkY, x2: x1, y2: L.trunkY }));
  // Older history goes on off the left edge.
  if (g.history.length >= 30) group.append(s('text', { class: 'gp-older', x: x0 - 6, y: L.trunkY + 5, 'text-anchor': 'end' }, '⋯'));
  for (const st of L.stations) {
    const dot = s('g', { class: `gp-st${st.merge ? ' merge' : ''}`, transform: `translate(${st.x} ${L.trunkY})` });
    dot.append(s('circle', { r: st.merge ? 10 : 7 }));
    if (st.merge) dot.append(s('circle', { class: 'gp-st-in', r: 4 }));
    dot.addEventListener('mouseenter', (e) => tip.commit(st.commit, e));
    dot.addEventListener('mousemove', (e) => tip.commit(st.commit, e));
    dot.addEventListener('mouseleave', () => tip.hide());
    group.append(dot);
  }
  // The train, at the default branch's newest commit.
  group.append(s('text', { class: 'gp-train', x: L.headX + 16, y: L.trunkY - 8 }, '🚂'));
  return group;
}

function drawLane(lane: Lane, i: number, trunkY: number, a: MapActions, tip: Tip): SVGElement {
  const b = lane.branch;
  const cls = ['gp-lane', `c${i % PALETTE}`, `t${i % 2}`];
  if (b.merged) cls.push('merged');
  if (lane.squashed) cls.push('squashed');
  if (!b.merged && b.behind > STALE_BEHIND) cls.push('stale');
  if (a.opens(b)) cls.push('opens');
  const group = s('g', { class: cls.join(' '), style: b.worker ? `--lane:${b.worker.color}` : undefined, 'data-branch': b.name });
  group.append(s('path', { class: 'gp-line-bed', d: lane.path }));
  group.append(s('path', { class: 'gp-line', d: lane.path }));
  if (lane.older) group.append(s('circle', { class: 'gp-fork older', cx: lane.forkX, cy: trunkY, r: 4 }));
  lane.dots.forEach((x, k) => group.append(s('circle', { class: `gp-dot${k === lane.dots.length - 1 && !lane.joinX ? ' tip' : ''}`, cx: x, cy: lane.y, r: k === lane.dots.length - 1 && !lane.joinX ? 7 : 5 })));
  if (lane.more > 0) group.append(s('text', { class: 'gp-more', x: (lane.dots[0] ?? lane.tipX) + 2, y: lane.y + 22, 'text-anchor': 'middle' }, `+${lane.more}`));
  if (lane.joinX !== undefined) group.append(s('text', { class: 'gp-badge', x: lane.joinX + 2, y: trunkY - 24 }, '✅'));
  else if (lane.squashed) group.append(s('text', { class: 'gp-badge', x: lane.tipX + 14, y: lane.y + 5 }, '✅'));
  if (b.worker) group.append(robot(b, lane));
  // A wide stroke nobody sees, so the line is easy to point at.
  group.append(s('path', { class: 'gp-hit', d: lane.path }));
  group.addEventListener('mouseenter', (e) => tip.branch(b, e));
  group.addEventListener('mousemove', (e) => tip.branch(b, e));
  group.addEventListener('mouseleave', () => tip.hide());
  group.addEventListener('click', () => a.open(b));
  return group;
}

/** The worker's robot at the tip, doing what the worker is: bobbing, typing, asking or cheering. */
function robot(b: GitBranch, at: Pick<Lane, 'tipX' | 'y'>): SVGElement {
  const st = b.worker!.status;
  const w = BOT_W * 2;
  const ht = BOT_H * 2;
  const bot = s('g', { class: `gp-bot st-${st}`, transform: `translate(${at.tipX - w / 2} ${at.y - ht - 6})` });
  const bob = s('g', { class: 'gp-bob' });
  bob.append(s('image', { href: robotUrl(b.worker!.color), width: w, height: ht, preserveAspectRatio: 'none' }));
  bot.append(bob);
  const fx = st === 'working' ? '✨' : st === 'needs_input' ? '🙋' : st === 'done' ? '🎉' : st === 'offline' || st === 'exited' ? '💤' : '';
  if (fx) bot.append(s('text', { class: 'gp-fx', x: w - 2, y: 4 }, fx));
  return bot;
}

function label(lane: Lane, i: number, a: MapActions, tip: Tip): HTMLElement {
  const b = lane.branch;
  const x = (lane.joinX ?? lane.tipX) + (lane.squashed ? 34 : 18);
  const y = lane.y - 14;
  const stale = !b.merged && b.behind > STALE_BEHIND;
  const chips = h(
    'span.gp-chips',
    {},
    b.merged ? h('span.gp-chip.good', {}, 'merged') : h('span.gp-chip', { title: `${b.ahead} ahead of, ${b.behind} behind the default branch` }, aheadBehind(b)),
    stale ? h('span.gp-chip.stale', { title: `More than ${STALE_BEHIND} commits behind` }, '🕸️ stale') : null,
    b.pr ? h(`span.gp-pr.${prTone(b.pr)}`, { title: `PR #${b.pr.number}: ${b.pr.title}` }, `#${b.pr.number}`) : null,
    b.worker ? h('span.gp-who', {}, b.worker.name) : null,
    b.where === 'local' ? h('span.gp-chip.dim', { title: 'Only on this machine: not pushed' }, 'local') : null,
  );
  const el = h(
    'button.gp-label',
    {
      type: 'button',
      class: `c${i % PALETTE}${a.opens(b) ? ' opens' : ''}`,
      style: `left:${x}px;top:${y}px;${b.worker ? `--lane:${b.worker.color}` : ''}`,
      'aria-label': `${b.name}: ${aheadBehind(b)}${b.pr ? `, PR #${b.pr.number}` : ''}${b.worker ? `, ${b.worker.name} ${STATUS_LABEL[b.worker.status] ?? b.worker.status}` : ''}`,
      onclick: () => a.open(b),
      onmouseenter: (e: Event) => tip.branch(b, e as MouseEvent),
      onmouseleave: () => tip.hide(),
      onfocus: () => tip.branch(b, el),
      onblur: () => tip.hide(),
    },
    h('span.gp-name', {}, clip(b.name, 34)),
    chips,
  );
  return el;
}

/** The card a hovered line shows: its last commit, how far off it is, its pull request and worker. */
export function tipCard(b: GitBranch, now = Date.now()): HTMLElement {
  const pr = b.pr;
  return h(
    'div.gp-card',
    {},
    h('b.gp-card-name', {}, b.name),
    h('p.gp-card-sub', {}, `“${clip(b.subject, 90)}”`),
    h('p.gp-card-meta', {}, `${b.author} · ${age(b.date, now)} ago · ${b.where === 'both' ? 'here & origin' : b.where === 'local' ? 'local only' : 'origin only'}${b.diverged ? ' (diverged)' : ''}`),
    h('p.gp-card-row', {}, b.merged ? '✅ merged' : `${aheadBehind(b)} vs default${b.behind > STALE_BEHIND ? ' · 🕸️ stale' : ''}`),
    pr ? h('p.gp-card-row', {}, h(`span.gp-pr.${prTone(pr)}`, {}, `#${pr.number}`), ` ${clip(pr.title, 70)}`) : null,
    b.worker ? h('p.gp-card-row', {}, `🤖 ${b.worker.name} · ${STATUS_LABEL[b.worker.status] ?? b.worker.status}`) : null,
    b.worker ? h('p.gp-card-hint', {}, 'Click to open its terminal') : pr ? h('p.gp-card-hint', {}, 'Click to open the pull request') : null,
  );
}

export function commitCard(c: GitCommit, now = Date.now()): HTMLElement {
  return h('div.gp-card', {}, h('b.gp-card-name', {}, `${c.parents.length > 1 ? '🔀 ' : ''}${c.sha.slice(0, 7)}`), h('p.gp-card-sub', {}, clip(c.subject, 90)), h('p.gp-card-meta', {}, `${c.author} · ${age(c.date, now)} ago`));
}
