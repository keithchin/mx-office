// The New project flow's calls to the office (server/http/routes/brief.ts): the planner's status and a
// person's draft. Plain fetches, polled while the Chief Analyst works, like the wizard's setup.
import type { DraftRepo, DraftView, ItemOp, PlannerStatus, StartMode } from '../../../../shared/brief';
import type { InterviewMode } from '../../../../shared/wizard';

export type BriefError = Error & { status?: number; draft?: DraftView };

let by = '';
/** Whose name the brief's changes are recorded under on the shared password (the page's profile name; an account's own name wins on the server). */
export const setBriefBy = (name: string) => (by = name);

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, raw?: Blob): Promise<T> {
  const url = method === 'POST' && by ? `${path}${path.includes('?') ? '&' : '?'}by=${encodeURIComponent(by)}` : path;
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: raw ? { 'content-type': 'application/octet-stream' } : body === undefined ? {} : { 'content-type': 'application/json' },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; draft?: DraftView };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `The office said ${res.status}`), { status: res.status, draft: data.draft }) as BriefError;
  return data;
}

const q = encodeURIComponent;

export const briefApi = {
  status: () => call<PlannerStatus>('GET', '/api/brief/status'),
  latest: () => call<{ draft: DraftView | null }>('GET', '/api/brief/latest'),
  get: (id: string) => call<DraftView>('GET', `/api/brief/draft?id=${q(id)}`),
  create: (body: { mode: StartMode; prompt: string; interview?: InterviewMode; manual?: boolean; title?: string; repo?: DraftRepo }) => call<DraftView>('POST', '/api/brief/new', body),
  update: (id: string, body: { prompt?: string; mode?: StartMode; interview?: InterviewMode; repo?: DraftRepo | null }) => call<DraftView>('POST', `/api/brief/update?id=${q(id)}`, body),
  attach: (id: string, file: File) => call<DraftView>('POST', `/api/brief/file?id=${q(id)}&name=${q(file.name)}`, undefined, file),
  unattach: (id: string, name: string) => call<DraftView>('POST', `/api/brief/unfile?id=${q(id)}`, { name }),
  draft: (id: string) => call<DraftView>('POST', `/api/brief/draft?id=${q(id)}`, {}),
  manual: (id: string) => call<DraftView>('POST', `/api/brief/manual?id=${q(id)}`, {}),
  item: (id: string, op: ItemOp) => call<DraftView>('POST', `/api/brief/item?id=${q(id)}`, op),
  chat: (id: string, text: string) => call<DraftView>('POST', `/api/brief/chat?id=${q(id)}`, { text }),
  approve: (id: string) => call<DraftView>('POST', `/api/brief/approve?id=${q(id)}`, {}),
  discard: (id: string) => call<{ ok: boolean }>('POST', `/api/brief/discard?id=${q(id)}`, {}),
};

/** The office's spend today, for the bar's "Office $ today" chip (GET /api/budget/office). */
export async function officeToday(): Promise<number | undefined> {
  try {
    const r = await fetch('/api/budget/office', { credentials: 'same-origin' });
    if (!r.ok) return undefined;
    const v = (await r.json()) as { today?: number };
    return typeof v.today === 'number' ? v.today : undefined;
  } catch {
    return undefined;
  }
}
