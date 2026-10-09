import './progress.css';
/**
 * The project progress bar: a thin line between the flat views' top row (the floor, its budget chip and
 * run state) and the 1D view's tabs or the 2D view's office, the same on every tab and theme. Its
 * phases are the toolkit's stages, Handover and Accepted (shared/progress.ts, server/progress/), each
 * showing only what was measured. It asks the office when something it heard of changed: the floor you
 * open, a pull request merged (main moved), coming back to the tab after a while, an Accept or a
 * Reopen. No timer of its own. It draws again only when the answer differs. Folding it to a thin line is
 * remembered on this browser. No three.js here.
 */
import type { Phase, PhaseOpen, ProjectProgress } from '../../../shared/progress';
import { store } from '../../state';
import { getProgress } from './api';
import { barRow, tipContent } from './bar';
import { openAcceptance } from './acceptance';
import { toolkitChip } from '../toolkit/line';

const FOLD_KEY = 'agent-office.progress-folded';
/** Coming back to a hidden tab asks again only when the answer is older than this. */
const STALE_MS = 60_000;

const folded = (): boolean => {
  try {
    return localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
};

export interface ProgressDeps {
  /** Opens the setup panel (the 1D view's Command Center; the 2D view goes there). */
  setup(): void;
  /** Opens the floor's deliverables. */
  deliverables(floor: string): void;
}

export interface ProgressBar {
  refresh(): void;
}

/** Mounts the bar into `root` (an empty element above the tabs) for the floor you're on. */
export function mountProgressBar(root: HTMLElement, deps: ProgressDeps): ProgressBar {
  let data: ProjectProgress | undefined;
  let drawn = '';
  let at = 0;
  let busy = false;
  let again = false;
  let collapsed = folded();
  /** The merged pull requests last heard of (undefined: none heard yet on this floor). */
  let mergedSig: string | undefined;
  const tip = document.createElement('div');
  tip.className = 'pg-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  root.classList.add('pg-host');

  const open = (target: PhaseOpen) => {
    const floor = store.floor;
    if (!floor) return;
    if (target === 'setup') return deps.setup();
    if (target === 'deliverables') return deps.deliverables(floor);
    openAcceptance(floor, () => load());
  };
  const showTip = (ph: Phase, seg: HTMLElement) => {
    tip.replaceChildren(tipContent(ph));
    tip.hidden = false;
    const r = seg.getBoundingClientRect();
    const w = Math.min(340, innerWidth - 16);
    tip.style.width = `${w}px`;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${Math.round(r.bottom + 6)}px`;
  };
  const hideTip = () => (tip.hidden = true);

  function draw() {
    const sig = `${collapsed}|${data ? JSON.stringify({ ...data, generatedAt: 0 }) : ''}`;
    if (sig === drawn) return;
    drawn = sig;
    hideTip();
    root.classList.toggle('pg-folded', collapsed);
    if (!data) return root.replaceChildren(h0());
    const row = barRow(data, collapsed, {
      toggle: () => {
        collapsed = !collapsed;
        try {
          localStorage.setItem(FOLD_KEY, collapsed ? '1' : '0');
        } catch {
          // Just for this visit, then.
        }
        draw();
      },
      open: (ph) => open(ph.open),
      label: () => open('acceptance'),
    });
    // The project's toolkit commit at the end (ui/toolkit/), when it's a toolkit project.
    if (data.toolkit && store.floor) row.append(toolkitChip(store.floor, () => void load()));
    root.replaceChildren(row, tip);
  }
  /** Before the first answer: the bar's height, empty, so nothing below it moves when it comes. */
  const h0 = () => {
    const el = document.createElement('div');
    el.className = `pg-bar pg-empty${collapsed ? ' collapsed' : ''}`;
    return el;
  };
  // The segments' tooltips, from one listener pair on the bar.
  const seg = (e: Event) => (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.pg-seg[data-phase]');
  const enter = (e: Event) => {
    const s = seg(e);
    const ph = s && data?.phases.find((p) => p.id === s.dataset.phase);
    if (s && ph && !collapsed) showTip(ph, s);
  };
  root.addEventListener('mouseover', enter);
  root.addEventListener('focusin', enter);
  root.addEventListener('mouseleave', hideTip);
  root.addEventListener('focusout', hideTip);

  async function load() {
    if (busy) return void (again = true);
    const floor = store.floor;
    if (!floor) return;
    busy = true;
    const p = await getProgress(floor);
    busy = false;
    if (p && p.floor === store.floor) {
      data = p;
      at = Date.now();
      draw();
    }
    if (again || floor !== store.floor) {
      again = false;
      void load();
    }
  }

  store.on('floor', () => {
    data = undefined;
    mergedSig = undefined;
    draw();
    void load();
  });
  // A pull request merged moves main: the gates and deliverables may have moved with it.
  store.on('pulls', () => {
    const sig = store.pulls.items.filter((p) => p.state === 'MERGED').map((p) => p.number).join(',');
    if (sig === mergedSig) return;
    const first = mergedSig === undefined;
    mergedSig = sig;
    if (!first) void load();
  });
  document.addEventListener('visibilitychange', () => !document.hidden && Date.now() - at > STALE_MS && void load());
  draw();
  void load();
  return { refresh: () => void load() };
}

export { miniProgress } from './mini';
