// The Portal Overview (the Command Center in a Portal theme, overview.css), as the approved mockup lays it
// out (docs/mockups/overview-coordinator-mockup.html): under the page header,
//
//   Progress           the toolkit's stages with their ✋ gates and the toolkit chip (the page's own
//                      progress bar, ui/progress/, moved into the card while Portal is on)
//   Needs you          everything actionable, the escalations as full cards (./needs-card.ts)   │ Team
//   Project brief      docs/project-brief.md's goal, domains and open questions (./brief-card.ts)│ Budget
//   Recent activity    the summary's own list (ui/summary.ts), and What's happening under it   │ Quick links
//                                                                                              │ Details
//
// The team lead (the project console that used to be in the middle) is the panel docked on the right of
// every tab (ui/lead-panel/). Everything the cards show is already on the page (the store, the roster, the
// budget feed, the live app's state, Studio's answer, the Needs-you strip's list); the toolkit pin is asked
// once per project, the last commit at most every two minutes. The cards redraw when what they show
// changes, never on a timer.

import { store } from '../../state';
import { h } from '../dom';
import { currentRoster, onRoster } from '../teams/world';
import { getToolkit } from '../toolkit/api';
import type { ToolkitStatus } from '../../../shared/toolkit';
import type { BudgetView } from '../../../shared/budget/types';
import { managerOf, TEAM_OWNER } from '../../../shared/roster/coverage';
import { batched } from '../batch';
import { shapeText } from '../roster/coverage';
import { initials } from './topbar';
import { icon } from './icons';
import { agentFace } from './face';
import { portalSlot } from './slot';
import { budgetFacts, budgetText, commitWhen, detailRows, teamRows, type DetailFacts } from './overview-logic';
import { needsCard } from './needs-card';
import { briefCard } from './brief-card';
import type { GitGraph } from '../../../shared/gitgraph';
import './overview.css';

export interface OverviewDeps {
  /** Opens a tab. */
  show(tab: string): void;
  openWorker(id: string): void;
  /** The live app's state and address, when the office has said. */
  live(): { status: string; url?: string } | undefined;
  /** The project's budget, from the budget feed. */
  budget(): BudgetView | undefined;
  /** The Mendix version Studio Pro would open it in. */
  mendix(): string | undefined;
  /** The setup panel's view: whether it's a toolkit project, and the delivery branch's head. */
  setup(): { toolkit?: boolean; head?: { branch: string; sha: string } } | undefined;
  /** View App and Open in Studio Pro, as the navigation does them; Studio's state (offered, or why not). */
  viewApp(): void;
  studio: { shown(): boolean; blocked(): string | undefined; open(): void };
}

export interface PortalOverview {
  /** The main column's cards (Needs you, Project brief), for ui/summary.ts to keep before the recent activity (its `middle`). */
  main: HTMLElement;
  /** The right column. */
  side: HTMLElement;
  /** Something the cards show changed. */
  refresh(): void;
  /** Scrolls to an escalation's card in Needs you; false when it isn't there (another theme: Approvals has it). */
  focusEscalation(id: string): boolean;
}

export function portalOverview(deps: OverviewDeps): PortalOverview {
  const card = (cls: string, heading: string, extra: (HTMLElement | null)[], ...body: HTMLElement[]) => h(`section.pt-ov-card${cls}`, { 'aria-label': heading }, h('div.pt-ov-card-h', {}, h('h2', {}, heading), ...extra), ...body);
  const link = (text: string, run: () => void) => h('button.pt-link', { type: 'button', onclick: run }, text);
  const grow = () => h('span.pt-grow');

  // ---- Progress: the page's own progress bar, moved into its card -----------------------------------------
  const progress = h('section.pt-ov-card.pt-prog.pt-only', { id: 'pt-progress', 'aria-label': 'Progress' }, h('h2', {}, 'Progress'));
  document.getElementById('setup')?.after(progress);
  portalSlot(document.getElementById('progress-bar'), progress);

  // ---- The main column: Needs you and the project brief ------------------------------------------------------
  const needs = needsCard({ show: deps.show });
  const brief = briefCard();
  const main = h('div.pt-ov-main.pt-only', {}, needs.el, brief.el);

  // ---- The right column --------------------------------------------------------------------------------------
  const shapeEl = h('span.pt-plain');
  const team = h('ul.pt-team');
  const money = h('div.pt-money');
  const meter = h('div.pt-meter', { role: 'img' }, h('i'));
  const budgetRows = h('dl.pt-kv');
  const budgetBody = h('div.pt-budget-b', {}, money, meter, budgetRows);
  const studioBtn = h('button.btn.pt-ql-studio', { type: 'button', onclick: () => deps.studio.open() }, icon('studio', 'pt-btn-ico'), 'Open in Studio Pro') as HTMLButtonElement;
  const appBtn = h('button.btn.pt-ql-app', { type: 'button', onclick: () => deps.viewApp() }, icon('play', 'pt-btn-ico'), 'View App') as HTMLButtonElement;
  const why = h('p.pt-ql-why');
  const details = h('dl.pt-details');
  const side = h(
    'aside.pt-ov-side.pt-only',
    { 'aria-label': 'About the project' },
    card('.pt-team-card', 'Team', [shapeEl, grow(), link('Open team', () => deps.show('org'))], team),
    card('.pt-budget-card', 'Budget', [grow(), link('Details', () => deps.show('budget'))], budgetBody),
    card('.pt-links-card', 'Quick links', [], h('div.pt-qlinks', {}, studioBtn, appBtn), why),
    card('.pt-details-card', 'Details', [], details),
  );
  document.getElementById('summary')?.after(side);

  let teamKey = '';
  function drawTeam() {
    const r = currentRoster();
    const lead = managerOf(r?.coverage ?? TEAM_OWNER);
    const rows = r ? teamRows(r.members, lead, (id) => store.workers.get(id)) : [];
    const others = [...store.workers.values()].filter((w) => (w.kind === undefined || w.kind === 'agent') && !r?.members.some((m) => m.workerId === w.id)).length;
    const colors = rows.map((x) => (x.workerId ? store.workers.get(x.workerId)?.color : undefined));
    const key = JSON.stringify([rows, others, colors, r ? shapeText(r) : '']);
    if (key === teamKey) return;
    teamKey = key;
    shapeEl.textContent = r ? shapeText(r) : '';
    if (!r) return void team.replaceChildren(h('li.pt-card-none', {}, 'Loading the team…'));
    team.replaceChildren(
      ...rows.map((x, i) => {
        const w = x.workerId ? store.workers.get(x.workerId) : undefined;
        const face = w
          ? h('button.pt-face', { type: 'button', title: `${x.name}: open its terminal`, 'aria-label': `${x.name}, ${x.title}: open its terminal`, style: `--face:${colors[i]}`, onclick: () => deps.openWorker(w.id) }, h('span.pt-face-i', { 'aria-hidden': 'true' }, initials(x.name)), agentFace(w, r.members))
          : h('span.pt-face.pt-face-off', { 'aria-hidden': 'true' }, initials(x.name));
        return h(
          'li',
          { class: x.missing ? 'pt-missing' : '' },
          face,
          h('div.pt-grow', {}, h('b', {}, x.missing ? x.title : x.lead ? `${x.name} · ${x.title}` : x.name), h('small', {}, x.missing ? x.what : [x.lead ? '' : x.title, x.what].filter(Boolean).join(' · '))),
          x.missing ? link('Hire', () => deps.show('org')) : h('span.pt-st', { class: `pt-st-${x.dot}` }, h('i', { 'aria-hidden': 'true' }), x.status),
        );
      }),
      ...(rows.length ? [] : [h('li.pt-card-none', {}, 'No one hired yet: Open team hires the team.')]),
      ...(others ? [h('li.pt-team-more', {}, link(`+ ${others} other agent${others === 1 ? '' : 's'} on the Agents page`, () => deps.show('workers')))] : []),
    );
  }

  let budgetKey = '';
  function drawBudget() {
    const v = deps.budget();
    const f = v ? budgetFacts(v) : undefined;
    const key = JSON.stringify(f ?? null);
    if (key === budgetKey) return;
    budgetKey = key;
    if (!f) {
      money.replaceChildren(h('p.pt-card-none', {}, 'Loading the budget…'));
      meter.hidden = true;
      return void budgetRows.replaceChildren();
    }
    money.replaceChildren(h('b', {}, f.spent), h('span', {}, f.of ?? 'spent · no budget set'));
    meter.hidden = f.pct === undefined;
    meter.dataset.tone = f.tone;
    meter.setAttribute('aria-label', f.pct === undefined ? 'No budget set' : `${f.pct} percent of the budget used`);
    (meter.firstElementChild as HTMLElement).style.width = `${f.pct ?? 0}%`;
    budgetRows.replaceChildren(...f.rows.flatMap(([k, val]) => [h('dt', {}, k), h('dd', {}, val)]));
  }

  let linksKey = '';
  function drawLinks() {
    const live = deps.live();
    const running = live?.status === 'running' && !!live.url;
    const shown = deps.studio.shown();
    const blocked = deps.studio.blocked();
    const key = JSON.stringify([running, live?.url, live?.status, shown, blocked]);
    if (key === linksKey) return;
    linksKey = key;
    studioBtn.hidden = !shown;
    studioBtn.disabled = !!blocked;
    studioBtn.title = blocked ?? 'Open the app’s .mpr in Studio Pro';
    appBtn.title = running ? `Open ${live!.url}` : 'The live app isn’t running: the Live app page';
    why.textContent = running ? `View App: the live app at ${live!.url!.replace(/^https?:\/\//, '').replace(/\/$/, '')}.` : `View App: the live app is ${live?.status ?? 'not started'}; opens the Live app page.${blocked ? ` Studio Pro: ${blocked}` : ''}`;
  }

  // The toolkit pin: asked once per project, only for a toolkit project.
  let toolkit: { floor: string; v?: ToolkitStatus } | undefined;
  function wantToolkit() {
    const floor = store.floor;
    if (!floor || toolkit?.floor === floor || !deps.setup()?.toolkit) return;
    toolkit = { floor };
    void getToolkit(floor).then(
      (v) => {
        if (toolkit?.floor === floor && v) ((toolkit.v = v), drawDetails());
      },
      () => undefined,
    );
  }

  // The default branch's newest commit: the Git tab's graph (GET /api/git, read off the event loop and
  // cached on the server), asked when the Overview is drawn for a project, then at most every two minutes
  // as it redraws. Never on a timer.
  let lastCommit: { floor: string; at: number; v?: GitGraph['history'][number] & { branch: string } } | undefined;
  const COMMIT_EVERY_MS = 120_000;
  function wantCommit() {
    const floor = store.floor;
    if (!floor || (lastCommit?.floor === floor && Date.now() - lastCommit.at < COMMIT_EVERY_MS)) return;
    const keep = lastCommit?.floor === floor ? lastCommit.v : undefined;
    lastCommit = { floor, at: Date.now(), v: keep };
    void fetch(`/api/git?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<GitGraph>) : undefined))
      .then((g) => {
        const c = g?.history[0];
        if (c && lastCommit?.floor === floor) ((lastCommit.v = { ...c, branch: g!.defaultBranch }), drawDetails());
      })
      .catch(() => undefined);
  }

  let detailsKey = '';
  function drawDetails() {
    wantToolkit();
    wantCommit();
    const f = store.currentFloor();
    const p = store.project;
    const b = deps.budget();
    const tk = toolkit?.floor === store.floor ? toolkit.v : undefined;
    const head = deps.setup()?.head;
    const commit = lastCommit?.floor === store.floor ? lastCommit.v : undefined;
    const facts: DetailFacts = {
      repo: f?.repo,
      dir: f?.repo ? undefined : (f?.dir ?? p?.dir),
      branch: p?.branch ?? f?.branch,
      mendix: deps.mendix(),
      toolkit: tk?.commit ? { sha: tk.commit.sha, date: tk.commit.date, state: tk.state } : undefined,
      lastCommit: commit ? { sha: commit.sha, branch: commit.branch, when: commitWhen(commit.date, navigator.language), subject: commit.subject } : head ? { sha: head.sha, branch: head.branch } : undefined,
      budget: b ? { spent: b.spent, total: b.settings.total, text: budgetText(b.spent, b.settings.total) } : undefined,
      live: deps.live(),
    };
    const rows = detailRows(facts);
    const key = JSON.stringify(rows);
    if (key === detailsKey) return;
    detailsKey = key;
    details.replaceChildren(
      ...rows.flatMap((r) => [
        h('dt', {}, r.label),
        h(
          'dd',
          { class: r.mono ? 'pt-mono' : '' },
          r.href
            ? h('a', { href: r.href, target: r.external ? '_blank' : undefined, rel: r.external ? 'noopener noreferrer' : undefined }, r.value, r.external ? icon('external', 'pt-ext') : null)
            : r.tab
              ? h('button.pt-link', { type: 'button', title: `Open ${r.tab === 'live' ? 'the Live app page' : `the ${r.tab[0].toUpperCase()}${r.tab.slice(1)} page`}`, onclick: () => deps.show(r.tab!) }, r.value)
              : r.value,
          r.sub ? h('small.pt-details-sub', {}, r.sub) : null,
        ),
      ]),
    );
  }

  const refresh = batched(() => {
    drawTeam();
    drawBudget();
    drawLinks();
    drawDetails();
    brief.refresh();
  });
  for (const k of ['workers', 'floor', 'floors', 'project', 'studio'] as const) store.on(k, refresh);
  onRoster(refresh);
  refresh();
  return { main, side, refresh, focusEscalation: (id) => needs.focusEscalation(id) };
}
