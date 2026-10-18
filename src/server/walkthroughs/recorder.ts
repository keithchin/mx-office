// The recorder: one walkthrough script played against the office's own recording copy of the app
// (app-instance/), in the office's headless Chromium (playwright-core; the browser is a child process),
// filmed with recordVideo. It signs in as the journey's identity (shared/walkthroughs/identity.ts, the same
// one the toolkit's journey runner uses) on the app's login form, in a context that isn't filmed, the way
// the runner's helpers.login does: wait for the form (the Mendix client renders it late), fill it, submit,
// wait to land in the app shell. Still on the sign-in page after that is a sign-in failure with that reason,
// never a failed first step. Then it films a fresh context that starts signed in: a chapter card, then each step with its caption, a step counter and a highlight box
// around what it's about to click or type into (./overlay.ts), a screenshot at the end of each step.
//
// Honest by construction: the first step that fails (an action that can't be done, a check that doesn't
// hold, a step the script can't walk) is captioned as failed, kept on screen, screenshotted, and ends the
// recording as failed; the steps after it are "not run". Every request to anywhere but the proxy's origin
// is refused, so the recording can only ever see the app. Cancel (the signal) closes the browser.

import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { installedChromium } from '../design/capture.js';
import { OVERLAY_SCRIPT } from './overlay.js';
import { RECORDING_CAP_MS, type ManifestStep, type WalkAction, type WalkScript, type WalkStep } from '../../shared/walkthroughs/types.js';
import { ADMIN_USER } from '../../shared/walkthroughs/identity.js';

export { ADMIN_USER };
export const VIEWPORT = { width: 1280, height: 720 } as const;

/* The bits of playwright-core used here. */
interface Box { x: number; y: number; width: number; height: number }
interface Loc {
  first(): Loc;
  innerText(o?: { timeout?: number }): Promise<string>;
  waitFor(o: { state: 'visible' | 'attached'; timeout: number }): Promise<void>;
  isVisible(o?: { timeout?: number }): Promise<boolean>;
  boundingBox(): Promise<Box | null>;
  click(o?: { timeout?: number; noWaitAfter?: boolean }): Promise<void>;
  press(key: string, o?: { timeout?: number }): Promise<void>;
  fill(v: string, o?: { timeout?: number }): Promise<void>;
  pressSequentially(v: string, o?: { delay?: number }): Promise<void>;
  inputValue(): Promise<string>;
  scrollIntoViewIfNeeded(o?: { timeout?: number }): Promise<void>;
}
interface Page {
  goto(url: string, o?: { waitUntil?: 'load' | 'domcontentloaded'; timeout?: number }): Promise<unknown>;
  locator(sel: string): Loc;
  evaluate<R, A>(fn: (a: A) => R, a: A): Promise<R>;
  waitForFunction<A>(fn: (a: A) => boolean, a: A, o?: { timeout?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(o: { path: string; type: 'png' }): Promise<unknown>;
  url(): string;
  video(): { path(): Promise<string> } | null;
}
interface Ctx {
  newPage(): Promise<Page>;
  route(url: string, fn: (r: { request(): { url(): string }; continue(): Promise<void>; abort(): Promise<void> }) => unknown): Promise<void>;
  addInitScript(s: { content: string }): Promise<void>;
  storageState(): Promise<unknown>;
  close(): Promise<void>;
}
export interface Browser {
  newContext(o: Record<string, unknown>): Promise<Ctx>;
  close(): Promise<void>;
}

export async function launchChromium(): Promise<Browser> {
  const pw = (await import('playwright-core')) as unknown as { chromium: { launch(o: { headless: boolean; timeout: number; executablePath?: string }): Promise<Browser> } };
  return pw.chromium.launch({ headless: true, timeout: 30_000 }).catch(async (err: Error) => {
    const exe = /Executable doesn't exist/i.test(err.message) ? await installedChromium() : undefined;
    if (!exe) throw err;
    return pw.chromium.launch({ headless: true, timeout: 30_000, executablePath: exe });
  });
}

export interface RecordInput {
  /** The office's recording copy of the app: http://127.0.0.1:<port>/ (the only origin it may reach). */
  url: string;
  script: WalkScript;
  /** Where raw.webm and steps/NN.png go. */
  outDir: string;
  login?: { user: string; password: string };
  /** The least time a step stays on screen (its narration's length). */
  holdMs?(step: WalkStep): number;
  signal: AbortSignal;
  progress?(line: string): void;
  launch?(): Promise<Browser>;
  /** How long the chapter card and the final card stay (tests shorten them). */
  cardMs?: number;
  /** The least time a step stays on screen without narration. */
  stepMs?: number;
}

export interface RecordResult {
  status: 'passed' | 'failed' | 'cancelled' | 'error';
  failure?: { step?: number; why: string };
  steps: ManifestStep[];
  /** raw.webm in outDir, when anything was filmed. */
  video?: string;
  durationMs: number;
}

class StepFailed extends Error {}
const short = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0].replace(/\s+/g, ' ').slice(0, 220);
const pad = (n: number) => String(n).padStart(2, '0');

/** The sign-in didn't let the account in: the recording ends with this reason, not with a failed step. */
export class SignInFailed extends Error {}

const PASSWORD = '#passwordInput, input[type=password]';
/** Inside the app: the app shell or any page content (with no password field and off the login address). */
const IN_APP = '.mx-page, .mx-navigationtree, .mx-navbar, .mx-scrollcontainer';

/** Whether `sel` becomes visible within `ms` (Playwright's isVisible never waits, whatever its timeout says). */
const shows = (page: Page, sel: string, ms: number) =>
  page
    .locator(sel)
    .first()
    .waitFor({ state: 'visible', timeout: ms })
    .then(() => true)
    .catch(() => false);

/** On the sign-in page now: a login address, or a password field on screen. */
const onSignIn = (page: Page) =>
  page.evaluate((pw) => /login\.html|\/login(\b|\/|$)/.test(location.href) || [...document.querySelectorAll<HTMLElement>(pw)].some((e) => e.offsetParent !== null), PASSWORD).catch(() => false);

/**
 * Signs in on the app's login form, as the toolkit's journey runner does: waits for the form or the app,
 * fills it, submits, waits to land in the app. Throws SignInFailed when the account isn't let in.
 */
export async function signIn(page: Page, url: string, login: RecordInput['login']) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // The Mendix client renders the form (or routes straight into the app) a moment after the page loads.
  await page.waitForFunction((a) => !!document.querySelector(a.pw) || !!document.querySelector(a.app), { pw: PASSWORD, app: IN_APP }, { timeout: 20_000 }).catch(() => undefined);
  if (!(await shows(page, PASSWORD, 1500))) {
    if (await onSignIn(page)) throw new SignInFailed(`couldn't sign in as ${login?.user ?? 'the demo user'}: the sign-in page never showed its form`);
    return;
  }
  if (!login?.user) throw new SignInFailed('the app asks for a sign-in and no demo user is known (tests/e2e/project.config.js, or Walkthroughs › demo user)');
  if (ADMIN_USER.test(login.user)) throw new SignInFailed(`walkthroughs never sign in as ${login.user}: set a demo user`);
  await page.waitForTimeout(400);
  await page.locator('#usernameInput, input[type=text]').first().fill(login.user);
  const pw = page.locator(PASSWORD).first();
  await pw.fill(login.password);
  const btn = page.locator('#loginButton, button[type=submit]').first();
  if (await shows(page, '#loginButton, button[type=submit]', 1500)) await btn.click({ timeout: 5000, noWaitAfter: true }).catch(() => pw.press('Enter').catch(() => undefined));
  else await pw.press('Enter').catch(() => undefined);
  const inApp = await page
    .waitForFunction((a) => !/login\.html|\/login(\b|\/|$)/.test(location.href) && !document.querySelector(a.pw) && !!document.querySelector(a.app), { pw: PASSWORD, app: IN_APP }, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (inApp) return;
  // What the app said, never what was typed.
  const said = (await page.locator('.login-message, .alert-danger, #loginMessage').first().innerText({ timeout: 1000 }).catch(() => '')).trim().replace(/\s+/g, ' ').slice(0, 160);
  throw new SignInFailed(`couldn't sign in as ${login.user}: still on the sign-in page${said ? ` (“${said}”)` : ''}`);
}

async function boxOf(page: Page, sel: string): Promise<Box | null> {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
  return el.boundingBox().catch(() => null);
}

/** Shows the highlight around `sel` for a moment, so the viewer sees where the click lands. */
async function point(page: Page, sel: string) {
  const el = page.locator(sel).first();
  if (!(await shows(page, sel, 6000))) throw new StepFailed(`${sel} isn't on the screen`);
  const box = await boxOf(page, sel);
  await page.evaluate((b) => (window as unknown as { __wt: { highlight(b: unknown): void } }).__wt.highlight(b), box);
  await page.waitForTimeout(550);
}

async function act(page: Page, a: WalkAction, origin: string) {
  switch (a.do) {
    case 'goto':
      await page.goto(new URL(a.path, origin).href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return;
    case 'nav': {
      for (const title of [a.group, a.item].filter((t): t is string => !!t)) {
        const sel = `.mx-navigationtree a[title="${title.replace(/"/g, '\\"')}"], .mx-navbar a[title="${title.replace(/"/g, '\\"')}"]`;
        await point(page, sel);
        await page.locator(sel).first().click({ timeout: 5000 });
        await page.waitForTimeout(400);
      }
      return;
    }
    case 'click':
      await point(page, a.selector);
      await page.locator(a.selector).first().click({ timeout: 6000 });
      return;
    case 'fill': {
      const sel = `${a.selector} input, ${a.selector} textarea, input${a.selector}, textarea${a.selector}`;
      await point(page, sel);
      const el = page.locator(sel).first();
      await el.fill('');
      await el.pressSequentially(a.value, { delay: 25 });
      return;
    }
    case 'combobox': {
      await point(page, a.selector);
      await page.locator(a.selector).first().click({ timeout: 6000 });
      const opt = page.locator(`[role="option"]:has-text("${a.match.replace(/"/g, '\\"')}")`).first();
      if (!(await opt.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false))) throw new StepFailed(`no option “${a.match}” in ${a.selector}`);
      await opt.click({ timeout: 5000 });
      const val = await page.locator(`${a.selector} input`).first().inputValue().catch(() => '');
      if (val && !val.includes(a.match)) throw new StepFailed(`${a.selector} took “${val}”, not “${a.match}”`);
      return;
    }
    case 'dismissModal': {
      const btn = page.locator('.mx-dialog-footer button, .mx-name-closeButton').first();
      if (await btn.waitFor({ state: 'visible', timeout: 800 }).then(() => true, () => false)) await btn.click({ timeout: 3000 });
      return;
    }
    case 'wait':
      await page.waitForTimeout(a.ms);
      return;
  }
}

async function check(page: Page, s: WalkStep) {
  const c = s.checks;
  if (c.ready) {
    await page.locator(c.ready).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
      throw new StepFailed(`the page never showed ${c.ready}`);
    });
  }
  for (const sel of c.visible) {
    await page.locator(sel).first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => {
      throw new StepFailed(`${sel} isn't on the screen`);
    });
  }
  for (const t of c.textPresent) {
    await page.waitForFunction((x) => document.body.innerText.includes(x), t, { timeout: 6000 }).catch(() => {
      throw new StepFailed(`the screen doesn't say “${t}”`);
    });
  }
  for (const t of c.textAbsent) if (await page.evaluate((x) => document.body.innerText.includes(x), t)) throw new StepFailed(`the screen says “${t}”, and it shouldn't`);
}

const wt = <A extends unknown[]>(page: Page, fn: string, ...args: A) => page.evaluate(([f, a]) => (window as unknown as { __wt: Record<string, (...x: unknown[]) => void> }).__wt[f](...a), [fn, args] as [string, unknown[]]).catch(() => undefined);

/** Films the script. Never throws: what went wrong is in the result. */
export async function record(i: RecordInput): Promise<RecordResult> {
  const origin = new URL(i.url).origin;
  const card = i.cardMs ?? 2500;
  const stepMin = i.stepMs ?? 1400;
  const steps: ManifestStep[] = i.script.steps.map((s) => ({ n: s.n, caption: s.caption, status: 'not-run' }));
  await mkdir(path.join(i.outDir, 'steps'), { recursive: true });
  let browser: Browser | undefined;
  const stop = () => void browser?.close().catch(() => undefined);
  i.signal.addEventListener('abort', stop, { once: true });
  let page: Page | undefined;
  let ctx: Ctx | undefined;
  let t0 = Date.now();
  const res: RecordResult = { status: 'passed', steps, durationMs: 0 };
  try {
    browser = await (i.launch ?? launchChromium)();
    if (i.signal.aborted) throw new Error('cancelled');
    const lock = async (c: Ctx) =>
      c.route('**/*', (r) => {
        let ok = false;
        try {
          ok = new URL(r.request().url()).origin === origin;
        } catch {
          ok = false;
        }
        return ok ? r.continue() : r.abort();
      });
    i.progress?.(`Signing in as ${i.login?.user ?? 'the demo user'}…`);
    const pre = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
    await lock(pre);
    await signIn(await pre.newPage(), i.url, i.login);
    const storageState = await pre.storageState();
    await pre.close();
    ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block', storageState, recordVideo: { dir: path.join(i.outDir, 'video-tmp'), size: VIEWPORT } });
    await lock(ctx);
    await ctx.addInitScript({ content: OVERLAY_SCRIPT });
    page = await ctx.newPage();
    t0 = Date.now();
    await page.goto(i.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(600);
    // The session didn't carry over to the filmed context: the same sign-in failure, said as one.
    if (await shows(page, PASSWORD, 2500)) throw new SignInFailed(`couldn't sign in as ${i.login?.user ?? 'the demo user'}: still on the sign-in page`);
    await wt(page, 'chapter', i.script.title, i.script.requirement.length ? `Shows ${i.script.requirement.slice(0, 4).join(', ')}` : `${i.script.steps.length} steps`);
    await page.waitForTimeout(card);
    const total = i.script.steps.length;
    for (const s of i.script.steps) {
      if (Date.now() - t0 > RECORDING_CAP_MS) {
        res.status = 'error';
        res.failure = { step: s.n, why: `stopped after ${RECORDING_CAP_MS / 60_000} minutes: a walkthrough is a short workflow` };
        break;
      }
      const out = steps[s.n - 1];
      out.startMs = Date.now() - t0;
      i.progress?.(`Step ${s.n} of ${total}: ${s.caption}`);
      await wt(page, 'step', s.n, total, s.caption, false);
      try {
        if (s.blocked) throw new StepFailed(s.blocked);
        for (const a of s.actions) {
          if (i.signal.aborted) throw new Error('cancelled');
          if (s.actions.length > 1 || a.caption !== s.caption) await wt(page, 'step', s.n, total, a.caption === s.caption ? s.caption : `${s.caption} — ${a.caption}`, false);
          await act(page, a, origin);
          await wt(page, 'highlight', null);
          await page.waitForTimeout(350);
        }
        await check(page, s);
        await wt(page, 'step', s.n, total, s.caption, false);
        const held = Date.now() - t0 - out.startMs;
        const want = Math.max(stepMin, i.holdMs?.(s) ?? 0);
        if (held < want) await page.waitForTimeout(want - held);
        out.screenshot = `steps/${pad(s.n)}.png`;
        await page.screenshot({ path: path.join(i.outDir, out.screenshot), type: 'png' });
        out.status = 'passed';
        out.endMs = Date.now() - t0;
      } catch (err) {
        if (i.signal.aborted) throw err;
        const why = err instanceof StepFailed ? err.message : short(err);
        out.status = 'failed';
        out.why = why;
        await wt(page, 'highlight', null);
        await wt(page, 'step', s.n, total, `Step ${s.n} failed: ${why}`, true);
        await page.waitForTimeout(2000);
        out.screenshot = `steps/${pad(s.n)}.png`;
        await page.screenshot({ path: path.join(i.outDir, out.screenshot), type: 'png' }).catch(() => undefined);
        out.endMs = Date.now() - t0;
        res.status = 'failed';
        res.failure = { step: s.n, why };
        break;
      }
    }
    if (res.status === 'passed') {
      await wt(page, 'chapter', 'Walkthrough complete', `${total} of ${total} steps passed`);
      await page.waitForTimeout(Math.min(card, 1500));
    }
  } catch (err) {
    if (i.signal.aborted) {
      res.status = 'cancelled';
      res.failure = { why: typeof i.signal.reason === 'string' ? i.signal.reason : 'cancelled' };
    } else if (err instanceof SignInFailed) {
      res.status = 'error';
      res.failure = { why: err.message };
    } else {
      res.status = 'error';
      res.failure = { why: short(err) };
    }
  } finally {
    res.durationMs = Date.now() - t0;
    const video = page?.video();
    await ctx?.close().catch(() => undefined);
    const raw = await video?.path().catch(() => undefined);
    if (raw) {
      const to = path.join(i.outDir, 'raw.webm');
      if (await rename(raw, to).then(() => true, () => false)) res.video = to;
    }
    i.signal.removeEventListener('abort', stop);
    await browser?.close().catch(() => undefined);
  }
  return res;
}
