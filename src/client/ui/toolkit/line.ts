import './toolkit.css';
/**
 * A project's Toolkit line: which toolkit commit it runs on and what the fork has that's newer ("toolkit
 * 7b4b4cf (2026-10-08) · 3 newer commits available (fix/new/gate-rule changes)"), in the setup panel, and
 * as a small chip at the end of the progress bar. One answer per floor is kept here for a minute and
 * shared by both; asking is one GET the office answers from its cache (it fetches the fork on its own
 * clock, never because a page opened). Either opens the Toolkit window (modal.ts).
 */
import { short, toolkitLine, type ToolkitStatus } from '../../../shared/toolkit';
import { h } from '../dom';
import { getToolkit } from './api';
import { openToolkit } from './modal';

const FRESH_MS = 60_000;
let cache: { floor: string; at: number; s?: ToolkitStatus; going?: Promise<ToolkitStatus | undefined> } | undefined;
const waiting = new Set<() => void>();

/** The floor's status: the one kept when it's fresh (unless `force`), else asked for once. */
export function toolkitStatus(floor: string, force = false): Promise<ToolkitStatus | undefined> {
  if (cache?.floor === floor) {
    if (cache.going) return cache.going;
    if (!force && cache.s && Date.now() - cache.at < FRESH_MS) return Promise.resolve(cache.s);
  }
  const entry: NonNullable<typeof cache> = { floor, at: Date.now(), s: cache?.floor === floor ? cache.s : undefined };
  entry.going = getToolkit(floor).then((s) => {
    entry.going = undefined;
    if (s) entry.s = s;
    entry.at = Date.now();
    for (const fn of [...waiting]) fn();
    return entry.s;
  });
  cache = entry;
  return entry.going;
}

/** What's kept for `floor` now, without asking. */
export const cachedToolkit = (floor: string) => (cache?.floor === floor ? cache.s : undefined);

/** Draws `draw(status)` into `el` now (from what's kept) and again once a fresh answer comes, while `el` is on the page. */
function live(el: HTMLElement, floor: string, draw: (s: ToolkitStatus | undefined) => void) {
  draw(cachedToolkit(floor));
  // Made and put on the page in the same tick, so an answer finding it gone means it was replaced.
  const again = () => (el.isConnected ? draw(cachedToolkit(floor)) : void waiting.delete(again));
  waiting.add(again);
  void toolkitStatus(floor);
}

const tone = (s: ToolkitStatus) => (s.problems.length || s.state === 'unknown' ? 'warn' : s.state === 'detected' ? 'warn' : s.newer.count ? 'new' : 'ok');

/** The setup panel's Toolkit line. */
export function toolkitRow(floor: string, onMoved?: () => void): HTMLElement {
  const el = h('div.tk-row', { role: 'group', 'aria-label': 'Toolkit version' });
  live(el, floor, (s) => {
    if (!s) return el.replaceChildren(h('span.tk-dim', {}, '🧰 toolkit …'));
    const open = h('button.btn.tk-open', { type: 'button', title: 'The project’s toolkit version, the newer commits and Update toolkit', onclick: () => void openToolkit(floor, onMoved) }, s.admin && (s.newer.count || s.state !== 'pinned') ? (s.state === 'pinned' ? '⬆ Update toolkit…' : '📌 Pin toolkit…') : 'Details');
    el.className = `tk-row ${tone(s)}`;
    const kids: (HTMLElement | null)[] = [
      h('span.tk-icon', { 'aria-hidden': 'true' }, '🧰'),
      h('span.tk-text', {}, toolkitLine(s)),
      s.state === 'pinned' ? h('span.tk-tag', { title: `Runs from ${s.runsFrom}` }, '📌 pinned') : null,
      s.job ? h('span.tk-tag', {}, s.job.kind === 'preview' ? '⏳ previewing…' : '⏳ updating…') : null,
      s.problems.length ? h('span.tk-tag.bad', { title: s.problems.join('\n') }, `⚠️ ${s.problems.length}`) : null,
      h('span.tk-grow'),
      open,
    ];
    el.replaceChildren(...kids.filter((k): k is HTMLElement => !!k));
  });
  return el;
}

/** The progress bar's chip: the commit and how many newer, a click to the Toolkit window. */
export function toolkitChip(floor: string, onMoved?: () => void): HTMLElement {
  const el = h('button.pg-tk', { type: 'button', onclick: () => void openToolkit(floor, onMoved) });
  live(el, floor, (s) => {
    if (!s?.git) return void (el.hidden = true);
    el.hidden = false;
    el.className = `pg-tk ${tone(s)}`;
    const n = s.newer.count;
    el.textContent = `🧰 ${s.commit ? `${s.state === 'detected' ? '≈' : ''}${short(s.commit.sha)}` : '?'}${n ? ` · ${n} new` : ''}`;
    el.title = `${toolkitLine(s)}: open the Toolkit window`;
    el.setAttribute('aria-label', toolkitLine(s));
  });
  return el;
}
