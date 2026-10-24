// The two views' address (C3 of the App Workspace proposal): one project, two presentations over the
// same records, named by the switch at the top right of every project page: **Developer** (the code's
// "app workspace": five sections of the 1D view, /lite, each a project tab id of its own,
// ?tab=app|requirements|decisions|review|release, so nothing collides with the other tabs' ids) and
// **Project Management** (every other tab, the navigation; the code's "engineering" view). `&ws=app` (or
// its alias `&ws=dev`) opens the Developer view (on its App section unless the tab is one of its
// sections); `&ws=eng` (or `&ws=pm`) opens Project Management (an App section asked for there goes to the
// page closest to it). No `ws`: the tab as it always was. Switching between the two keeps the project (the
// address's floor) and maps the page you're on to its counterpart. Pure and tiny: the address reads it
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

export type AppSection = 'app' | 'requirements' | 'decisions' | 'review' | 'release';

/** The sections, left to right, as the App Workspace's secondary navigation has them. */
export const APP_SECTIONS: readonly { id: AppSection; label: string; hint: string }[] = [
  { id: 'app', label: 'App', hint: 'The running app first: its status for this version, what needs you and the next step' },
  { id: 'requirements', label: 'Requirements', hint: 'The approved brief: the goal, the areas of the app and the open questions' },
  { id: 'decisions', label: 'Decisions', hint: 'The decisions the team needs from you, most blocking first' },
  { id: 'review', label: 'Review', hint: 'What has been checked on the version that runs now, and what is still missing' },
  { id: 'release', label: 'Release', hint: 'Acceptance of a version and its deployment, which stays with people' },
];

export const isAppSection = (t: unknown): t is AppSection => typeof t === 'string' && APP_SECTIONS.some((s) => s.id === t);

/** The Project Management page closest to each App section (the switch goes there when you didn't come from one). */
export const ENGINEERING_FOR: Readonly<Record<AppSection, string>> = { app: 'live', requirements: 'documents', decisions: 'approvals', review: 'testing', release: 'command' };

/** The App section closest to a Project Management page (the switch to Developer, and `&ws=app` with such a tab). */
export function appSectionFor(tab: string | null | undefined): AppSection {
  if (isAppSection(tab)) return tab;
  switch (tab) {
    case 'documents':
      return 'requirements';
    case 'approvals':
    case 'questions':
      return 'decisions';
    case 'testing':
    case 'tests':
    case 'walkthroughs':
    case 'security':
      return 'review';
    default:
      return 'app';
  }
}

/**
 * The tab the address opens, from its `ws` and `tab`: `ws=app` (`dev`) an App section (the one asked for,
 * or the closest to the Project Management tab asked for), `ws=eng` (`pm`) a Project Management tab (an
 * App section asked for maps to its page there), anything else the tab as asked (null: none asked, as before).
 */
export function workspaceTab(ws: string | null | undefined, tab: string | null | undefined): string | null {
  const v = wsView(ws);
  if (v === 'app') return appSectionFor(tab);
  if (v === 'eng' && isAppSection(tab)) return ENGINEERING_FOR[tab];
  return tab ?? null;
}
