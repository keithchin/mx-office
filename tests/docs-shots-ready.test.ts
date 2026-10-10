// The docs screenshots' wait for the Projects page (scripts/docs-shots.mjs, readme-projects): the shot is
// taken only once every card shows its spend, so a budget feed answering late can't give an early
// picture, and one that never answers fails with a readiness timeout that says so. Its check used to be
// /$/, which every card's text matched at once. On a stand-in page over the stand-in DOM, and in a real
// Chromium when there is one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fakeDocument, FakeEl } from './support/fakedom.js';
// @ts-expect-error: a plain .mjs script, no types
import { SHOTS, projectsLoaded } from '../scripts/docs-shots.mjs';
// @ts-expect-error: a plain .mjs script, no types
import { findChrome } from '../scripts/perf/pages.mjs';

installFakeDom();

const shot = SHOTS.find((s: { name: string }) => s.name === 'readme-projects');

/** Playwright's waitForFunction, enough of it: `fn` polled against the stand-in DOM until true or `timeout`. */
const fakePage = {
  async waitForFunction(fn: () => boolean, _arg: unknown, { timeout }: { timeout: number }) {
    const end = Date.now() + timeout;
    for (;;) {
      if (fn()) return;
      if (Date.now() > end) throw new Error(`page.waitForFunction: Timeout ${timeout}ms exceeded.`);
      await new Promise((r) => setTimeout(r, 10));
    }
  },
};

/** The Projects grid: two cards, with their spend or without (the budget feed not in yet). */
function cards(spend: boolean) {
  const grid = new FakeEl('ul');
  for (const name of ['Travel approval', 'Field service']) {
    const card = new FakeEl('li');
    card.className = 'ph-card';
    const foot = new FakeEl('div');
    foot.className = 'ph-foot';
    foot.append(Object.assign(new FakeEl('span'), { className: 'ph-status' }));
    card.append(name, foot);
    grid.append(card);
  }
  fakeDocument.body.replaceChildren(grid);
  if (spend) addSpend();
}
function addSpend() {
  for (const foot of fakeDocument.body.querySelectorAll('.ph-foot')) {
    const s = new FakeEl('span');
    s.className = 'ph-spend';
    s.append('$412 / $2,000');
    foot.append(s);
  }
}

test('the Projects shot waits for every card’s spend, not just the cards', async () => {
  cards(false);
  // The old check would have passed here: every string matches /$/.
  assert.ok([...fakeDocument.body.querySelectorAll('.ph-card')].every((c) => /$/.test(c.textContent)));
  assert.equal(projectsLoaded(), false);
  let ready = false;
  const waiting = shot.ready(fakePage, { timeout: 5000 }).then(() => (ready = true));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(ready, false, 'no shot while the budget feed is late');
  addSpend();
  await waiting;
  assert.equal(ready, true);
  // One card without its spend is still not ready.
  cards(true);
  fakeDocument.body.querySelector('.ph-spend')!.remove();
  assert.equal(projectsLoaded(), false);
});

test('a budget feed that never answers fails with a readiness timeout naming it', async () => {
  cards(false);
  await assert.rejects(shot.ready(fakePage, { timeout: 200 }), /not ready after 0 s: the Projects cards never showed their spend .*budget feed/);
});

test('in a real Chromium: a late budget feed gives no early shot, a missing one a readiness timeout', { skip: findChrome() ? false : 'no Chromium installed for playwright-core' }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() });
  try {
    const page = await browser.newPage();
    const html = (delay: number | null) => `<ul>${['A', 'B'].map((n) => `<li class="ph-card">${n}<div class="ph-foot"></div></li>`).join('')}</ul>
      <script>${delay === null ? '' : `setTimeout(() => document.querySelectorAll('.ph-foot').forEach((f) => { const s = document.createElement('span'); s.className = 'ph-spend'; s.textContent = '$12.50 spent'; f.append(s); window.spendAt = performance.now(); }), ${delay});`}</script>`;
    await page.setContent(html(700));
    await shot.ready(page, { timeout: 10000 });
    const at = await page.evaluate(() => ({ spend: (window as unknown as { spendAt?: number }).spendAt, cards: document.querySelectorAll('.ph-spend').length }));
    assert.ok(at.spend !== undefined && at.cards === 2, 'ready only once the delayed spend was drawn');
    await page.setContent(html(null));
    await assert.rejects(shot.ready(page, { timeout: 1000 }), /not ready after 1 s: the Projects cards never showed their spend/);
  } finally {
    await browser.close();
  }
});
