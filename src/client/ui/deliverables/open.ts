// Every way to the Documents page (the setup panel's Open documents →, the progress bar, the Portal
// navigation): on the 1D view it's a tab (lite.ts's showTab, handed in with documentsOpener), shown at
// once however often it's clicked; anywhere else (the 2D view) the link takes you there.

let show: (() => void) | undefined;

/** The 1D view: how the Documents tab is shown. */
export function documentsOpener(fn: () => void) {
  show = fn;
}

/** The Documents page's address for `floor` (?tab=documents; an old ?tab=deliverables still lands there). */
export const documentsHref = (floor?: string | null) => `/lite?tab=documents${floor ? `&floor=${encodeURIComponent(floor)}` : ''}`;

/** Shows the Documents page: the tab here, or the 1D view's page from elsewhere. */
export function openDocuments(floor?: string | null) {
  if (show) return show();
  location.assign(documentsHref(floor));
}
