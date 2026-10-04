// Hovering a card on the board (ui/kanban.ts): a panel beside it, on whichever side has the room,
// with what matters at a glance (status, model, tokens, the description) and, for an agent, its
// terminal live and read-only. ⤢ Open (or clicking the card) goes on to the full window.

import { Terminal } from '@xterm/xterm';
import type { Net } from '../net';
import type { ServerMsg } from '../../shared/protocol';
import { h } from './dom';
import { openTerminalFor } from './terminal';
import { TERM_THEME } from './termtheme';
import './kanban-preview.css';

export interface Preview {
  title: string;
  /** A pill by the title: the worker's status, the PR's state. */
  status?: string;
  /** Label and value, a row each; empty values are left out. */
  fields: [string, string | undefined][];
  /** The issue's or PR's description, or the task an agent was given. */
  description?: string;
  /** An agent's terminal, shown live. */
  workerId?: string;
  /** More to show under the fields (a PR's checks); `relayout` finds it room again once it has filled in. */
  extra?: (relayout: () => void) => HTMLElement | null;
  open(): void;
}

/** How long (ms) the pointer rests on a card before its preview opens, and leaves before it closes. */
const SHOW_MS = 300;
const HIDE_MS = 200;
const GAP = 12;
const DESCRIPTION_MAX = 1200;

let net: Net | null = null;
let panel: HTMLElement | null = null;
/** The card the open preview is of. */
let openKey = '';
let showTimer = 0;
let hideTimer = 0;
/** The terminal in the open preview: which worker's, and where it's drawn. */
let live: { workerId: string; term: Terminal; host: HTMLElement; attached: boolean } | null = null;

/** The board's connection, for attaching to terminals. */
export function usePreviewNet(n: Net) {
  net = n;
}

/** Every server message comes through here, so the open preview's terminal gets its own. */
export function routePreviewMessage(msg: ServerMsg) {
  if (!live || !('workerId' in msg) || msg.workerId !== live.workerId) return;
  const { term } = live;
  if (msg.t === 'term.snapshot') {
    term.reset();
    term.resize(msg.cols, msg.rows);
    term.write(msg.data, fit);
  } else if (msg.t === 'term.data') term.write(msg.data);
}

/**
 * Opens `p` beside `anchor` once the pointer has rested on it; leaving either closes it. `key` is
 * the card's: the board is drawn again on every change, and its preview stays open through that.
 */
export function previewOnHover(anchor: HTMLElement, key: string, p: () => Preview) {
  // A phone has no hover: a tap opens the full window, as a click does.
  if (!matchMedia('(hover: hover)').matches) return;
  anchor.addEventListener('mouseenter', () => {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    if (panel && openKey === key) return;
    showTimer = window.setTimeout(() => show(anchor, key, p()), SHOW_MS);
  });
  anchor.addEventListener('mouseleave', () => {
    clearTimeout(showTimer);
    hideSoon();
  });
  anchor.addEventListener('dragstart', hidePreview);
}

function hideSoon() {
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hidePreview, HIDE_MS);
}

/** The card whose preview is open, or '' for none. */
export const previewKey = () => openKey;

export function hidePreview() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  dropTerminal();
  panel?.remove();
  panel = null;
  openKey = '';
}

function show(anchor: HTMLElement, key: string, p: Preview) {
  hidePreview();
  openKey = key;
  const openBtn = h('button.btn.primary.kbp-open', { type: 'button', title: 'Open the full window' }, '⤢ Open');
  openBtn.addEventListener('click', () => {
    hidePreview();
    p.open();
  });
  const rows = p.fields.filter(([, v]) => v);
  const host = p.workerId ? h('div.kbp-term', { 'aria-label': 'Terminal (live, read-only)' }) : null;
  const extra = p.extra?.(() => panel && openKey === key && place(panel, anchor)) ?? null;
  panel = h(
    'aside.kbp',
    { role: 'dialog', 'aria-label': p.title },
    h('header.kbp-h', {}, h('h3', {}, p.title), p.status ? h('span.pill.kbp-status', {}, p.status) : null, openBtn),
    rows.length ? h('dl.kbp-fields', {}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v!)])) : null,
    extra,
    host ? h('div.kbp-sec', {}, h('div.kbp-label', {}, '💻 Terminal · live'), host) : null,
    p.description ? h('div.kbp-sec', {}, h('div.kbp-label', {}, '📝 Description'), h('div.kbp-desc', {}, clipText(p.description))) : null,
  );
  panel.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  panel.addEventListener('mouseleave', hideSoon);
  document.body.append(panel);
  place(panel, anchor);
  if (host && p.workerId) watchTerminal(p.workerId, host);
}

/** Beside the card, on the side with more room, kept on screen top to bottom. */
function place(el: HTMLElement, anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const ht = el.offsetHeight;
  const right = r.left + r.width / 2 < innerWidth / 2;
  const x = right ? Math.min(r.right + GAP, innerWidth - w - GAP) : Math.max(GAP, r.left - w - GAP);
  const y = Math.max(GAP, Math.min(r.top, innerHeight - ht - GAP));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.classList.add(right ? 'from-left' : 'from-right');
}

function clipText(s: string) {
  const t = s.trim();
  return t.length > DESCRIPTION_MAX ? `${t.slice(0, DESCRIPTION_MAX)}…` : t;
}

function watchTerminal(workerId: string, host: HTMLElement) {
  const term = new Terminal({ disableStdin: true, cursorBlink: false, fontSize: 11, scrollback: 0, theme: TERM_THEME, allowProposedApi: false });
  term.open(host);
  live = { workerId, term, host, attached: false };
  if (!net) return;
  // The full terminal may be open on the same worker: it's attached already, and stays so.
  live.attached = openTerminalFor() !== workerId;
  net.send({ t: 'worker.attach', workerId });
}

/** Scales the whole screen down to the preview's width; the newest lines are at its foot. */
function fit() {
  if (!live) return;
  const screen = live.host.querySelector<HTMLElement>('.xterm-screen');
  if (!screen) return;
  const scale = Math.min(1, live.host.clientWidth / screen.offsetWidth);
  const inner = live.host.firstElementChild as HTMLElement;
  inner.style.transform = `scale(${scale})`;
  inner.style.height = `${screen.offsetHeight}px`;
  live.host.style.height = `${Math.min(screen.offsetHeight * scale, 240)}px`;
}

function dropTerminal() {
  if (!live) return;
  if (live.attached && net && openTerminalFor() !== live.workerId) net.send({ t: 'worker.detach', workerId: live.workerId });
  live.term.dispose();
  live = null;
}
