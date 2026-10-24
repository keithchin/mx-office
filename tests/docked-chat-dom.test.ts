// The Developer view's docked coordinator chat in headless Chromium: the real team-lead panel (ui/lead-panel/), the
// real workspace (shell, explorer with its fake server, canvas) and a test source, with the app stopped:
//   - the layout: explorer | canvas (Model preview of the app's first page by default) | the chat docked right,
//     collapsible to a rail; the page makes room for it; Live preview says "not running" and needs nothing
//   - the same conversation as on Project Management's pages: the one panel, its messages, before and after
//   - chips: opening a page in the explorer, and picking a widget with Select element, put a chip in the composer;
//     ✕ removes it, "+ Context" puts it back
//   - Request a change (the default with a chip) makes a DC through the one intake with the element reference, the
//     revision viewed and an idempotency key (the same key on a retry); the lead gets a note when it queues; Ask
//     sends a message to the lead with the context said and makes no DC
//   - each change's receipt follows the record's state; the project's pause is said with who and when; Cancel
//   - a decision answered inline through the shared answer path, a 409 said; Please try this: Looks right kept for
//     the version tried, Something's wrong sent as a correction
//   - the explorer's and the preview's "Request a change" open the composer with the chip, never the old dialog
//   - no lead at work: the chat still takes requests (they queue); the phone: the chat is a bottom sheet
// DK_SHOTS=<dir> saves Light, Dark and phone screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Frame, type Page } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import { A, FAKES } from './fixtures/dev-view-fakes.js';
import { CHANGE_TONE, changeFour } from '../src/shared/dev-changes.js';

const root = path.join(import.meta.dirname, '..');
const shots = process.env.DK_SHOTS;
const chrome = findChrome();
const now = Date.now();
const M = 'c0ffee1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const S = 'feed5e1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const stopped = { floor: 'f1', status: 'stopped', phase: 'stopped', log: [], available: true, started: true, branch: 'main', lastServed: { sha: A, subject: 'Host approval', builtAt: now - 9e6, until: now - 8e6 } };
const running = { floor: 'f1', status: 'running', phase: 'running', log: [], available: true, started: true, branch: 'main', appPort: 8123, since: now - 6e5, served: { sha: S, subject: 'Visitor list', builtAt: now - 5e5 } };
/** A change as GET /api/dev-changes gives it, with its four facts worked out the way the server does. */
const change = (o: Record<string, unknown>) => {
  const c = change0(o) as Record<string, any>;
  c.facts = changeFour({ state: c.state, words: c.words, tone: CHANGE_TONE[c.state as keyof typeof CHANGE_TONE], ...(c.revision ? { revision: c.revision, ...(c.state === 'implemented' ? { merged: c.revision } : {}) } : {}), ...(o.preview ? { preview: o.preview as { running: boolean; served?: string } } : {}), ...(o.inServed !== undefined ? { inServed: o.inServed as boolean } : {}), ...(o.held ? { held: o.held as { env: string; reason: string; findings: number } } : {}), ...(c.reviews ? { reviews: c.reviews } : {}) });
  return c;
};
const change0 = (o: Record<string, unknown>) => ({ text: 'Show the host’s name next to each visitor.\n\nAbout: Today’s visitors (page VisitorDesk.Visitor_Overview)', by: 'Alex Lee', owner: 'u1', at: now - 900_000, source: { sha: A, kind: 'viewed' }, ref: { docType: 'page', docQn: 'VisitorDesk.Visitor_Overview', label: 'Today’s visitors' }, candidates: [], branch: 'dev/DC-5', mayCancel: false, via: 'chat', ...o });
const DEV = (changes: unknown[], o: Record<string, unknown> = {}) => ({ floor: 'f1', changes, strip: { main: A, preview: { status: 'off', lastServed: A } }, current: null, ...o });
const DATA = {
  floor: 'f1',
  project: 'Visitor Registration',
  live: stopped,
  business: { state: 'in-progress', label: 'Being built', about: 'all', revision: A, revisionKind: 'main', tone: 'busy', notes: [], missing: [], line: '' },
  milestones: [],
  decisions: [],
  others: 0,
  changes: [],
  admin: true,
  dev: DEV([]),
};

async function harness(): Promise<{ js: string; css: string }> {
  const out = await build({
    stdin: {
      contents: `import '../../lite.css';
        import '../../styles/themes.css';
        import '../../styles/theme-clean.css';
        import '../../styles/theme-portal.css';
        import { store } from '../../state';
        import { setRoster } from '../teams/world';
        import { leadPanel } from '../lead-panel';
        import { panelDock } from '../lead-panel/dock';
        import { createWorkspace } from './shell';
        ${FAKES}
        window.__sent = []; window.__asked = []; window.__answers = []; window.__marks = []; window.__opened = [];
        window.__answerWith = { ok: true }; window.__requestWith = undefined; window.__markWith = undefined;
        const M = (role, o) => ({ role, title: role === 'pm' ? 'Project Coordinator' : 'Lead Developer', team: 'management', icon: '🧭', name: role === 'pm' ? 'Ada' : 'Bo', model: 'sonnet', status: 'idle', workerId: 'w-' + role, ...o });
        window.__roster = (pm) => setRoster({ floor: 'f1', shape: 'enterprise', coverage: { management: 'pm', analysis: 'pm' }, admin: true, members: [M('pm', pm), M('lead-developer')], escalations: [], approvals: [], proposals: [], standups: [], settings: {} });
        store.floor = 'f1';
        store.me = { ...store.me, account: { id: 'u1', name: 'Alex Lee' }, admin: true };
        store.workers.set('w-pm', { id: 'w-pm', name: 'Ada', status: 'idle', color: '#0f766e', cols: 80, rows: 24, floor: 'f1' });
        store.convo.set('w-pm', { available: true, messages: [
          { id: 'm1', kind: 'user', text: 'Morning: how far is the visitor list?', at: ${now - 3_600_000} },
          { id: 'm2', kind: 'agent', text: 'The visitor list is built; Bo is on the host approval next.', at: ${now - 3_500_000} },
          { id: 'm3', kind: 'agent', text: 'Host approval merged into main.', at: ${now - 60_000} },
        ] });
        window.__roster({});
        const net = { send: (m) => window.__sent.push(m) };
        leadPanel({ net, openWorker() {}, show: (t) => window.__opened.push('pm:' + t) });
        let data = {};
        const fns = new Set();
        const ws = createWorkspace({
          source: {
            get: () => data, on: (fn) => (fns.add(fn), () => fns.delete(fn)), wake() {},
            request: async (a) => (window.__asked.push(a), window.__requestWith ?? { ok: true, again: false, change: { id: 'DC-7', by: 'Alex Lee', queue: 'queued', text: a.text } }),
            answer: async (x, a) => (window.__answers.push({ id: x.id, escalation: x.escalation, ...a }), window.__answerWith),
            mark: async (m) => (window.__marks.push(m), window.__markWith ?? { ok: true, finding: { id: 'GV-1', ...(m.verdict === 'wrong' ? { correction: { id: 'DC-8' } } : {}) } }),
            want() {},
          },
          open: (t) => window.__opened.push(t),
          explorer: window.__explorer,
        });
        document.querySelector('.lite-main').append(ws.el);
        window.__ws = ws;
        window.__dock = () => !!panelDock();
        window.__set = (d) => { data = { ...d, decisions: (d.decisions || []).map((x) => ({ ...x, answer: () => window.__opened.push('answer:' + x.id) })) }; fns.forEach((fn) => fn()); };`,
      resolveDir: path.join(root, 'src/client/ui/app-workspace'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'iife',
    loader: { '.css': 'css', '.png': 'empty', '.svg': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
    logLevel: 'silent',
  });
  return { js: out.outputFiles.find((f) => f.path.endsWith('.js'))!.text, css: out.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '' };
}

async function open(page: Page, h: { js: string; css: string }, theme: string, posts: { url: string; body: string }[], app: string[]) {
  await page.route('**/*', (r) => {
    const req = r.request();
    const u = req.url();
    if (u.startsWith('http://127.0.0.1:8123/')) return app.push(u), r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>app</h1>' });
    if (u.startsWith('http://office.test/lite')) return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>office</title>' });
    if (req.method() === 'POST') posts.push({ url: new URL(u).pathname, body: req.postData() ?? '' });
    if (u.includes('/api/dev-changes/cancel')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ change: { id: 'DC-5', queue: 'cancelled' } }) });
    if (u.includes('/api/roster')) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://office.test/lite');
  await page.setContent(`<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${h.css}</style></head><body class="lite pt-has-nav"><header class="lite-bar" style="height:45px"></header><main class="lite-main"></main><div id="modal-root"></div><div id="toasts"></div></body></html>`);
  await page.addScriptTag({ content: h.js });
}

type W = Record<string, unknown> & { __set(d: unknown): void; __ws: { show(): void; hide(): void; view(): string }; __roster(o: unknown): void; __dock(): boolean };
const set = (page: Page, d: object) => page.evaluate((x) => (window as unknown as W).__set(x), d as Record<string, unknown>);
const get = <T>(page: Page, k: string) => page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], k) as Promise<T>;
const text = (page: Page, sel: string) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const box = (page: Page, sel: string) => page.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().toJSON() as DOMRect | undefined, sel);
const shot = async (page: Page, name: string) => {
  if (shots) await page.waitForTimeout(300), await page.screenshot({ path: path.join(shots, name) });
};
async function preview(page: Page): Promise<Frame> {
  for (let i = 0; i < 60; i++) {
    const handle = await page.$('.ax-pane:not([hidden]) .pgp-frame');
    const fr = handle ? await handle.contentFrame() : null;
    if (fr && (await fr.$('[data-mx-el]').catch(() => null))) return fr;
    await page.waitForTimeout(50);
  }
  throw new Error('no preview frame');
}
async function send(page: Page, words: string) {
  await page.fill('#lead-panel .lp-box', words);
  await page.press('#lead-panel .lp-box', 'Enter');
  await page.waitForTimeout(150);
}

test('in a browser, the app stopped: the docked chat, chips, a change made through the one intake, receipts, cards and the old buttons', { skip: chrome ? false : 'no Chromium here', timeout: 180_000 }, async () => {
  const h = await harness();
  const browser = await chromium.launch({ headless: true, executablePath: chrome!, args: ['--headless=new'] });
  try {
    for (const theme of ['portal-light', 'portal-dark']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const posts: { url: string; body: string }[] = [];
      const app: string[] = [];
      await open(page, h, theme, posts, app);
      await set(page, DATA);

      // On a Project Management page: the panel, its conversation; no dock.
      assert.match((await text(page, '#lead-panel')) ?? '', /The visitor list is built/);
      assert.equal(await page.evaluate(() => (window as unknown as W).__dock()), false);
      const panelBefore = await page.evaluate(() => ((window as unknown as Record<string, unknown>).__panelEl = document.querySelector('#lead-panel')) !== null);
      assert.ok(panelBefore);

      // The Developer view: explorer | canvas | the chat docked right; the page makes room for it.
      await page.evaluate(() => (window as unknown as W).__ws.show());
      await page.waitForSelector('.ax-pane:not([hidden]) .pgp-frame');
      assert.equal(await page.evaluate(() => (window as unknown as W).__dock()), true);
      assert.equal(await page.evaluate(() => document.querySelector('#lead-panel') === (window as unknown as Record<string, unknown>).__panelEl), true, 'the same panel');
      const lp = (await box(page, '#lead-panel'))!;
      const main = (await box(page, '.aw-main'))!;
      const side = (await box(page, '.ax-side'))!;
      assert.ok(lp.width >= 380 && Math.abs(lp.right - 1440) < 2, `docked right (${lp.left}–${lp.right})`);
      assert.ok(main.right <= lp.left + 1 && main.left >= side.right - 1, `explorer | canvas | chat (${side.right} ${main.left}–${main.right} ${lp.left})`);
      assert.match((await text(page, '#lead-panel .pmc-chat-list')) ?? '', /The visitor list is built/, 'the same conversation');
      assert.equal(await page.locator('.aw-side, [data-part="status"], .aw-tab[data-section]').count(), 0, 'no status panel, no section tabs');
      // The header: the business status, the revisions, this session's changes.
      assert.match((await text(page, '#lead-panel .dk-head')) ?? '', /Being built[\s\S]*main @7d3f0b1[\s\S]*preview: not running[\s\S]*No changes this session/);
      // The default canvas is the Model preview of the app's first page (with an address); Live preview says not running.
      assert.equal(await page.evaluate(() => (window as unknown as W).__ws.view()), 'model');
      assert.match((await text(page, '.ax-pane:not([hidden]) .ax-pane-title')) ?? '', /Today’s visitors/);
      assert.match((await text(page, '.aw-tab[data-view="live"]')) ?? '', /not running/);
      // The first page opened is a chip already.
      assert.equal(await text(page, '#lead-panel .lp-ctx-chip .lp-ctx-t'), 'Today’s visitors');
      assert.equal(await page.getAttribute('#lead-panel .lp-mode[data-mode="change"]', 'aria-checked'), 'true', 'Request a change is the default with a chip');
      if (theme === 'portal-light') await shot(page, '01-docked-model-preview-light.png');

      // A widget picked with Select element: its chip.
      await page.click('.ax-pane:not([hidden]) .pgp-pick');
      const fr = await preview(page);
      await fr.click('[data-mx-w="btnSave"]');
      await page.waitForFunction(() => /›/.test(document.querySelector('#lead-panel .lp-ctx-chip')?.textContent ?? ''));
      assert.match((await text(page, '#lead-panel .lp-ctx-chip')) ?? '', /Today’s visitors › Save button/);

      // ✕ removes it, + Context puts it back.
      await page.click('#lead-panel .lp-ctx-x');
      assert.equal(await page.locator('#lead-panel .lp-ctx-chip').count(), 0);
      assert.equal(await page.getAttribute('#lead-panel .lp-mode[data-mode="ask"]', 'aria-checked'), 'true', 'Ask again without a chip');
      await page.click('#lead-panel .lp-ctx-add');
      assert.match((await text(page, '#lead-panel .lp-ctx-chip')) ?? '', /Save button/);

      // Request a change: one DC through the intake, with the element, the revision viewed and a key; a failure keeps the key.
      await page.evaluate(() => ((window as unknown as Record<string, unknown>).__requestWith = { ok: false, error: 'The office couldn’t be reached.' }));
      await send(page, 'Make the Save button say Sign in');
      await page.evaluate(() => ((window as unknown as Record<string, unknown>).__requestWith = undefined));
      await page.press('#lead-panel .lp-box', 'Enter');
      await page.waitForTimeout(200);
      const asked = await get<{ text: string; ref?: { docQn: string; widgetName?: string; id?: string }; source?: string; key?: string; via?: string }[]>(page, '__asked');
      assert.equal(asked.length, 2);
      assert.equal(asked[0].key, asked[1].key, 'a retry sends the same key');
      assert.deepEqual([asked[1].ref?.docQn, asked[1].ref?.widgetName, asked[1].source, asked[1].via], ['VisitorDesk.Visitor_Overview', 'btnSave', A, 'chat']);
      assert.match(asked[1].text, /^Make the Save button say Sign in\n\nAbout: Today’s visitors › Save button/);
      assert.equal(await page.inputValue('#lead-panel .lp-box'), '', 'the box clears once it went');
      // It queued: the lead gets a note after its turn, so it knows (not a second task).
      const tell = posts.find((p) => p.url.startsWith('/api/roster') && p.body.includes('DC-7'));
      assert.ok(tell && /"when":"after"/.test(tell.body) && /queued/.test(tell.body), `a note to the lead: ${JSON.stringify(posts)}`);
      assert.equal((await get<{ t: string }[]>(page, '__sent')).filter((m) => m.t === 'worker.prompt').length, 0, 'a change is no prompt');

      // Ask: a message to the lead with the context said first; no DC.
      await page.click('#lead-panel .lp-mode[data-mode="ask"]');
      await send(page, 'Which pages use this button?');
      const prompt = (await get<{ t: string; prompt?: string }[]>(page, '__sent')).find((m) => m.t === 'worker.prompt');
      assert.match(prompt?.prompt ?? '', /^About: Today’s visitors › Save button \(widget btnSave on page VisitorDesk\.Visitor_Overview\) at revision @7d3f0b1[\s\S]*Which pages use this button\?$/);
      assert.equal((await get<unknown[]>(page, '__asked')).length, 2, 'Ask made no change');

      // Receipts follow the record: queued (paused, with who and when), then on a candidate, then in preview with Please try this.
      const queued = change({ id: 'DC-5', queue: 'queued', state: 'queued', words: 'Queued', detail: 'The project is paused: it starts when the project is resumed.', position: 1, mayCancel: true });
      await set(page, { ...DATA, dev: DEV([queued], { pause: { by: 'Keith', at: now - 1_200_000, why: 'person' } }) });
      await page.waitForSelector('#lead-panel .dk-asked[data-change="DC-5"]');
      assert.match((await text(page, '#lead-panel .dk-asked[data-change="DC-5"] .dk-receipt')) ?? '', /→ DC-5 · Queued[\s\S]*Project paused by Keith/);
      assert.match((await text(page, '#lead-panel .dk-pause')) ?? '', /Project paused by Keith[\s\S]*▶ Resume/);
      assert.match((await text(page, '#lead-panel .dk-head')) ?? '', /1 change this session[\s\S]*1 queued/);
      assert.equal(await text(page, '#lead-panel .dk-asked[data-change="DC-5"] .pmc-text'), 'Show the host’s name next to each visitor.', 'the person’s words, without the added context line');
      if (theme === 'portal-light') await shot(page, '02-receipt-paused-light.png');
      // Cancel from the receipt (a second click confirms).
      await page.click('#lead-panel .dk-receipt [data-cancel="DC-5"]');
      await page.click('#lead-panel .dk-receipt [data-cancel="DC-5"]');
      await page.waitForTimeout(150);
      assert.ok(posts.some((p) => p.url === '/api/dev-changes/cancel' && p.body.includes('DC-5')), 'cancelled through the record');
      const onCand = change({ id: 'DC-5', queue: 'active', state: 'candidate', words: 'Working · candidate', revision: M, detail: `Candidate @c0ffee1 on dev/DC-5. Not merged: the live preview runs main, not this.`, candidates: [{ sha: M, via: 'branch', branch: 'dev/DC-5', seenAt: now - 300_000 }] });
      await set(page, { ...DATA, dev: DEV([onCand]) });
      await page.waitForFunction(() => /Working · candidate @c0ffee1/.test(document.querySelector('#lead-panel .dk-asked[data-change="DC-5"]')?.textContent ?? ''));
      assert.equal(await page.locator('#lead-panel .dk-try').count(), 0, 'no try card before it’s in the preview');
      assert.deepEqual(app, [], 'nothing so far needed the live app');

      // In preview (the app running now): Please try this; Looks right is kept for the version served.
      const inPrev = change({ id: 'DC-5', queue: 'settled', state: 'implemented', words: 'Implemented', revision: M, preview: { running: true, served: S }, inServed: true, detail: 'Merged into main @c0ffee1. Merged isn’t tried or reviewed: the preview and your review are facts of their own.', settled: { at: now - 120_000, why: 'merged' }, candidates: [{ sha: M, via: 'branch', branch: 'dev/DC-5', seenAt: now - 300_000 }] });
      await set(page, { ...DATA, live: running, appUrl: 'http://127.0.0.1:8123/', onScreen: S, dev: DEV([inPrev]) });
      await page.waitForSelector('#lead-panel .dk-try[data-change="DC-5"]');
      assert.match((await text(page, '#lead-panel .dk-try')) ?? '', /Please try this · DC-5[\s\S]*Try it: Show the host’s name next to each visitor\.[\s\S]*version feed5e1/);
      await page.click('#lead-panel .dk-try .dk-looks');
      await page.waitForTimeout(100);
      await page.click('#lead-panel .dk-try .dk-wrongbtn');
      await page.fill('#lead-panel .dk-try .dk-wrongtext', 'The host name is cut off on small screens');
      await page.click('#lead-panel .dk-try .dk-wrongsend');
      await page.waitForTimeout(100);
      const marks = await get<{ change?: string; verdict: string; revision: string; note?: string; scenario?: string }[]>(page, '__marks');
      assert.deepEqual(marks.map((m) => [m.change, m.verdict, m.revision, m.scenario]), [['DC-5', 'works', S, undefined], ['DC-5', 'wrong', S, undefined]]);
      assert.equal(marks[1].note, 'The host name is cut off on small screens');
      // A review kept for this version shows on the card; never "accepted".
      await set(page, { ...DATA, live: running, appUrl: 'http://127.0.0.1:8123/', onScreen: S, dev: DEV([change({ id: 'DC-5', queue: 'settled', state: 'implemented', words: 'Implemented', revision: M, preview: { running: true, served: S }, inServed: true, detail: 'x', settled: { at: now - 120_000, why: 'merged' }, candidates: [{ sha: M, via: 'branch', branch: 'dev/DC-5', seenAt: now - 300_000 }], reviews: [{ id: 'GV-1', verdict: 'works', revision: S, by: 'Alex Lee', at: now - 5_000 }] })]) });
      await page.waitForFunction(() => /Looks right · kept for version feed5e1/.test(document.querySelector('#lead-panel .dk-try')?.textContent ?? ''));
      assert.doesNotMatch((await text(page, '#lead-panel .dk-try')) ?? '', /accepted/i);
      if (theme === 'portal-dark') await shot(page, '03-try-card-dark.png');

      // A decision inline, answered through the shared path; a stale one's 409 said plainly.
      const decision = { id: 'esc:e1', escalation: 'e1', others: [], question: 'Can a host approve an early arrival?', owner: 'Ada', level: 'block', since: now - 600_000, options: ['Host approves from the list', 'Visitor waits'], recommendation: 'Host approves from the list' };
      await set(page, { ...DATA, decisions: [decision] });
      await page.waitForSelector('#lead-panel .dk-dec[data-decision="esc:e1"]');
      assert.match((await text(page, '#lead-panel .dk-dec')) ?? '', /Decision needed[\s\S]*early arrival[\s\S]*Also listed in Project Management › Approvals/);
      await page.click('#lead-panel .dk-dec .aw-opt:nth-child(2)');
      await page.evaluate(() => ((window as unknown as Record<string, unknown>).__answerWith = { ok: false, status: 409, error: 'stale', current: { state: 'answered', open: 'Answered meanwhile by Bo: host approves.' } }));
      await page.click('#lead-panel .dk-dec .aw-send');
      await page.waitForSelector('#lead-panel [data-note="stale"]');
      assert.match((await text(page, '#lead-panel [data-note="stale"]')) ?? '', /changed since you opened it[\s\S]*Answered meanwhile by Bo/);
      assert.deepEqual((await get<{ escalation: string; text: string }[]>(page, '__answers')).map((a) => [a.escalation, a.text]), [['e1', 'Go with: Visitor waits']]);
      if (theme === 'portal-light') await shot(page, '04-decision-light.png');

      // The old buttons: the explorer's and the preview's Request a change focus the composer with the chip, no dialog.
      await set(page, DATA);
      await page.click('.aw-tab[data-view="model"]');
      await page.click('#lead-panel .lp-ctx-x').catch(() => undefined);
      await page.click('.ax-pane:not([hidden]) .ax-pick-ask');
      assert.equal(await page.locator('.aw-reqdlg').count(), 0, 'no dialog');
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('lp-box')), true, 'the composer is focused');
      assert.match((await text(page, '#lead-panel .lp-ctx-chip')) ?? '', /Today’s visitors/);
      await page.locator('.ax-tree [role="treeitem"]', { has: page.locator('.ax-label:text-is("Visitor save")') }).count();
      await page.click('.ax-bar .ax-ask');
      assert.equal(await page.locator('.aw-reqdlg').count(), 0, 'no dialog from the explorer either');
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('lp-box')), true);

      // Collapse to the rail: the page gets the room back; open again.
      await page.click('#lead-panel .lp-collapse');
      // The page's margin follows the panel with a transition: wait for it to settle, not a fixed time (slow under load).
      await page.waitForFunction(() => (document.querySelector('.aw-main')?.getBoundingClientRect().right ?? 0) > 1300, null, { timeout: 5000 }).catch(() => {});
      assert.equal(await page.evaluate(() => document.body.classList.contains('lp-collapsed')), true);
      assert.ok(((await box(page, '.lp-rail'))?.width ?? 0) > 40, 'the rail');
      const roomy = (await box(page, '.aw-main'))?.right ?? 0;
      assert.ok(roomy > 1300, `the canvas takes the room (${roomy}, ${await page.evaluate(() => getComputedStyle(document.querySelector('.lite-main')!).marginRight)})`);
      await page.click('.lp-rail-open');
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => document.body.classList.contains('lp-collapsed')), false);

      // Leaving the Developer view gives the panel back as it was.
      await page.evaluate(() => (window as unknown as W).__ws.hide());
      assert.equal(await page.evaluate(() => (window as unknown as W).__dock()), false);
      assert.equal(await page.locator('#lead-panel .lp-ctx:not([hidden]), #lead-panel .dk-head').count(), 0, 'no chips or header on Project Management');
      assert.match((await text(page, '#lead-panel .pmc-chat-list')) ?? '', /Host approval merged into main/, 'the same conversation');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('no lead at work: the chat still takes requests (they queue); a phone: the chat is a bottom sheet', { skip: chrome ? false : 'no Chromium here', timeout: 120_000 }, async () => {
  const h = await harness();
  const browser = await chromium.launch({ headless: true, executablePath: chrome!, args: ['--headless=new'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const posts: { url: string; body: string }[] = [];
    await open(page, h, 'portal-light', posts, []);
    await page.evaluate(() => (window as unknown as W).__roster({ status: 'not-hired', workerId: undefined }));
    await set(page, DATA);
    await page.evaluate(() => (window as unknown as W).__ws.show());
    await page.waitForSelector('#lead-panel .lp-chat:not([hidden]) .lp-box');
    assert.equal(await page.isDisabled('#lead-panel .lp-box'), false, 'requests still go in');
    assert.equal(await page.isDisabled('#lead-panel .lp-mode[data-mode="ask"]'), true, 'Ask needs a lead');
    assert.match((await text(page, '#lead-panel .lp-hint')) ?? '', /No one leads the team yet: a change you request is kept and waits in the queue/);
    await page.waitForSelector('#lead-panel .lp-ctx-chip');
    await send(page, 'Sort the visitors by arrival time');
    assert.equal((await get<unknown[]>(page, '__asked')).length, 1);
    assert.ok(!posts.some((p) => p.url.startsWith('/api/roster')), 'no note to a lead that isn’t there');
    await shot(page, '05-no-lead-light.png');

    // A phone: a floating button opens the chat as a bottom sheet with the chip; Esc closes it.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.equal(await page.isVisible('.lp-fab'), true);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 391, `nothing scrolls sideways (${sw})`);
    await shot(page, '06-phone-canvas.png');
    await page.click('.lp-fab');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.body.classList.contains('lp-sheet')), true);
    const sheet = (await box(page, '#lead-panel'))!;
    assert.ok(sheet.top > 80 && Math.abs(sheet.bottom - 844) < 2, `a bottom sheet (${sheet.top}–${sheet.bottom})`);
    assert.equal(await page.isVisible('#lead-panel .lp-ctx-chip'), true);
    await shot(page, '07-phone-chat.png');
    // Increment B's receipts on a phone: the four facts apart (a hold among them), the dependency note, a commit
    // possibly related with Confirm / Dismiss, a cancelled change's late PR "not counted"; nothing scrolls sideways.
    const rich = change({ id: 'DC-7', queue: 'active', state: 'candidate', words: 'Working · candidate', revision: M, detail: 'Candidate @c0ffee1 on dev/DC-7. Not merged: the live preview runs main, not this.', mayCancel: true, at: now - 60_000, candidates: [{ sha: M, via: 'branch', branch: 'dev/DC-7', seenAt: now - 30_000 }], held: { env: 'candidate:DC-7', reason: 'Held: possible data impact', findings: 2 }, depends: [{ id: 'DC-6', docs: ['page:VisitorDesk.Visitor_Overview'] }], relatedView: [{ sha: '1'.repeat(40), subject: 'Tidy the overview page', docs: ['page:VisitorDesk.Visitor_Overview'], at: now, mayDecide: true }] });
    const gone = change({ id: 'DC-6', queue: 'cancelled', state: 'cancelled', words: 'Cancelled', detail: 'Cancelled by Alex Lee while the team had it: its worker was stopped mid-turn (its session kept) before the next change could start.', at: now - 120_000, late: 'After cancellation: PR #12 merged: not counted. It never settles this change or moves the queue.' });
    await set(page, { ...DATA, dev: DEV([rich, gone]) });
    await page.waitForSelector('#lead-panel .dk-asked[data-change="DC-7"] [data-fact="preview"]');
    const r7 = (await text(page, '#lead-panel .dk-asked[data-change="DC-7"] .dk-receipt')) ?? '';
    assert.match(r7, /→ DC-7 · Working · candidate @c0ffee1[\s\S]*Work[\s\S]*Checks[\s\S]*Incomplete @c0ffee1: no CI[\s\S]*Preview[\s\S]*Held: possible data impact · Findings \(2\)[\s\S]*Your review[\s\S]*No review yet/);
    assert.match(r7, /Depends on DC-6 \(not yet tried\)/);
    assert.match(r7, /Possibly related: @1111111 “Tidy the overview page”[\s\S]*Confirm[\s\S]*Dismiss/);
    assert.match(r7, /Cancel \(stops the work\)/);
    assert.doesNotMatch(r7, /accepted/i);
    assert.match((await text(page, '#lead-panel .dk-asked[data-change="DC-6"] .dk-receipt')) ?? '', /After cancellation: PR #12 merged: not counted/);
    const wide = await page.evaluate(() => [document.documentElement.scrollWidth, document.querySelector('#lead-panel')!.scrollWidth - document.querySelector('#lead-panel')!.clientWidth]);
    assert.ok(wide[0] <= 391 && wide[1] <= 1, `nothing scrolls sideways on a phone (${wide})`);
    await shot(page, '08-phone-lifecycle.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.body.classList.contains('lp-sheet')), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
