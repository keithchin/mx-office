// What the Model preview asks the server about one page at one revision (GET /api/app-explorer/page-facts,
// server/app-explorer/page-facts.ts), read from the model's units (no mxcli, no runtime):
//
//   widgets   per document (the page, its layout, the snippets they call): each named widget's $Type and $ID.
//             Select element marks widgets by name (names are unique per document and survive edits); the $ID
//             goes into the request as a hint only.
//   usedOn    per snippet the page shows: the pages that show it too (directly, or through their layout), for
//             "This is in snippet X, used on N pages".
//   theme     the project's own layout classes from its theme (themesource/<module>/web/main.scss), cleaned down
//             to layout properties (display, grid and flex placement, gaps, alignment), for the preview's frame.
//
// Pure: the page and the server import the types and the words.

export interface PageFacts {
  rev: string;
  qn: string;
  /** docQn → widget name → [$Type, $ID]. */
  widgets: Record<string, Record<string, [string, string]>>;
  /** snippet qn → the pages that show it (this page included), sorted. */
  usedOn: Record<string, string[]>;
  /** Cleaned layout CSS from the project's theme ('' when none), and the files it came from. */
  theme: { css: string; from: string[] };
  problem?: string;
}

/** `Forms$ActionButton` → `ActionButton`. */
export const widgetTypeWords = (t: string) => t.slice(t.indexOf('$') + 1);

/** "This is in snippet App header, used on 5 pages" (undefined when it's on this page only, or not in a snippet). */
export function sharedWords(snippetQn: string | undefined, facts: PageFacts | null | undefined): string | undefined {
  if (!snippetQn || !facts) return undefined;
  const pages = facts.usedOn[snippetQn];
  if (!pages || pages.length < 2) return undefined;
  const name = snippetQn.slice(snippetQn.indexOf('.') + 1);
  return `This is in snippet ${name}, used on ${pages.length} pages: a change to it changes all of them.`;
}
