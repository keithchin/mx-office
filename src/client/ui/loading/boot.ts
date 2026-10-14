// Mx Office's loading screen: the page draws it itself (#ao-boot, inline in lite.html, pixel.html,
// home.html and m.html, with window.__aoBoot) before any code loads; this moves it on through what the
// page really waits for: the code loaded, the sign-in checked, the socket up, the office's data in, and
// the first view drawn, then it fades. The connection lost brings it back after a moment as
// "Reconnecting to Mx Office…" until the office answers: not "restarting", since a computer waking from
// sleep loses it too (13 Oct 2026). A real restart says so itself (office-down.ts, the close code).
// Each step's first time is a performance mark (`ao:boot:<step>`). Pages without the block ignore it.

export type BootStep = 'bundle' | 'session' | 'socket' | 'data' | 'view';

interface BootApi {
  step(s: BootStep): void;
  down(): void;
}

const api = (): BootApi | undefined => (window as unknown as { __aoBoot?: BootApi }).__aoBoot;
const marked = new Set<BootStep>();

export function bootStep(s: BootStep) {
  if (!marked.has(s)) {
    marked.add(s);
    try {
      performance.mark(`ao:boot:${s}`);
    } catch {
      // No marks: the screen still moves on.
    }
  }
  api()?.step(s);
}

/** The connection went: the screen comes back (after a moment), reconnecting. */
export const bootDown = () => api()?.down();

/** The view drawn: two frames after the office's data came in. */
export const bootDrawn = () => requestAnimationFrame(() => requestAnimationFrame(() => bootStep('view')));

// This module runs with the page's code: the bundle is in.
bootStep('bundle');
