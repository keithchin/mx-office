// Which tab the 1D view (lite.ts) opens on. Entering a project (from Home, the project switcher, the
// launcher, Go to Board, or /lite fresh) always opens its Command Center (the Portal Overview); a link
// that names a tab (?tab=…: Needs you, a PR's View in Model, a notification) opens that one; and a reload
// of the same browser tab keeps the tab it was showing (kept in sessionStorage, so only for that browser
// tab, never "the last tab ever"). Switching project inside the 1D view goes to the new one's Command
// Center too. Pure but for the two small storage helpers, so tests/portal-nav.test.ts runs it.

/** This browser tab's current tab (sessionStorage: gone when the browser tab closes). */
export const TAB_SESSION_KEY = 'agent-office.lite-tab.session';

/** The tab to open: the one a link names, else on a reload the one this browser tab showed, else `home`. */
export function startTab<T extends string>(asked: T | undefined, reloaded: boolean, current: T | undefined, home: T): T {
  return asked ?? (reloaded ? current : undefined) ?? home;
}

/** A change of project after the first one (the first is the page arriving): back to its Command Center. */
export const floorSwitched = (prev: string | null | undefined, next: string | null | undefined): boolean => !!prev && !!next && prev !== next;

/** Whether this page load is a reload of the same page. */
export function isReload(): boolean {
  try {
    return (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload';
  } catch {
    return false;
  }
}

/** What this browser tab showed last, if the browser keeps it. */
export function sessionTab(): string | undefined {
  try {
    return sessionStorage.getItem(TAB_SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberSessionTab(t: string) {
  try {
    sessionStorage.setItem(TAB_SESSION_KEY, t);
  } catch {
    // Not kept: a reload opens the Command Center.
  }
}
