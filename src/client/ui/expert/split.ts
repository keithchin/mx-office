// The session screen's split between the live preview and the session (design notes, decision 11): a
// divider you drag (a grip shows on hover, col-resize cursor, both sides kept at 320 px or more),
// double-click or Enter for 50/50, arrow keys when it has the focus (Shift for a bigger step), Home and End
// for the limits; the header's App | Both | Chat presets; and swap sides. Remembered per project in this
// browser (localStorage, every read and write in try/catch: a private window just starts at 50/50). The
// rules are shared/expert.ts's, so tests run them.

import { clampSplit, readSplit, splitKey, type SplitFocus, type SplitPrefs } from '../../../shared/expert';

const KEY = 'mxo.expert.split.';

export function loadSplit(floor: string): SplitPrefs {
  try {
    return readSplit(JSON.parse(localStorage.getItem(KEY + floor) ?? 'null'));
  } catch {
    return readSplit(null);
  }
}

function saveSplit(floor: string, p: SplitPrefs) {
  try {
    localStorage.setItem(KEY + floor, JSON.stringify(p));
  } catch {
    // not kept: the next visit starts at the default
  }
}

export interface Split {
  /** Puts the saved split of `floor` in place. */
  load(floor: string): void;
  focus(f: SplitFocus): void;
  swap(): void;
  prefs(): SplitPrefs;
  /** Hears every change (the panes refit their contents). */
  onChange(fn: (p: SplitPrefs) => void): void;
}

/** `row` holds `preview`, `divider` and `session`, in that order; the row's data attributes say focus and side. */
export function splitter(row: HTMLElement, preview: HTMLElement, divider: HTMLElement, session: HTMLElement): Split {
  let floor = '';
  let p: SplitPrefs = readSplit(null);
  const fns: ((p: SplitPrefs) => void)[] = [];

  const width = () => row.getBoundingClientRect().width - divider.getBoundingClientRect().width;
  const apply = (save = true) => {
    const pct = clampSplit(p.pct, width());
    row.dataset.focus = p.focus;
    row.dataset.swapped = String(p.swapped);
    preview.style.flexBasis = p.focus === 'both' ? `${pct}%` : '';
    session.style.flexBasis = p.focus === 'both' ? `${100 - pct}%` : '';
    divider.setAttribute('aria-valuenow', String(Math.round(pct)));
    divider.setAttribute('aria-valuetext', `Preview ${Math.round(pct)}%, session ${Math.round(100 - pct)}%`);
    if (save && floor) saveSplit(floor, p);
    for (const fn of fns) fn(p);
  };
  const set = (next: Partial<SplitPrefs>) => {
    p = { ...p, ...next };
    apply();
  };

  // Dragging: the preview's share follows the pointer, on whichever side it is.
  divider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    row.classList.add('xs-dragging');
    const box = row.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const x = Math.min(box.right, Math.max(box.left, ev.clientX)) - box.left;
      const leftPct = (x / box.width) * 100;
      p = { ...p, focus: 'both', pct: clampSplit(p.swapped ? 100 - leftPct : leftPct, width()) };
      apply(false);
    };
    const up = () => {
      divider.removeEventListener('pointermove', move);
      row.classList.remove('xs-dragging');
      apply();
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up, { once: true });
    divider.addEventListener('pointercancel', up, { once: true });
  });
  divider.addEventListener('dblclick', () => set({ pct: 50, focus: 'both' }));
  divider.addEventListener('keydown', (e) => {
    const next = splitKey(p.pct, e.key, e.shiftKey, width(), p.swapped ? 'right' : 'left');
    if (next === undefined) return;
    e.preventDefault();
    set({ pct: next, focus: 'both' });
  });
  new ResizeObserver(() => apply(false)).observe(row);

  return {
    load(f) {
      floor = f;
      p = loadSplit(f);
      apply(false);
    },
    focus: (focus) => set({ focus }),
    swap: () => set({ swapped: !p.swapped }),
    prefs: () => p,
    onChange: (fn) => void fns.push(fn),
  };
}
