// The explorer's requests (server: http/routes/app-explorer.ts). Every answer is about one revision, which
// never changes, so each is asked once per revision and kept (a new revision starts a new cache; the old one
// is let go); an answer that says the model couldn't be read is asked again next time. Main's newest commit
// (head) is asked fresh each time. A test hands in its own fetch.

import type { ExplorerChanges, ExplorerFile, ExplorerHead, ExplorerIndex, ExplorerLevel, ExplorerSearch } from '../../../../shared/app-explorer';
import type { DocumentsView } from '../../../../shared/app-documents';

export type Fetch = (url: string) => Promise<Response>;

export interface ExplorerApi {
  /** One level of the business tree ('' the top). */
  level(floor: string, rev: string, at: string): Promise<ExplorerLevel>;
  /** One folder of the project's files, from `cursor`. */
  folder(floor: string, rev: string, path: string, cursor?: number): Promise<ExplorerLevel>;
  file(floor: string, rev: string, path: string): Promise<ExplorerFile>;
  changes(floor: string, from: string, to: string): Promise<ExplorerChanges>;
  /** Main's newest commit (asked fresh each time: it moves), and how far the live app's revision is from it. */
  head(floor: string, served?: string): Promise<ExplorerHead>;
  /** Every level of the business tree at once (the search). */
  index(floor: string, rev: string): Promise<ExplorerIndex>;
  /** The project's files whose path has every word of `q`. */
  search(floor: string, rev: string, q: string): Promise<ExplorerSearch>;
  /** The documents with their relationships. */
  documents(floor: string, rev: string): Promise<DocumentsView>;
}

export function explorerApi(fetcher: Fetch = (u) => fetch(u, { credentials: 'same-origin' })): ExplorerApi {
  let kept: { key: string; answers: Map<string, Promise<unknown>> } = { key: '', answers: new Map() };
  const ask = <T>(floor: string, rev: string, path: string, q: Record<string, string>): Promise<T> => {
    const key = `${floor}\0${rev}`;
    if (kept.key !== key) kept = { key, answers: new Map() };
    const params = new URLSearchParams({ floor, rev, ...q });
    const url = `${path}?${params.toString()}`;
    const hit = kept.answers.get(url) as Promise<T> | undefined;
    if (hit) return hit;
    const answers = kept.answers;
    const p = fetcher(url).then(async (r) => {
      const body = (await r.json().catch(() => ({}))) as T & { error?: string; problem?: string };
      if (!r.ok) throw new Error(body.error || `${r.status}`);
      if (body.problem) answers.delete(url);
      return body;
    });
    answers.set(url, p);
    p.catch(() => answers.delete(url));
    return p;
  };
  return {
    level: (floor, rev, at) => ask(floor, rev, '/api/app-explorer/tree', { at }),
    folder: (floor, rev, path, cursor = 0) => ask(floor, rev, '/api/app-explorer/files', { path, ...(cursor ? { cursor: String(cursor) } : {}) }),
    file: (floor, rev, path) => ask(floor, rev, '/api/app-explorer/file', { path }),
    changes: (floor, from, to) => ask(floor, to, '/api/app-explorer/changes', { from }),
    head: async (floor, served) => {
      const r = await fetcher(`/api/app-explorer/head?${new URLSearchParams({ floor, ...(served ? { served } : {}) }).toString()}`);
      const body = (await r.json().catch(() => ({}))) as ExplorerHead & { error?: string };
      if (!r.ok) throw new Error(body.error || `${r.status}`);
      return body;
    },
    index: (floor, rev) => ask(floor, rev, '/api/app-explorer/index', {}),
    search: (floor, rev, q) => ask(floor, rev, '/api/app-explorer/search', { q }),
    documents: (floor, rev) => ask(floor, rev, '/api/app-explorer/documents', {}),
  };
}
