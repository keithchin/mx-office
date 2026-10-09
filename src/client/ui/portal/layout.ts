// The Portal layout of the 1D view, in one call from lite.ts: the left navigation (./nav.ts), the page
// header (./pagehead.ts), the Overview's right-hand cards and alert (./overview.ts), the bar's section
// (the page's name, now that the floor picker is in the navigation's project card) and what the top
// bar's search finds on this page (its pages, agents, issues and pull requests). All of it is drawn only
// in a Portal theme (.pt-only) and leaves the tabs, their ids and showTab as they were, so every other
// theme keeps the tab row and the bottom bar exactly as before. layout.css lays the page out round it.

import { store } from '../../state';
import type { GhIssue, GhPull } from '../../../shared/protocol';
import type { ProjectSummary } from '../../../shared/summary';
import { h } from '../dom';
import { openStudio, studioShown, studioVersion } from '../studio';
import { portalNav } from './nav';
import { pageHead } from './pagehead';
import { portalOverview } from './overview';
import { NAV_BOTTOM, NAV_GROUPS, pageTitle, type NavAction, type NavTab } from './nav-logic';
import type { SearchItem } from './search-logic';
import './layout.css';

export interface PortalLayoutDeps {
  show(tab: NavTab): void;
  openWorker(id: string): void;
  openIssue(it: GhIssue): void;
  openPull(it: GhPull): void;
  /** The project's deliverables window. */
  documents(): void;
  /** The live app's state and address (null until the office says). */
  live(): { status: string; url?: string } | undefined;
  budget(): { spent: number; total?: number } | undefined;
  setup(): { toolkit?: boolean; head?: { branch: string; sha: string } } | undefined;
}

export interface PortalLayout {
  /** The Overview's right column, for ui/summary.ts to keep last in the summary. */
  side: HTMLElement;
  /** The page showing now (lite.ts's showTab). */
  selected(tab: string): void;
  /** The project summary just drawn (its goal is the Overview's line). */
  summary(s: ProjectSummary | undefined): void;
  /** Something the Overview's cards show changed (the budget, the live app). */
  refresh(): void;
  /** What the top bar's search finds on this page. */
  searchItems(): SearchItem[];
}

export function portalLayout(deps: PortalLayoutDeps): PortalLayout {
  const main = document.querySelector<HTMLElement>('.lite-main')!;
  const viewApp = () => {
    const s = deps.live();
    if (s?.status === 'running' && s.url) window.open(s.url, '_blank', 'noopener');
    else deps.show('live');
  };
  const run = (a: NavAction) => (a === 'documents' ? deps.documents() : a === 'view-app' ? viewApp() : void openStudio());
  const nav = portalNav({ show: deps.show, run, offered: (a) => a !== 'studio' || studioShown() });
  const head = pageHead(main);
  const overview = portalOverview({ show: (t) => deps.show(t as NavTab), openWorker: deps.openWorker, live: deps.live, budget: deps.budget, mendix: studioVersion, setup: deps.setup });

  // The bar's section: the page's name, where the floor picker was (it's in the navigation's card now).
  const section = h('span.pt-section.pt-only.pt-page-name', { 'aria-live': 'polite' });
  document.querySelector('.lite-bar .pt-sep')?.after(section);

  return {
    side: overview.side,
    selected(t) {
      nav.selected(t);
      head.page(t);
      section.textContent = pageTitle(t);
    },
    summary(s) {
      if (s && s.floor === store.floor) head.describe(s.goal);
      overview.refresh();
    },
    refresh: overview.refresh,
    searchItems() {
      const here = store.currentFloor()?.name;
      const admin = store.me.admin;
      const pages: SearchItem[] = [...NAV_GROUPS.flatMap((g) => g.items.filter((i) => !i.admin || admin).map((i) => ({ i, where: g.label }))), ...NAV_BOTTOM.map((i) => ({ i, where: here ?? 'This project' }))]
        .filter(({ i }) => i.kind === 'tab' || i.id === 'documents' || (i.id === 'studio' ? studioShown() : true))
        .map(({ i, where }) => ({ kind: 'tab', label: i.label, hint: where, also: `${i.hint}${i.id === 'command' ? ' command center' : ''}`, go: () => (i.kind === 'tab' ? deps.show(i.id as NavTab) : run(i.id as NavAction)) }));
      const agents: SearchItem[] = [...store.workers.values()].map((w) => ({ kind: 'agent', label: w.name, hint: w.task?.name ?? w.title ?? w.status, also: `${w.worktree?.branch ?? ''} ${w.model ?? ''}`, go: () => deps.openWorker(w.id) }));
      const issues: SearchItem[] = store.issues.items.map((it) => ({ kind: 'issue', label: `#${it.number} ${it.title}`, hint: it.state === 'OPEN' ? 'Open issue' : 'Closed issue', also: String(it.number), go: () => deps.openIssue(it) }));
      const pulls: SearchItem[] = store.pulls.items.map((p) => ({ kind: 'pr', label: `#${p.number} ${p.title}`, hint: `${p.state === 'OPEN' ? (p.isDraft ? 'Draft' : 'Open') : p.state === 'MERGED' ? 'Merged' : 'Closed'} · ${p.headRefName}`, also: `${p.number} ${p.headRefName}`, go: () => deps.openPull(p) }));
      return [...pages, ...agents, ...issues, ...pulls];
    },
  };
}
