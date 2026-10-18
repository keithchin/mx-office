// Open live app from the office's 🌐 Live app tab (src/client/ui/liveapp/open.ts): a link whose target is
// the project's window name ("mxoffice-liveapp-<project>") to the app's address on this machine. The
// desktop app opens it as a window of its own (desktop/src/liveapp.ts) instead of the default browser.
// What counts as such a request is here, without Electron.

/** The window names the office gives its Live app links. */
export const LIVE_WINDOW = /^mxoffice-liveapp-[\w-]{1,160}$/;

export interface LiveWindowRequest {
  /** The window's name: one window per project. */
  key: string;
  url: string;
  /** The app's origin: the window stays on it; anything else opens in the default browser. */
  origin: string;
}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A Live app window to open, or undefined: the office's window name, plain HTTP (mxcli and the office's
 * recording proxy serve no TLS) on this machine, and never the office's own port.
 */
export function liveWindowRequest(url: string, frameName: string, officePort: number): LiveWindowRequest | undefined {
  if (!LIVE_WINDOW.test(frameName)) return undefined;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' || !LOCAL.has(u.hostname) || !u.port || u.port === String(officePort)) return undefined;
  return { key: frameName, url: u.toString(), origin: u.origin };
}

/** Whether `url` is on the Live app window's own origin. */
export function onOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
