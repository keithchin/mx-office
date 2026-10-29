// A fake Mendix Portal and Team Server on 127.0.0.1, so no test ever calls the real Mendix API:
//   POST /v2/projects            the Projects API's create (MxToken auth), answering 202 { jobId }, or a refusal set by the test
//   GET  /v2/projects/jobs/<id>  the job: `steps` statuses one per look, then completed with a projectId (or failed)
//   GET  /api/v4/apps/<id>/environments  the Deploy API's environments (MxToken auth): `environments[id]`, or `envStatus`
//   /<projectId>.git/...         Team Server's git over smart HTTP: Basic auth with user `pat` and the token (anything
//                                else is a 401 with Team Server's challenge), served by git's own git-http-backend.
// A completed job makes the app's repository with a template commit (App.mpr, mprcontents/mprname) and a Studio Pro
// history note, as the Portal's blank template has. Every request is recorded (method, URL, Authorization), so tests
// can check the token was never in a URL.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export interface FakeTeamServer {
  url: string;
  endpoints: { projectsApi: string; git: string; deployApi: string };
  root: string;
  token: string;
  requests: { method: string; url: string; auth?: string }[];
  /** Set by a test: the next create's answer instead of 202. */
  refuse?: { status: number; body: unknown };
  /** Statuses a job reports before it completes. */
  steps: string[];
  /** A job that fails instead, with this message. */
  failJob?: string;
  creates: { name: string; summary?: string }[];
  /** The Deploy API's answer per app id (the body as sent), and a status to answer instead. */
  environments: Record<string, unknown>;
  /** GET /api/v4/apps/<id>'s answer per app id. */
  apps: Record<string, unknown>;
  envStatus?: number;
  /** Makes an app's repository with the template (an existing app, for linking). */
  makeApp(id?: string): string;
  /** A bare repository's ref. */
  head(projectId: string, ref?: string): string;
  close(): Promise<void>;
}

const gitEnv = { GIT_AUTHOR_NAME: 'Template', GIT_AUTHOR_EMAIL: 'template@localhost', GIT_COMMITTER_NAME: 'Template', GIT_COMMITTER_EMAIL: 'template@localhost', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...gitEnv } }).trim();

export async function fakeTeamServer(token = 'fake-mendix-pat-0123456789abcdef'): Promise<FakeTeamServer> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fake-ts-'));
  const backend = path.join(git(root, ['--exec-path']), process.platform === 'win32' ? 'git-http-backend.exe' : 'git-http-backend');
  const jobs = new Map<string, { looks: number; name: string; projectId?: string }>();

  const makeApp = (id = randomUUID()) => {
    const bare = path.join(root, `${id}.git`);
    git(root, ['init', '--bare', '-q', '-b', 'main', bare]);
    git(bare, ['config', 'http.receivepack', 'true']);
    const seed = mkdtempSync(path.join(os.tmpdir(), 'fake-ts-seed-'));
    try {
      git(seed, ['init', '-q', '-b', 'main']);
      writeFileSync(path.join(seed, 'App.mpr'), 'template model\n');
      mkdirSync(path.join(seed, 'mprcontents'));
      writeFileSync(path.join(seed, 'mprcontents', 'mprname'), 'App.mpr');
      git(seed, ['add', '-A']);
      git(seed, ['commit', '-q', '-m', 'Initial app upload.']);
      git(seed, ['notes', '--ref=mx_metadata', 'add', '-m', '{"ModelerVersion":"11.15.0","ModelChanges":[]}']);
      git(seed, ['push', '-q', bare, 'main', 'refs/notes/mx_metadata']);
    } finally {
      rmSync(seed, { recursive: true, force: true });
    }
    return id;
  };

  const send = (res: http.ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const fake: FakeTeamServer = {
    url: '',
    endpoints: { projectsApi: '', git: '', deployApi: '' },
    root,
    token,
    requests: [],
    steps: ['scheduled', 'running'],
    creates: [],
    environments: {},
    apps: {},
    makeApp,
    head: (projectId, ref = 'main') => git(path.join(root, `${projectId}.git`), ['rev-parse', ref]),
    close: () => new Promise((done) => server.close(() => (rmSync(root, { recursive: true, force: true }), done()))),
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    fake.requests.push({ method: req.method ?? 'GET', url: req.url ?? '', ...(req.headers.authorization ? { auth: req.headers.authorization } : {}) });
    const env = /^\/api\/v4\/apps\/([\w-]+)\/environments$/.exec(url.pathname);
    const appAt = /^[/]api[/]v4[/]apps[/]([0-9a-zA-Z_-]+)$/.exec(url.pathname);
    if (appAt) {
      if (req.headers.authorization !== `MxToken ${token}`) return send(res, 401, { error: { message: 'Unauthorized' } });
      const body = fake.apps[appAt[1]];
      return body === undefined ? send(res, 404, { error: { message: 'Not Found' } }) : send(res, 200, body);
    }
    if (env) {
      if (req.headers.authorization !== `MxToken ${token}`) return send(res, 401, { error: { message: 'Unauthorized' } });
      if (fake.envStatus) return send(res, fake.envStatus, { error: { message: 'refused' } });
      const body = fake.environments[env[1]];
      return body === undefined ? send(res, 404, { error: { message: 'Not Found' } }) : send(res, 200, body);
    }
    if (url.pathname.startsWith('/v2/')) {
      if (req.headers.authorization !== `MxToken ${token}`) return send(res, 401, { error: { message: 'Unauthorized', detail: 'Invalid access token', code: 401 } });
      if (req.method === 'POST' && url.pathname === '/v2/projects') {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          const body = JSON.parse(raw || '{}') as { name: string; summary?: string };
          fake.creates.push(body);
          if (fake.refuse) return send(res, fake.refuse.status, fake.refuse.body);
          const jobId = randomUUID();
          jobs.set(jobId, { looks: 0, name: body.name });
          send(res, 202, { jobId });
        });
        return;
      }
      const m = /^\/v2\/projects\/jobs\/([\w-]+)$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const job = jobs.get(m[1]);
        if (!job) return send(res, 404, { error: { message: 'Not Found', code: 404 } });
        const step = fake.steps[job.looks++];
        if (step) return send(res, 200, { status: step });
        if (fake.failJob) return send(res, 200, { status: 'failed', errorMessage: fake.failJob });
        job.projectId ??= makeApp();
        return send(res, 200, { status: 'completed', projectId: job.projectId });
      }
      return send(res, 404, { error: { message: 'Not Found' } });
    }
    // Team Server's git: Basic auth, user `pat` (lower case), the token as the password.
    const want = `Basic ${Buffer.from(`pat:${token}`).toString('base64')}`;
    if (req.headers.authorization !== want) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="Git Service"' });
      return res.end('Unauthorized');
    }
    const child = spawn(backend, [], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: decodeURIComponent(url.pathname),
        REQUEST_METHOD: req.method ?? 'GET',
        QUERY_STRING: url.search.replace(/^\?/, ''),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        ...(req.headers['content-encoding'] ? { HTTP_CONTENT_ENCODING: String(req.headers['content-encoding']) } : {}),
        ...(req.headers['git-protocol'] ? { GIT_PROTOCOL: String(req.headers['git-protocol']) } : {}),
        REMOTE_USER: 'pat',
        REMOTE_ADDR: '127.0.0.1',
      },
    });
    req.pipe(child.stdin);
    const out: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.on('close', () => {
      const all = Buffer.concat(out);
      const sep = all.indexOf('\r\n\r\n');
      const head = all.subarray(0, sep).toString('utf8');
      const headers: Record<string, string> = {};
      let status = 200;
      for (const line of head.split('\r\n')) {
        const i = line.indexOf(':');
        if (i < 0) continue;
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (/^status$/i.test(k)) status = Number(v.split(' ')[0]) || 200;
        else headers[k] = v;
      }
      res.writeHead(status, headers);
      res.end(all.subarray(sep + 4));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  fake.url = `http://127.0.0.1:${port}`;
  fake.endpoints = { projectsApi: `${fake.url}/v2`, git: fake.url, deployApi: `${fake.url}/api/v4` };
  return fake;
}
