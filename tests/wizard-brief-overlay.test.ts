// The New project brief while the Chief Analyst folds a chat answer in (src/client/ui/wizard/new/brief-update.ts,
// brief-overlay.ts): the steps (start, hold, settle; mapping domains held too), what counts as changed, and in
// headless Chromium the real brief panel (bundled with esbuild, every wizard stylesheet): polls while busy
// redraw nothing, the overlay shows over the brief as it was (aria-busy, inert, the drafting card, made once),
// and when it's done one redraw, the overlay gone, the changed items pulsing, or "No changes to the brief".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import { settledChanges, updateStep } from '../src/client/ui/wizard/new/brief-update.js';
import { fakeBrief, fakeChat } from '../src/server/wizard/planner/fake.js';
import type { DraftView } from '../src/shared/brief.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

const { brief } = fakeBrief([]);
const draft = (over: Partial<DraftView> = {}): DraftView => ({ id: 'd1', version: 1, mode: 'describe', prompt: 'x', interview: 'steering', attachments: [], status: 'ready', brief, manual: false, chat: [], spent: 0, cap: 1, updatedAt: 0, ...over }) as DraftView;

test('the steps: a chat answer starts an update, its polls are held, the first draft after settles it', () => {
  assert.equal(updateStep(false, draft()), 'draw');
  assert.equal(updateStep(false, draft({ busy: 'chat' })), 'start');
  assert.equal(updateStep(true, draft({ busy: 'chat' })), 'hold');
  assert.equal(updateStep(true, draft()), 'settle');
  assert.equal(updateStep(false, draft({ busy: 'chat', brief: undefined })), 'draw', 'no brief yet: nothing to hold');
  assert.equal(updateStep(false, draft({ busy: 'brief', status: 'drafting' })), 'draw', 'drafting has its own cards');
  // Mapping domains: the brief is folded and locked; once drawn so, its polls are held, without the overlay.
  const approved = { by: 'Alex Lee', at: '2026-10-16T10:00:00.000Z', assumed: 0 } as DraftView['approved'];
  assert.equal(updateStep(false, draft({ busy: 'domains', approved }), false), 'draw');
  assert.equal(updateStep(false, draft({ busy: 'domains', approved }), true), 'hold');
  assert.equal(updateStep(false, draft({ approved }), true), 'draw', 'the domains done: drawn once more');
});

test('what changed: new and changed items against the brief shown before, with the turn’s own list, in brief order', () => {
  const next = fakeChat(brief, [], 'security desk').brief;
  const ids = settledChanges(brief, next);
  const role = next.sections.roles.find((r) => r.name === 'Security officer')!;
  assert.ok(ids.includes(role.id), 'the new role');
  assert.deepEqual(ids, [role.id], 'only the role: a source alone is no change until the server settles it (mergeTurn)');
  assert.deepEqual(settledChanges(brief, brief), [], 'nothing changed');
  assert.deepEqual(settledChanges(brief, brief, ['c3', 'nope']), ['c3'], 'the turn’s list, only items still there');
  assert.deepEqual(settledChanges(brief, undefined), []);
  const order = settledChanges(brief, next, ['g1']);
  assert.equal(order[0], 'g1', 'goal comes first');
});

test('the rules: reused drafting card, reduced motion, made once, no announcement of its own', () => {
  const ov = read('src/client/ui/wizard/new/brief-overlay.ts');
  assert.match(ov, /draftingCard\('Updating the brief…'/);
  assert.match(ov, /removeAttribute\('role'\)/, 'the chat pill announces it, not the card');
  assert.match(ov, /ov \?\?= make\(\)/, 'made once');
  assert.match(read('src/client/ui/wizard/new/new.css'), /prefers-reduced-motion: reduce\) \{ #modal-root \.nw \*/);
  assert.doesNotMatch(read('src/client/ui/wizard/new/parts.ts'), /Updating the brief/, 'the drafting card isn’t copied');
});

const chrome = findChrome();
test('in a browser: no redraw while busy, the overlay over the brief, one redraw after with the changes pulsing', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: {
      contents: `import { briefPanel } from './brief-view';
        const flow = { me: 'Alex Lee', status: { available: true }, said: [], say(t) { this.said.push(t); }, draft: undefined };
        flow.setDraft = (d) => { const prev = flow.draft; flow.draft = d; panel.update(prev); };
        const panel = briefPanel(flow, { prefill: () => {} });
        const doc = document.createElement('div'); doc.className = 'nw-doc'; doc.style.height = '100vh';
        const nw = document.createElement('div'); nw.className = 'nw'; nw.append(doc); document.getElementById('modal-root').append(nw);
        doc.append(panel.el);
        window.T = { flow, panel };`,
      resolveDir: path.join(root, 'src/client/ui/wizard/new'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const css = ['src/client/styles/themes.css', 'src/client/ui/wizard/new/new.css', 'src/client/ui/wizard/new/brief-overlay.css'].filter((f) => { try { read(f); return true; } catch { return false; } }).map(read).join('\n');
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(`<!doctype html><html data-theme="portal-light"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="modal-root"></div></body></html>`);
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const next = fakeChat(brief, [], 'security desk').brief;
    const role = next.sections.roles.find((r) => r.name === 'Security officer')!;
    const you = { who: 'you', text: 'We also have a security desk.', at: '2026-10-16T10:00:00.000Z' };
    await page.evaluate((d) => (window as any).T.flow.setDraft(d), draft());
    await page.evaluate(() => ((window as any).first = document.querySelector('#nw-it-g1')));
    // The answer sent: busy 'chat'. Then polls, one with a different draft object each time.
    await page.evaluate((d) => (window as any).T.flow.setDraft(d), draft({ busy: 'chat', chat: [you] as DraftView['chat'] }));
    for (let i = 0; i < 3; i++) await page.evaluate((d) => (window as any).T.flow.setDraft(d), draft({ busy: 'chat', chat: [you] as DraftView['chat'], updatedAt: i }));
    await page.waitForTimeout(300);
    const mid = await page.evaluate(() => {
      const el = (window as any).T.panel.el as HTMLElement;
      const ov = el.querySelectorAll('.nw-upd');
      return { same: document.querySelector('#nw-it-g1') === (window as any).first, busy: el.getAttribute('aria-busy'), inert: (el.querySelector('.nw-collapse') as HTMLElement).inert, overlays: ov.length, on: ov[0]?.classList.contains('on'), visible: !(ov[0] as HTMLElement)?.hidden, card: ov[0]?.querySelector('.nw-drafting .nw-st')?.textContent, role: ov[0]?.querySelector('.nw-drafting')?.getAttribute('role'), opacity: getComputedStyle(el.querySelector('.nw-collapse')!).opacity };
    });
    assert.deepEqual({ ...mid, opacity: undefined }, { same: true, busy: 'true', inert: true, overlays: 1, on: true, visible: true, card: 'Updating the brief…', role: null, opacity: undefined }, 'held, under the overlay');
    assert.ok(Number(mid.opacity) < 1, 'the brief dimmed');
    // Done: the new brief, the Chief Analyst's reply.
    const reply = { who: 'ca', text: 'Added a Security officer.', at: '2026-10-16T10:00:02.000Z', changed: [role.id] };
    await page.evaluate((d) => (window as any).T.flow.setDraft(d), draft({ version: 2, brief: next, chat: [you, reply] as DraftView['chat'] }));
    await page.waitForTimeout(400);
    const after = await page.evaluate((id) => {
      const el = (window as any).T.panel.el as HTMLElement;
      return { redrawn: document.querySelector('#nw-it-g1') !== (window as any).first, busy: el.hasAttribute('aria-busy'), inert: (el.querySelector('.nw-collapse') as HTMLElement).inert, hidden: (el.querySelector('.nw-upd') as HTMLElement).hidden, pulsing: [...el.querySelectorAll('.nw-changed')].map((n) => n.id), anim: [...el.querySelectorAll('.nw-changed')].map((n) => getComputedStyle(n).animationName), still: getComputedStyle(el.querySelector('#nw-it-g1')!).animationName, role: !!document.getElementById(`nw-it-${id}`), overlays: el.querySelectorAll('.nw-upd').length };
    }, role.id);
    assert.equal(after.redrawn, true);
    assert.ok(after.anim.length && after.anim.every((a) => a === 'nw-changed'), `the pulse runs: ${after.anim}`);
    assert.equal(after.still, 'none', 'the unchanged items don’t rise again');
    assert.equal(after.busy, false);
    assert.equal(after.inert, false);
    assert.equal(after.hidden, true, 'the overlay faded out');
    assert.equal(after.overlays, 1);
    assert.ok(after.role, 'the new role is drawn');
    assert.ok(after.pulsing.includes(`nw-it-${role.id}`), `changed items pulse: ${after.pulsing}`);
    // A second answer that changes nothing: a note says so.
    await page.evaluate((d) => (window as any).T.flow.setDraft(d), draft({ version: 2, brief: next, busy: 'chat', chat: [you, reply, you] as DraftView['chat'] }));
    await page.evaluate((d) => (window as any).T.flow.setDraft(d), draft({ version: 2, brief: next, chat: [you, reply, you, { who: 'ca', text: 'Nothing to change.', at: 'x' }] as DraftView['chat'] }));
    const note = await page.evaluate(() => {
      const n = (window as any).T.panel.el.querySelector('.nw-upd-note') as HTMLElement | null;
      return { text: n?.textContent, shown: n ? !n.hidden : false, said: (window as any).T.flow.said as string[] };
    });
    assert.deepEqual([note.text, note.shown], ['No changes to the brief', true]);
    assert.ok(note.said.includes('No changes to the brief'));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
