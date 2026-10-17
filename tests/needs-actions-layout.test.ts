// Every Needs-you item keeps its text the whole width: the action buttons sit on their own line under it, at
// the bottom right, wrapping when there are many (the Overview's cards and rows, the Command Center's strip,
// the phone's rows and notes), and are at least 40 px tall at phone width. CSS only: the DOM order is
// text first, then buttons (so the keyboard reaches the words before the buttons).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { installFakeDom } from './support/fakedom.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const rule = (css: string, sel: string) => css.match(new RegExp(`(?:^|\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';

test('the Overview: a card’s buttons line up at the bottom right; a row’s go under its text', () => {
  const css = read('src/client/ui/portal/overview.css');
  assert.match(rule(css, "html[data-theme^='portal'] .pt-esc-acts"), /flex-wrap: wrap;.*justify-content: flex-end;/);
  // The spacer that pushed "Ask <lead>" away from the buttons is gone: they all sit together at the right.
  assert.match(rule(css, "html[data-theme^='portal'] .pt-esc-acts > .pt-grow"), /display: none/);
  assert.match(rule(css, "html[data-theme^='portal'] .pt-nrow-b"), /flex: 1 0 100%;.*justify-content: flex-end;/);
  assert.match(rule(css, "html[data-theme^='portal'] .pt-nrow-t"), /overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 760px\) \{[^@]*body\.lite\.lite :is\(\.pt-esc-acts, \.pt-nrow-b\) \.btn \{ min-height: 40px; \}/);
});

test('the Command Center strip: the sentence beside its icon, the buttons after a line break at the right', () => {
  const css = read('src/client/ui/needsyou/needsyou.css');
  assert.match(rule(css, '.ny-item'), /flex-wrap: wrap;/);
  assert.match(rule(css, '.ny-item::before'), /order: 2; flex: 0 0 100%; height: 0;/);
  assert.match(rule(css, '.ny-item .ny-go'), /order: 3;/);
  assert.match(rule(css, '.ny-text + .ny-go'), /margin-left: auto/);
  assert.match(rule(css, '.ny-text'), /flex: 1 1 0; min-width: 0;.*overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 520px\) \{[^@]*\.ny-item \.ny-go \{ min-height: 40px; \}/);
});

test('the phone: a note’s buttons and a merge’s or the cap’s button go under the words at the right, 40 px tall', () => {
  assert.match(rule(read('src/client/ui/phone/phone.css'), '.tp-note-acts'), /justify-content: flex-end/);
  const m = read('src/client/mobile/mobile.css');
  assert.match(rule(m, '.m-appr'), /flex-wrap: wrap/);
  assert.match(rule(m, '.m-appr .m-row-main'), /flex: 1 1 calc\(100% - 40px\)/);
  assert.match(rule(m, '.m-appr > .btn'), /margin-left: auto/);
  assert.match(m, /body\.lite\.lite \.m-log \.tp-act, html\[data-theme\] body\.lite\.lite \.m-appr > \.btn \{ min-height: 40px; \}/);
});

test('a decision card’s buttons come after all its text, as its last child', async () => {
  installFakeDom();
  const { genericCard, fyiCard } = await import('../src/client/ui/portal/decision-card.js');
  const need = { key: 'k', kind: 'stuck', icon: '⚠', text: 'Stage 2 paperwork does not add up', level: 'warn', action: 'Ask the lead to fix it', target: { to: 'stage-fix', floor: 'f' } } as const;
  const card = { id: 'k', kind: 'status', question: need.text, evidence: [{ label: 'gate file' }], blocks: [], owner: 'Ada', sources: [{ id: 'k', type: 'stuck', label: 'stuck', target: need.target }], after: 'After you answer: …', level: 'warn', notes: ['a note'], related: [], need } as never;
  const ctx = { floor: 'f', admin: true, go: () => {}, ask: () => true, done: () => {} };
  for (const el of [genericCard(card, ctx), fyiCard(card, ctx)]) {
    const kids = [...el.children] as HTMLElement[];
    assert.ok(kids.at(-1)!.classList.contains('pt-esc-acts'), 'the buttons are last');
    assert.equal(kids.filter((k) => k.classList.contains('pt-esc-acts')).length, 1);
  }
});
