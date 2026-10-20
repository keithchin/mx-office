// The recorder: one walkthrough script played against the office's own recording copy of the app
// (app-instance/), in the office's headless Chromium (playwright-core; the browser is a child process),
// filmed with recordVideo. It signs in as the journey's identity (shared/walkthroughs/identity.ts, the same
// one the toolkit's journey runner uses) through the batch's sign-ins (./signin.ts: one session per account
// per batch, signed in once in a context that isn't filmed, signed out when the batch is done, because an
// unlicensed Mendix app keeps only 6 sessions open). A sign-in that doesn't get in is a sign-in failure with
// what the app said, never a failed first step. Then it films a fresh context that starts with the account's
// cookies (the same session): a chapter card, then each step with its caption, a step counter and a highlight
// box around what it's about to click or type into (./overlay.ts), a screenshot at the end of each step.
// Each action and check is the toolkit journey runner's, with its semantics (./actions.ts); a step's data
// (OQL) and trace checks aren't run, and its card says so. A failed step says what the app showed, if
// anything (an error dialog, a validation message), apart from what the recorder couldn't find.
//
// Honest by construction: the first step that fails (an action that can't be done, a check that doesn't
// hold, a step the script can't walk) is captioned as failed, kept on screen, screenshotted, and ends the
// recording as failed; the steps after it are "not run". Every request to anywhere but the proxy's origin
// is refused, so the recording can only ever see the app. Cancel (the signal) closes the filmed context.
// With film: false it plays a journey only to set up a later one's start state: no video, cards or pauses.

import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { OVERLAY_SCRIPT } from './overlay.js';
import { RECORDING_CAP_MS, type ManifestStep, type WalkScript, type WalkStep } from '../../shared/walkthroughs/types.js';
import { ADMIN_USER } from '../../shared/walkthroughs/identity.js';
import { isSessionCap } from '../../shared/liveapp/session-cap.js';
import { AppSessions, PASSWORD, SignInFailed, VIEWPORT, appSays, lockTo, shows, signInWords, type Browser, type Ctx, type Login, type Page } from './signin.js';
import { StepFailed, act, appShows, check, withApp } from './actions.js';

export { ADMIN_USER, AppSessions, SignInFailed, VIEWPORT };
export { launchChromium, signIn, type Browser } from './signin.js';

export interface RecordInput {
  /** The office's recording copy of the app: http://127.0.0.1:<port>/ (the only origin it may reach). */
  url: string;
  script: WalkScript;
  /** Where raw.webm and steps/NN.png go. */
  outDir: string;
  login?: Login;
  /** The batch's sign-ins (./signin.ts): one session per account, reused; without it, one of its own, signed out at the end. */
  sessions?: AppSessions;
  /** The least time a step stays on screen (its narration's length). */
  holdMs?(step: WalkStep): number;
  signal: AbortSignal;
  progress?(line: string): void;
  launch?(): Promise<Browser>;
  /** How long the chapter card and the final card stay (tests shorten them). */
  cardMs?: number;
  /** The least time a step stays on screen without narration. */
  stepMs?: number;
  /** false: played only to set up another journey's start state (no video, no cards, no screenshots, no pauses). */
  film?: boolean;
  /** The recorded commit's files (the recording app's workspace): setFiles attaches from its tests/e2e/fixtures only. */
  workspace?: string;
}

export interface RecordResult {
  status: 'passed' | 'failed' | 'cancelled' | 'error';
  failure?: { step?: number; why: string; said?: string };
  steps: ManifestStep[];
  /** raw.webm in outDir, when anything was filmed. */
  video?: string;
  durationMs: number;
}

const short = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0].replace(/\s+/g, ' ').slice(0, 220);
const pad = (n: number) => String(n).padStart(2, '0');

const wt = <A extends unknown[]>(page: Page, fn: string, ...args: A) => page.evaluate(([f, a]) => (window as unknown as { __wt: Record<string, (...x: unknown[]) => void> }).__wt[f](...a), [fn, args] as [string, unknown[]]).catch(() => undefined);

/** Films the script. Never throws: what went wrong is in the result. */
export async function record(i: RecordInput): Promise<RecordResult> {
  const origin = new URL(i.url).origin;
  const film = i.film !== false;
  const card = film ? (i.cardMs ?? 2500) : 0;
  const stepMin = film ? (i.stepMs ?? 1400) : 0;
  const steps: ManifestStep[] = i.script.steps.map((s) => ({ n: s.n, caption: s.caption, status: 'not-run', ...(s.unchecked ? { notes: [s.unchecked] } : {}) }));
  if (film) await mkdir(path.join(i.outDir, 'steps'), { recursive: true });
  // The batch's sign-ins, or (alone) one of its own that signs out when this recording is done.
  const own = !i.sessions;
  const sessions = i.sessions ?? new AppSessions({ url: i.url, ...(i.launch ? { launch: i.launch } : {}) });
  let page: Page | undefined;
  let ctx: Ctx | undefined;
  // Cancel ends the filmed context (and a browser of its own); the batch's browser goes with the batch.
  const stop = () => void (own ? sessions.close() : ctx?.close())?.catch(() => undefined);
  i.signal.addEventListener('abort', stop, { once: true });
  let t0 = Date.now();
  const res: RecordResult = { status: 'passed', steps, durationMs: 0 };
  const who = i.login?.user || 'the demo user';
  try {
    if (i.signal.aborted) throw new Error('cancelled');
    i.progress?.(`Signing in as ${who}…`);
    const storageState = await sessions.storage(i.login);
    if (i.signal.aborted) throw new Error('cancelled');
    const browser = await sessions.browserNow();
    // The filmed context starts with the account's cookies, so the app resumes that session: no new one.
    ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block', storageState, ...(film ? { recordVideo: { dir: path.join(i.outDir, 'video-tmp'), size: VIEWPORT } } : {}) });
    await lockTo(origin)(ctx);
    await ctx.addInitScript({ content: OVERLAY_SCRIPT });
    page = await ctx.newPage();
    t0 = Date.now();
    await page.goto(i.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(600);
    // The session didn't carry over to the filmed context, or the app refused it: a sign-in failure, said as one.
    if (await shows(page, PASSWORD, 2500)) throw new SignInFailed(signInWords(who, await appSays(page), 'still on the sign-in page'));
    const said = await appSays(page);
    if (isSessionCap(said)) throw new SignInFailed(signInWords(who, said, 'the app refused the session'));
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
      const env = { origin, film, ...(i.workspace ? { workspace: i.workspace } : {}), note: (line: string) => (out.notes ??= []).push(line) };
      try {
        if (s.blocked) throw new StepFailed(s.blocked);
        for (const a of s.actions) {
          if (i.signal.aborted) throw new Error('cancelled');
          if (s.actions.length > 1 || a.caption !== s.caption) await wt(page, 'step', s.n, total, a.caption === s.caption ? s.caption : `${s.caption} — ${a.caption}`, false);
          await act(page, a, env);
          await wt(page, 'highlight', null);
        }
        await check(page, s);
        await wt(page, 'step', s.n, total, s.caption, false);
        const held = Date.now() - t0 - out.startMs;
        const want = film ? Math.max(stepMin, i.holdMs?.(s) ?? 0) : 0;
        if (held < want) await page.waitForTimeout(want - held);
        if (film) {
          out.screenshot = `steps/${pad(s.n)}.png`;
          await page.screenshot({ path: path.join(i.outDir, out.screenshot), type: 'png' });
        }
        out.status = 'passed';
        out.endMs = Date.now() - t0;
      } catch (err) {
        if (i.signal.aborted) throw err;
        // What the app has on screen (an error dialog, a validation message) comes first: the app refused, not the recorder.
        const said = s.blocked ? undefined : await appShows(page);
        const why = withApp(err instanceof StepFailed ? err.message : short(err), said);
        out.status = 'failed';
        out.why = why;
        if (said) out.said = said.text;
        await wt(page, 'highlight', null);
        await wt(page, 'step', s.n, total, `Step ${s.n} failed: ${why}`, true);
        if (film) {
          await page.waitForTimeout(2000);
          out.screenshot = `steps/${pad(s.n)}.png`;
          await page.screenshot({ path: path.join(i.outDir, out.screenshot), type: 'png' }).catch(() => undefined);
        }
        out.endMs = Date.now() - t0;
        res.status = 'failed';
        res.failure = { step: s.n, why, ...(said ? { said: said.text } : {}) };
        break;
      }
    }
    if (res.status === 'passed' && film) {
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
    if (own) await sessions.close().catch(() => undefined);
  }
  return res;
}
