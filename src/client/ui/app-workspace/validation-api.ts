// What guided validation (C5) reads and sends, for the App Workspace's Review and Release sections:
//
//   feed        GET /api/guided-validation for the version on screen (the served revision): asked only when
//               Review or Release shows, and again when that version or its results move (the live app's
//               own message carries the readiness, whose journey results are those of the served commit),
//               one ask in flight at a time. No timer.
//   mark        POST /api/guided-validation/mark ("Works as expected" / "Something's wrong")
//   acceptance  the progress bar's acceptance routes, unchanged (GET /api/acceptance/draft for the review
//               token, POST /api/acceptance with the same body the Engineering view's dialog sends), with
//               the server's refusal handed back (status and words) rather than toasted, so the Release
//               section can say it in business words

import type { AcceptanceDraft, AcceptanceView, Exception } from '../../../shared/acceptance';
import type { FindingRecord, ValidationView } from '../../../shared/guided-validation';
import { myName } from '../project-run/api';

export interface MarkAsk {
  revision: string;
  scenario: string;
  verdict: 'works' | 'wrong';
  note?: string;
  page?: string;
  pageMoved?: boolean;
}
export type MarkSent = { ok: true; finding: FindingRecord } | { ok: false; status: number; error: string };

/** What the server answered an Accept or a Reopen: done, or its refusal (status, words, whether the review went stale). */
export type ActResult = { ok: true; version: string } | { ok: false; status: number; error: string; stale?: boolean };

/** The acceptance path as the Release section uses it (the page's own, or a test's). */
export interface AcceptancePort {
  draft(floor: string): Promise<AcceptanceDraft | undefined>;
  view(floor: string): Promise<AcceptanceView | undefined>;
  accept(floor: string, a: { reviewToken: string; version: string; exceptions: Exception[]; scopeNote?: string }): Promise<ActResult>;
  reopen(floor: string, version: string, scopeNote: string): Promise<ActResult>;
}

const json = async <T>(url: string): Promise<T | undefined> => {
  try {
    const r = await fetch(url, { credentials: 'same-origin' });
    return r.ok ? ((await r.json()) as T) : undefined;
  } catch {
    return undefined;
  }
};

async function post(url: string, body: object): Promise<{ status: number; data: Record<string, unknown> }> {
  try {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, by: myName() }) });
    return { status: r.status, data: ((await r.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } catch {
    return { status: 0, data: {} };
  }
}

const q = (floor: string) => `floor=${encodeURIComponent(floor)}`;

/** The page's acceptance path: the same routes and bodies as the progress bar's dialog. */
export const pageAcceptance: AcceptancePort = {
  draft: (floor) => json<AcceptanceDraft>(`/api/acceptance/draft?${q(floor)}`),
  view: (floor) => json<AcceptanceView>(`/api/acceptance?${q(floor)}`),
  async accept(floor, a) {
    const { status, data } = await post('/api/acceptance', { floor, action: 'accept', confirm: true, ...a });
    const rec = data.record as { version?: string } | undefined;
    return status === 200 && rec ? { ok: true, version: String(rec.version ?? a.version) } : { ok: false, status, error: String(data.error ?? ''), ...(data.stale === true ? { stale: true } : {}) };
  },
  async reopen(floor, version, scopeNote) {
    const { status, data } = await post('/api/acceptance', { floor, action: 'reopen', version, scopeNote });
    const r = data.reopen as { version?: string } | undefined;
    return status === 200 && r ? { ok: true, version: String(r.version ?? version) } : { ok: false, status, error: String(data.error ?? '') };
  },
};

/** POST /api/guided-validation/mark: the mark as kept, or why not. */
export async function postMark(floor: string, m: MarkAsk): Promise<MarkSent> {
  const { status, data } = await post('/api/guided-validation/mark', { floor, ...m });
  if (status === 200 && data.finding) return { ok: true, finding: data.finding as FindingRecord };
  return { ok: false, status, error: typeof data.error === 'string' ? data.error : status === 0 ? 'The office couldn’t be reached. Try again.' : 'The office couldn’t keep it just now. Try again.' };
}

/** The version on screen's scenarios, kept per project and version; `key` says when to ask again. */
export function validationFeed(onChange: () => void) {
  let mine: { floor: string; revision: string; key: string; v?: ValidationView; asking?: boolean; dirty?: boolean } | undefined;
  const ask = (cur: NonNullable<typeof mine>) => {
    if (cur.asking) return void (cur.dirty = true);
    cur.asking = true;
    void json<ValidationView>(`/api/guided-validation?${q(cur.floor)}&revision=${encodeURIComponent(cur.revision)}`).then((v) => {
      cur.asking = false;
      if (mine !== cur) return;
      cur.v = v ?? cur.v ?? { floor: cur.floor, revision: cur.revision, scenarios: [], checks: { passed: 0, failed: 0, skipped: 0 }, corrections: [], note: 'The office couldn’t list the guided checks just now.' };
      onChange();
      if (cur.dirty) {
        cur.dirty = false;
        ask(cur);
      }
    });
  };
  return {
    /** Review or Release shows `revision` of `floor`: ask when it, or what its results hang on (`key`), changed. */
    want(floor: string, revision: string, key: string) {
      if (mine?.floor === floor && mine.revision === revision && mine.key === key) return;
      const keep = mine?.floor === floor && mine.revision === revision ? mine.v : undefined;
      mine = { floor, revision, key, ...(keep ? { v: keep } : {}) };
      ask(mine);
    },
    /** Now, after a mark. */
    now() {
      if (mine) ask(mine);
    },
    get: (floor: string | null, revision: string | undefined): ValidationView | undefined => (floor && revision && mine?.floor === floor && mine.revision === revision ? mine.v : undefined),
  };
}
