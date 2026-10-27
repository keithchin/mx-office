// The Mendix Projects API (v2, https://docs.mendix.com/openapi-spec/projects-v2.yaml) for creating a Portal app:
// `POST /projects` schedules a job and answers 202 with its `jobId`; `GET /projects/jobs/{jobId}` says
// scheduled, running, completed (with the new app's `projectId`) or failed (with an `errorMessage`). Both need
// a Personal Access Token with `mx:app:create`, sent as `Authorization: MxToken <pat>` (the spec's security
// scheme) and nowhere else: never in a URL, a log line or an error message. Every answer that isn't a success
// is said in words a Project Manager can act on (the missing scope, the company's policy, the name, the proxy).

import { APP_CREATE_SCOPE, MENDIX_ENDPOINTS, type TeamServerEndpoints } from '../../shared/team-server.js';

export type Fetch = typeof fetch;

export interface ApiDeps {
  token: string;
  endpoints?: TeamServerEndpoints;
  fetch?: Fetch;
  /** Waits between polls (tests pass a quick one). */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** A refusal the person has to act on (scope, policy, name): Retry alone won't help. */
export class PortalRefusal extends Error {
  override name = 'PortalRefusal';
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const REQUEST_MS = 30_000;
/** How long the office waits for the Portal to finish making the app. */
export const JOB_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = [1_000, 2_000, 3_000, 5_000];

const sleepMs = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The words of a Mendix API error body (`{ error: { message, detail, invalid-params } }`), kept short. */
export function errorText(body: unknown): string {
  const e = (body as { error?: { message?: unknown; detail?: unknown; 'invalid-params'?: unknown } } | undefined)?.error;
  if (!e) return typeof body === 'string' ? body.slice(0, 300) : '';
  const params = Array.isArray(e['invalid-params']) ? (e['invalid-params'] as { name?: unknown; reason?: unknown }[]).map((p) => `${String(p.name ?? '')}: ${String(p.reason ?? '')}`).join('; ') : '';
  return [e.message, e.detail, params].filter((x) => typeof x === 'string' && x.trim()).join(' — ').slice(0, 300);
}

const PROXY_HINT = 'If `curl` with the same token works from this machine, a proxy is refusing Node (it doesn’t read HTTPS_PROXY): start the office with NODE_USE_ENV_PROXY=1.';

/** What a refused call means, in words: the scope, the company's policy, the name, the token. */
export function refusalWords(status: number, said: string, what: string): string {
  const s = said.toLowerCase();
  if (status === 401) return `The Mendix token was refused (401${said ? `: ${said}` : ''}): it may have expired or been revoked. Make a new one at https://user-settings.mendix.com and save it in 🔌 Connections.`;
  if (status === 403) {
    if (/scope/.test(s)) return `The Mendix token can’t ${what}: it is missing the ${APP_CREATE_SCOPE} scope (403${said ? `: ${said}` : ''}). Make a token with ${APP_CREATE_SCOPE} at https://user-settings.mendix.com and save it in 🔌 Connections.`;
    if (/polic|company|not allowed|disabled|administrator/.test(s)) return `Your company’s Mendix settings don’t allow creating apps this way (403: ${said}). Ask your Mendix company admin, or create the app in the Portal yourself and paste its App ID.`;
    return `The Mendix Portal refused to ${what} (403${said ? `: ${said}` : ''}). Check that the token has the ${APP_CREATE_SCOPE} scope and that your company allows creating apps through the API. ${PROXY_HINT}`;
  }
  if (status === 409 || /already (exists|in use|taken)|name.*(taken|exists|in use)|duplicate/.test(s)) return `The Mendix Portal says that app name is taken (${status}${said ? `: ${said}` : ''}). Pick another project name, or link the existing app by its App ID.`;
  if (status === 400) return `The Mendix Portal didn’t accept the app’s details (400${said ? `: ${said}` : ''}). An app name may use letters, digits, spaces, - and _ (at most 100), a description at most 400 characters without & < > " ' / = @ : ( ) [ ] { } + ! # $ % ^ * | ~ \` , ; ? \\.`;
  if (status === 404) return `The Mendix Portal didn’t find it (404${said ? `: ${said}` : ''}).`;
  return `The Mendix Portal answered ${status}${said ? `: ${said}` : ''} when asked to ${what}. Try again in a few minutes.`;
}

async function call(d: ApiDeps, method: 'GET' | 'POST', pathname: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const base = (d.endpoints ?? MENDIX_ENDPOINTS).projectsApi.replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_MS);
  try {
    const res = await (d.fetch ?? fetch)(`${base}${pathname}`, {
      method,
      headers: { Authorization: `MxToken ${d.token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      // not JSON: kept as text
    }
    return { status: res.status, json };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const why = e.name === 'AbortError' ? `no answer in ${REQUEST_MS / 1000} s` : (e.cause?.code ?? e.message);
    throw new Error(`Couldn’t reach the Mendix Portal (${base}): ${why}. ${PROXY_HINT}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Schedules the app's creation; its job id. A refusal (401/403/400/409) throws PortalRefusal. */
export async function createProject(d: ApiDeps, app: { name: string; summary?: string }): Promise<string> {
  const r = await call(d, 'POST', '/projects', { name: app.name, ...(app.summary ? { summary: app.summary } : {}) });
  if (r.status === 202 || r.status === 200 || r.status === 201) {
    const jobId = (r.json as { jobId?: unknown } | undefined)?.jobId;
    if (typeof jobId === 'string' && jobId) return jobId;
    throw new Error('The Mendix Portal accepted the app but gave no job id to follow it: look for the app in the Portal before you try again');
  }
  const words = refusalWords(r.status, errorText(r.json), 'create an app');
  if (r.status >= 400 && r.status < 500) throw new PortalRefusal(words, r.status);
  throw new Error(words);
}

export interface JobStatus {
  status: string;
  projectId?: string;
  errorMessage?: string;
}

/** One look at the job. */
export async function jobStatus(d: ApiDeps, jobId: string): Promise<JobStatus | { gone: true } > {
  const r = await call(d, 'GET', `/projects/jobs/${encodeURIComponent(jobId)}`);
  if (r.status === 404) return { gone: true };
  if (r.status !== 200) {
    const words = refusalWords(r.status, errorText(r.json), 'say how the new app is coming along');
    if (r.status === 401 || r.status === 403) throw new PortalRefusal(words, r.status);
    throw new Error(words);
  }
  const j = (r.json ?? {}) as Record<string, unknown>;
  // The spec's example writes them snake_case once: both are read.
  const pick = (a: string, b: string) => (typeof j[a] === 'string' ? (j[a] as string) : typeof j[b] === 'string' ? (j[b] as string) : undefined);
  return { status: String(j.status ?? '').toLowerCase(), projectId: pick('projectId', 'project_id'), errorMessage: pick('errorMessage', 'error_message') };
}

/**
 * Follows the job until the app is made: its project id. A failed job, a job that stays unknown, or one
 * still running after `timeoutMs` throws, saying so (an unknown outcome says to look in the Portal first).
 */
export async function waitForProject(d: ApiDeps, jobId: string, onLine: (line: string) => void = () => undefined, timeoutMs = JOB_TIMEOUT_MS): Promise<string> {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? sleepMs;
  const start = now();
  let polls = 0;
  let gone = 0;
  let said = '';
  for (;;) {
    const s = await jobStatus(d, jobId);
    if ('gone' in s) {
      // A job only just scheduled may not be visible yet: a few looks before it counts.
      if (++gone >= 5) throw new Error(`The Mendix Portal no longer knows the job that was creating the app (${jobId}). Look in the Portal: if the app is there, link it by its App ID; if not, try again`);
    } else {
      if (s.status === 'completed') {
        if (!s.projectId) throw new Error(`The Mendix Portal finished the job (${jobId}) but gave no project id. Look in the Portal for the app and link it by its App ID`);
        return s.projectId;
      }
      if (s.status === 'failed') throw new PortalRefusal(`The Mendix Portal couldn’t create the app: ${s.errorMessage?.slice(0, 300) || 'it gave no reason'}.`);
      if (s.status !== said) onLine(`Mendix Portal: the app's creation is ${s.status || 'pending'}…`);
      said = s.status;
    }
    if (now() - start >= timeoutMs) throw new Error(`The Mendix Portal was still creating the app after ${Math.round(timeoutMs / 60_000)} minutes (job ${jobId}, ${said || 'no status'}). Look in the Portal: once the app is there, Retry links it`);
    await sleep(POLL_MS[Math.min(polls++, POLL_MS.length - 1)]);
  }
}
