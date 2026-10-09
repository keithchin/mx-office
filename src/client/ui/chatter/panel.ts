// 💬 Team chatter on the 1D Command Center: the agent-to-agent exchanges on the floor as a chat thread,
// newest on top (server/chatter/). Filters: everything, only agents among themselves, only what
// involves you (the Project Manager), or one person. New messages are put on top as nodes of their own,
// never by drawing the list again, so where you've scrolled to stays put; scrolled down, a "N new" pill
// takes you back up. The panel is one element the summary keeps (ui/summary.ts `after`).

import { matchesFilter, isGroup, type ChatterFilter, type ChatterMessage, type ChatterParty, type PartyKind } from '../../../shared/chatter';
import { parseJournal } from '../../../shared/roster/journal';
import { store } from '../../state';
import { h, openModal } from '../dom';
import { markdownFile } from '../markdown';
import { openStandupWindow } from '../roster/standup';
import { loadOlder, messages, onFeed, type FeedEvent } from './feed';
import { messageNode, refreshTimes, type ChatterActions } from './message';
import './chatter.css';

export interface ChatterDeps {
  openWorker(id: string): void;
  openEscalation(id: string): void;
  openPull(n: number): void;
}

/** A journal entry in a window, read from the project's checkout (GET /api/docs/file). */
export async function openJournalEntry(path: string, heading: string, fallback?: string) {
  const body = h('div.body.tc-doc', {}, h('p.tc-dim', {}, 'Loading…'));
  openModal(h('div.modal.tc-doc-win', { role: 'dialog', 'aria-label': `${path}: ${heading}` }, h('header', {}, h('h2', {}, `📓 ${heading || path}`)), body));
  try {
    const r = await fetch(`/api/docs/file?${new URLSearchParams({ floor: store.floor ?? '', path })}`, { credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
    const e = parseJournal(((await r.json()) as { text: string }).text).find((x) => x.heading === heading);
    body.replaceChildren(e ? markdownFile(e.body) : h('p.tc-dim', {}, `That entry isn't in ${path} on the checkout yet (it may still be on the Lead's branch).${fallback ? ` It said: ${fallback}` : ''}`));
  } catch (err) {
    body.replaceChildren(h('p.tc-dim', {}, `Couldn't read ${path}: ${(err as Error).message}`));
  }
}

export function chatterActions(deps: ChatterDeps): ChatterActions {
  return {
    ...deps,
    openJournal: (path, heading) => void openJournalEntry(path, heading),
    openStandup: () => store.floor && void openStandupWindow(store.floor),
  };
}

const personKey = (p: Pick<ChatterParty, 'kind' | 'name'>) => `${p.kind}:${p.name}`;
const personLabel = (p: ChatterParty) => (p.kind === 'human' ? `${p.name} (you, the PM)` : p.role ? `${p.name} · ${p.role}` : p.name);

export interface ChatterPanel {
  el: HTMLElement;
  /** Shows `floor`'s thread; cheap to call on every redraw (the same floor does nothing). */
  show(floor: string | undefined): void;
}

export function chatterPanel(deps: ChatterDeps): ChatterPanel {
  const act = chatterActions(deps);
  let floor: string | undefined;
  let off: (() => void) | undefined;
  let filter: ChatterFilter = { with: 'all' };
  let unseen = 0;
  const people = new Map<string, ChatterParty>();

  const list = h('ol.tc-list', { 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const empty = h('p.tc-dim.tc-empty', {}, 'Loading the chatter…');
  const more = h('button.btn.small.tc-more', { type: 'button', hidden: true, onclick: () => void older() }, 'Load older');
  const pill = h('button.tc-pill', { type: 'button', hidden: true, onclick: () => toTop() }, '');
  // The pill sits in a bar of no height, so showing it moves nothing.
  const scroll = h('div.tc-scroll', {}, h('div.tc-pillbar', {}, pill), list, empty, more);
  const pick = h('select.tc-person', { 'aria-label': 'Only one person', onchange: () => setFilter(pick.value ? person(pick.value) : { with: 'all' }) }) as HTMLSelectElement;
  const tabs = (['all', 'agents', 'me'] as const).map((w) =>
    h('button.tc-f', { type: 'button', 'data-with': w, 'aria-pressed': String(w === 'all'), onclick: () => ((pick.value = ''), setFilter({ with: w })) }, w === 'all' ? 'All' : w === 'agents' ? 'Between agents' : 'With me'),
  );
  const el = h('section.tc', { 'aria-label': 'Team chatter' }, h('header.tc-h', {}, h('span.sm-sub.tc-title', {}, '💬 Team chatter'), h('div.tc-filters', { role: 'group', 'aria-label': 'Show' }, ...tabs, pick)), scroll);

  function person(key: string): ChatterFilter {
    const p = people.get(key);
    const i = key.indexOf(':');
    return { with: 'person', name: p?.name ?? key.slice(i + 1), kind: (p?.kind ?? key.slice(0, i)) as PartyKind };
  }

  function notePeople(ms: readonly ChatterMessage[]) {
    let changed = false;
    for (const m of ms) {
      for (const p of [m.from, m.to]) {
        if (isGroup(p) || p.kind === 'office') continue;
        const k = personKey(p);
        if (!people.has(k) || (!people.get(k)!.role && p.role)) {
          people.set(k, p);
          changed = true;
        }
      }
    }
    if (!changed || document.activeElement === pick) return;
    const at = pick.value;
    const sorted = [...people.entries()].sort((a, b) => (a[1].kind === 'human' ? -1 : b[1].kind === 'human' ? 1 : a[1].name.localeCompare(b[1].name)));
    pick.replaceChildren(h('option', { value: '' }, 'Anyone'), ...sorted.map(([k, p]) => h('option', { value: k }, personLabel(p))));
    pick.value = people.has(at) ? at : '';
  }

  const keep = (m: ChatterMessage) => matchesFilter(m, filter);

  function fill() {
    if (!floor) return;
    const got = messages(floor);
    notePeople(got.list);
    const shown = got.list.filter(keep);
    list.replaceChildren(...shown.map((m) => messageNode(m, act)));
    empty.hidden = shown.length > 0;
    empty.textContent = !got.loaded ? 'Loading the chatter…' : got.error ? `Couldn't load the chatter: ${got.error}` : filter.with === 'all' ? 'Nobody has said anything yet. Escalations, relays, journal entries and subagent work show up here as they happen.' : 'Nothing like that yet.';
    more.hidden = !got.more;
    setUnseen(0);
  }

  function setFilter(f: ChatterFilter) {
    filter = f;
    for (const b of tabs) b.setAttribute('aria-pressed', String(f.with === b.dataset.with));
    scroll.scrollTop = 0;
    fill();
  }

  function setUnseen(n: number) {
    unseen = n;
    pill.hidden = n === 0;
    pill.textContent = `↑ ${n} new`;
  }

  function toTop() {
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroll.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    setUnseen(0);
  }

  /** A new message on top, keeping what you're looking at where it is. */
  function prepend(m: ChatterMessage) {
    notePeople([m]);
    if (!keep(m)) return;
    const away = scroll.scrollTop > 8;
    const before = scroll.scrollHeight;
    const node = messageNode(m, act);
    if (!away) node.classList.add('tc-fresh');
    list.prepend(node);
    empty.hidden = true;
    if (away) {
      scroll.scrollTop += scroll.scrollHeight - before;
      setUnseen(unseen + 1);
    }
  }

  async function older() {
    if (!floor) return;
    more.disabled = true;
    const add = await loadOlder(floor);
    more.disabled = false;
    if (!floor) return;
    notePeople(add);
    list.append(...add.filter(keep).map((m) => messageNode(m, act)));
    more.hidden = !messages(floor).more;
    if (add.length) empty.hidden = list.childElementCount > 0;
  }

  const onEvent = (ev: FeedEvent) => {
    if (ev.t === 'new') prepend(ev.m);
    else if (ev.t === 'reset') fill();
  };
  scroll.addEventListener('scroll', () => {
    if (scroll.scrollTop <= 8 && unseen) setUnseen(0);
  });
  setInterval(() => el.isConnected && refreshTimes(list), 30_000);

  return {
    el,
    show(next) {
      if (next === floor) return;
      off?.();
      floor = next;
      people.clear();
      pick.replaceChildren(h('option', { value: '' }, 'Anyone'));
      filter = { with: 'all' };
      for (const b of tabs) b.setAttribute('aria-pressed', String(b.dataset.with === 'all'));
      off = floor ? onFeed(floor, onEvent) : undefined;
      fill();
    },
  };
}
