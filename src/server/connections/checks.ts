// 🔌 Connections' Test buttons: a cheap read call to the service each credential is for, and what it
// says about the token (who it is, what it can reach, when it expires). Nothing here writes anything
// anywhere, and the value goes only into the request's Authorization header.

import type { CredentialCheck, CredentialId } from '../../shared/connections.js';
import { withExpiry } from '../../shared/connections.js';
import { JEV_URL, jevRequest } from '../judge/pure.js';

type Fetch = typeof fetch;
const TIMEOUT_MS = 10_000;

async function get(f: Fetch, url: string, headers: Record<string, string>, init: RequestInit = {}): Promise<Response | string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await f(url, { ...init, headers: { 'User-Agent': 'agent-office', ...headers }, signal: ctl.signal });
  } catch {
    return ctl.signal.aborted ? 'took too long to answer' : 'is unreachable from the office’s machine';
  } finally {
    clearTimeout(timer);
  }
}

const unreachable = (service: string, why: string): CredentialCheck => ({ at: Date.now(), status: 'connected', summary: `Couldn’t test it: ${service} ${why}. It’s kept as it is.` });

/** GitHub's "2026-11-01 00:00:00 UTC" (or "+0000"). */
export function parseGithubExpiry(h: string | null): number | undefined {
  if (!h) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|[+-]\d{4})?/.exec(h.trim());
  if (!m) return undefined;
  const tz = !m[3] || m[3] === 'UTC' ? 'Z' : `${m[3].slice(0, 3)}:${m[3].slice(3)}`;
  const t = Date.parse(`${m[1]}T${m[2]}${tz}`);
  return Number.isFinite(t) ? t : undefined;
}

const GH = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });

/**
 * A GitHub token: who it is, when it expires, the repositories it can see (and their owners), whether
 * it reaches each of `want` (the office's projects), and for the agents' token whether it can read
 * contents, issues and pull requests on the first of them. Fine-grained tokens don't report their
 * permissions, so write access can't be read back: GitHub's token page shows it.
 */
export async function testGithub(token: string, opts: { admin?: boolean; want?: string[]; fetch?: Fetch } = {}): Promise<CredentialCheck> {
  const f = opts.fetch ?? fetch;
  const me = await get(f, 'https://api.github.com/user', GH(token));
  if (typeof me === 'string') return unreachable('GitHub', me);
  if (me.status === 401) return { at: Date.now(), status: 'invalid', summary: 'GitHub refused it (401): it was revoked, has expired, or was pasted wrong.' };
  if (!me.ok) return { at: Date.now(), status: 'invalid', summary: `GitHub answered ${me.status} for it.` };
  const user = (await me.json().catch(() => ({}))) as { login?: string };
  const expiresAt = parseGithubExpiry(me.headers.get('github-authentication-token-expiration'));
  const scopesHeader = me.headers.get('x-oauth-scopes');
  const scopes = scopesHeader ? scopesHeader.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const details: string[] = [];
  const kind = token.startsWith('github_pat_') ? 'fine-grained' : 'classic';
  if (kind === 'classic') details.push(`A classic token${scopes ? ` with scopes ${scopes.join(', ') || '(none)'}` : ''}: a fine-grained one limited to your organization is safer.`);

  let repos: string[] = [];
  let repoCount = 0;
  const list = await get(f, 'https://api.github.com/user/repos?per_page=100&sort=full_name', GH(token));
  if (typeof list !== 'string' && list.ok) {
    const body = (await list.json().catch(() => [])) as unknown;
    const items = (Array.isArray(body) ? (body as { full_name?: string }[]) : []).map((r) => r.full_name).filter((n): n is string => !!n);
    repoCount = items.length;
    repos = items.slice(0, 12);
    if (items.length === 100) details.push('It can see 100 or more repositories (only the first 100 were counted).');
  }
  const owners = [...new Set([...repos, ...(opts.want ?? [])].map((r) => r.split('/')[0]))].filter((o) => repos.some((r) => r.startsWith(`${o}/`)));

  const missing: string[] = [];
  for (const repo of (opts.want ?? []).slice(0, 10)) {
    const r = await get(f, `https://api.github.com/repos/${repo}`, GH(token));
    if (typeof r !== 'string' && !r.ok) missing.push(repo);
  }
  if (missing.length) details.push(`Can’t reach ${missing.join(', ')}: give it access to ${missing.length === 1 ? 'that repository' : 'those repositories'} (or All repositories).`);
  const probe = (opts.want ?? []).find((r) => !missing.includes(r));
  if (!opts.admin && probe) {
    const can: string[] = [];
    const cannot: string[] = [];
    for (const [what, p] of [['contents', 'commits'], ['issues', 'issues'], ['pull requests', 'pulls']] as const) {
      const r = await get(f, `https://api.github.com/repos/${probe}/${p}?per_page=1`, GH(token));
      (typeof r !== 'string' && r.ok ? can : cannot).push(what);
    }
    details.push(`On ${probe} it can read ${can.join(', ') || 'nothing'}${cannot.length ? `, but not ${cannot.join(', ')}` : ''}. Write access can’t be read back from GitHub: check it on the token’s page.`);
  }
  if (opts.admin) details.push('Administration (write) can’t be read back without creating a repository: the wizard tells you if GitHub refuses.');
  const status = withExpiry('connected', expiresAt);
  const when = expiresAt ? `, expires ${new Date(expiresAt).toISOString().slice(0, 10)}` : ', no expiry date';
  return {
    at: Date.now(),
    status,
    summary: `Signed in to GitHub as ${user.login ?? 'someone'} (${kind}${when}); sees ${repoCount}${repoCount === 100 ? '+' : ''} repositor${repoCount === 1 ? 'y' : 'ies'}.`,
    details,
    expiresAt,
    login: user.login,
    repos,
    repoCount,
    owners,
    scopes,
  };
}

/**
 * A Mendix PAT, against the one read call a PAT is known to work on (the Deploy API v4's app list).
 * Mendix doesn't report a PAT's scopes: a 403 means the token was taken but has no mx:deployment:read,
 * which app creation doesn't need.
 */
export async function testMendix(token: string, f: Fetch = fetch): Promise<CredentialCheck> {
  const r = await get(f, 'https://deploy.mendix.com/api/v4/apps', { Authorization: `MxToken ${token}`, Accept: 'application/json' });
  if (typeof r === 'string') return unreachable('Mendix', r);
  if (r.status === 401) return { at: Date.now(), status: 'invalid', summary: 'Mendix refused it (401): revoked, or pasted wrong.' };
  if (r.status === 403) return { at: Date.now(), status: 'connected', summary: 'Mendix took the token, but it has no mx:deployment:read, so Test can’t list your apps. That’s fine for creating apps (mx:app:create).', details: ['Mendix doesn’t say which scopes a token has: its page in Mendix user settings does.'] };
  if (!r.ok) return { at: Date.now(), status: 'connected', summary: `Mendix answered ${r.status}; couldn’t tell more.` };
  const body = (await r.json().catch(() => [])) as unknown;
  const apps = Array.isArray(body) ? body.length : undefined;
  return { at: Date.now(), status: 'connected', summary: `Mendix took it${apps !== undefined ? `: it can see ${apps} app${apps === 1 ? '' : 's'}` : ''}.`, details: ['Mendix doesn’t say which scopes a token has: make sure it has mx:app:create for the wizard.'] };
}

/** Jev: one tiny question. */
export async function testJev(key: string, f: Fetch = fetch): Promise<CredentialCheck> {
  const body = JSON.stringify(jevRequest('The office is checking its key.', { ok: { type: 'noul', instructions: 'Is this a check?' } }));
  const r = await get(f, JEV_URL, { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, { method: 'POST', body });
  if (typeof r === 'string') return unreachable('Jev', r);
  if (r.status === 401 || r.status === 403) return { at: Date.now(), status: 'invalid', summary: `Jev refused the key (${r.status}).` };
  if (!r.ok) return { at: Date.now(), status: 'connected', summary: `Jev answered ${r.status}; the key may still be fine.` };
  return { at: Date.now(), status: 'connected', summary: 'Jev answered: Jeff can use it.' };
}

/** The Test for one credential. */
export function testCredential(id: CredentialId, value: string, want: string[], f?: Fetch): Promise<CredentialCheck> | undefined {
  switch (id) {
    case 'github-agents':
      return testGithub(value, { want, fetch: f });
    case 'github-admin':
      return testGithub(value, { admin: true, fetch: f });
    case 'mendix':
      return testMendix(value, f);
    case 'jev':
      return testJev(value, f);
    default:
      return undefined;
  }
}
