// The two views' address (C3 of the App Workspace proposal): one project, two presentations over the
// same records, named by the switch at the top right of every project page: **Developer** (the code's
// "app workspace": one project tab of the 1D view, /lite, ?tab=app: explorer, canvas and the docked
// coordinator chat) and **Project Management** (every other tab, the navigation; the code's "engineering"
// view). `&ws=app` (or its alias `&ws=dev`) opens the Developer view; `&ws=eng` (or `&ws=pm`) opens
// Project Management. No `ws`: the tab as it always was.
//
// The Developer view's old sections (?tab=requirements|decisions|review|release) are retired: their lists
// live in Project Management, so an old link lands on the page closest to each (Documents, Approvals,
// Testing, the Overview's progress and Accept), with or without `ws`. Pure and tiny: the address reads it
// before the page starts (client/shared/address.ts).

/** The two views' names, as the switch, the navigation, the titles and the docs say them. */
export const VIEW_NAMES = { app: 'Developer', eng: 'Project Management' } as const;
/** The Developer view's full name (page titles, the docs, the workspace's label). */
export const DEVELOPER_VIEW = 'Developer view';

/** The view an address's `ws` names: `app`/`dev` the Developer view, `eng`/`pm` Project Management, else none. */
export function wsView(ws: string | null | undefined): 'app' | 'eng' | null {
  if (ws === 'app' || ws === 'dev') return 'app';
  if (ws === 'eng' || ws === 'pm') return 'eng';
  return null;
}

/** The Developer view's one tab. */
export type AppSection = 'app';

/** The Developer view's tab (it had five sections; four are retired, below). */
export const APP_SECTIONS: readonly { id: AppSection; label: string; hint: string }[] = [
  { id: 'app', label: 'App', hint: 'The app: its explorer, its Model preview or the live app, and the coordinator chat to ask for changes' },
];

export const isAppSection = (t: unknown): t is AppSection => t === 'app';

/** The Developer view's retired sections, and the Project Management page each one's list lives on now. */
export const RETIRED_SECTIONS = { requirements: 'documents', decisions: 'approvals', review: 'testing', release: 'command' } as const;
export type RetiredSection = keyof typeof RETIRED_SECTIONS;
export const isRetiredSection = (t: unknown): t is RetiredSection => typeof t === 'string' && Object.hasOwn(RETIRED_SECTIONS, t);

/** The Project Management page closest to the Developer view (the switch goes there when you didn't come from one), and to each retired section. */
export const ENGINEERING_FOR: Readonly<Record<AppSection | RetiredSection, string>> = { app: 'live', ...RETIRED_SECTIONS };

/** The Developer view's tab for any page (the switch to Developer, and `&ws=app` with a Project Management tab): its one tab. */
export function appSectionFor(_tab?: string | null): AppSection {
  return 'app';
}

/**
 * The tab the address opens, from its `ws` and `tab`: a retired section the Project Management page that has
 * its list now (whatever `ws` says); `ws=app` (`dev`) the Developer view; `ws=eng` (`pm`) with the Developer
 * view's tab, the Live app page; anything else the tab as asked (null: none asked, as before).
 */
export function workspaceTab(ws: string | null | undefined, tab: string | null | undefined): string | null {
  if (isRetiredSection(tab)) return RETIRED_SECTIONS[tab];
  const v = wsView(ws);
  if (v === 'app') return 'app';
  if (v === 'eng' && isAppSection(tab)) return ENGINEERING_FOR[tab];
  return tab ?? null;
}
