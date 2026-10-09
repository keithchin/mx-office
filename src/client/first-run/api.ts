// 🚀 First-run setup's calls to the office (server/http/routes/first-run.ts): plain fetches. The office
// password goes up once, in a POST body; nothing secret ever comes back.
import type { CloneEvent, FirstRunStep, FirstRunView, PrereqResult } from '../../shared/first-run';
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
  /** Clones the toolkit, telling `on` each line git prints and how it ended. */
  async clone(url: string, dir: string, on: (e: CloneEvent) => void): Promise<void> {
    const res = await fetch('/api/setup/toolkit/clone', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, dir, by: loadProfile()?.name }) });
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return on({ t: 'done', ok: false, error: data.error ?? `The office said ${res.status}` });
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) on(JSON.parse(l) as CloneEvent);
    }
    if (buf.trim()) on(JSON.parse(buf) as CloneEvent);
  },
};
