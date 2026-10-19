// A tiny stand-in for a Mendix live app, for the walkthrough tests: a sign-in page (#usernameInput,
// #passwordInput, #loginButton; optionally drawn late, as the Mendix client does) for the demo user, then a page with a navigation tree, a request list, a
// New request button and a form, marked up with the .mx-name-* classes a journey names. Neutral sample
// data only. It also asks for a picture from `other` (another origin) to prove the recorder refuses it.
// Like an unlicensed Mendix runtime it keeps sessions, at most `cap` at once (anonymous ones too: with
// `guest` access every page load without a session opens one): a sign-in over the cap gets the Mendix
// client's error dialog, and the client's `logout` xas action (with the session's CSRF token, which the
// page exposes as mx.session.sessionData.csrftoken) ends one. It counts sign-ins, logouts and sessions.
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const DEMO = { user: 'demo_test_user', password: 'Demo2025!' };

const FORM = `<form method="post" action="/login"><h2>Sample app</h2><input id="usernameInput" name="u" type="text" placeholder="User name"><input id="passwordInput" name="p" type="password" placeholder="Password"><button id="loginButton" type="submit">Sign in</button></form>`;
/** The sign-in page; with `lateMs` the form comes a moment after the page loads, as the Mendix client renders it. */
const login = (lateMs = 0) => `<!doctype html><html><head><title>Sign in</title><style>body{font-family:sans-serif;background:#eef2f7;display:flex;justify-content:center;padding-top:120px}form{background:#fff;padding:32px;border-radius:8px;display:grid;gap:12px;width:300px}</style></head><body>
${lateMs ? `<div id="boot">Loading…</div><script>setTimeout(() => { document.getElementById("boot").outerHTML = ${JSON.stringify(FORM)}; }, ${lateMs});</script>` : FORM}</body></html>`;

const page = (other: string, token: string, saved: string[] = []) => `<!doctype html><html><head><title>Sample requests</title><style>
[hidden]{display:none!important}
body{margin:0;font-family:"Segoe UI",sans-serif;display:flex;height:100vh;background:#f5f7fa}
.mx-navigationtree{width:200px;background:#1e293b;padding:16px}.mx-navigationtree a{display:block;color:#e2e8f0;padding:8px;text-decoration:none}
.mx-page{flex:1;padding:32px}h1{margin-top:0}button{padding:8px 16px;font-size:15px;border-radius:6px;border:1px solid #2563eb;background:#2563eb;color:#fff;cursor:pointer}
.mx-name-dgRequests{background:#fff;border-radius:8px;padding:12px;margin:16px 0;min-height:60px}.row{padding:6px;border-bottom:1px solid #e5e7eb}
.mx-name-dvForm{background:#fff;border-radius:8px;padding:16px;margin-top:16px;display:grid;gap:10px;max-width:420px}.mx-name-tbTitle input{padding:8px;font-size:15px;width:100%}
</style></head><body>
<nav class="mx-navigationtree"><a href="#" title="Home">Home</a><a href="#" title="Requests" id="navRequests">Requests</a></nav>
<div class="mx-page"><h1 id="heading">Welcome</h1>
<div id="list" hidden><div class="mx-name-dgRequests">${saved.map((t) => `<div class="row">${t}</div>`).join('')}<div class="row">Sample request A</div><div class="row">Sample request B</div></div>
<button class="mx-name-btnNew">New request</button></div>
<div class="mx-name-dvForm" hidden><div class="mx-name-tbTitle"><input placeholder="Title"></div><button class="mx-name-btnSubmit">Submit</button></div>
<img src="${other}/tracker.png" width="1" height="1" alt="">
</div>
<script>
window.mx = { session: { sessionData: { csrftoken: ${JSON.stringify(token)} } } };
const $ = (s) => document.querySelector(s);
$('#navRequests').onclick = (e) => { e.preventDefault(); $('#heading').textContent = 'Requests'; $('#list').hidden = false; };
$('.mx-name-btnNew').onclick = () => { $('.mx-name-dvForm').hidden = false; };
$('.mx-name-btnSubmit').onclick = () => {
  const t = $('.mx-name-tbTitle input').value;
  fetch('/api/submit', { method: 'POST', body: t });
  const r = document.createElement('div'); r.className = 'row'; r.textContent = t; $('.mx-name-dgRequests').prepend(r);
  $('.mx-name-dvForm').hidden = true; $('#heading').textContent = 'Request submitted';
};
</script></body></html>`;

/** What the Mendix client shows when the runtime refuses a session (HTTP 402). */
export const CAP_TEXT = 'The current license does not allow more users to sign in.';
const refused = () => `<!doctype html><html><head><title>Sample app</title></head><body><div class="modal-dialog mx-dialog-error mx-dialog" role="dialog"><div class="modal-header mx-dialog-header"><h4 class="mx-dialog-caption">Error</h4></div><div class="modal-body mx-dialog-body"><p>${CAP_TEXT}</p></div><div class="mx-dialog-footer"><button>OK</button></div></div></body></html>`;

export interface FakeApp {
  url: string;
  close(): Promise<void>;
  /** Requests the other origin got (should stay 0). */
  otherHits(): number;
  /** Each sign-in that got a session: who. */
  signIns(): string[];
  /** Each session signed out: who ('' for an anonymous one). */
  logouts(): string[];
  /** Sessions open now. */
  open(): number;
  /** How many anonymous sessions were ever opened. */
  anonymous(): number;
  /** Sessions refused over the cap. */
  refusals(): number;
  /** What was submitted on the current "database" (newest first). */
  saved(): string[];
  /** A fresh database: nothing submitted (sessions are left alone: the tests hold some on purpose). */
  reset(): void;
  /** Opens `n` sessions somewhere else (other windows of the app). */
  hold(n: number): void;
}

export interface FakeAppOptions {
  lateFormMs?: number;
  /** The most sessions at once (an unlicensed Mendix runtime: 6). */
  cap?: number;
  /** Guest access: the app's address shows the app to anyone, opening an anonymous session; the sign-in page is /login.html. */
  guest?: boolean;
  /** Sign in as Mendix's login.html does (a refused session only says "Sign in failed."), with the runtime's line in this log. */
  runtimeLog?: string;
}

export async function fakeApp(o: FakeAppOptions = {}): Promise<FakeApp> {
  let hits = 0;
  const cap = o.cap ?? Infinity;
  const sessions = new Map<string, { user: string | null; token: string }>();
  const ins: string[] = [];
  const outs: string[] = [];
  let anon = 0;
  const saved: string[] = [];
  let refusals = 0;
  const id = () => randomBytes(8).toString('hex');
  /** A new session, or undefined over the cap. */
  const open = (user: string | null) => {
    if (sessions.size >= cap) {
      refusals++;
      return undefined;
    }
    const sid = id();
    sessions.set(sid, { user, token: id() });
    if (user) ins.push(user);
    else anon++;
    return sid;
  };
  const other = http.createServer((_req, res) => {
    hits++;
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end();
  });
  await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
  const otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
  const server = http.createServer((req, res) => {
    const sid = /(?:^|;\s*)sess=([0-9a-f]+)/.exec(req.headers.cookie ?? '')?.[1];
    const mine = sid ? sessions.get(sid) : undefined;
    const body = (then: (b: string) => void) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => then(b));
    };
    const html = (t: string, status = 200, cookie?: string) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...(cookie ? { 'set-cookie': cookie } : {}) });
      res.end(t);
    };
    if (req.method === 'POST' && req.url === '/login') {
      body((b) => {
        const q = new URLSearchParams(b);
        if (q.get('u') !== DEMO.user || q.get('p') !== DEMO.password) {
          res.writeHead(302, { location: '/login.html' });
          return res.end();
        }
        // Signing in from an anonymous session replaces it, as the runtime does.
        if (sid && mine && !mine.user) sessions.delete(sid);
        const made = open(DEMO.user);
        if (!made && o.runtimeLog) {
          appendFileSync(o.runtimeLog, `2026-10-18 21:57:08.295 WARNING - Core: Maximum number of sessions exceeded! (You are currently using a trial license)\n`);
          return html(login(0).replace('</form>', '<p id="loginMessage">Sign in failed.</p></form>'), 200);
        }
        if (!made) return html(refused(), 402);
        res.writeHead(302, { location: '/', 'set-cookie': `sess=${made}; Path=/; HttpOnly` });
        res.end();
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/xas/') {
      body((b) => {
        let action = '';
        try {
          action = (JSON.parse(b) as { action?: string }).action ?? '';
        } catch {
          action = '';
        }
        if (action !== 'logout' || !sid || !mine || req.headers['x-csrf-token'] !== mine.token) {
          res.writeHead(403);
          return res.end();
        }
        sessions.delete(sid);
        outs.push(mine.user ?? '');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
      return;
    }
    if (req.url === '/login.html') return html(login(o.lateFormMs));
    if (req.method === 'POST' && req.url === '/api/submit') {
      // The app's "database": what was submitted stays until reset() (a fresh database).
      body((b) => {
        if (mine) saved.unshift(b.slice(0, 80));
        res.writeHead(mine ? 200 : 403);
        res.end();
      });
      return;
    }
    if (mine) return html(page(otherUrl, mine.token, saved));
    if (!o.guest) return html(login(o.lateFormMs));
    // Guest access: the app, for an anonymous session the page load opens (or the refusal over the cap).
    const made = open(null);
    if (!made) return html(refused(), 402);
    html(page(otherUrl, sessions.get(made)!.token), 200, `sess=${made}; Path=/; HttpOnly`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    otherHits: () => hits,
    signIns: () => [...ins],
    logouts: () => [...outs],
    open: () => sessions.size,
    anonymous: () => anon,
    refusals: () => refusals,
    saved: () => [...saved],
    reset: () => {
      saved.length = 0;
    },
    hold: (n) => {
      for (let k = 0; k < n; k++) sessions.set(id(), { user: 'someone_else', token: id() });
    },
    close: async () => {
      server.closeAllConnections();
      other.closeAllConnections();
      await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => other.close(r))]);
    },
  };
}

/** The journey the fake app passes, in the toolkit's journey-runner shape. */
export const PASSING = {
  id: 'new-request',
  title: 'Submit a new request',
  persona: 'demo_test_user',
  requirement: ['UC-01', 'build-plan row 2'],
  seeds: [{ name: 'title', value: 'Sample request C' }],
  steps: [
    { name: 'Open the request list', actions: [{ do: 'nav', item: 'Requests' }], ui: { ready: '.mx-name-dgRequests', checks: ['btnNew'] } },
    { name: 'Start a new request', actions: [{ do: 'click', widget: 'btnNew', label: 'New request' }], ui: { checks: ['tbTitle', 'btnSubmit'] } },
    { name: 'Give it a title', actions: [{ do: 'fill', widget: 'tbTitle', value: '{{title}}', label: 'Title' }] },
    { name: 'Submit the request', actions: [{ do: 'click', widget: 'btnSubmit', label: 'Submit' }], ui: { textPresent: ['Request submitted', '{{title}}'] } },
  ],
};

/** One whose second step can't be done: the button isn't there. */
export const FAILING = {
  id: 'approve-request',
  title: 'Approve a request',
  $comment: ['Approve the first request.', 'START STATE: run directly after new-request (its request is the one approved).'],
  requirement: ['UC-02'],
  steps: [
    { name: 'Open the request list', actions: [{ do: 'nav', item: 'Requests' }], ui: { ready: '.mx-name-dgRequests' } },
    { name: 'Approve the first request', actions: [{ do: 'click', widget: 'btnApprove', label: 'Approve' }] },
    { name: 'See it approved', ui: { textPresent: ['Approved'] } },
  ],
};
