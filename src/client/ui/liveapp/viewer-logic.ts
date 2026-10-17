// The live app viewer's own logic, apart from the page: the addresses it knows the frame went to, Back and
// Forward over them, what the address field may navigate to, and the device widths and zoom.
//
// The app runs on another port, so another origin: the office's page can't read where the frame is now
// (its location and its history are the app's), and can't call its history.back(). What it can do is
// point the frame at an address. So Back and Forward step through the addresses the viewer itself sent
// the frame to (Home, the address field, a reload), and a click inside the app that moved it elsewhere is
// only seen as "the frame loaded something" (a full page load) or not at all (the app's own client-side
// navigation, which is most of a Mendix app's). The viewer says so instead of pretending. Pure.

export interface ViewerHistory {
  /** Paths within the app ("/", "/p/check-sheets"), oldest first. */
  stack: string[];
  at: number;
}

export const freshHistory = (path = '/'): ViewerHistory => ({ stack: [path], at: 0 });

/** Goes to `path` (drops anything Forward had, as browsers do); the same path as now changes nothing. */
export function go(h: ViewerHistory, path: string): ViewerHistory {
  if (h.stack[h.at] === path) return h;
  const stack = [...h.stack.slice(0, h.at + 1), path].slice(-50);
  return { stack, at: stack.length - 1 };
}

export const canBack = (h: ViewerHistory) => h.at > 0;
export const canForward = (h: ViewerHistory) => h.at < h.stack.length - 1;
export const back = (h: ViewerHistory): ViewerHistory => (canBack(h) ? { ...h, at: h.at - 1 } : h);
export const forward = (h: ViewerHistory): ViewerHistory => (canForward(h) ? { ...h, at: h.at + 1 } : h);
export const current = (h: ViewerHistory) => h.stack[h.at] ?? '/';

/**
 * What the address field may go to: a path within the app ("/p/x", "p/x", "?a=1", "#x") or a full address
 * on the app's own origin, as a path; null for anything else (another site, another port, javascript:).
 */
export function inApp(input: string, appBase: string): string | null {
  const text = input.trim();
  if (!text) return '/';
  let base: URL;
  try {
    base = new URL(appBase);
  } catch {
    return null;
  }
  let u: URL;
  try {
    u = /^[a-z][a-z0-9+.-]*:/i.test(text) ? new URL(text) : new URL(text.startsWith('/') || text.startsWith('?') || text.startsWith('#') ? text : `/${text}`, base);
  } catch {
    return null;
  }
  if (u.origin !== base.origin || !/^https?:$/.test(u.protocol)) return null;
  return `${u.pathname}${u.search}${u.hash}` || '/';
}

/** The full address of a path in the app. */
export const urlOf = (appBase: string, path: string) => new URL(path || '/', appBase).toString();

/** A hard reload's address: the same path with a throwaway query, so nothing cached answers it. */
export function bust(path: string, now: number): string {
  const [p, hash = ''] = path.split('#');
  return `${p}${p.includes('?') ? '&' : '?'}_mxoffice=${now}${hash ? `#${hash}` : ''}`;
}

export type Device = 'desktop' | 'tablet' | 'phone';
export type Zoom = 'fit' | '100';

/** The frame's width per device; desktop fills the box. */
export const DEVICE_WIDTH: Record<Device, number | null> = { desktop: null, tablet: 820, phone: 390 };
export const DEVICE_LABEL: Record<Device, string> = { desktop: 'Desktop', tablet: 'Tablet', phone: 'Phone' };

/** How much to shrink a device-wide frame to fit `box` px ("fit"), never grown; 1 at 100% or on desktop. */
export function scaleFor(device: Device, zoom: Zoom, box: number): number {
  const w = DEVICE_WIDTH[device];
  if (!w || zoom === '100' || box <= 0) return 1;
  return Math.min(1, box / w);
}
