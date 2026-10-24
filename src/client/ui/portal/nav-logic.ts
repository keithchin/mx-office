// What the Portal left navigation of the 1D view shows and remembers, without the page (ui/portal/nav.ts
// draws it): its groups and their items, each item one of the 1D view's tabs (the ids lite.ts's showTab
// and ?tab= know) or an action (the live app, Studio Pro); which group a tab is
// in, the page's name for the bar and the header, which groups are open and whether the pane is folded
// to its icon rail (kept per viewer in this browser), and what a closed group's badge says. A feature's
// own tab joins its group from the tab registry (src/client/tabs/registry.ts) rather than this list.
// Pure, so tests/portal-nav.test.ts runs it.

import { registeredTabs, reserveTabIds, tabsVersion } from '../../tabs/registry';

/** The 1D view's built-in tabs (lite.html's tab row and its views). */
export type NavTab = 'command' | 'board' | 'workers' | 'analysis' | 'live' | 'git' | 'model' | 'org' | 'standup' | 'approvals' | 'teams' | 'documents' | 'audit' | 'budget' | 'settings';
/** Any tab of the 1D view: a built-in one, or one a feature registered (lite.ts's Tab). */
export type TabId = NavTab | (string & {});
/** The items that do something rather than open a tab. */
export type NavAction = 'view-app' | 'studio';

export type GroupId = 'general' | 'pm' | 'insights' | 'repo' | 'deploy' | 'monitor';
export type GroupIcon = 'grid' | 'home' | 'kanban' | 'chart' | 'branch' | 'rocket' | 'pulse';

export interface NavItem {
  /** A tab's id (built-in or registered), or an action's. */
  id: TabId | NavAction;
  label: string;
  /** For a tab: the page header's one line under its title. For an action: its tooltip. */
  hint: string;
  kind: 'tab' | 'action';
  /** Only for admins (the test lab). */
  admin?: boolean;
}

export interface NavGroup {
  id: GroupId;
  label: string;
  icon: GroupIcon;
  items: NavItem[];
}

const tab = (id: TabId, label: string, hint: string, extra: Partial<NavItem> = {}): NavItem => ({ id, label, hint, kind: 'tab', ...extra });
const action = (id: NavAction, label: string, hint: string): NavItem => ({ id, label, hint, kind: 'action' });

/** The groups, top to bottom, as the portal's app pane has them, with their built-in items. */
const BUILTIN_GROUPS: readonly NavGroup[] = [
  {
    id: 'general',
    label: 'General',
    icon: 'grid',
    items: [
      tab('command', 'Overview', 'The project at a glance: what needs you, the team and recent activity'),
      tab('org', 'Team', 'The project team: the Project Coordinator and the Leads, who covers what'),
      tab('teams', 'Team boards', 'A board per team: its own cards, Lead, panels and journal'),
      tab('documents', 'Documents', 'Every team’s documents by toolkit stage: on main, on a branch, drafts and what’s still missing'),
    ],
  },
  {
    id: 'pm',
    label: 'Project Management',
    icon: 'kanban',
    items: [
      tab('board', 'Board', 'The pipeline from issue to merged pull request, the agents in between'),
      tab('approvals', 'Approvals', 'What needs the Project Manager: proposals and escalations'),
      tab('standup', 'Standup', 'The latest standup, and running one'),
    ],
  },
  {
    id: 'insights',
    label: 'App Insights',
    icon: 'chart',
    items: [
      tab('analysis', 'Analysis', 'Which model does well on what, here or on every project'),
      tab('budget', 'Budget', 'What the project has spent against its budget: by stage, role, agent, model, day and issue'),
      tab('audit', 'Audit log', 'Who did what, when: hires, prompts, escalations, approvals, GitHub, settings and sign-ins'),
    ],
  },
  {
    id: 'repo',
    label: 'Repository',
    icon: 'branch',
    items: [
      tab('git', 'Git', 'The branches as a metro map: who is on which, how far ahead and behind, and their pull requests'),
      tab('model', 'Model', 'The app as Studio Pro shows it: the App Explorer, domain models and microflows, on main or any branch'),
    ],
  },
  { id: 'deploy', label: 'Deployment', icon: 'rocket', items: [tab('live', 'Live app', 'The project’s app, running from main: open it, with its Console')] },
  {
    id: 'monitor',
    label: 'Monitoring',
    icon: 'pulse',
    // Tests (the test lab) joins from the tab registry: ui/testlab/tab.ts.
    items: [tab('workers', 'Agents', 'Every agent on the project and how it is doing, the ones waiting on someone first')],
  },
];

/** Under the rule at the bottom: Settings, the app, Studio Pro. */
export const NAV_BOTTOM: readonly NavItem[] = [
  tab('settings', 'Settings', 'Every setting: you, the agents, the team, notifications, the budget, connections, Studio, the look'),
  action('view-app', 'View App', 'Open the project’s app, running from main'),
  action('studio', 'Edit in Studio Pro', 'Open the project in Studio Pro on the office’s computer'),
];

reserveTabIds([...BUILTIN_GROUPS.flatMap((g) => g.items), ...NAV_BOTTOM].map((i) => i.id));

let cache: { version: number; groups: readonly NavGroup[]; all: readonly NavItem[] } | undefined;
function derived() {
  if (cache?.version === tabsVersion()) return cache;
  const groups = BUILTIN_GROUPS.map((g) => {
    const placed = g.items.map((item, i) => ({ item, order: (i + 1) * 10 }));
    for (const t of registeredTabs()) if (t.group === g.id && !t.hidden) placed.push({ item: tab(t.id, t.label, t.tooltip, t.admin ? { admin: true } : {}), order: t.order ?? Infinity });
    return { ...g, items: placed.sort((a, b) => a.order - b.order).map((p) => p.item) };
  });
  // The hidden ones (tabs/registry.ts `hidden`) are in no group but still tabs: ?tab=, the header's title.
  const hidden = registeredTabs().filter((t) => t.hidden).map((t) => tab(t.id, t.label, t.tooltip, t.admin ? { admin: true } : {}));
  cache = { version: tabsVersion(), groups, all: [...groups.flatMap((g) => g.items), ...NAV_BOTTOM, ...hidden] };
  return cache;
}

/**
 * The groups, top to bottom, with their items: the built-in ones (at 10, 20, 30…) and the registered tabs
 * (at their `order`, else after the built-in ones in the order they registered), sorted stably. Every
 * tab is in exactly one (tests check). Worked out again only when a tab registers.
 */
export const navGroups = (): readonly NavGroup[] => derived().groups;

/** The item for a tab or action id. */
export const navItem = (id: string): NavItem | undefined => derived().all.find((i) => i.id === id);

/** The group a tab is in (undefined for Settings, under the rule). */
export const groupOf = (id: string): NavGroup | undefined => navGroups().find((g) => g.items.some((i) => i.id === id));

/** Whether `t` is a tab of the 1D view: a built-in one or a registered one. */
export const isTab = (t: unknown): t is TabId => typeof t === 'string' && navItem(t)?.kind === 'tab';

/**
 * The tab a ?tab= (or the tab this browser tab last showed) asks for, or undefined for none or one that
 * isn't there (the page then opens as if none were asked). Old names still work: team is the org chart,
 * agents the Agents page (its own name for workers), deliverables Documents.
 */
export const asTab = (t: unknown): TabId | undefined => (t === 'team' ? 'org' : t === 'agents' ? 'workers' : t === 'deliverables' ? 'documents' : isTab(t) ? t : undefined);

/** The page's name: "Overview" for the Command Center, the item's label for the rest. */
export const pageTitle = (t: string): string => navItem(t)?.label ?? 'Overview';

/** The groups' items a viewer sees: the admin-only ones (Tests) only for an admin. */
export function visibleItems(g: NavGroup, admin: boolean): NavItem[] {
  return g.items.filter((i) => !i.admin || admin);
}

// ---- What's remembered: the open groups and the folded rail ----------------------------------------

export interface NavState {
  /** The groups opened (true) or closed (false) by hand; one never touched follows the page. */
  open: Partial<Record<GroupId, boolean>>;
  /** The pane folded to its icon rail. */
  rail: boolean;
}

export const NAV_KEY = 'agent-office.portal-nav';

const isGroup = (v: unknown): v is GroupId => BUILTIN_GROUPS.some((g) => g.id === v);

/** What was stored, made safe: anything odd is dropped rather than trusted. */
export function parseNavState(raw: string | null): NavState {
  const out: NavState = { open: {}, rail: false };
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object') return out;
    const o = v as { open?: unknown; rail?: unknown };
    if (o.open && typeof o.open === 'object') for (const [k, b] of Object.entries(o.open)) if (isGroup(k) && typeof b === 'boolean') out.open[k] = b;
    out.rail = o.rail === true;
  } catch {
    // Not JSON: as if nothing were stored.
  }
  return out;
}

export const serializeNavState = (s: NavState): string => JSON.stringify(s);

/**
 * Whether group `g` is open: as the viewer left it, else open when the page showing is in it (the
 * portal opens the group of the page you're on and leaves the others closed).
 */
export function groupOpen(s: NavState, g: GroupId, current: string): boolean {
  return s.open[g] ?? groupOf(current)?.id === g;
}

/** Going to a page (a click, ?tab=, a link elsewhere on the page): its group opens, so the picked item shows. */
export function revealGroup(s: NavState, current: string): NavState {
  const g = groupOf(current)?.id;
  return g && s.open[g] === false ? { ...s, open: { ...s.open, [g]: true } } : s;
}

/** Opening or closing a group by hand. */
export const toggleGroup = (s: NavState, g: GroupId, current: string): NavState => ({ ...s, open: { ...s.open, [g]: !groupOpen(s, g, current) } });

/**
 * Where a hover (or a click on the rail) shows a flyout of the group's items beside the pane: on the
 * folded rail always, on the open pane only for a closed group (an open one shows its items already).
 */
export const showsFlyout = (rail: boolean, open: boolean): boolean => rail || !open;

// ---- Badges --------------------------------------------------------------------------------------

/** A tab's badge as its .ro-tab-n says it: a count ("3", "9+"), "!" when something broke, a dot, or nothing. */
export type NavBadge = { text: string; kind: 'count' | 'bang' | 'dot' } | null;

/** The badge a tab's .ro-tab-n shows: its words and whether it's a dot or a "!". */
export function readBadge(text: string, dot: boolean, bang: boolean): NavBadge {
  const t = text.trim();
  if (dot) return { text: '', kind: 'dot' };
  if (bang || t === '!') return { text: '!', kind: 'bang' };
  return t && t !== '0' ? { text: t, kind: 'count' } : null;
}

/**
 * A closed group's (or the rail's) badge, from its items': a "!" wins, then the counts added up ("9+"
 * counts as 9 and keeps its plus), then a dot. Nothing when none of them has one.
 */
export function groupBadge(badges: readonly NavBadge[]): NavBadge {
  const shown = badges.filter((b): b is NonNullable<NavBadge> => !!b);
  if (!shown.length) return null;
  if (shown.some((b) => b.kind === 'bang')) return { text: '!', kind: 'bang' };
  const counts = shown.filter((b) => b.kind === 'count');
  if (counts.length) {
    const n = counts.reduce((sum, b) => sum + (parseInt(b.text, 10) || 0), 0);
    const plus = counts.some((b) => b.text.endsWith('+'));
    return { text: `${n}${plus ? '+' : ''}`, kind: 'count' };
  }
  return { text: '', kind: 'dot' };
}

/** The tab whose badge is the one Needs-you count (shared/needs-count.ts): the Overview. */
export const NEEDS_TAB = 'command';

/**
 * A closed group's badge without adding up counts that overlap: the tabs' own counts (Approvals, the Board's
 * cards for a human, agents waiting) are parts of, or beside, what Needs you counts, so a sum of them was a
 * fourth number that agreed with nothing. The group holding the Overview shows the Overview's count (the one
 * count); any other group shows a "!" when something broke, else a dot when one of its tabs has something.
 */
export function foldedBadge(badges: readonly NavBadge[], needs?: NavBadge | undefined): NavBadge {
  if (needs !== undefined) return needs ?? foldedBadge(badges);
  const shown = badges.filter((b): b is NonNullable<NavBadge> => !!b);
  if (!shown.length) return null;
  if (shown.some((b) => b.kind === 'bang')) return { text: '!', kind: 'bang' };
  return { text: '', kind: 'dot' };
}
