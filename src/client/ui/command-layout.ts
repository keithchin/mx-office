// The 1D Command Center, made to fit a laptop screen (command-layout.css): the Needs-you row on top
// (ui/needsyou/), the project setup panel folded to one line once its gates are fine (it opens again with
// a click, and this browser remembers which way you left it), and the project summary below in columns
// exactly as tall as what's left of the window, the PM console in the middle: on a desktop the page
// doesn't scroll and no column does, each card scrolls inside its own frame (command-layout.css). The
// summary's own sections fold too (ui/summary.ts). The panels draw themselves as before; this only
// decorates them as they're drawn. No three.js.

import { h } from './dom';
import './command-layout.css';

const SETUP_KEY = 'agent-office.cc-setup';
/** A window shorter than this folds the setup panel at first even when a gate fails. */
export const SHORT_PX = 820;

/** Folded or open, as this browser left it; undefined when it was never touched (fine gates fold). */
function setupChoice(): boolean | undefined {
  try {
    const v = localStorage.getItem(SETUP_KEY);
    return v === 'folded' ? true : v === 'open' ? false : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the setup panel's gates are fine: no stage failing or waiting for a sign-off, no stale folder. */
export function setupFine(stages: readonly { status: string }[], stale: boolean): boolean {
  return !stale && !stages.some((s) => s.status === 'FAIL' || s.status === 'MANUAL');
}

/** The one line a folded setup panel says: where it stands, in words. */
export function setupLine(stages: readonly { id: string; status: string }[]): string {
  const n = (st: string) => stages.filter((s) => s.status === st).length;
  const bits = [n('PASS') && `${n('PASS')} passed`, n('FAIL') && `${n('FAIL')} failing`, n('MANUAL') && `${n('MANUAL')} to sign off`, n('PENDING') && `${n('PENDING')} pending`].filter(Boolean);
  const next = stages.find((s) => s.status !== 'PASS' && s.status !== 'WAIVED');
  return `${bits.join(' · ')}${next ? ` · next: stage ${next.id}` : ''}`;
}

function decorateSetup(root: HTMLElement) {
  const panel = root.querySelector<HTMLElement>('.setup-panel');
  const head = panel?.querySelector<HTMLElement>('.setup-head');
  if (!panel || !head || head.querySelector('.cc-fold-btn')) return;
  const stages = [...panel.querySelectorAll<HTMLElement>('.setup-stage')].map((el) => ({ id: el.querySelector('.setup-stage-id')?.textContent ?? '', status: (['pass', 'fail', 'manual', 'pending', 'waived'].find((c) => el.classList.contains(c)) ?? 'pending').toUpperCase() }));
  const fine = setupFine(stages, !!panel.querySelector('.setup-stale'));
  // Never touched: folded once its gates are fine, and on a short window whatever they say (its line
  // says what's failing, in red), so the fitted Command Center keeps its room.
  const folded = setupChoice() ?? (fine || window.innerHeight < SHORT_PX);
  const line = h('span.cc-setup-line', { class: fine ? '' : 'cc-bad' }, setupLine(stages));
  const btn = h('button.btn.small.cc-fold-btn', { type: 'button', 'aria-expanded': String(!folded), title: 'Show or hide the setup panel' }, folded ? 'Show ▾' : 'Hide ▴');
  const apply = (f: boolean) => {
    panel.classList.toggle('cc-folded', f);
    btn.setAttribute('aria-expanded', String(!f));
    btn.textContent = f ? 'Show ▾' : 'Hide ▴';
  };
  btn.addEventListener('click', () => {
    const f = !panel.classList.contains('cc-folded');
    apply(f);
    try {
      localStorage.setItem(SETUP_KEY, f ? 'folded' : 'open');
    } catch {
      // Only this visit.
    }
    fit();
  });
  head.querySelector('h3')?.after(line);
  head.append(btn);
  apply(folded);
}

/** How far down the page the summary starts, so its columns take what's left of the window. */
function fit() {
  const sm = document.getElementById('summary');
  if (!sm || sm.classList.contains('hidden')) return;
  const top = sm.getBoundingClientRect().top + window.scrollY;
  document.documentElement.style.setProperty('--cc-top', `${Math.round(top)}px`);
}

export function collapsibleCommand() {
  const setup = document.getElementById('setup');
  if (setup) {
    decorateSetup(setup);
    new MutationObserver(() => {
      decorateSetup(setup);
      fit();
    }).observe(setup, { childList: true });
  }
  const ro = new ResizeObserver(fit);
  for (const id of ['needs-you', 'setup', 'firm-banner', 'floor-meta']) {
    const el = document.getElementById(id);
    if (el) ro.observe(el);
  }
  const tabs = document.querySelector('.lite-tabs');
  if (tabs) ro.observe(tabs);
  window.addEventListener('resize', fit);
  fit();
}
