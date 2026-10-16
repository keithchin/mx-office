/**
 * A project's card in the Portal look: the one card Home's Projects page (home/portal.ts) and a client's
 * page (clients/view.ts) both draw. It has its tile (the project's letters in its floor's colour), its name
 * (to its board), what it is, its 👁 (watch: shared/project-prefs.ts), its pin and its ⋯ (open the project,
 * the live app, Edit in Studio Pro, Pause or Resume it, Delete), and at the bottom its progress, its status
 * and its spend. It asks the office for nothing new: the floors are the store's, the run state
 * home/run-state.ts's, the spend one GET /api/budget/office (at most once a minute), the progress
 * ui/progress/mini.ts's, the summary line ui/summary.ts's.
 */
import { store } from '../state';
import type { FloorInfo } from '../../shared/protocol';
import type { OfficeBudgetView } from '../../shared/budget/types';
import { floorPalette } from '../../shared/floors';
import { usd } from '../../shared/budget/money';
import { h, toast } from '../ui/dom';
import { confirmDialog } from '../ui/prompt';
import { icon } from '../ui/portal/icons';
import { openPop, type PopItem } from '../ui/portal/pop';
import { miniProgress } from '../ui/progress/mini';
import { summaryLine } from '../ui/summary';
import { startPause, startResume } from '../ui/project-run/api';
import { openDeleteDialog } from '../ui/project-delete/dialog';
import { isPinned, isWatched, setPinned, setWatched } from '../shared/project-prefs';
import { homeRunState, refreshHomeRunState } from './run-state';
import { activityScore, statusOf, tileLetters } from './portal-logic';
import './portal.css';

const STATUS_WORD = { 'needs-you': 'Needs you', running: 'Running', paused: 'Paused', adding: 'Being added' } as const;

export const floorUrl = (id: string, extra = '') => `/lite?floor=${encodeURIComponent(id)}${extra}`;

export interface ProjectCardDeps {
  /** The floor this browser was last on (marked on its card). */
  last: string | null;
  /** Into a floor: its 1D view. */
  open: (floor: string) => void;
  /** Draws the cards again (the spend came in). */
  redraw: () => void;
}

/** The cards' shared state (the spend, the summaries) and the card itself. */
export function projectCards(deps: ProjectCardDeps) {
  let budget: OfficeBudgetView | undefined;
  let asked = 0;
  /** The spend on every card: asked at most once a minute. */
  const askBudget = () => {
    if (Date.now() - asked < 60_000) return;
    asked = Date.now();
    void fetch('/api/budget/office', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<OfficeBudgetView>) : undefined))
      .then((v) => {
        if (!v) return;
        budget = v;
        deps.redraw();
      })
      .catch(() => undefined);
  };
  const spendOf = (id: string) => budget?.floors.find((b) => b.id === id);
  const paused = (id: string) => {
    const k = homeRunState(id)?.kind;
    return k === 'paused' || k === 'pausing';
  };
  const facts = {
    paused,
    pinned: isPinned,
    activity: (id: string) => {
      const f = store.floors.find((x) => x.id === id);
      return activityScore(spendOf(id)?.spark, f?.busy ?? 0, f?.waiting ?? 0);
    },
  };
  const summaries = new Map<string, string>();

  const toggle = (cls: string, on: boolean, label: [string, string], ico: [Parameters<typeof icon>[0], Parameters<typeof icon>[0]], flip: () => void) => {
    const b = h(`button.ph-icon.${cls}`, { type: 'button', 'aria-pressed': String(on), 'aria-label': on ? label[0] : label[1], title: on ? label[0] : label[1] }, icon(on ? ico[0] : ico[1]));
    b.addEventListener('click', flip);
    return b;
  };

  const confirmRun = (f: FloorInfo, action: 'pause' | 'resume') => {
    const pause = action === 'pause';
    confirmDialog(
      pause ? `Pause ${f.name}` : `Resume ${f.name}`,
      pause ? 'Its agents finish their current turn, write a handoff note and sleep; office prompts are held until it is resumed. Your messages still go through.' : 'Wakes the agents that have work waiting, a few at a time.',
      pause ? 'Pause' : 'Resume',
      () =>
        void (pause ? startPause(f.id) : startResume(f.id, { mode: 'work' })).then((r) => {
          if (!r) return;
          toast(pause ? `Pausing ${f.name}` : `Resuming ${f.name}`);
          setTimeout(refreshHomeRunState, 600);
        }),
    );
  };

  const moreItems = (f: FloorInfo): PopItem[] => {
    const items: PopItem[] = [
      { label: 'Open project', hint: 'Its Command Center, board, agents and tabs', href: floorUrl(f.id), run: () => deps.open(f.id) },
      { label: 'View live app', hint: 'The app running from main', href: floorUrl(f.id, '&tab=live') },
      { label: 'Edit in Studio Pro', hint: 'Opens on the office’s computer (admins)', href: floorUrl(f.id, '&open=studio') },
    ];
    if (store.me.admin) {
      const k = homeRunState(f.id)?.kind;
      if (k === 'paused') items.push({ label: 'Resume project', hint: 'Wake its agents with work waiting', run: () => confirmRun(f, 'resume') });
      else if (k === 'running') items.push({ label: 'Pause project', hint: 'Agents finish their turn, then sleep', run: () => confirmRun(f, 'pause') });
      if (!f.cloning) items.push({ label: 'Delete…', hint: 'Remove it from the office, or delete it for good', run: () => openDeleteDialog(f.id, f.name, 'delete') });
    }
    return items;
  };

  const card = (f: FloorInfo) => {
    const st = statusOf(f, facts);
    const pinned = isPinned(f.id);
    const watched = isWatched(f.id);
    const more = h('button.ph-icon.ph-more', { type: 'button', 'aria-label': `More for ${f.name}`, title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more'));
    more.addEventListener('click', () => openPop(more, moreItems(f), { label: `${f.name}: more`, align: 'right' }));
    const spend = spendOf(f.id);
    const name = h('a.ph-name', { href: floorUrl(f.id), title: `${f.name}: its board` }, f.name);
    name.addEventListener('click', (e) => {
      e.preventDefault();
      if (!f.cloning) deps.open(f.id);
    });
    const sub = [f.repo ?? 'Local folder', f.branch && f.branch !== 'HEAD' ? `⎇ ${f.branch}` : ''].filter(Boolean).join(' · ');
    const people = [f.busy && `${f.busy} working`, `${f.workers} agent${f.workers === 1 ? '' : 's'}`, f.people && `${f.people} here`].filter(Boolean).join(' · ');
    const summary = h('p.ph-line', {}, summaries.get(f.id) ?? people);
    if (!summaries.has(f.id) && !f.cloning) void summaryLine(f.id).then((t) => (summaries.set(f.id, t), summary.isConnected && t && (summary.textContent = t)));
    return h(
      'li.ph-card',
      { class: `${f.id === deps.last ? 'here' : ''} st-${st}`, style: `--tile:${floorPalette(f.palette).trim}`, 'data-floor': f.id },
      h(
        'div.ph-card-head',
        {},
        h('span.ph-tile', { 'aria-hidden': 'true' }, tileLetters(f.name)),
        h(
          'div.ph-acts',
          {},
          toggle('ph-watch', watched, [`Watching ${f.name}: it calls you over when someone's waiting. Click to stop`, `Not watching ${f.name}. Click to watch it`], ['eye', 'eyeOff'], () => setWatched(f.id, !watched)),
          toggle('ph-pin', pinned, [`Pinned: ${f.name} comes first. Click to unpin`, `Pin ${f.name} to the top`], ['pinned', 'pin'], () => setPinned(f.id, !pinned)),
          more,
        ),
      ),
      h('h3.ph-h', {}, name),
      h('p.ph-sub', { title: f.dir }, sub),
      summary,
      f.cloning ? h('p.ph-line', {}, f.clone?.step ?? 'Being added…') : miniProgress(f.id),
      h(
        'div.ph-foot',
        {},
        h('span.ph-status', { 'data-st': st }, STATUS_WORD[st]),
        spend ? h('span.ph-spend', { title: spend.budget ? `${usd(spend.spent)} of ${usd(spend.budget)} spent` : `${usd(spend.spent)} spent` }, spend.budget ? `${usd(spend.spent)} / ${usd(spend.budget)}` : `${usd(spend.spent)} spent`) : null,
        f.id === deps.last ? h('span.ph-here', {}, 'Last visited') : null,
      ),
    );
  };

  return { card, facts, askBudget };
}
