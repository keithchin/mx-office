// 🚀 First-run setup's calls to the office (server/http/routes/first-run.ts): plain fetches. The office
// password goes up once, in a POST body; nothing secret ever comes back.
import type { CloneEvent, FirstRunStep, FirstRunView, PrereqResult } from '../../shared/first-run';
import type { FixEvent, FixId, FixPlan } from '../../shared/first-run-fix';
import { loadProfile } from '../state/persist';

async function call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify({ ...body, by: loadProfile()?.name }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `The office said ${res.status}`), { status: res.status });
  return data;
}

export const setupApi = {
  view: () => call<FirstRunView>('GET', '/api/setup'),
  checks: () => call<{ rows: PrereqResult[] }>('GET', '/api/setup/checks'),
  password: (password: string) => call<FirstRunView>('POST', '/api/setup/password', { password }),
  step: (step: FirstRunStep) => call<FirstRunView>('POST', '/api/setup/step', { step }),
  org: (org: string) => call<FirstRunView>('POST', '/api/setup/org', { org }),
  mendix: (version: string) => call<FirstRunView>('POST', '/api/setup/mendix', { version }),
  mxcli: (path: string) => call<FirstRunView>('POST', '/api/setup/mxcli', { path }),
  toolkit: (dir: string) => call<FirstRunView>('POST', '/api/setup/toolkit', { dir }),
  finish: () => call<FirstRunView>('POST', '/api/setup/finish', {}),
  rerun: () => call<FirstRunView>('POST', '/api/setup/rerun', {}),
  /** The long-paths row's button: git config --global core.longpaths true (never the registry). */
  longpaths: () => call<FirstRunView>('POST', '/api/setup/longpaths', {}),
  /** What a row's Fix (or Set up everything, 'all') would run, and the confirm token a run must carry. */
  fixPlan: (ids: FixId[] | 'all') => call<FixPlan>('POST', '/api/setup/fix/plan', { ids }),
  /** Runs a confirmed plan (less the optional steps in `skip`), telling `on` its progress. */
  fixRun: (confirm: string, skip: FixId[], on: (e: FixEvent) => void, signal?: AbortSignal) => lines<FixEvent>('/api/setup/fix/run', { confirm, skip }, on, (error) => ({ t: 'done', ok: false, error }), signal),
  /** Saves an Anthropic API key in 🔌 Connections; nothing of it comes back. */
  claudeKey: (key: string) => call<{ saved: true }>('POST', '/api/setup/claude-key', { key }),
  /** Clones the toolkit, telling `on` each line git prints and how it ended. */
  clone: (url: string, dir: string, on: (e: CloneEvent) => void) => lines<CloneEvent>('/api/setup/toolkit/clone', { url, dir }, on, (error) => ({ t: 'done', ok: false, error })),
};

/** A streamed answer (a JSON line each), handed to `on` as it comes; a refusal becomes `failed`'s event. */
async function lines<E>(path: string, body: Record<string, unknown>, on: (e: E) => void, failed: (error: string) => E, signal?: AbortSignal): Promise<void> {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, by: loadProfile()?.name }), signal });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return on(failed(data.error ?? `The office said ${res.status}`));
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const l of parts) if (l.trim()) on(JSON.parse(l) as E);
  }
  if (buf.trim()) on(JSON.parse(buf) as E);
}
