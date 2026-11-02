// Project Management › Roadmap (/lite?tab=roadmap): Build delivered in phases (shared/phases/, server/phases/).
// The summary line (delivery, phases done and active, spent against the budget and its auto-pause), Ask the team
// for a change and Edit phases; while the phases wait for the Build Plan gate, the gate's editor (./gate.ts);
// then the timeline (./timeline.ts) and the selected phase with publishing and the change history beside it
// (./detail.ts). A project delivered in one go says so, and offers the office's first cut of the build plan to
// the Project Manager. Asked when shown and again when the office says the project changed, never on a timer.

import { store } from '../../state';
import type { TabHooks } from '../../tabs/registry';
import { h, toast } from '../dom';
import { onRoster } from '../teams/world';
import { usd, type PhasesView } from '../../../shared/phases/view';
import type { PhaseProposal } from '../../../shared/phases/types';
import { actOnPhases, getPhases, isFull, pick } from './api';
import { timeline } from './timeline';
import { changesCard, phaseDetail, publishCard, type DetailActs } from './detail';
import { gateEditor } from './gate';
import { openEditPhases, openTextDialog } from './edit';
import './roadmap.css';

export function roadmapPage(root: HTMLElement): TabHooks {
  root.classList.add('rm-page');
  let shown = false;
  let view: PhasesView | undefined;
  let selected: string | undefined;
  let drawn = '';
  let busy = false;
  let again = false;

  async function load() {
    const floor = store.floor;
    if (!floor || !shown) return;
    if (busy) return void (again = true);
    busy = true;
    const v = await getPhases(floor);
    busy = false;
    if (isFull(v) && v.floor === store.floor) {
      view = v;
      draw();
    } else if (!v && !view) root.replaceChildren(h('p.rm-muted.rm-pad', {}, "Couldn't load the Roadmap. It loads again when you come back to it."));
    if (again) {
      again = false;
      void load();
    }
  }
  const act = async (body: Record<string, unknown>, done?: string) => {
    const r = await actOnPhases({ floor: store.floor, ...body });
    if (r.ok) {
      if (done) toast(done);
      await load();
    }
    return r;
  };
  const acts: DetailActs = {
    go: (phase) => void act({ action: 'go', phase }, 'Go: the next phase starts'),
    stop: (phase) => openTextDialog({ title: 'Stop at the checkpoint', lead: 'The phase stops, and so does early work on the next phase: nothing new starts. What was made is kept.', label: 'Reason', placeholder: 'Why Build stops here', action: 'Stop', required: true, submit: async (reason) => ((r) => (r.ok ? undefined : r.error))(await act({ action: 'stop', phase, reason }, 'Stopped')) }),
    accept: (p) => void act({ action: 'accept', proposal: p.id }, `Accepted ${p.id}`),
    decline: (p) => declineDialog(p),
    editFirst: (p) => view && openEditPhases(view, { title: `Edit ${p.id} first`, lead: `${p.by.name}'s proposal, with your edits on top. Saved as the accepted proposal, with their reason and your edits recorded.`, save: 'Accept with my edits', ops: p.ops ?? [], reason: p.reason, submit: async (ops) => ((r) => (r.ok ? undefined : r.error))(await actQuiet({ action: 'accept', proposal: p.id, ops }, `Accepted ${p.id} with your edits`)) }),
    editPhases: () => view && openEditPhases(view, { title: 'Edit phases', lead: 'Your edit is saved as a change on the Roadmap with your reason. Phases that are done are locked.', save: 'Save as change', submit: async (ops, reason) => ((r) => (r.ok ? undefined : r.error))(await actQuiet({ action: 'edit', ops, reason }, 'Saved as a change')) }),
  };
  const actQuiet = async (body: Record<string, unknown>, done: string) => {
    const r = await actOnPhases({ floor: store.floor, ...body }, true);
    if (r.ok) {
      toast(done);
      await load();
    }
    return r;
  };
  const declineDialog = (p: PhaseProposal | undefined) =>
    p &&
    openTextDialog({
      title: p.kind === 'plan' ? 'Ask for changes' : `Decline ${p.id}`,
      lead: p.kind === 'plan' ? 'The team hears what you want changed and proposes the phases again.' : 'The phases stay as they are; the team hears why.',
      label: p.kind === 'plan' ? 'What should change' : 'Why (optional)',
      placeholder: p.kind === 'plan' ? 'e.g. Put admin before social; the launch event needs moderation' : 'e.g. Keep notifications in Events for the launch',
      action: p.kind === 'plan' ? 'Send to the team' : 'Decline',
      required: p.kind === 'plan',
      submit: async (note) => ((r) => (r.ok ? undefined : r.error))(await actQuiet({ action: 'decline', proposal: p.id, note }, p.kind === 'plan' ? 'Sent to the team' : `Declined ${p.id}`)),
    });
  const ask = () =>
    openTextDialog({
      title: 'Ask the team for a change',
      lead: 'Sent to the team lead after their turn. Their proposal comes back here to accept, decline or edit.',
      label: 'What would you like changed',
      placeholder: 'e.g. Can admin moderation come before Social?',
      action: 'Send',
      required: true,
      submit: async (text) => ((r) => (r.ok ? undefined : r.error))(await actQuiet({ action: 'ask', text }, 'Sent to the team lead')),
    });

  function summary(v: PhasesView): HTMLElement {
    const done = v.phases.filter((l) => l.status === 'done').length;
    const active = v.phases.filter((l) => l.status === 'active' || l.status === 'checkpoint').length;
    return h(
      'div.rm-sum',
      {},
      h('span', {}, 'Delivery ', h('b', {}, v.plan.state === 'none' ? 'In one go' : 'In phases')),
      v.phases.length ? h('span', {}, h('b', {}, `${v.phases.length} phases`), ` · ${done} done, ${active} active`) : null,
      h('span', {}, 'Spent ', h('b', {}, usd(v.spent)), v.budget ? ` of ${usd(v.budget.total)}` : '', v.budget ? h('span.rm-muted', {}, v.budget.autoPause ? ` (auto-pause at ${usd(v.budget.total)})` : ' (no auto-pause)') : null),
    );
  }

  function draw() {
    const v = view;
    if (!v) return;
    const key = JSON.stringify({ ...v, now: Math.floor(v.now / 3_600_000) }) + `|${selected}`;
    if (key === drawn) return;
    drawn = key;
    const buttons = v.admin && v.plan.state !== 'none' ? h('div.rm-top-acts', {}, h('button.btn', { type: 'button', onclick: ask }, '💬 Ask the team for a change'), v.plan.state === 'approved' ? h('button.btn.primary', { type: 'button', onclick: acts.editPhases }, '✎ Edit phases') : null) : null;
    const top = h('div.rm-top', {}, h('p.rm-lead', {}, 'Build is delivered in phases. Each phase ends when its journeys pass on a running app.'), buttons);
    if (v.plan.state === 'none') {
      const setup =
        v.admin && v.draft?.length
          ? h('button.btn', { type: 'button', onclick: () => void act({ action: 'setup', phases: v.draft }, 'Phases set up from the build plan: approve or edit them below') }, `Set up ${v.draft.length} phases from the build plan`)
          : null;
      root.replaceChildren(
        top,
        summary(v),
        h(
          'section.rm-card.rm-empty',
          {},
          h('h2', {}, 'Delivered in one go'),
          h('p', {}, 'This project has no phases: Build runs as one piece, and the Overview shows it as Stage 5 · Build. For a larger app the team can propose phases at the Build Plan gate (Stage 4) with propose_phases: business outcomes with a foundation first, each proven by its journeys and published to the sandbox at its end.'),
          v.note ? h('p.rm-muted', {}, v.note) : null,
          setup ? h('p', {}, setup, h('span.rm-muted', {}, ' The office’s first cut from the build plan’s phases; you approve or edit it before Build starts.')) : null,
        ),
      );
      return;
    }
    if (!selected || !v.phases.some((l) => l.id === selected)) selected = (v.phases.find((l) => l.status === 'active' || l.status === 'checkpoint') ?? v.phases[0])?.id;
    const sel = v.phases.find((l) => l.id === selected);
    const parts: (HTMLElement | null)[] = [top, summary(v)];
    if (v.plan.state === 'proposed') parts.push(gateEditor(v, { approve: async (ops) => void (await act({ action: 'approve', ops }, 'Phases approved: Build starts with phase 1')), askChanges: (p) => declineDialog(p) }));
    parts.push(timeline(v, selected, (id) => ((selected = id), draw())));
    if (sel) parts.push(h('div.rm-detail-grid', {}, phaseDetail(v, sel, acts), h('div.rm-side', {}, publishCard(sel), changesCard(v, acts))));
    root.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  }

  store.on('floor', () => {
    view = undefined;
    selected = undefined;
    drawn = '';
    root.replaceChildren();
    void load();
  });
  onRoster(() => void load());
  return {
    show: () => {
      shown = true;
      if (pick.phase) {
        selected = pick.phase;
        pick.phase = undefined;
        drawn = '';
        draw();
      }
      void load();
    },
    hide: () => (shown = false),
    refresh: () => void load(),
  };
}
