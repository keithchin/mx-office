// The issues and PR boards' status line. "Updated 2m ago" only for a fetch that came back: a failed one
// keeps the last good time and says it couldn't refresh, and why (the server keeps fetchedAt on a
// failure and stamps errorAt instead, server/github.ts). Pure.

import type { GhState } from '../../../shared/protocol';

/** The first line of gh's complaint, short enough for a status line. */
const reasonOf = (error: string) => {
  const line = error.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? 'unknown error';
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
};

export function boardStatus(st: Pick<GhState<unknown>, 'loading' | 'fetchedAt' | 'error'>, ago: (at: number) => string): string {
  if (st.loading) return 'Refreshing…';
  if (st.error) return `Couldn't refresh: ${reasonOf(st.error)}${st.fetchedAt ? ` (last updated ${ago(st.fetchedAt)})` : ''}`;
  return st.fetchedAt ? `Updated ${ago(st.fetchedAt)}` : '';
}
