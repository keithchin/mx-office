// An unlicensed Mendix app's session cap, as measured on a local `mxcli run --local` (Mendix 11.12, trial
// licence, a scratch copy of a sample app on its own database): the runtime refuses a new session once 6 are open. It
// counts sessions, not people: the same account signed in twice holds two, and with guest access every
// browser that loads the app holds an anonymous one. A session lasts until it signs out, until it has been
// idle for the session timeout (10 minutes) and the runtime's next cleanup runs (every 5: measured, gone
// after about 14 minutes), or until the runtime restarts. Closing the window ends nothing. The refusal:
//   * the runtime log: `WARNING - Core: Maximum number of sessions exceeded! (You are currently using a
//     trial license)` (`WebUI` instead of `Core` when the Mendix client asked);
//   * on screen: login.html gets HTTP 560 and says only "Sign in failed."; the Mendix client gets HTTP 402
//     and says "The current license does not allow more users to sign in.".
// The walkthrough recorder and the 🌐 Live app tab both say it with these words. No Node imports.

/** How many sessions an unlicensed Mendix runtime keeps open at once. */
export const TRIAL_SESSIONS = 6;

/** The runtime log's line when it refuses one. */
export const CAP_LOG = /Maximum number of sessions exceeded/i;

/** What the app's own pages say when it refuses one. */
export const CAP_SAID = /licen[cs]e does not allow more users|maximum number of sessions/i;

/** Whether a runtime-log message, or text the app showed, is the session cap. */
export const isSessionCap = (text: string | undefined): boolean => !!text && (CAP_LOG.test(text) || CAP_SAID.test(text));

/** The short reason, after what the app said. */
export const CAP_REASON = `an unlicensed Mendix app keeps only ${TRIAL_SESSIONS} sessions open at once, signed-in and guest`;

/**
 * Run inside the app's page (Playwright's page.evaluate; self-contained, it's sent as source): ends the
 * page's Mendix session with the client's own `logout` xas action and the session's CSRF token, and
 * nothing else. (`mx.logout()` ends it too but then reloads, which in an app with guest access opens a new
 * anonymous session at once; there's no /logout address.) Whether it went.
 */
export async function endMendixSession(): Promise<boolean> {
  const mx = (globalThis as unknown as { mx?: { session?: { sessionData?: { csrftoken?: string } } } }).mx;
  const token = mx?.session?.sessionData?.csrftoken;
  if (!token) return false;
  const res = await fetch('/xas/', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'X-Csrf-Token': token }, body: JSON.stringify({ action: 'logout', params: {} }) });
  return res.ok;
}

/** The Live app tab's hint, once the app has refused a sign-in. */
export const CAP_HINT = `The app refused a session: without a Mendix licence it keeps only ${TRIAL_SESSIONS} open at once. Every sign-in holds one (the same account signed in twice holds two), and with guest access so does every window that just opened the app. Closing a window doesn’t end its session: it ends when it signs out, about 15 minutes after its window was closed, or when the app restarts. Sign out in windows of the app you don’t need, wait, or ⟳ Restart the app.`;
