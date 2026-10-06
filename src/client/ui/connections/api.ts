// 🔌 Connections' calls to the office (server/http/routes/connections.ts): plain fetches, admins only.
// A value goes up once, in the body of a save; nothing secret ever comes back.
import type { ConnectionsView, CredentialId, ToolsView } from '../../../shared/connections';
import { loadProfile } from '../../state/persist';

export type ImportResult = { imported: CredentialId[]; files: string[]; errors: string[] };

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

export const connectionsApi = {
  view: () => call<ConnectionsView>('GET', '/api/connections'),
  tools: () => call<ToolsView>('GET', '/api/connections/tools'),
  save: (id: CredentialId, value: string) => call<ConnectionsView>('POST', '/api/connections/save', { id, value }),
  remove: (id: CredentialId) => call<ConnectionsView>('POST', '/api/connections/remove', { id }),
  test: (id: CredentialId) => call<ConnectionsView>('POST', '/api/connections/test', { id }),
  importFiles: () => call<ConnectionsView & { imported: ImportResult }>('POST', '/api/connections/import', {}),
  mendixFloor: (floor: string, on: boolean) => call<ConnectionsView>('POST', '/api/connections/mendix-floor', { floor, on }),
  path: (which: 'projectsDir' | 'toolkitDir', dir: string) => call<ConnectionsView>('POST', '/api/connections/paths', { which, dir }),
  identity: (name: string, email: string) => call<ConnectionsView>('POST', '/api/connections/git-identity', { name, email }),
  clearIdentity: () => call<ConnectionsView>('POST', '/api/connections/git-identity', { clear: true }),
  sweep: (on: boolean) => call<ConnectionsView>('POST', '/api/connections/sweep', { on }),
  sweepNow: () => call<ConnectionsView>('POST', '/api/connections/sweep/run', {}),
};
