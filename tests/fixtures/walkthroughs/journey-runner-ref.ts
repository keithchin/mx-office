// A minimal re-implementation of the toolkit journey runner's action table and ui rung (the project's
// tests/e2e/journey-runner.js: act(), helpers.navTo / helpers.dismissModal, and the landing guard, widget
// and text checks of runJourney), line for line where it matters, for tests/walkthroughs-parity.test.ts:
// the same journey played by this and by the recorder must leave the app in the same state. Its act()
// switch is also the list the recorder's actions are held to (a runner action added here, or found in a
// real runner, that the recorder can't play fails that test). The data (OQL) and trace rungs need a
// database and tracing and are left out, as the recorder leaves them out. Neutral: no project's names.
import path from 'node:path';
import type { Locator, Page } from 'playwright-core';

type Json = Record<string, unknown> & { do?: string };
type Vars = Record<string, string>;

const PAUSE = (ms: number) => new Promise((r) => setTimeout(r, ms));
const subst = (v: unknown, vars: Vars) => (typeof v === 'string' ? v.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? vars[k] : m)) : v);

async function dismissModal(page: Page, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const btn = page.locator('.mx-dialog-footer button, .mx-name-closeButton').first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
    } else break;
  }
}

async function navTo(page: Page, parentTitle: string | null, childTitle: string) {
  const clickTitle = (t: string) =>
    page
      .evaluate((title) => {
        const a = [...document.querySelectorAll<HTMLElement>('.mx-navigationtree a, .mx-navbar a')].find((x) => x.getAttribute('title') === title);
        if (a) {
          a.scrollIntoView({ block: 'nearest' });
          a.click();
          return true;
        }
        return false;
      }, t)
      .catch(() => false);
  if (parentTitle) {
    await clickTitle(parentTitle);
    await page.waitForTimeout(500);
  }
  await clickTitle(childTitle);
  await page.waitForTimeout(1500);
  await dismissModal(page);
}

/** The runner's act(), `fixtures` its tests/e2e/fixtures. */
export async function act(page: Page, a: Json, vars: Vars, fixtures: string) {
  const esc = (s: string) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const root: Page | Locator = a.within
    ? page
        .locator(`.mx-name-${a.within}`)
        .filter({ hasText: new RegExp(esc(String(subst(a.hasText || '', vars))), 'i') })
        .first()
    : page;
  const w = (n: unknown) => root.locator(`.mx-name-${n}`).first();
  switch (a.do) {
    case 'nav':
      await navTo(page, (a.group as string) || null, a.item as string);
      break;
    case 'click': {
      const el = w(a.widget);
      await el.waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
      await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await el.evaluate((n) => n.scrollIntoView({ block: 'center' })).catch(() => {});
      await PAUSE(300);
      if (!(await el.isVisible().catch(() => false))) throw new Error(`.mx-name-${a.widget} not visible`);
      let cover: string | null = null;
      for (let t = 0; t < 5; t++) {
        cover = await el
          .evaluate((n) => {
            const r = n.getBoundingClientRect();
            const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            if (!e || n.contains(e) || e.contains(n)) return null;
            const c = e.closest('[class]') || e;
            return String((c as HTMLElement).className || c.tagName).trim().split(/\s+/).slice(0, 3).join('.');
          })
          .catch(() => null);
        if (!cover) break;
        await PAUSE(250);
      }
      if (cover) throw new Error(`.mx-name-${a.widget} is covered by .${cover} — a click lands on that, not on the widget`);
      await el.click({ force: true }).catch(() => el.click());
      break;
    }
    case 'fill': {
      const el = root.locator(`.mx-name-${a.widget} input, .mx-name-${a.widget} textarea`).first();
      if (!(await el.isVisible().catch(() => false))) throw new Error(`.mx-name-${a.widget} input not visible`);
      await el.fill(String(subst(a.value, vars)));
      if (a.blur) await el.press('Tab');
      break;
    }
    case 'setFiles': {
      const inp = root.locator(`.mx-name-${a.widget} input[type=file]`).first();
      if (!(await inp.count())) throw new Error(`.mx-name-${a.widget} input[type=file] not found`);
      const files = ([] as unknown[]).concat(a.file).map((f) => path.join(fixtures, String(subst(f, vars))));
      await inp.setInputFiles(files);
      await PAUSE((a.settleMs as number) ?? 4000);
      break;
    }
    case 'pickLanguage': {
      await page.locator('.mx-name-languageSelector1').first().click();
      await PAUSE(900);
      await page
        .locator('[role=option], .popupmenu-menu li')
        .filter({ hasText: new RegExp(esc(String(subst(a.match, vars))), 'i') })
        .first()
        .click();
      await PAUSE((a.settleMs as number) ?? 7000);
      break;
    }
    case 'combobox': {
      const box = w(a.widget);
      if (!(await box.isVisible().catch(() => false))) throw new Error(`.mx-name-${a.widget} not visible`);
      await box.scrollIntoViewIfNeeded().catch(() => {});
      await PAUSE(400);
      await page.locator('[id^="downshift-"][id$="-toggle-button"]').first().click({ force: true }).catch(() => {});
      await PAUSE(1200);
      const opts = page.locator('[role="option"]');
      await opts.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      const texts = await opts.evaluateAll((e) => e.map((x) => (x.textContent ?? '').trim())).catch(() => [] as string[]);
      const want = String(subst(a.match, vars));
      if (texts.findIndex((t) => t.includes(want)) === -1) throw new Error(`${a.widget}: no option matches "${want}"`);
      const activeText = async () => {
        const id = await box.locator('input[role="combobox"]').getAttribute('aria-activedescendant').catch(() => null);
        if (!id) return null;
        return page.locator(`[id="${id}"]`).textContent().catch(() => null);
      };
      let landed = false;
      for (let k = 0; k < texts.length + 2; k++) {
        const cur = ((await activeText()) || '').trim();
        if (cur && cur.includes(want)) {
          landed = true;
          break;
        }
        await page.keyboard.press('ArrowDown');
        await PAUSE(120);
      }
      if (!landed) throw new Error(`${a.widget}: the highlight never reached "${want}"`);
      await page.keyboard.press('Enter');
      await PAUSE(500);
      const val = await box.locator('input[role="combobox"]').inputValue().catch(() => '');
      if (!val) throw new Error(`${a.widget} still empty after selecting "${want}"`);
      if (!val.includes(want)) throw new Error(`${a.widget} committed "${val}" but the journey asked for "${want}"`);
      break;
    }
    case 'dismissModal':
      await dismissModal(page);
      break;
    case 'wait':
      await page.waitForTimeout((a.ms as number) || 1000);
      break;
    default:
      throw new Error(`unknown action "${a.do}"`);
  }
  await page.waitForTimeout((a.settleMs as number) ?? 1200);
}

/** The runner's walk of one journey's actions and ui rung (literal seeds only); the first failure, or undefined. */
export async function runJourney(page: Page, j: { seeds?: { name: string; value?: string }[]; steps: Json[] }, fixtures: string): Promise<string | undefined> {
  const vars: Vars = Object.fromEntries((j.seeds ?? []).filter((s) => typeof s.value === 'string').map((s) => [s.name, s.value as string]));
  for (const step of j.steps) {
    try {
      for (const a of (step.actions as Json[]) || []) await act(page, a, vars, fixtures);
    } catch (e) {
      return `${step.name}: actions: ${(e as Error).message.split('\n')[0]}`;
    }
    const ui = (step.ui ?? {}) as { ready?: string; checks?: string[]; textPresent?: string[]; textAbsent?: string[] };
    if (ui.ready && !(await page.locator(ui.ready).first().waitFor({ state: 'visible', timeout: 12000 }).then(() => true, () => false))) return `${step.name}: not reached`;
    for (const c of ui.checks ?? []) if (!(await page.locator(`.mx-name-${c}`).first().isVisible().catch(() => false))) return `${step.name}: widget ${c}`;
    const body = ui.textPresent || ui.textAbsent ? await page.locator('body').innerText().catch(() => '') : '';
    for (const t of ui.textPresent ?? []) if (!body.includes(String(subst(t, vars)))) return `${step.name}: page says "${t}"`;
    for (const t of ui.textAbsent ?? []) if (body.includes(String(subst(t, vars)))) return `${step.name}: page does NOT say "${t}"`;
  }
  return undefined;
}
