// The App Workspace's address (C3 of the App Workspace proposal): one project, two presentations over the
// same records. The App Workspace is five sections of the 1D view (/lite), each a project tab id of its
// own (?tab=app|requirements|decisions|review|release), so nothing collides with the Engineering tabs'
// ids, which keep opening exactly as before. `&ws=app` opens the App Workspace (on its App section unless
// the tab is one of its sections); `&ws=eng` opens the Engineering view (an App section asked for there
// goes to the Engineering page closest to it). No `ws`: the tab as it always was. Switching between the
// two keeps the project (the address's floor) and maps the page you're on to its counterpart. Pure and
// tiny: the address reads it before the page starts (client/shared/address.ts).

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

/** The Engineering page closest to each App section (the switch to Engineering goes there when you didn't come from one). */
export const ENGINEERING_FOR: Readonly<Record<AppSection, string>> = { app: 'live', requirements: 'documents', decisions: 'approvals', review: 'testing', release: 'command' };

/** The App section closest to an Engineering page (the switch to App, and `&ws=app` with an Engineering tab). */
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
 * The tab the address opens, from its `ws` and `tab`: `ws=app` an App section (the one asked for, or the
 * closest to the Engineering tab asked for), `ws=eng` an Engineering tab (an App section asked for maps to
 * its Engineering page), anything else the tab as asked (null: none asked, as before).
 */
export function workspaceTab(ws: string | null | undefined, tab: string | null | undefined): string | null {
  if (ws === 'app') return appSectionFor(tab);
  if (ws === 'eng' && isAppSection(tab)) return ENGINEERING_FOR[tab];
  return tab ?? null;
}
