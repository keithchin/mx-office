// "Open in Studio Pro": the floor's Mendix project (its .mpr, in the floor's checkout) opened in
// Studio Pro on the office's machine (server/studio/). A button in the Command Center's heading,
// next to the 🌐 Live app chip, and an item in the ☰ menu. Only admins open it, and only after a
// confirm: Studio Pro locks the project the agents write with `mxcli exec` (the one-writer rule),
// so it says so and names the agents on the floor mid-turn. Beside the button, Studio mode's chip:
// the office sees Studio Pro open on the project (server/studio/watch.ts), however it was opened,
// and pauses the agents' mxcli writes meanwhile; the button says it's open and waits.
//
// The button is on every project page, always: greyed out with the reason when it truly can't work (no
// Studio Pro on the office's computer, not an admin, already open), never hidden because the office
// hasn't found an .mpr. Opening brings the floor's folder up to date with GitHub first when that's safe
// (server/floor-sync/), and says why when it isn't (local changes, another branch, Studio Pro open).

import type { StudioInfo, StudioOpenResult, StudioState, StudioSyncResult } from '../../../shared/studio';
import { ADMINS_ONLY_TEXT, SYNC_WAIT_MS, afterSync, askOffice, isFailed, stopBeforeSync, syncLine } from './logic';
import { store } from '../../state';
import { h, openModal, toast } from '../dom';
import { oneAtATime } from '../once';
import './studio.css';

/** A window with an arrow out of it: thin lines in the text's color, the same in every theme (no emoji, so Clean keeps it). */
const ICON =
  '<svg class="st-icon" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 2.5h-6v11h11v-6"/><path d="M2.5 5.5h4"/><path d="M10 2.5h3.5V6M13.5 2.5 8 8"/></svg>';

let info: StudioInfo | null = null;
/** The floor `info` is about. */
let infoFor: string | null = null;
let watching = false;
const buttons = new Set<HTMLButtonElement>();
const changed = new Set<() => void>();

/** Hears every redraw of what the office says about the button (the Portal navigation's item follows it); returns how to stop. */
export function onStudioChange(fn: () => void): () => void {
  changed.add(fn);
  return () => void changed.delete(fn);
}

/** Your name as this browser has it, for the record (an account's name wins on the server). */
function myName(): string | undefined {
  try {
    return JSON.parse(localStorage.getItem('agent-office.profile') ?? 'null')?.name;
  } catch {
    return undefined;
  }
}

/** What the office says about the floor's project, or why it couldn't say. */
const askInfo = (floor: string) => askOffice<StudioInfo>(`/api/studio?floor=${encodeURIComponent(floor)}`);

async function fetchInfo(floor: string): Promise<StudioInfo | null> {
  const r = await askInfo(floor);
  return isFailed(r) ? null : r;
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

/**
 * Whether the button is offered: on every project page, whatever the office has found. It used to wait
 * for an .mpr, and since the Portal navigation asks only when the page changes, it vanished one page
 * after the office said "none" (the folder was behind GitHub, without the .mpr main had).
 */
export const studioShown = () => !!store.floor;
/** The Mendix version the floor's project opens in, once the office has said (the Portal Overview's Details). */
export const studioVersion = () => (infoFor === store.floor ? (info?.version ?? undefined) : undefined);

/** Why it can't be opened from here, if it can't: it's greyed out and says so. */
export function studioBlocked(): string | undefined {
  const s = studioState();
  if (s?.open) return `Studio Pro already has the project open (${sinceText(s.since)}): the agents' mxcli writes are paused until it's closed`;
  if (!store.me.admin) return ADMINS_ONLY_TEXT;
  if (info && infoFor === store.floor && !info.available) return info.problem === 'no-mpr' ? info.machine?.error : info.error;
  return undefined;
}

export function studioTitle(): string {
  const here = infoFor === store.floor ? info : null;
  const base = here?.mpr
    ? `Open ${here.mpr}${here.version ? ` (Mendix ${here.version})` : ''} in Studio Pro on the office's computer`
    : here && !here.hasMpr
      ? "No .mpr in the project folder yet: clicking brings the folder up to date with GitHub first, then opens it in Studio Pro on the office's computer"
      : "Open the project in Studio Pro on the office's computer";
  const note = here?.sync?.state === 'refused' ? here.sync.message : undefined;
  return note ? `${base}. ${note}` : base;
}

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
  for (const fn of changed) fn();
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

/** Asks again (who's busy may have changed), confirms, and opens it; clicked again meanwhile, the same call (ui/once.ts). */
export const openStudio = oneAtATime(openStudioNow);

async function openStudioNow() {
  const floor = store.floor;
  if (!floor) return;
  const now = await askInfo(floor);
  if (store.floor !== floor) return;
  if (isFailed(now)) return void toast(stopBeforeSync(now)!, 'error');
  info = now;
  infoFor = floor;
  draw();
  const stop = stopBeforeSync(now);
  if (stop) return void toast(stop, 'warn');
  // The folder brought up to date with GitHub first, when that's safe: what main has is what opens.
  const busy = toast(now.hasMpr ? 'Checking the project folder is up to date with GitHub…' : 'No .mpr in the project folder yet: bringing it up to date with GitHub…');
  const r = await syncNow(floor);
  busy.remove();
  if (store.floor !== floor) return;
  if (!isFailed(r)) {
    info = r.info;
    infoFor = floor;
    draw();
  }
  const next = afterSync(r);
  if ('stop' in next) return void toast(next.stop, next.failed ? 'error' : 'warn');
  if (isFailed(r)) return;
  if (next.moved && next.note) toast(next.note);
  confirmOpen(floor, r.info, next.moved ? undefined : next.note);
}

/** The folder brought up to date (or why not), or why the office couldn't answer: the reason always comes back. */
const syncNow = (floor: string) =>
  askOffice<StudioSyncResult>('/api/studio/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor }) }, SYNC_WAIT_MS);

function confirmOpen(floor: string, s: StudioInfo, behind?: string) {
  const yes = h('button.btn.primary', { type: 'button' }, 'Open in Studio Pro');
  const no = h('button.btn', { type: 'button' }, 'Never mind');
  const remote = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const busy = s.busy.length
    ? h('div.st-busy', {}, h('p', {}, `Busy on this project right now (${s.busy.length}):`), h('ul', {}, ...s.busy.map((n) => h('li', {}, n))), h('p', {}, 'Let them finish their turn before you change anything in Studio Pro.'))
    : h('p.st-calm', {}, 'No agent on this project is in the middle of a turn.');
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
      behind ? h('p.st-warn.st-behind', { role: 'status' }, behind) : null,
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
  const r = await askOffice<StudioOpenResult>('/api/studio/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor, by: myName() }) }, SYNC_WAIT_MS);
  if (isFailed(r)) toast(`Couldn't open the project in Studio Pro: ${r.failed}`, 'error');
  else if (!r.ok) toast(r.error, 'error');
  else if (r.sync?.state === 'moved') toast(syncLine(r.sync)!);
  if (store.floor === floor) void refresh();
}
