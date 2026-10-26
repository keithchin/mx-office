// The Marketplace request's Needs-you card and its package-file dialog (src/client/ui/marketplace/), and words on
// action cards (src/client/ui/portal/card-words.ts, handsOnCard), in headless Chromium with every client
// stylesheet and a fake office: the item, version, publisher and licence; Download and add off with why when
// the office has no token it may use, on (posting approve) when it has; Use a package file… with ✕ top right and
// Esc/✕ giving focus back; a refused file said in the dialog, a good one closing it; Decline with the PM's words;
// members see no buttons; I've done it / Can't now sending the note typed; phone width without a horizontal
// scroll. MARKETPLACE_SHOTS=<folder> saves screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import { marketplaceCandidates } from '../src/shared/decisions/marketplace.js';
import type { MarketplaceRequest, MarketplaceView } from '../src/shared/marketplace.js';
import type { DecisionCard } from '../src/shared/decisions/types.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
function sheets(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(root, dir)).sort()) {
    const p = path.join(dir, e);
    if (statSync(path.join(root, p)).isDirectory()) out.push(...sheets(p));
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

const REQ: MarketplaceRequest = { rid: 'mkt_a1', floor: 'demo', id: '235351', kind: 'widget', version: '2.5.1', name: 'com.mendix.widget.web.FileUploader', status: 'pending', by: { id: 'w1', name: 'Rhea' }, folder: 'C:/office/demo/wt', branch: 'dev/receipts', at: Date.now() - 60_000, why: 'receipt upload on the expense form', info: { title: 'File Uploader', publisher: 'Example Co', licence: 'Apache 2.0' } };
const viewOf = (canDownload: boolean): MarketplaceView => ({ floor: 'demo', admin: true, canDownload, ...(canDownload ? {} : { noDownload: 'This is a test office: it holds no Mendix token. Use a package file instead.' }), requests: [REQ] });
function cardOf(v: MarketplaceView): DecisionCard {
  const [c] = marketplaceCandidates(v, 'demo');
  return { ...c.body, id: c.source.id, kind: c.kind, sources: [c.source], related: [], need: c.need, level: 'warn', after: c.body.after ?? '' } as DecisionCard;
}
const HANDS_ON = { id: 'esc:e1', kind: 'hands-on', question: 'Install the File Uploader widget', detail: 'mxcli refuses fileuploader (MDL-WIDGET25).', evidence: [], blocks: [], owner: 'Carl', sources: [{ id: 'esc:e1', type: 'escalation', label: "Carl's escalation", target: { to: 'escalation', id: 'e1' }, escalation: 'e1' }], after: 'After you answer: Carl re-checks.', level: 'block', notes: [], related: [], escalation: 'e1', need: { key: 'esc-e1', kind: 'escalation', icon: '✋', text: 'x', level: 'block', action: 'Answer', target: { to: 'escalation', id: 'e1' } } };

test('the card is drawn by the Needs-you card from its own module, nothing of it in lite.ts', () => {
  assert.match(read('src/client/ui/portal/needs-card.ts'), /marketplaceCard\(/);
  assert.doesNotMatch(read('src/client/lite.ts'), /marketplace/i);
});

const chrome = findChrome();
test('in a browser: the approve card, the package-file dialog (✕, Esc, focus), Decline with words, members, action-card words, phone width', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: {
      contents: `import { marketplaceCard } from './marketplace/card'; import { handsOnCard } from './portal/decision-card';
        const ctx = (admin) => ({ floor: 'demo', admin, leadName: 'Barbara', go() {}, ask() { return true; }, done(c, what) { window.doneWith = what; } });
        window.T = { show(card, admin) { const host = document.getElementById('host'); host.replaceChildren(marketplaceCard(card, ctx(admin))); },
                     hands(card) { const host = document.getElementById('host'); host.replaceChildren(handsOnCard(card, ctx(true))); } };`,
      resolveDir: path.join(root, 'src/client/ui'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const css = sheets('src/client')
    .filter((f) => !/login\.css$|[\\/]mobile[\\/]|[\\/]first-run[\\/]/.test(f))
    .map((f) => read(f).replace(/@import[^;]+;/g, ''))
    .join('\n');
  const shots = process.env.MARKETPLACE_SHOTS;
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    const posted: { path: string; body: unknown }[] = [];
    let uploadAnswer: { status: number; body: unknown } = { status: 422, body: { error: 'That file can’t be used: This package is version 2.4.1, and the request is for 2.5.1' } };
    page.on('pageerror', (e) => errors.push(e.message));
    const added = { ...REQ, status: 'added', added: { how: 'file', commit: 'abcdef1234567', files: ['app/widgets/x.mpk'], by: 'Pat', at: 1, pkg: {} } };
    await page.route('http://office.test/**', async (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="portal-light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style></head><body class="lite"><main class="lite-main" style="padding:16px"><div id="host"></div></main><div id="modal-root"></div><div id="toasts"></div></body></html>` });
      if (u.pathname === '/api/marketplace/upload') {
        posted.push({ path: `${u.pathname}?${u.searchParams}`, body: (r.request().postDataBuffer() ?? Buffer.alloc(0)).length });
        return r.fulfill({ status: uploadAnswer.status, contentType: 'application/json', body: JSON.stringify(uploadAnswer.body) });
      }
      if (u.pathname === '/api/marketplace/action' || u.pathname === '/api/decisions/action') {
        const b = JSON.parse(r.request().postData() ?? '{}');
        posted.push({ path: u.pathname, body: b });
        if (u.pathname === '/api/decisions/action') return r.fulfill({ contentType: 'application/json', body: '{}' });
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ request: b.action === 'decline' ? { ...REQ, status: 'declined' } : added, view: viewOf(true) }) });
      }
      return r.fulfill({ status: 404, body: '' });
    });
    await page.goto('http://office.test/');
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const T = <R>(js: string) => page.evaluate(js) as Promise<R>;

    // No token the office may use: Download off, with why; the facts on the card.
    await T(`T.show(${JSON.stringify(cardOf(viewOf(false)))}, true)`);
    const text = await T<string>(`document.querySelector('.mk-card').innerText`);
    assert.match(text, /Add widget File Uploader 2\.5\.1 to dev\/receipts\?/);
    assert.match(text, /Rhea asked for it: “receipt upload on the expense form”/);
    assert.match(text, /Marketplace item 235351 \(File Uploader\)[\s\S]*Version: 2\.5\.1[\s\S]*Publisher: Example Co[\s\S]*Licence: Apache 2\.0/);
    assert.match(text, /This is a test office: it holds no Mendix token/);
    assert.doesNotMatch(text, /\bfloor\b/i);
    assert.equal(await T<boolean>(`document.querySelector('.mk-download').disabled`), true, 'no download without a token');
    if (shots) await (await page.$('.mk-card'))!.screenshot({ path: path.join(shots, 'marketplace-card.png') });

    // The dialog: ✕ top right; Esc and ✕ give focus back to Use a package file….
    await page.click('.mk-file');
    await page.waitForSelector('.mk-modal');
    assert.ok(await T<boolean>(`!!document.querySelector('.mk-modal .close')`), 'a ✕');
    assert.match(await T<string>(`document.querySelector('.mk-modal').innerText`), /checks it is the package com\.mendix\.widget\.web\.FileUploader, version 2\.5\.1 before it adds it to dev\/receipts/);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.mk-modal', { state: 'detached' });
    assert.match(await T<string>(`document.activeElement?.className`), /mk-file/, 'focus back after Esc');
    await page.click('.mk-file');
    await page.click('.mk-modal .close');
    await page.waitForSelector('.mk-modal', { state: 'detached' });
    assert.match(await T<string>(`document.activeElement?.className`), /mk-file/, 'focus back after ✕');

    // A wrong file: refused in the dialog, which stays open; then a path that works closes it.
    await page.click('.mk-file');
    await page.setInputFiles('.mk-pick', { name: 'FileUploader.mpk', mimeType: 'application/octet-stream', buffer: Buffer.from('PK fake package') });
    await page.click('.mk-use');
    await page.waitForFunction(`document.querySelector('.mk-modal .mk-msg.bad')`);
    assert.match(await T<string>(`document.querySelector('.mk-modal .mk-msg').innerText`), /version 2\.4\.1, and the request is for 2\.5\.1/);
    if (shots) await (await page.$('.mk-modal'))!.screenshot({ path: path.join(shots, 'marketplace-dialog-refused.png') });
    assert.match(String(posted.at(-1)!.path), /^\/api\/marketplace\/upload\?floor=demo&rid=mkt_a1&name=FileUploader\.mpk$/);
    await page.setInputFiles('.mk-pick', []);
    await page.fill('.mk-path', 'C:\\Downloads\\FileUploader.mpk');
    await page.click('.mk-use');
    await page.waitForSelector('.mk-modal', { state: 'detached' });
    assert.deepEqual(posted.at(-1), { path: '/api/marketplace/action', body: { floor: 'demo', rid: 'mkt_a1', action: 'path', path: 'C:\\Downloads\\FileUploader.mpk' } });
    assert.equal(await T<string>(`window.doneWith`), 'Added · commit abcdef1');

    // With a token: Download and add posts approve.
    await T(`T.show(${JSON.stringify(cardOf(viewOf(true)))}, true)`);
    assert.equal(await T<boolean>(`document.querySelector('.mk-download').disabled`), false);
    await page.click('.mk-download');
    await page.waitForFunction(`window.doneWith === 'Added · commit abcdef1'`);
    assert.deepEqual(posted.at(-1), { path: '/api/marketplace/action', body: { floor: 'demo', rid: 'mkt_a1', action: 'approve' } });

    // Decline with the PM's words.
    await T(`T.show(${JSON.stringify(cardOf(viewOf(true)))}, true)`);
    await page.fill('.mk-card .pt-dc-words', 'Not in this phase: keep the read-only list');
    await page.click('.mk-decline');
    await page.waitForFunction(`window.doneWith === 'Declined'`);
    assert.deepEqual(posted.at(-1), { path: '/api/marketplace/action', body: { floor: 'demo', rid: 'mkt_a1', action: 'decline', words: 'Not in this phase: keep the read-only list' } });

    // A member: reads it, no buttons.
    await T(`T.show(${JSON.stringify(cardOf(viewOf(true)))}, false)`);
    assert.equal(await T<number>(`document.querySelectorAll('.mk-card button').length`), 0);
    assert.match(await T<string>(`document.querySelector('.mk-card').innerText`), /Only the Project Manager \(an admin\) can act on it/);

    // Action cards accept words: Can't now sends the note typed; I've done it with none sends no text.
    await T(`T.hands(${JSON.stringify(HANDS_ON)})`);
    await page.fill('.pt-dc-words', 'Option C: descope the upload click, keep the receipt rules');
    if (shots) await (await page.$('.pt-dc'))!.screenshot({ path: path.join(shots, 'action-card-words.png') });
    await page.click('.pt-dc-cant');
    await page.waitForFunction(`document.querySelector('.pt-dc-words').value === ''`);
    assert.deepEqual(posted.at(-1), { path: '/api/decisions/action', body: { floor: 'demo', by: 'Guest', action: 'cant-now', escalation: 'e1', text: 'Option C: descope the upload click, keep the receipt rules' } });
    await page.click('.pt-dc-done');
    await page.waitForFunction(`window.doneWith && window.doneWith.startsWith('Done')`);
    const done = posted.at(-1)!.body as Record<string, unknown>;
    assert.equal(done.action, 'done');
    assert.equal(done.text, undefined, 'no note, no text');

    // Phone width: no horizontal scroll, with the dialog open too.
    await page.setViewportSize({ width: 390, height: 800 });
    await T(`T.show(${JSON.stringify(cardOf(viewOf(false)))}, true)`);
    assert.ok(await T<boolean>(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'no horizontal scroll at phone width');
    if (shots) await (await page.$('.mk-card'))!.screenshot({ path: path.join(shots, 'marketplace-card-phone.png') });
    await page.click('.mk-file');
    await page.waitForSelector('.mk-modal');
    assert.ok(await T<boolean>(`document.querySelector('.mk-modal').getBoundingClientRect().right <= window.innerWidth + 1`), 'the dialog fits a phone');
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
