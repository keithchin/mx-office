// A member's live subagents under it in the 1D views' team lists (the Overview's Team card, the Team tab's
// org chart): each at work with its name, type, task, how long, and a working animation; each just
// finished as "done · 4 min" for a minute; then "2 subagent runs today". Worked out by
// shared/roster/member-subagents.ts from the roster the page already has (GET /api/roster, fetched again
// when the office says the team changed, ui/teams/world.ts): no polling. Elapsed times are to the minute,
// so a list with something at work is drawn again at most once a minute, and only while it's on screen
// (watchShown).

import { memberSubagents, subElapsed, subRowLine, todayWords, type MemberSubs, type SubRow } from '../../../shared/roster/member-subagents';
import type { RosterView } from '../../../shared/roster/types';
import { h } from '../dom';
import './member-subs.css';

/** Every member's subagents at `now`, by role. */
export function subsByRole(v: RosterView | undefined, now: number): Map<string, MemberSubs> {
  const out = new Map<string, MemberSubs>();
  if (!v?.subagentRuns?.length) return out;
  for (const m of v.members) {
    const s = memberSubagents(v.subagentRuns, v.subagentNames, m.role, now);
    if (s.rows.length || s.today) out.set(m.role, s);
  }
  return out;
}

/** How many of a role's subagents are at work. */
export const workingIn = (subs: Map<string, MemberSubs>, role: string) => subs.get(role)?.rows.filter((r) => r.state === 'working').length ?? 0;

/** What the lists would draw, as a string: the same key, nothing to draw again. */
export function subsKey(subs: Map<string, MemberSubs>, now: number): string {
  return [...subs].map(([role, s]) => `${role}:${s.rows.map((r) => `${r.id}|${r.first}|${r.state}|${subRowLine(r, now)}`).join(',')}:${s.today}`).join(';');
}

/** In how many ms the lists change by the clock alone (a minute more at work, a finished run folding); undefined when they won't. */
export function nextTick(subs: Map<string, MemberSubs>, now: number): number | undefined {
  let at = Infinity;
  for (const s of subs.values()) {
    if (s.foldAt !== undefined) at = Math.min(at, s.foldAt);
    for (const r of s.rows) if (r.state === 'working') at = Math.min(at, now + 60_000 - ((now - r.since) % 60_000));
  }
  return at === Infinity ? undefined : Math.max(1_000, at - now + 50);
}

export interface SubsActions {
  /** A subagent's row was clicked (its detail, or its Lead's terminal). */
  open(row: SubRow): void;
  /** "N subagent runs today" was clicked (the runs' view). */
  runs?(): void;
}

function rowEl(r: SubRow, now: number, act: SubsActions): HTMLElement {
  const label = `${r.first} · ${r.role}`;
  const line = subRowLine(r, now);
  return h(
    'li.ms-row',
    { class: `ms-${r.state}`, 'data-subagent-run': r.id },
    h('span.ms-face', { 'aria-hidden': 'true' }, r.first.slice(0, 1)),
    h(
      'button.ms-who',
      { type: 'button', title: `${label}${r.task ? `: ${r.task}` : ''} (dispatched as ${r.type})`, onclick: () => act.open(r) },
      h('b', {}, label),
      h('small', {}, r.state === 'working' ? (r.task ?? 'Working') : line),
    ),
    r.state === 'working'
      ? h('span.ms-st', { title: line }, h('span.ms-when', {}, subElapsed(r, now)), h('span.ms-dots', { role: 'img', 'aria-label': 'working' }, h('i'), h('i'), h('i')))
      : h('span.ms-st', {}, r.state === 'failed' ? '✕' : '✓'),
  );
}

/** A member's subagents as a list (null when it has none to show). */
export function subsList(subs: MemberSubs | undefined, now: number, act: SubsActions): HTMLElement | null {
  if (!subs || (!subs.rows.length && !subs.today)) return null;
  const today = todayWords(subs);
  return h(
    'ul.ms-list',
    { 'aria-label': 'Subagents' },
    ...subs.rows.map((r) => rowEl(r, now, act)),
    today ? h('li.ms-today', {}, act.runs ? h('button.ms-link', { type: 'button', title: 'The subagents and their runs', onclick: () => act.runs!() }, today) : today) : null,
  );
}

/**
 * Calls `redraw` when the clock changes what the lists say, but only while `el` is on screen; and once
 * when it comes back on screen. `due(now)` says in how many ms that is next (nextTick). Returns the way to
 * ask again after each draw.
 */
export function watchShown(el: HTMLElement, redraw: () => void, due: (now: number) => number | undefined): () => void {
  let shown = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = undefined;
    const ms = shown ? due(Date.now()) : undefined;
    if (ms !== undefined) timer = setTimeout(redraw, ms);
  };
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => {
      const now = entries.some((e) => e.isIntersecting);
      if (now === shown) return;
      shown = now;
      if (shown) redraw();
      else arm();
    }).observe(el);
  }
  return arm;
}
