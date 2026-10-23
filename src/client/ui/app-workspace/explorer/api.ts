// The explorer's requests (server: http/routes/app-explorer.ts). Every answer is about one revision, which
// never changes, so each is asked once per revision and kept (a new revision starts a new cache; the old one
// is let go). A test hands in its own fetch.

import type { ExplorerChanges, ExplorerFile, ExplorerLevel } from '../../../../shared/app-explorer';

export type Fetch = (url: string) => Promise<Response>;

export interface ExplorerApi {
  /** One level of the business tree ('' the top). */
  level(floor: string, rev: string, at: string): Promise<ExplorerLevel>;
  /** One folder of the project's files, from `cursor`. */
  folder(floor: string, rev: string, path: string, cursor?: number): Promise<ExplorerLevel>;
  file(floor: string, rev: string, path: string): Promise<ExplorerFile>;
  changes(floor: string, from: string, to: string): Promise<ExplorerChanges>;
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
      const body = (await r.json().catch(() => ({}))) as T & { error?: string };
      if (!r.ok) throw new Error(body.error || `${r.status}`);
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
  };
}
