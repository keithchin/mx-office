// Signing in to the recording app, once per account per batch (./index.ts). An unlicensed Mendix app keeps
// only 6 sessions open at once (measured: shared/liveapp/session-cap.ts): every sign-in holds one until it
// signs out, and with guest access every fresh browser that loads the app holds an anonymous one too;
// closing the browser releases neither (they go about 15 minutes later). So the
// recorder signs each account in once, in a context of its own that stays open (unfilmed) for the batch,
// hands its cookies to each filmed context (which then resumes that same session, never a new one), and
// signs out when the batch is done. Nothing else loads the app.
//
// The sign-in itself is the toolkit's journey runner's (its helpers.login): Mendix's own sign-in page
// (login.html, a static page that holds no session) when the app has one, else the app's address; wait
// for the form (the Mendix client renders it late), fill it, submit, wait to land in the app shell. Still
// on the sign-in page after that is a sign-in failure, with what the app said (a Mendix error dialog or the
// form's message), and the session cap said as such when it's that.

import { open, stat } from 'node:fs/promises';
import { installedChromium } from '../design/capture.js';
import { ADMIN_USER } from '../../shared/walkthroughs/identity.js';
import { CAP_LOG, CAP_REASON, endMendixSession, isSessionCap } from '../../shared/liveapp/session-cap.js';

export const VIEWPORT = { width: 1280, height: 720 } as const;

/* The bits of playwright-core used here and in the recorder. */
export interface Box { x: number; y: number; width: number; height: number }
export interface Loc {
  first(): Loc;
  innerText(o?: { timeout?: number }): Promise<string>;
  waitFor(o: { state: 'visible' | 'attached'; timeout: number }): Promise<void>;
  isVisible(o?: { timeout?: number }): Promise<boolean>;
  boundingBox(): Promise<Box | null>;
  press(key: string, o?: { timeout?: number }): Promise<void>;
  fill(v: string, o?: { timeout?: number }): Promise<void>;
  pressSequentially(v: string, o?: { delay?: number }): Promise<void>;
  inputValue(): Promise<string>;
  scrollIntoViewIfNeeded(o?: { timeout?: number }): Promise<void>;
  locator(sel: string): Loc;
  filter(o: { hasText: RegExp | string }): Loc;
  count(): Promise<number>;
  evaluate<R, A = undefined>(fn: (n: Element, a: A) => R, a?: A): Promise<R>;
  evaluateAll<R>(fn: (ns: Element[]) => R): Promise<R>;
  getAttribute(name: string): Promise<string | null>;
  textContent(): Promise<string | null>;
  setInputFiles(files: string[]): Promise<void>;
  click(o?: { timeout?: number; noWaitAfter?: boolean; force?: boolean }): Promise<void>;
}
export interface Page {
  goto(url: string, o?: { waitUntil?: 'load' | 'domcontentloaded'; timeout?: number }): Promise<unknown>;
  keyboard: { press(key: string): Promise<void> };
  locator(sel: string): Loc;
  evaluate<R, A>(fn: (a: A) => R, a: A): Promise<R>;
  waitForFunction<A>(fn: (a: A) => boolean, a: A, o?: { timeout?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(o: { path: string; type: 'png' }): Promise<unknown>;
  url(): string;
  video(): { path(): Promise<string> } | null;
}
export interface Ctx {
  newPage(): Promise<Page>;
  route(url: string, fn: (r: { request(): { url(): string }; continue(): Promise<void>; abort(): Promise<void> }) => unknown): Promise<void>;
  addInitScript(s: { content: string }): Promise<void>;
  storageState(): Promise<unknown>;
  request: { get(url: string, o?: { timeout?: number; maxRedirects?: number }): Promise<{ status(): number; text(): Promise<string> }> };
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

export interface Login {
  user: string;
  password: string;
}

/** The sign-in didn't let the account in: the recording ends with this reason, not with a failed step. */
export class SignInFailed extends Error {}

export const PASSWORD = '#passwordInput, input[type=password]';
/** Inside the app: the app shell or any page content (with no password field and off the login address). */
export const IN_APP = '.mx-page, .mx-navigationtree, .mx-navbar, .mx-scrollcontainer';
/** Where an app says why: a Mendix error or message dialog, the sign-in form's message. */
const SAID = '.mx-dialog-error .mx-dialog-body, .mx-dialog .mx-dialog-body, .login-message, .alert-danger, #loginMessage';

/** Whether `sel` becomes visible within `ms` (Playwright's isVisible never waits, whatever its timeout says). */
export const shows = (page: Page, sel: string, ms: number) =>
  page
    .locator(sel)
    .first()
    .waitFor({ state: 'visible', timeout: ms })
    .then(() => true)
    .catch(() => false);

/** On the sign-in page now: a login address, or a password field on screen. */
const onSignIn = (page: Page) =>
  page.evaluate((pw) => /login\.html|\/login(\b|\/|$)/.test(location.href) || [...document.querySelectorAll<HTMLElement>(pw)].some((e) => e.offsetParent !== null), PASSWORD).catch(() => false);

/** What the app says on screen now (a dialog, the form's message), never what was typed; '' for nothing. */
export async function appSays(page: Page): Promise<string> {
  const t = await page.locator(SAID).first().innerText({ timeout: 800 }).catch(() => '');
  return t.trim().replace(/\s+/g, ' ').slice(0, 160);
}

/** "couldn't sign in as X: …", with the app's words and, for the session cap, what it means. */
export function signInWords(user: string, said: string, otherwise: string): string {
  if (isSessionCap(said)) return `couldn't sign in as ${user}: the app says “${said}” (${CAP_REASON})`;
  return `couldn't sign in as ${user}: ${otherwise}${said ? ` (“${said}”)` : ''}`;
}

/** The runtime log's length now (0 when there's none). */
const logSize = (file: string | undefined) => (file ? stat(file).then((s) => s.size, () => 0) : Promise.resolve(0));

/** Whether the runtime logged the session cap after byte `from` (the last 256 KB at most are read). */
export async function capLoggedSince(file: string | undefined, from: number): Promise<boolean> {
  if (!file) return false;
  const size = await logSize(file);
  if (size <= from) return false;
  const start = Math.max(from, size - 256 * 1024);
  const fh = await open(file, 'r').catch(() => undefined);
  if (!fh) return false;
  try {
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    return CAP_LOG.test(buf.toString('utf8'));
  } finally {
    await fh.close();
  }
}

/** Requests to anywhere but the app's origin are refused. */
export const lockTo = (origin: string) => (c: Ctx) =>
  c.route('**/*', (r) => {
    let ok = false;
    try {
      ok = new URL(r.request().url()).origin === origin;
    } catch {
      ok = false;
    }
    return ok ? r.continue() : r.abort();
  });

/** Mendix's own sign-in page, when the app serves one (a plain request: it holds no session). */
async function signInPage(ctx: Ctx | undefined, url: string): Promise<string | undefined> {
  if (!ctx?.request) return undefined;
  const at = new URL('login.html', url).href;
  const res = await ctx.request.get(at, { timeout: 10_000, maxRedirects: 0 }).catch(() => undefined);
  if (!res || res.status() !== 200) return undefined;
  return /type=["']?password/i.test(await res.text().catch(() => '')) ? at : undefined;
}

/**
 * Signs in on the app's login form, as the toolkit's journey runner does: waits for the form or the app,
 * fills it, submits, waits to land in the app. Throws SignInFailed when the account isn't let in.
 * `ctx` (the page's context) lets it find Mendix's own sign-in page first.
 */
export async function signIn(page: Page, url: string, login: Login | undefined, ctx?: Ctx) {
  const who = login?.user || 'the demo user';
  if (login?.user && ADMIN_USER.test(login.user)) throw new SignInFailed(`walkthroughs never sign in as ${login.user}: set a demo user`);
  const form = login?.user ? await signInPage(ctx, url) : undefined;
  await page.goto(form ?? url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // The Mendix client renders the form (or routes straight into the app) a moment after the page loads.
  await page.waitForFunction((a) => !!document.querySelector(a.pw) || !!document.querySelector(a.app) || !!document.querySelector(a.said), { pw: PASSWORD, app: IN_APP, said: '.mx-dialog' }, { timeout: 20_000 }).catch(() => undefined);
  if (!(await shows(page, PASSWORD, 1500))) {
    const said = await appSays(page);
    if (isSessionCap(said) || (await onSignIn(page))) throw new SignInFailed(signInWords(who, said, 'the sign-in page never showed its form'));
    return;
  }
  if (!login?.user) throw new SignInFailed('the app asks for a sign-in and no demo user is known (tests/e2e/project.config.js, or Walkthroughs › demo user)');
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
  // In, unless the app put up an error over it (a session it couldn't make).
  const said = await appSays(page);
  if (inApp && !isSessionCap(said)) return;
  throw new SignInFailed(signInWords(login.user, said, 'still on the sign-in page'));
}

/** Signs the page's session out (shared/liveapp/session-cap.ts endMendixSession); whether it went. */
export const signOut = async (page: Page): Promise<boolean> => (await page.evaluate(endMendixSession, undefined).catch(() => false)) === true;

interface Held {
  ctx: Ctx;
  page: Page;
  state: unknown;
}

/**
 * The batch's sign-ins: one session per account, made the first time a journey needs it and kept (in an
 * unfilmed context that stays open, so the app keeps it alive) until close(), which signs each one out.
 * A sign-in that failed isn't tried again in the same batch: every try can cost a session.
 */
export class AppSessions {
  private browser?: Promise<Browser>;
  private held = new Map<string, Promise<Held>>();
  private closed = false;

  /** `runtimeLog`: the app's runtime log, where the cap shows when Mendix's sign-in page only says “Sign in failed.”. */
  constructor(private o: { url: string; launch?: () => Promise<Browser>; runtimeLog?: string }) {}

  /** The batch's browser (one, launched the first time it's needed). */
  browserNow(): Promise<Browser> {
    if (this.closed) return Promise.reject(new Error('the recording browser is closed'));
    this.browser ??= (this.o.launch ?? launchChromium)();
    return this.browser;
  }

  /** The cookies and storage of `login`'s session, signing it in the first time. Throws SignInFailed. */
  async storage(login: Login | undefined): Promise<unknown> {
    const key = login?.user ?? '';
    let p = this.held.get(key);
    if (!p) {
      p = this.signInOnce(login);
      this.held.set(key, p);
    }
    return (await p).state;
  }

  private async signInOnce(login: Login | undefined): Promise<Held> {
    const browser = await this.browserNow();
    const ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
    const from = await logSize(this.o.runtimeLog);
    try {
      await lockTo(new URL(this.o.url).origin)(ctx);
      const page = await ctx.newPage();
      await signIn(page, this.o.url, login, ctx);
      return { ctx, page, state: await ctx.storageState() };
    } catch (err) {
      await ctx.close().catch(() => undefined);
      // login.html says only “Sign in failed.” for a refused session: the runtime's log says which.
      if (err instanceof SignInFailed && !isSessionCap(err.message) && (await capLoggedSince(this.o.runtimeLog, from))) {
        throw new SignInFailed(`couldn't sign in as ${login?.user || 'the demo user'}: the app refused a new session (its log says “Maximum number of sessions exceeded”): ${CAP_REASON}`);
      }
      throw err;
    }
  }

  /** Signs every session out and closes the browser. Safe to call twice. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.held.values()) {
      const h = await p.catch(() => undefined);
      if (!h) continue;
      await signOut(h.page);
      await h.ctx.close().catch(() => undefined);
    }
    this.held.clear();
    const b = await this.browser?.catch(() => undefined);
    await b?.close().catch(() => undefined);
  }
}
