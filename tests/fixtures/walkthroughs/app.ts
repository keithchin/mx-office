// A tiny stand-in for a Mendix live app, for the walkthrough tests: a sign-in page (#usernameInput,
// #passwordInput, #loginButton; optionally drawn late, as the Mendix client does) for the demo user, then a page with a navigation tree, a request list, a
// New request button and a form, marked up with the .mx-name-* classes a journey names. Neutral sample
// data only. It also asks for a picture from `other` (another origin) to prove the recorder refuses it.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const DEMO = { user: 'demo_test_user', password: 'Demo2025!' };

const FORM = `<form method="post" action="/login"><h2>Sample app</h2><input id="usernameInput" name="u" type="text" placeholder="User name"><input id="passwordInput" name="p" type="password" placeholder="Password"><button id="loginButton" type="submit">Sign in</button></form>`;
/** The sign-in page; with `lateMs` the form comes a moment after the page loads, as the Mendix client renders it. */
const login = (lateMs = 0) => `<!doctype html><html><head><title>Sign in</title><style>body{font-family:sans-serif;background:#eef2f7;display:flex;justify-content:center;padding-top:120px}form{background:#fff;padding:32px;border-radius:8px;display:grid;gap:12px;width:300px}</style></head><body>
${lateMs ? `<div id="boot">Loading…</div><script>setTimeout(() => { document.getElementById("boot").outerHTML = ${JSON.stringify(FORM)}; }, ${lateMs});</script>` : FORM}</body></html>`;

const page = (other: string) => `<!doctype html><html><head><title>Sample requests</title><style>
[hidden]{display:none!important}
body{margin:0;font-family:"Segoe UI",sans-serif;display:flex;height:100vh;background:#f5f7fa}
.mx-navigationtree{width:200px;background:#1e293b;padding:16px}.mx-navigationtree a{display:block;color:#e2e8f0;padding:8px;text-decoration:none}
.mx-page{flex:1;padding:32px}h1{margin-top:0}button{padding:8px 16px;font-size:15px;border-radius:6px;border:1px solid #2563eb;background:#2563eb;color:#fff;cursor:pointer}
.mx-name-dgRequests{background:#fff;border-radius:8px;padding:12px;margin:16px 0;min-height:60px}.row{padding:6px;border-bottom:1px solid #e5e7eb}
.mx-name-dvForm{background:#fff;border-radius:8px;padding:16px;margin-top:16px;display:grid;gap:10px;max-width:420px}.mx-name-tbTitle input{padding:8px;font-size:15px;width:100%}
</style></head><body>
<nav class="mx-navigationtree"><a href="#" title="Home">Home</a><a href="#" title="Requests" id="navRequests">Requests</a></nav>
<div class="mx-page"><h1 id="heading">Welcome</h1>
<div id="list" hidden><div class="mx-name-dgRequests"><div class="row">Sample request A</div><div class="row">Sample request B</div></div>
<button class="mx-name-btnNew">New request</button></div>
<div class="mx-name-dvForm" hidden><div class="mx-name-tbTitle"><input placeholder="Title"></div><button class="mx-name-btnSubmit">Submit</button></div>
<img src="${other}/tracker.png" width="1" height="1" alt="">
</div>
<script>
const $ = (s) => document.querySelector(s);
$('#navRequests').onclick = (e) => { e.preventDefault(); $('#heading').textContent = 'Requests'; $('#list').hidden = false; };
$('.mx-name-btnNew').onclick = () => { $('.mx-name-dvForm').hidden = false; };
$('.mx-name-btnSubmit').onclick = () => {
  const t = $('.mx-name-tbTitle input').value;
  const r = document.createElement('div'); r.className = 'row'; r.textContent = t; $('.mx-name-dgRequests').prepend(r);
  $('.mx-name-dvForm').hidden = true; $('#heading').textContent = 'Request submitted';
};
</script></body></html>`;

export interface FakeApp {
  url: string;
  close(): Promise<void>;
  /** Requests the other origin got (should stay 0). */
  otherHits(): number;
}

export async function fakeApp(o: { lateFormMs?: number } = {}): Promise<FakeApp> {
  let hits = 0;
  const other = http.createServer((_req, res) => {
    hits++;
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end();
  });
  await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
  const otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
  const server = http.createServer((req, res) => {
    const signedIn = /(?:^|;\s*)sess=ok/.test(req.headers.cookie ?? '');
    if (req.method === 'POST' && req.url === '/login') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const q = new URLSearchParams(body);
        const ok = q.get('u') === DEMO.user && q.get('p') === DEMO.password;
        res.writeHead(302, { location: ok ? '/' : '/login.html', ...(ok ? { 'set-cookie': 'sess=ok; Path=/; HttpOnly' } : {}) });
        res.end();
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(signedIn && req.url !== '/login.html' ? page(otherUrl) : login(o.lateFormMs));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    otherHits: () => hits,
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
