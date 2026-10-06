// Which view the Command Center's console shows its worker in: Chat (the conversation, the default)
// or Terminal (its screen as it is). Set in ⚙️ Settings (setting.ts) or by the Chat | Terminal toggle on the
// console itself, and kept in this browser: every tab follows a change made in another.

export const PMC_VIEWS = ['chat', 'terminal'] as const;
export type PmcView = (typeof PMC_VIEWS)[number];

export const PMC_VIEW_LABEL: Record<PmcView, string> = { chat: 'Chat', terminal: 'Terminal' };

/** Where it's kept. */
export const PMC_VIEW_KEY = 'agent-office.pmc-view';

export const isPmcView = (v: unknown): v is PmcView => PMC_VIEWS.includes(v as PmcView);

/** The view picked in this browser, or Chat when none was (or storage is blocked). */
export function savedPmcView(): PmcView {
  try {
    const v = globalThis.localStorage?.getItem(PMC_VIEW_KEY);
    if (isPmcView(v)) return v;
  } catch {
    // storage blocked
  }
  return 'chat';
}

const listeners = new Set<(v: PmcView) => void>();

/** Picks `v`: kept in this browser (where it can be), and told to everything on this page that follows it. */
export function savePmcView(v: PmcView) {
  try {
    globalThis.localStorage?.setItem(PMC_VIEW_KEY, v);
  } catch {
    // Just for this visit, then.
  }
  for (const fn of listeners) fn(v);
}

let listening = false;

/** Hears every change of view, made on this page or in another tab. */
export function onPmcView(fn: (v: PmcView) => void): () => void {
  listeners.add(fn);
  if (!listening && typeof addEventListener === 'function') {
    listening = true;
    addEventListener('storage', (e: StorageEvent) => {
      if (e.key !== PMC_VIEW_KEY && e.key !== null) return;
      const v = savedPmcView();
      for (const l of listeners) l(v);
    });
  }
  return () => listeners.delete(fn);
}
