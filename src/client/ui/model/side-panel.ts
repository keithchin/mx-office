// The details panel's size: closed (the drawing gets the whole width; a tab on the drawing's edge opens it
// again), its usual width, or wider (dragged by its left edge, or "Wider" for up to 60% of the tab), and
// remembered per viewer in this browser. The same in full screen. On a phone the panel is a sheet under the
// drawing and only closes and opens. `clampWidth` and the storage are pure enough to test in node.

import { h } from '../dom';

const KEY = 'agent-office.model.side';
export const MIN_W = 220;
export const MAX_SHARE = 0.6;
/** The width "Wider" opens to, as a share of the tab: the most it may have. */
export const WIDE_SHARE = MAX_SHARE;

export interface SideState {
  closed: boolean;
  /** Width in px, or 0 for the usual width (the grid's own). */
  width: number;
}

export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const local = (): Store | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function recallSide(store: Store | null = local()): SideState {
  try {
    const v = JSON.parse(store?.getItem(KEY) ?? 'null') as Partial<SideState> | null;
    return { closed: v?.closed === true, width: typeof v?.width === 'number' && v.width > 0 && Number.isFinite(v.width) ? Math.round(v.width) : 0 };
  } catch {
    return { closed: false, width: 0 };
  }
}

export function rememberSide(s: SideState, store: Store | null = local()) {
  try {
    store?.setItem(KEY, JSON.stringify(s));
  } catch {
    // just for this visit, then
  }
}

/** A width the panel may have in a tab `total` px wide: at least MIN_W, at most 60% of it. */
export function clampWidth(w: number, total: number): number {
  return Math.round(Math.max(MIN_W, Math.min(w, Math.max(MIN_W, total * MAX_SHARE))));
}

export interface SidePanel {
  readonly state: SideState;
  /** The grip on the panel's left edge and its head (Wider/Narrower and ✕), put into the panel each time it's drawn. */
  head(): HTMLElement;
  /** The tab on the drawing's right edge that opens a closed panel. */
  readonly reopen: HTMLButtonElement;
  readonly grip: HTMLElement;
  setClosed(closed: boolean): void;
  /** Applies the state to the body grid (after a resize too). */
  apply(): void;
}

/** `body` is the explorer | drawing | panel grid; `changed` runs after the panel's size changed. */
export function sidePanel(body: HTMLElement, changed: () => void): SidePanel {
  let state = recallSide();
  const total = () => body.getBoundingClientRect().width || window.innerWidth;
  const reopen = h('button.mx-side-open', { type: 'button', title: 'Show the details panel', 'aria-label': 'Show the details panel' }, '‹ Details');
  const grip = h('div.mx-side-grip', { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the details panel (← → keys)', tabindex: '0', title: 'Drag to resize' });

  const save = () => rememberSide(state);
  const apply = () => {
    body.classList.toggle('mx-sideclosed', state.closed);
    reopen.hidden = !state.closed;
    if (state.width) body.style.setProperty('--mx-side-w', `${clampWidth(state.width, total())}px`);
    else body.style.removeProperty('--mx-side-w');
    grip.setAttribute('aria-valuenow', String(state.width || 0));
  };
  const set = (next: Partial<SideState>) => {
    state = { ...state, ...next };
    apply();
    save();
    changed();
  };
  reopen.addEventListener('click', () => set({ closed: false }));

  const current = () => state.width || (body.querySelector('.mx-side') as HTMLElement | null)?.getBoundingClientRect().width || 300;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = current();
    body.classList.add('mx-resizing');
    const move = (ev: PointerEvent) => {
      state = { ...state, width: clampWidth(startW + (startX - ev.clientX), total()) };
      apply();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      body.classList.remove('mx-resizing');
      save();
      changed();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    set({ width: clampWidth(current() + (e.key === 'ArrowLeft' ? 40 : -40), total()) });
  });
  grip.addEventListener('dblclick', () => set({ width: 0 }));

  const wide = () => state.width >= total() * WIDE_SHARE - 1;
  return {
    get state() {
      return state;
    },
    reopen,
    grip,
    head() {
      const isWide = wide();
      return h(
        'div.mx-side-head',
        {},
        h('button.mx-side-btn', { type: 'button', title: isWide ? 'Back to the usual width' : 'Make the panel wider', 'aria-pressed': String(isWide), onclick: () => set({ width: isWide ? 0 : clampWidth(total() * WIDE_SHARE, total()) }) }, isWide ? '› Narrower' : '‹ Wider'),
        h('button.mx-side-btn', { type: 'button', title: 'Hide the details panel', 'aria-label': 'Hide the details panel', onclick: () => set({ closed: true }) }, '✕'),
      );
    },
    setClosed(closed: boolean) {
      set({ closed });
    },
    apply,
  };
}
