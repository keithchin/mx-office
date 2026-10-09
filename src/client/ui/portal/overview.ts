// The Portal Overview (the Command Center in a Portal theme, overview.css): laid out like the portal's
// app overview. The main column is the page's own Command Center pieces, re-arranged by CSS alone: the
// Needs-you row as the portal's blue info alert (dismissible for the session, until it says something
// new), the setup panel when there is one, the project console under a "Project console" heading, the
// recent activity as a separated list, and What's happening, progress and the agents. The right column
// is this module's three light-grey cards:
//
//   Team               the agents' faces with a dot for how each is doing, "+N", → Workers
//   Technical contact  the Project Coordinator (or the Solo Lead), → its terminal
//   Details            repository, branch, Mendix version, toolkit pin, last commit, budget, live app
//
// Everything it shows is already on the page (the store, the roster, the budget feed, the live app's
// state, Studio's answer); the toolkit pin is asked once per project, and only for a toolkit project.
// The cards redraw when what they show changes, never on a timer.

import { store } from '../../state';
import { h } from '../dom';
import { currentRoster, onRoster } from '../teams/world';
import { getToolkit } from '../toolkit/api';
import type { ToolkitStatus } from '../../../shared/toolkit';
import { batched } from '../batch';
import { initials } from './topbar';
import { icon } from './icons';
import { alertKey, budgetText, commitWhen, detailRows, teamFaces, technicalContact, type DetailFacts } from './overview-logic';
import type { GitGraph } from '../../../shared/gitgraph';
import './overview.css';

export interface OverviewDeps {
  /** Opens a tab. */
  show(tab: string): void;
  openWorker(id: string): void;
  /** The live app's state and address, when the office has said. */
  live(): { status: string; url?: string } | undefined;
  /** The project's spend and budget, from the budget feed. */
  budget(): { spent: number; total?: number } | undefined;
  /** The Mendix version Studio Pro would open it in. */
  mendix(): string | undefined;
  /** The setup panel's view: whether it's a toolkit project, and the delivery branch's head. */
  setup(): { toolkit?: boolean; head?: { branch: string; sha: string } } | undefined;
}

export interface PortalOverview {
  /** The right column, for ui/summary.ts to keep last in the summary (its `after`). */
  side: HTMLElement;
  /** Something the cards show changed. */
  refresh(): void;
}

const DISMISSED = 'agent-office.portal-ny-dismissed';

export function portalOverview(deps: OverviewDeps): PortalOverview {
  // ---- The right column -----------------------------------------------------------------------------
  const faces = h('div.pt-faces');
  const contact = h('div.pt-contact');
  const details = h('dl.pt-details');
  const card = (heading: string, link: HTMLElement | null, ...body: HTMLElement[]) => h('section.pt-card', {}, h('div.pt-card-h', {}, h('h2', {}, heading), link), ...body);
  const link = (text: string, run: () => void) => h('button.pt-link', { type: 'button', onclick: run }, text);
  const side = h(
    'aside.pt-ov-side.pt-only',
    { 'aria-label': 'About the project' },
    card('Team', link('View team', () => deps.show('workers')), faces),
    card('Technical contact', null, contact),
    card('Details', null, details),
  );

  let teamKey = '';
  function drawTeam() {
    const t = teamFaces(store.workers.values());
    const key = JSON.stringify(t);
    if (key === teamKey) return;
    teamKey = key;
    if (!t.total) return void faces.replaceChildren(h('p.pt-card-none', {}, 'No agents yet: New task hires one.'));
    faces.replaceChildren(
      h(
        'ul.pt-face-list',
        { 'aria-label': `${t.total} agent${t.total === 1 ? '' : 's'}` },
        ...t.faces.map((f) =>
          h(
            'li',
            {},
            h('button.pt-face', { type: 'button', title: f.title, 'aria-label': `${f.title}: open its terminal`, style: `--face:${f.color}`, onclick: () => deps.openWorker(f.id) }, initials(f.name), h('span.pt-face-dot', { class: `pt-dot-${f.dot}`, 'aria-hidden': 'true' })),
          ),
        ),
        t.more ? h('li', {}, h('button.pt-face.pt-face-more', { type: 'button', title: `${t.more} more: the Agents page`, 'aria-label': `${t.more} more agents: the Agents page`, onclick: () => deps.show('workers') }, `+${t.more}`)) : null,
      ),
    );
  }

  let contactKey = '';
  function drawContact() {
    const m = technicalContact(currentRoster()?.members);
    const w0 = m?.workerId ? store.workers.get(m.workerId) : undefined;
    const key = JSON.stringify([m?.name, m?.title, m?.status, w0?.id, w0?.color]);
    if (key === contactKey) return;
    contactKey = key;
    if (!m) return void contact.replaceChildren(h('p.pt-card-none', {}, 'No Project Coordinator on this project yet.'));
    const w = m.workerId ? store.workers.get(m.workerId) : undefined;
    contact.replaceChildren(
      h('span.pt-contact-face', { 'aria-hidden': 'true', style: w ? `--face:${w.color}` : '' }, w ? initials(m.name) : icon('person')),
      h(
        'div.pt-contact-who',
        {},
        h('b', {}, m.name),
        h('span', {}, m.title),
        w ? h('button.pt-link', { type: 'button', onclick: () => deps.openWorker(w.id) }, 'Open its terminal') : h('span.pt-card-none', {}, m.status === 'benched' ? 'Benched' : 'Not working right now'),
      ),
    );
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
      budget: b ? { spent: b.spent, total: b.total, text: budgetText(b.spent, b.total) } : undefined,
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

  // ---- The main column's pieces --------------------------------------------------------------------
  // "Project console" over the console, with the way to the board, as the portal heads its sections.
  const consoleHead = h('div.pt-ov-h.pt-only', {}, h('h2', {}, 'Project console'), link('View board', () => deps.show('board')));
  document.getElementById('setup')?.after(consoleHead);

  // Needs you as the portal's info alert: an icon in front, a ✕ that hides it for the session until it says something new.
  const needs = document.getElementById('needs-you');
  const dismissedKey = () => {
    try {
      return sessionStorage.getItem(DISMISSED);
    } catch {
      return null;
    }
  };
  function decorateNeeds() {
    if (!needs) return;
    const row = needs.querySelector<HTMLElement>('.ny');
    const key = alertKey(store.floor ?? '', row?.textContent ?? '');
    needs.classList.toggle('pt-ny-dismissed', !!row && dismissedKey() === key);
    if (!row || row.querySelector('.pt-ny-ico')) return;
    row.prepend(icon('info', 'pt-ny-ico pt-only'));
    const x = h('button.pt-ny-x.pt-only', { type: 'button', 'aria-label': 'Dismiss for now', title: 'Hide this until something new needs you' }, icon('close'));
    x.addEventListener('click', () => {
      try {
        sessionStorage.setItem(DISMISSED, key);
      } catch {
        // Only until the next redraw, then.
      }
      needs.classList.add('pt-ny-dismissed');
    });
    row.append(x);
  }
  if (needs) new MutationObserver(decorateNeeds).observe(needs, { childList: true });
  decorateNeeds();

  const refresh = batched(() => {
    drawTeam();
    drawContact();
    drawDetails();
  });
  for (const k of ['workers', 'floor', 'floors', 'project', 'studio'] as const) store.on(k, refresh);
  onRoster(refresh);
  refresh();
  return { side, refresh };
}
