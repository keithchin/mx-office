// "Open in Studio Pro": the floor's Mendix project (its .mpr, in the floor's checkout) opened in
// Studio Pro on the office's machine (server/studio/). A button in the Command Center's heading,
// next to the 🌐 Live app chip, and an item in the ☰ menu. Only admins open it, and only after a
// confirm: Studio Pro locks the project the agents write with `mxcli exec` (the one-writer rule),
// so it says so and names the agents on the floor mid-turn. Beside the button, Studio mode's chip:
// the office sees Studio Pro open on the project (server/studio/watch.ts), however it was opened,
// and pauses the agents' mxcli writes meanwhile; the button says it's open and waits. No three.js
// here: the flat views load it.

import type { StudioInfo, StudioOpenResult, StudioState } from '../../../shared/studio';
import { store } from '../../state';
import { h, openModal, toast } from '../dom';
import './studio.css';

/** A window with an arrow out of it: thin lines in the text's color, the same in every theme (no emoji, so Clean keeps it). */
const ICON =
  '<svg class="st-icon" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 2.5h-6v11h11v-6"/><path d="M2.5 5.5h4"/><path d="M10 2.5h3.5V6M13.5 2.5 8 8"/></svg>';

let info: StudioInfo | null = null;
/** The floor `info` is about. */
let infoFor: string | null = null;
let watching = false;
const buttons = new Set<HTMLButtonElement>();

/** Your name as this browser has it, for the record (an account's name wins on the server). */
function myName(): string | undefined {
  try {
    return JSON.parse(localStorage.getItem('agent-office.profile') ?? 'null')?.name;
  } catch {
    return undefined;
  }
}

async function fetchInfo(floor: string): Promise<StudioInfo | null> {
  try {
    const res = await fetch(`/api/studio?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    return res.ok ? ((await res.json()) as StudioInfo) : null;
  } catch {
    return null;
  }
}

/** Studio mode on the floor you're on: what the office last pushed, else what it answered when asked. */
export function studioState(): StudioState | undefined {
  const floor = store.floor;
  if (!floor) return undefined;
  if (store.studio?.floor === floor) return store.studio;
  return infoFor === floor ? info?.state : undefined;
}

/** Since when, as the page says it ("since 14:05"). */
const sinceText = (at: number) => `since ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

/** Asks the office about the floor you're on, and redraws the buttons. */
async function refresh() {
  const floor = store.floor;
  if (floor !== infoFor) info = null;
  infoFor = floor;
  draw();
  if (!floor) return;
  const got = await fetchInfo(floor);
  if (store.floor !== floor) return;
  info = got;
  draw();
  // What the office answered is Studio mode too (the Needs you strip reads it through studioState).
  if (got?.state && !store.studio) store.emit('studio');
}

/** Keeps what the office says about the floor's project current as you go between floors (once). */
export function watchStudio() {
  if (watching) return;
  watching = true;
  store.on('floor', () => void refresh());
  store.on('me', draw);
  store.on('studio', draw);
  if (store.floor) void refresh();
}

/** Whether the floor you're on has a project to open: until the office says, it's offered. */
export const studioShown = () => !!store.floor && (infoFor !== store.floor || !info || info.hasMpr);
/** The Mendix version the floor's project opens in, once the office has said (the Portal Overview's Details). */
export const studioVersion = () => (infoFor === store.floor ? (info?.version ?? undefined) : undefined);

/** Why it can't be opened from here, if it can't: it's greyed out and says so. */
export function studioBlocked(): string | undefined {
  const s = studioState();
  if (s?.open) return `Studio Pro already has the project open (${sinceText(s.since)}): the agents' mxcli writes are paused until it's closed`;
  if (!store.me.admin) return 'Only admins can open the project in Studio Pro';
  if (info && infoFor === store.floor && !info.available) return info.error;
  return undefined;
}

export const studioTitle = () =>
  info?.mpr ? `Open ${info.mpr}${info.version ? ` (Mendix ${info.version})` : ''} in Studio Pro on the office's computer` : "Open the floor's Mendix project in Studio Pro on the office's computer";

function draw() {
  const shown = studioShown();
  const blocked = studioBlocked();
  const s = studioState();
  for (const b of buttons) {
    b.hidden = !shown;
    b.disabled = !!blocked;
    b.title = blocked ?? studioTitle();
    b.classList.toggle('st-open', !!s?.open);
    const label = b.querySelector('span');
    if (label) label.textContent = s?.open ? 'Studio Pro is open' : 'Open in Studio Pro';
  }
  for (const c of chips) drawChip(c, shown ? s : undefined);
}

const chips = new Set<HTMLElement>();

/** Studio mode's chip: shown only while Studio Pro is open (writes paused). A stale lock gets no chip:
 *  Studio Pro leaves its .mpr.lock behind on every close, so most Mendix floors would wear one for good.
 *  It's still in the audit log and the open confirm. */
function drawChip(c: HTMLElement, s: StudioState | undefined) {
  const mcp = s?.open && s.mcp?.available ? s.mcp.url : undefined;
  if (s?.open) {
    c.hidden = false;
    c.className = 'st-mode st-mode-open';
    c.textContent = mcp ? 'Studio Pro open · mxcli paused · MCP' : 'Studio Pro open · mxcli paused';
    c.title = `Studio Pro has the project open (${sinceText(s.since)}${s.pid ? `, process ${s.pid}` : ''}). The office holds the agents' mxcli writes until it's closed${mcp ? `; they can route writes through Studio Pro's MCP server at ${mcp}` : ''}.`;
  } else {
    c.hidden = true;
    c.textContent = '';
  }
}

/** A new Studio mode chip, kept up to date. */
export function studioChip(): HTMLElement {
  const c = h('span.st-mode', { role: 'status' });
  c.hidden = true;
  chips.add(c);
  watchStudio();
  draw();
  return c;
}

/** A new "Open in Studio Pro" button, kept up to date. */
export function studioButton(): HTMLButtonElement {
  const b = h('button.btn.st-btn', { type: 'button', onclick: () => void openStudio() });
  b.innerHTML = ICON;
  b.append(h('span', {}, 'Open in Studio Pro'));
  buttons.add(b);
  watchStudio();
  draw();
  return b;
}

let chip: HTMLButtonElement | null = null;
let mode: HTMLElement | null = null;
/** Puts the button and Studio mode's chip into the project summary's heading in `summary`, after it was drawn (beside the Live app chip). */
export function mountStudio(summary: HTMLElement) {
  chip ??= studioButton();
  mode ??= studioChip();
  const at = summary.querySelector('.sm-name');
  if (at && chip.parentElement !== at) at.append(chip);
  if (at && mode.parentElement !== at) at.append(mode);
}

/** Asks again (who's busy may have changed), confirms, and opens it. */
export async function openStudio() {
  const floor = store.floor;
  if (!floor) return;
  const now = await fetchInfo(floor);
  if (store.floor !== floor) return;
  if (now) {
    info = now;
    infoFor = floor;
    draw();
  }
  if (!now) return void toast("Couldn't ask the office about the project", 'warn');
  if (!now.hasMpr) return void toast(now.error ?? 'No Mendix project (.mpr) on this floor', 'warn');
  if (now.state?.open) return void toast("Studio Pro already has the project open: the agents' mxcli writes are paused until it's closed", 'warn');
  if (!now.admin) return void toast('Only admins can open the project in Studio Pro', 'warn');
  if (!now.available) return void toast(now.error ?? "Studio Pro can't be opened from here", 'warn');
  confirmOpen(floor, now);
}

function confirmOpen(floor: string, s: StudioInfo) {
  const yes = h('button.btn.primary', { type: 'button' }, 'Open in Studio Pro');
  const no = h('button.btn', { type: 'button' }, 'Never mind');
  const remote = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const busy = s.busy.length
    ? h('div.st-busy', {}, h('p', {}, `Busy on this floor right now (${s.busy.length}):`), h('ul', {}, ...s.busy.map((n) => h('li', {}, n))), h('p', {}, 'Let them finish their turn before you change anything in Studio Pro.'))
    : h('p.st-calm', {}, 'No agent on this floor is in the middle of a turn.');
  const el = h(
    'div.modal.st-modal',
    { role: 'alertdialog', 'aria-label': 'Open in Studio Pro' },
    h('header', {}, h('h2', {}, 'Open in Studio Pro')),
    h(
      'div.body',
      {},
      h('p', {}, h('code', {}, s.mpr ?? 'the project'), s.version ? ` opens in Studio Pro ${s.version}.` : ' opens in Studio Pro.'),
      h('p.st-warn', { role: 'alert' }, "Studio Pro locks the project while it's open, and agents write it with mxcli: one writer at a time. The office sees Studio Pro open and pauses the agents' mxcli writes automatically until you close it."),
      h('p.st-note', {}, 'When you close Studio Pro, commit your changes so the agents build on them.'),
      s.state?.staleLock ? h('p.st-note', {}, "The project's .mpr.lock is already there with no Studio Pro running: a stale lock, left by an earlier Studio Pro. Studio Pro takes it over when it opens.") : null,
      busy,
      s.last ? h('p.st-note', {}, `Last opened by ${s.last.by} at ${new Date(s.last.at).toLocaleTimeString()}.`) : null,
      remote ? h('p.st-note', {}, "It opens on the office's computer, not this one.") : null,
    ),
    h('footer', {}, no, yes),
  );
  const modal = openModal(el);
  no.addEventListener('click', () => modal.close());
  yes.addEventListener('click', () => {
    modal.close();
    void post(floor, s);
  });
  setTimeout(() => yes.focus(), 30);
}

async function post(floor: string, s: StudioInfo) {
  toast(`Opening in Studio Pro${s.version ? ` ${s.version}` : ''}…`);
  try {
    const res = await fetch('/api/studio/open', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ floor, by: myName() }),
    });
    const r = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as StudioOpenResult;
    if (!r.ok) toast(r.error, 'warn');
  } catch {
    toast("Couldn't reach the office", 'warn');
  }
  if (store.floor === floor) void refresh();
}
