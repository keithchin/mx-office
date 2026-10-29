// The app's Mendix Cloud environments and their URLs, read with the office's Mendix token through the Deploy API v4
// (`GET /apps/{appId}/environments`, header `Authorization: MxToken <pat>`): name, state, URL, plan, production or
// not. Read-only, and cached per app (a few minutes; a refusal a little less), so ⚙️ Settings › ☁️ Team Server and
// the project's Overview never wait on Mendix more than once in a while. The token is only ever in that header:
// never in a URL, a log line, an error or the cache, and anything the API answers is passed through the redactor.

import { MENDIX_ENDPOINTS, type CloudEnvironment, type CloudEnvironments, type TeamServerEndpoints } from '../../shared/team-server.js';
import { redactor } from '../wizard/admin-token.js';
import type { Fetch } from './api.js';

/** How long a good answer is kept. */
export const ENV_TTL_MS = 5 * 60_000;
/** How long a refusal or an unreachable API is kept before asking again. */
export const ENV_ERROR_TTL_MS = 2 * 60_000;
const REQUEST_MS = 15_000;

export interface EnvDeps {
  token: string;
  endpoints?: TeamServerEndpoints;
  fetch?: Fetch;
  now?: () => number;
}

const cache = new Map<string, CloudEnvironments>();
const inflight = new Map<string, Promise<CloudEnvironments>>();

/** What was read last for the app, without asking (undefined: never read since the office started). */
export const peekEnvironments = (projectId: string): CloudEnvironments | undefined => cache.get(projectId);

/** Forgets what was read (tests). */
export const forgetEnvironments = () => (cache.clear(), inflight.clear());

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** One environment from the API's JSON, whatever casing it uses; undefined when it isn't one. */
function cleanEnvironment(v: unknown): CloudEnvironment | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const name = str(r.name) ?? str(r.Name) ?? str(r.mode) ?? str(r.Mode);
  if (!name) return undefined;
  const url = str(r.url) ?? str(r.Url);
  const isProduction = typeof r.isProduction === 'boolean' ? r.isProduction : typeof r.production === 'boolean' ? r.production : undefined;
  return {
    name: name.slice(0, 80),
    state: (str(r.state) ?? str(r.Status) ?? str(r.status) ?? '').slice(0, 40),
    // Only a web address is shown as a link.
    ...(url && /^https?:\/\/[^\s@]+$/.test(url) ? { url: url.slice(0, 300) } : {}),
    ...(str(r.planName) ? { planName: str(r.planName)!.slice(0, 80) } : {}),
    ...(isProduction !== undefined ? { isProduction } : {}),
  };
}

/** The list in the API's answer: an array, or one under `environments`, `items` or `data`. */
export function environmentsOf(body: unknown): CloudEnvironment[] {
  const b = body as Record<string, unknown> | unknown[] | undefined;
  const arr = Array.isArray(b) ? b : Array.isArray(b?.environments) ? b.environments : Array.isArray(b?.items) ? b.items : Array.isArray(b?.data) ? b.data : [];
  return (arr as unknown[]).map(cleanEnvironment).filter((e): e is CloudEnvironment => !!e).slice(0, 20);
}

/** What a refused read means, in words a Project Manager can act on. */
export function envRefusalWords(status: number): string {
  if (status === 401) return 'The Mendix token was refused by the Deploy API (401): it may have expired. Make a new one at https://user-settings.mendix.com and save it in 🔌 Connections.';
  if (status === 403) return 'The Deploy API refused the Mendix token (403): it needs the mx:deployment:read scope, and its owner must be on the app’s team.';
  if (status === 404) return 'The Deploy API doesn’t know this app (404): it has no cloud environments yet, or the token’s owner isn’t on its team.';
  return `The Deploy API answered ${status}. The office asks again in a few minutes.`;
}

async function read(d: EnvDeps, projectId: string): Promise<CloudEnvironments> {
  const now = (d.now ?? Date.now)();
  const base = (d.endpoints?.deployApi ?? MENDIX_ENDPOINTS.deployApi!).replace(/\/+$/, '');
  const hide = redactor([d.token]);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_MS);
  try {
    const res = await (d.fetch ?? fetch)(`${base}/apps/${encodeURIComponent(projectId)}/environments`, { headers: { Authorization: `MxToken ${d.token}`, Accept: 'application/json' }, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) return { at: now, list: [], error: envRefusalWords(res.status) };
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { at: now, list: [], error: 'The Deploy API’s answer wasn’t readable.' };
    }
    return { at: now, list: environmentsOf(body) };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const why = e.name === 'AbortError' ? `no answer in ${REQUEST_MS / 1000} s` : hide(e.cause?.code ?? e.message);
    return { at: now, list: [], error: `Couldn’t reach the Mendix Deploy API: ${why}.` };
  } finally {
    clearTimeout(timer);
  }
}

/** The app's environments: the cached ones while fresh, else read now (one read at a time per app). Never throws. */
export function loadEnvironments(d: EnvDeps, projectId: string, force = false): Promise<CloudEnvironments> {
  const now = (d.now ?? Date.now)();
  const had = cache.get(projectId);
  if (had && !force && now - had.at < (had.error ? ENV_ERROR_TTL_MS : ENV_TTL_MS)) return Promise.resolve(had);
  const going = inflight.get(projectId);
  if (going) return going;
  const p = read(d, projectId)
    .then((e) => {
      // A failed read keeps the last good list beside its error, so the Overview doesn't lose the URL on a blip.
      const kept = e.error && had?.list.length ? { ...e, list: had.list } : e;
      cache.set(projectId, kept);
      return kept;
    })
    .finally(() => inflight.delete(projectId));
  inflight.set(projectId, p);
  return p;
}

/** Whether the cached read for the app is old enough to read again. */
export function environmentsStale(projectId: string, now = Date.now()): boolean {
  const had = cache.get(projectId);
  return !had || now - had.at >= (had.error ? ENV_ERROR_TTL_MS : ENV_TTL_MS);
}
