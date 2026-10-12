import './groups.css';
/**
 * The setup's five groups (shared/setup-groups.ts), drawn once and updated in place as the job's state
 * comes in, so nothing jumps or loses focus while it ticks: each group a button that opens its real steps
 * (aria-expanded), its status as a ring (waiting), a spinner (running), a tick (done) or a cross (failed),
 * the steps each with its line (a skipped step's reason, a failed one's error), and a slot under the steps
 * for the failure box. The running (or failed) group opens by itself unless you opened or closed it.
 * Each group's change of status is said once in a polite live region.
 */
import { h } from '../dom';
import { openGroup, SETUP_GROUP_IDS, type GroupStatus, type SetupGroupId, type SetupGroupView } from '../../../shared/setup-groups';
import type { StepStatus } from '../../../shared/wizard';

const TICK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const SKIP = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 10a5 5 0 0 1 9-3M12 3.5V7H8.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV = '<svg class="sg-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ICON_OF: Partial<Record<GroupStatus | StepStatus, string>> = { done: TICK, failed: CROSS, skipped: SKIP };
const WORD: Record<StepStatus, string> = { pending: 'waiting', running: 'running', done: 'done', skipped: 'skipped', failed: 'failed' };

interface GroupEls {
  root: HTMLElement;
  head: HTMLButtonElement;
  state: HTMLElement;
  meta: HTMLElement;
  sr: HTMLElement;
  body: HTMLElement;
  steps: Map<string, { li: HTMLElement; dot: HTMLElement; note: HTMLElement; sr: HTMLElement }>;
  slot: HTMLElement;
  status?: GroupStatus;
  /** Opened or closed by hand: the page leaves it so. */
  manual?: boolean;
}

export interface GroupsView {
  el: HTMLElement;
  /** The live region the groups' changes are said in (put it once on the page). */
  live: HTMLElement;
  update(groups: SetupGroupView[]): void;
  /** The slot under a group's steps, for the failure box. */
  slot(id: SetupGroupId): HTMLElement;
  /** Opens (or closes) every group, as "View setup details" does. */
  openAll(open: boolean): void;
}

export function groupsView(first: SetupGroupView[]): GroupsView {
  const live = h('div.sg-live', { 'aria-live': 'polite', role: 'status' });
  const els = new Map<SetupGroupId, GroupEls>();
  const list = h('ol.sg-groups', { 'aria-label': 'Setup steps' });

  for (const g of first) {
    const state = h('span.sg-state', { 'aria-hidden': 'true' });
    const meta = h('small.sg-meta', { 'aria-hidden': 'true' });
    const sr = h('span.sg-sr', {});
    const bodyId = `sg-body-${g.id}`;
    const head = h(
      'button.sg-head',
      { type: 'button', 'aria-expanded': 'false', 'aria-controls': bodyId },
      state,
      h('span.sg-text', {}, h('b', {}, g.name), h('small', {}, g.say)),
      meta,
      sr,
    ) as HTMLButtonElement;
    head.insertAdjacentHTML('beforeend', CHEV);
    const steps = new Map<string, { li: HTMLElement; dot: HTMLElement; note: HTMLElement; sr: HTMLElement }>();
    const ul = h('ul.sg-steps', {});
    for (const s of g.steps) {
      const dot = h('span.sg-dot', { 'aria-hidden': 'true' });
      const note = h('small.sg-note', {});
      const ssr = h('span.sg-sr', {});
      const li = h('li.sg-step', { 'data-s': s.status }, dot, h('span.sg-step-text', {}, h('span', {}, s.label), ssr, note));
      ul.append(li);
      steps.set(s.id, { li, dot, note, sr: ssr });
    }
    const slot = h('div.sg-slot', {});
    const body = h('div.sg-body.shut', { id: bodyId }, h('div', {}, ul, slot));
    const root = h('li.sg-group', { 'data-s': g.status, 'data-id': g.id }, head, body);
    const e: GroupEls = { root, head, state, meta, sr, body, steps, slot };
    head.addEventListener('click', () => {
      e.manual = true;
      setOpen(e, head.getAttribute('aria-expanded') !== 'true');
    });
    els.set(g.id, e);
    list.append(root);
  }

  const setOpen = (e: GroupEls, open: boolean) => {
    e.head.setAttribute('aria-expanded', String(open));
    e.body.classList.toggle('shut', !open);
  };

  let said = false;
  const update = (groups: SetupGroupView[]) => {
    const auto = openGroup(groups);
    const news: string[] = [];
    for (const g of groups) {
      const e = els.get(g.id)!;
      if (e.status !== g.status) {
        // The first draw isn't news; every change after it is said once.
        if (said && g.status !== 'pending') news.push(g.announce);
        e.status = g.status;
        e.root.dataset.s = g.status;
        e.state.innerHTML = ICON_OF[g.status] ?? '';
        // A group that finished closes by itself, unless it was opened by hand.
        if (!e.manual && g.status === 'done') setOpen(e, false);
      }
      e.meta.textContent = g.status === 'done' && g.skipped ? `${g.skipped} skipped` : '';
      e.sr.textContent = `, ${g.announce.slice(g.name.length + 2)}`;
      for (const s of g.steps) {
        const r = e.steps.get(s.id)!;
        if (r.li.dataset.s !== s.status) {
          r.li.dataset.s = s.status;
          r.dot.innerHTML = ICON_OF[s.status] ?? '';
        }
        r.sr.textContent = ` (${WORD[s.status]})`;
        // A failed step's error is in the failure box under the steps, not said twice.
        const note = s.status === 'failed' ? '' : (s.note ?? '');
        if (r.note.textContent !== note) r.note.textContent = note;
      }
    }
    if (auto) {
      const e = els.get(auto)!;
      if (!e.manual) setOpen(e, true);
    }
    if (news.length) live.textContent = news.join('. ');
    said = true;
  };
  update(first);

  return {
    el: list,
    live,
    update,
    slot: (id) => els.get(id)!.slot,
    openAll(open) {
      for (const id of SETUP_GROUP_IDS) {
        const e = els.get(id)!;
        e.manual = true;
        setOpen(e, open);
      }
    },
  };
}
