// What the recorder (./recorder.ts) does in a step, with the toolkit journey runner's own semantics
// (tests/e2e/journey-runner.js: its act() and its ui rung), so a journey plays the same in a recording as
// in the runner: a widget by its Mendix class (.mx-name-<widget>), scoped by `within` + `hasText` to the
// first container whose text matches (plain text, any case); a click after the target is centred and
// hit-tested (covered by something else for more than an animation is said as such), forced as the runner
// forces it; `fill` sets the input's value as Playwright's fill() does (no typing), Tab out when `blur`;
// `setFiles` puts files from the commit's tests/e2e/fixtures on the uploader's hidden file input (never
// outside the recorded commit's files); `pickLanguage` opens the language selector and picks the option;
// `combobox` steps the highlight and reads it before it commits, then checks what was committed;
// `dismissModal` clicks a dialog's button up to three times, without failing; `nav` clicks the menu's
// anchor by its title; every action is followed by its `settleMs` (the runner's 1200 ms when not given).
// The ui checks are the runner's: `ready` waits up to 12 s, `checks` and the texts are read once.
//
// When a step fails, appShows() reads what the app has on screen (a Mendix error, warning or message
// dialog, a validation message), so a failure says "the app showed: …" apart from "the recorder couldn't
// find …".

import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WalkAction, WalkStep, WalkTarget } from '../../shared/walkthroughs/types.js';
import type { Loc, Page } from './signin.js';

export class StepFailed extends Error {}

export interface ActEnv {
  origin: string;
  /** Filmed: the highlight shows where a click lands, for a moment. */
  film: boolean;
  /** The recorded commit's files (the recording app's workspace): where setFiles takes its fixtures from. */
  workspace?: string;
  /** Said beside the step (a dialog the step closed, with its words). */
  note(line: string): void;
}

/** The runner's wait after every action without its own `settleMs`. */
export const SETTLE_MS = 1200;
/** Where the runner takes setFiles' files from, in the project (next to journey-runner.js). */
export const FIXTURES = 'tests/e2e/fixtures';
/** How long the runner's landing guard waits for `ui.ready` (its JOURNEY_READY_TIMEOUT default). */
export const READY_MS = 12_000;

const DIALOG_BUTTON = '.mx-dialog-footer button, .mx-name-closeButton';
const LANGUAGE = '.mx-name-languageSelector1';
const OPTION = '[role=option], .popupmenu-menu li';
const NAV = '.mx-navigationtree a, .mx-navbar a';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const textRe = (s: string) => new RegExp(esc(s), 'i');
const quiet = <T>(p: Promise<T>) => p.catch(() => undefined);

/** The container a widget action is scoped to (`within` + `hasText`), else the page. */
const rootOf = (page: Page, a: WalkTarget): Page | Loc => (a.within ? page.locator(a.within).filter({ hasText: textRe(a.hasText ?? '') }).first() : page);

/** Why a widget can't be acted on: the container that isn't there, else the widget. */
async function missing(page: Page, sel: string, a: WalkTarget, what = "isn't on the screen"): Promise<StepFailed> {
  if (a.within && !(await page.locator(a.within).filter({ hasText: textRe(a.hasText ?? '') }).count().catch(() => 0))) {
    return new StepFailed(`couldn't find a ${a.within} that says “${a.hasText ?? ''}”`);
  }
  return new StepFailed(`couldn't find ${sel}${a.within ? ` in the ${a.within} that says “${a.hasText ?? ''}”` : ''}: it ${what}`);
}

/** Shows the highlight around `el` for a moment (filmed only), so the viewer sees where the action lands. */
async function highlight(page: Page, el: Loc, env: ActEnv) {
  if (!env.film) return;
  const box = await el.boundingBox().catch(() => null);
  if (!box) return;
  await quiet(page.evaluate((b) => (window as unknown as { __wt: { highlight(b: unknown): void } }).__wt.highlight(b), box));
  await page.waitForTimeout(550);
}

/** helpers.dismissModal: up to three dialogs' buttons, clicked; a click that doesn't go is let be, as the runner does. */
async function dismissModal(page: Page, env: ActEnv) {
  for (let k = 0; k < 3; k++) {
    const btn = page.locator(DIALOG_BUTTON).first();
    if (!(await btn.isVisible().catch(() => false))) break;
    const said = await appShows(page);
    if (said) env.note(`closed the app's ${said.kind === 'validation' ? 'message' : said.kind}: “${said.text}”`);
    await quiet(btn.click({ timeout: 5000 }));
    await page.waitForTimeout(500);
  }
}

/** helpers.navTo: the menu's anchor with that title, clicked as the runner clicks it (the element's own click()). */
async function nav(page: Page, group: string | undefined, item: string, env: ActEnv) {
  const clickTitle = async (title: string) => {
    const q = title.replace(/"/g, '\\"');
    const el = page.locator(`.mx-navigationtree a[title="${q}"], .mx-navbar a[title="${q}"]`).first();
    if (await el.isVisible().catch(() => false)) await highlight(page, el, env);
    return page
      .evaluate(
        ({ title, nav }) => {
          const x = [...document.querySelectorAll<HTMLElement>(nav)].find((e) => e.getAttribute('title') === title);
          if (!x) return false;
          x.scrollIntoView({ block: 'nearest' });
          x.click();
          return true;
        },
        { title, nav: NAV },
      )
      .catch(() => false);
  };
  if (group) {
    await clickTitle(group);
    await page.waitForTimeout(500);
  }
  // The runner goes on when the item isn't there (its landing guard says so later); the recorder says it here.
  if (!(await clickTitle(item))) throw new StepFailed(`couldn't find “${item}” in the menu`);
  await page.waitForTimeout(1500);
  await dismissModal(page, env);
}

async function click(page: Page, a: Extract<WalkAction, { do: 'click' }>, env: ActEnv) {
  const el = rootOf(page, a).locator(a.selector).first();
  await quiet(el.waitFor({ state: 'attached', timeout: 8000 }));
  await quiet(el.scrollIntoViewIfNeeded({ timeout: 2000 }));
  // The runner centres the target: a sticky action bar covers widgets scrolled to the viewport's edge.
  await quiet(el.evaluate((n) => n.scrollIntoView({ block: 'center' })));
  await page.waitForTimeout(300);
  if (!(await el.isVisible().catch(() => false))) throw await missing(page, a.selector, a);
  await highlight(page, el, env);
  // Hit-test before the forced click: whatever sits on top for longer than an animation gets the click.
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
    await page.waitForTimeout(250);
  }
  if (cover) throw new StepFailed(`couldn't click ${a.selector}: it is covered by .${cover}, so a click lands on that, not on the widget`);
  await el.click({ force: true }).catch(() => el.click({ timeout: 6000 }));
}

async function fill(page: Page, a: Extract<WalkAction, { do: 'fill' }>, env: ActEnv) {
  const el = rootOf(page, a).locator(`${a.selector} input, ${a.selector} textarea`).first();
  if (!(await el.isVisible().catch(() => false))) throw await missing(page, `${a.selector} input`, a);
  await highlight(page, el, env);
  await el.fill(a.value);
  // Mendix commits a text box on blur.
  if (a.blur) await el.press('Tab');
}

/** The files of `files`, in the recorded commit's tests/e2e/fixtures; never a path outside the commit's files. */
export async function fixturePaths(workspace: string | undefined, files: string[]): Promise<string[]> {
  if (!workspace) throw new StepFailed('the recording has no copy of the commit’s files to attach a file from');
  const base = path.resolve(workspace);
  const realBase = await realpath(base).catch(() => base);
  const inside = (root: string, p: string) => {
    const rel = path.relative(root, p);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  const out: string[] = [];
  for (const f of files) {
    const p = path.join(base, FIXTURES, f);
    if (!inside(base, p)) throw new StepFailed(`won't attach “${f}”: it is outside the recorded commit’s files`);
    const real = await realpath(p).catch(() => undefined);
    if (!real || !(await stat(real).then((s) => s.isFile(), () => false))) throw new StepFailed(`couldn't find ${FIXTURES}/${f} in the recorded commit`);
    if (!inside(realBase, real)) throw new StepFailed(`won't attach “${f}”: it leads outside the recorded commit’s files`);
    out.push(real);
  }
  return out;
}

async function setFiles(page: Page, a: Extract<WalkAction, { do: 'setFiles' }>, env: ActEnv) {
  const root = rootOf(page, a);
  const inp = root.locator(`${a.selector} input[type=file]`).first();
  if (!(await inp.count().catch(() => 0))) throw await missing(page, `${a.selector} input[type=file]`, a, "isn't there");
  const files = await fixturePaths(env.workspace, a.files);
  await highlight(page, root.locator(a.selector).first(), env);
  await inp.setInputFiles(files);
  await page.waitForTimeout(a.settleMs ?? 4000);
}

async function pickLanguage(page: Page, a: Extract<WalkAction, { do: 'pickLanguage' }>, env: ActEnv) {
  const pill = page.locator(LANGUAGE).first();
  if (!(await pill.isVisible().catch(() => false))) throw new StepFailed(`couldn't find the language selector (${LANGUAGE})`);
  await highlight(page, pill, env);
  await pill.click({ timeout: 6000 });
  await page.waitForTimeout(900);
  const opt = page.locator(OPTION).filter({ hasText: textRe(a.match) }).first();
  await opt.click({ timeout: 6000 }).catch(() => {
    throw new StepFailed(`the language selector has no option “${a.match}”`);
  });
  await page.waitForTimeout(a.settleMs ?? 7000);
}

/** The runner's Downshift combobox: toggle, step the highlight and read it, Enter, then check what was committed. */
async function combobox(page: Page, a: Extract<WalkAction, { do: 'combobox' }>, env: ActEnv) {
  const box = rootOf(page, a).locator(a.selector).first();
  if (!(await box.isVisible().catch(() => false))) throw await missing(page, a.selector, a);
  await quiet(box.scrollIntoViewIfNeeded());
  await highlight(page, box, env);
  await page.waitForTimeout(400);
  await quiet(page.locator('[id^="downshift-"][id$="-toggle-button"]').first().click({ force: true }));
  await page.waitForTimeout(1200);
  const opts = page.locator('[role="option"]');
  await quiet(opts.first().waitFor({ state: 'visible', timeout: 5000 }));
  const texts = await opts.evaluateAll((e) => e.map((x) => (x.textContent ?? '').trim())).catch(() => [] as string[]);
  if (!texts.some((t) => t.includes(a.match))) {
    throw new StepFailed(`${a.selector} has no option “${a.match}”; its options: ${texts.slice(0, 8).map((t) => `“${t}”`).join(', ')}${texts.length > 8 ? ` (+${texts.length - 8} more)` : ''}`);
  }
  const input = box.locator('input[role="combobox"]');
  const active = async () => {
    const id = await input.getAttribute('aria-activedescendant').catch(() => null);
    return id ? ((await page.locator(`[id="${id}"]`).textContent().catch(() => null)) ?? '').trim() : '';
  };
  let landed = false;
  for (let k = 0; k < texts.length + 2; k++) {
    const cur = await active();
    if (cur && cur.includes(a.match)) {
      landed = true;
      break;
    }
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
  }
  if (!landed) throw new StepFailed(`${a.selector}: the highlight never reached “${a.match}” (listed, but not reachable by keyboard)`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const val = await input.inputValue().catch(() => '');
  if (!val) throw new StepFailed(`${a.selector} is still empty after picking “${a.match}”`);
  if (!val.includes(a.match)) throw new StepFailed(`${a.selector} took “${val}”, not “${a.match}”`);
}

/** One action, then its settle time. */
export async function act(page: Page, a: WalkAction, env: ActEnv) {
  switch (a.do) {
    case 'goto':
      await page.goto(new URL(a.path, env.origin).href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      break;
    case 'nav':
      await nav(page, a.group, a.item, env);
      break;
    case 'click':
      await click(page, a, env);
      break;
    case 'fill':
      await fill(page, a, env);
      break;
    case 'setFiles':
      await setFiles(page, a, env);
      break;
    case 'pickLanguage':
      await pickLanguage(page, a, env);
      break;
    case 'combobox':
      await combobox(page, a, env);
      break;
    case 'dismissModal':
      await dismissModal(page, env);
      break;
    case 'wait':
      await page.waitForTimeout(a.ms);
      break;
  }
  await page.waitForTimeout(a.settleMs ?? SETTLE_MS);
}

/** The runner's ui rung: the landing guard, the widgets, what the page says and doesn't. */
export async function check(page: Page, s: WalkStep) {
  const c = s.checks;
  if (c.ready && !(await page.locator(c.ready).first().waitFor({ state: 'visible', timeout: READY_MS }).then(() => true, () => false))) {
    throw new StepFailed(`the page never showed ${c.ready}`);
  }
  for (const sel of c.visible) if (!(await page.locator(sel).first().isVisible().catch(() => false))) throw new StepFailed(`${sel} isn't on the screen`);
  if (!c.textPresent.length && !c.textAbsent.length) return;
  const body = await page.locator('body').innerText().catch(() => '');
  for (const t of c.textPresent) if (!body.includes(t)) throw new StepFailed(`the screen doesn't say “${t}”`);
  for (const t of c.textAbsent) if (body.includes(t)) throw new StepFailed(`the screen says “${t}”, and it shouldn't`);
}

export interface AppShows {
  kind: 'error' | 'warning' | 'message' | 'validation';
  /** "Title — text", at most 240 characters. */
  text: string;
}

/** What the app shows on screen now: its topmost Mendix dialog, else a validation message; undefined for nothing. */
export async function appShows(page: Page): Promise<AppShows | undefined> {
  const got = await page
    // No named helpers inside: the function runs in the page as written (a bundler's name wrapper isn't there).
    .evaluate(() => {
      const shown = [...document.querySelectorAll<HTMLElement>('.mx-dialog, .mx-validation-message, .alert-danger')].filter((h) => !!(h.offsetWidth || h.offsetHeight || h.getClientRects().length) && getComputedStyle(h).visibility !== 'hidden');
      const dialogs = shown.filter((h) => h.classList.contains('mx-dialog'));
      const top = dialogs[dialogs.length - 1];
      if (top) {
        const cls = top.className;
        const kind = /mx-dialog-error/.test(cls) ? 'error' : /mx-dialog-warning/.test(cls) ? 'warning' : 'message';
        const title = (top.querySelector<HTMLElement>('.mx-dialog-caption, .mx-dialog-header h4, .modal-header h4')?.innerText ?? '').replace(/\s+/g, ' ').trim();
        const body = (top.querySelector<HTMLElement>('.mx-dialog-body, .modal-body') ?? top).innerText.replace(/\s+/g, ' ').trim();
        return { kind, text: title && body && !body.startsWith(title) ? `${title} — ${body}` : body || title };
      }
      const v = shown.filter((h) => !h.classList.contains('mx-dialog')).map((h) => h.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean);
      return v.length ? { kind: 'validation', text: [...new Set(v)].slice(0, 2).join(' · ') } : null;
    }, undefined)
    .catch(() => null);
  if (!got || !got.text) return undefined;
  return { kind: got.kind as AppShows['kind'], text: got.text.length > 240 ? `${got.text.slice(0, 239)}…` : got.text };
}

/** A failure's words with what the app showed first: "the app showed an error: “…” (then: …)". */
export function withApp(why: string, said: AppShows | undefined): string {
  if (!said) return why;
  const what = { error: 'showed an error', warning: 'showed a warning', message: 'showed a message', validation: 'marked a field' }[said.kind];
  return `the app ${what}: “${said.text}” (then: ${why})`;
}
