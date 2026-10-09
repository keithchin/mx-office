// ⚙️ Settings → Workers → Keep awake (server/keep-awake/): whether the office keeps this computer from
// sleeping while agents work, how long everything must be idle before it lets go, what it's doing right
// now, and what the lid needs for work to carry on with it closed. Admins change it.

import './settings-teams.css';
import { awakeLine, IDLE_MAX, IDLE_MIN, type KeepAwakeView } from '../../shared/keep-awake';
import { h, toast } from './dom';

/** Your name as this browser has it, for the record (an account's name wins on the server). */
function myName(): string | undefined {
  try {
    return JSON.parse(localStorage.getItem('agent-office.profile') ?? 'null')?.name;
  } catch {
    return undefined;
  }
}

async function call(body?: unknown): Promise<KeepAwakeView | undefined> {
  try {
    const res = await fetch('/api/keep-awake', body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(body as object), by: myName() }) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
    return data as KeepAwakeView;
  } catch (err) {
    if (body !== undefined) toast((err as Error).message, 'warn');
    return undefined;
  }
}

/** What the lid needs, per platform: the office never changes power settings itself. */
function lidNote(platform: string): HTMLElement {
  if (platform === 'win32')
    return h(
      'div.awake-lid',
      {},
      h('strong', {}, '💻 Closing the lid: '),
      'keep-awake stops idle sleep, but Windows still sleeps when the lid closes unless it’s told not to. For agents to keep working with the lid shut, set “When I close the lid” to “Do nothing” for when it’s plugged in:',
      h(
        'ol',
        {},
        h('li', {}, 'Open Control Panel → Hardware and Sound → Power Options → “Choose what closing the lid does” (or run ', h('code', {}, 'control /name Microsoft.PowerOptions /page pageGlobalSettings'), ').'),
        h('li', {}, 'Under “Plugged in”, set “When I close the lid” to “Do nothing”, then Save changes.'),
        h('li', {}, 'Keep it plugged in and somewhere it can breathe: a closed laptop runs warmer. On battery, leave it as it is so it still sleeps.'),
      ),
      'Your company may manage this setting; if it’s greyed out, ask IT. The screen still turns off as usual.',
    );
  if (platform === 'darwin') return h('div.awake-lid', {}, h('strong', {}, '💻 Closing the lid: '), 'a Mac sleeps when its lid closes unless it’s plugged in with an external display (clamshell mode). Keep-awake (caffeinate -i) only stops idle sleep.');
  return h('div.awake-lid', {}, h('strong', {}, '💻 Closing the lid: '), 'keep-awake stops idle sleep (systemd-inhibit). What closing the lid does is set by your desktop’s power settings or HandleLidSwitchExternalPower in /etc/systemd/logind.conf.');
}

/** The setting, made by `frame` from what goes in it, and what to call when Settings closes. */
export function keepAwakeSetting(frame: (body: Node[]) => HTMLElement): { section: HTMLElement; off: () => void } {
  let view: KeepAwakeView | undefined;
  const now = h('p.awake-now');
  const seg = h('div.seg', { role: 'radiogroup', 'aria-label': 'Keep awake while agents work', style: 'margin-top:8px' });
  const idle = h('input', { type: 'number', min: IDLE_MIN, max: IDLE_MAX, step: 1, 'aria-label': 'Idle minutes before letting go' }) as HTMLInputElement;
  const idleSave = h('button.btn', { type: 'button' }, 'Save');
  const idleRow = h('div.awake-idle', {}, h('span', {}, 'Let go after everything has been idle for'), idle, h('span', {}, 'minutes'), idleSave);
  const note = h('p.setting-note');
  const lid = h('div');
  const section = frame([now, seg, idleRow, note, lid]);

  const send = async (patch: { on?: boolean; idleMinutes?: number }) => {
    const v = await call(patch);
    if (v) ((view = v), paint());
  };
  const paint = () => {
    const v = view;
    if (!v) return void (now.textContent = 'Loading…');
    now.textContent = awakeLine(v, Date.now());
    now.classList.toggle('on', v.holding);
    seg.replaceChildren(
      ...([true, false] as const).map((on) =>
        h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(v.on === on), class: v.on === on ? 'on' : '', disabled: !v.admin || !v.supported, onclick: () => v.on !== on && void send({ on }) }, on ? '☕ Keep awake while agents work' : 'Off'),
      ),
    );
    idle.disabled = idleSave.disabled = !v.admin || !v.supported;
    if (document.activeElement !== idle) idle.value = String(v.idleMinutes);
    note.classList.toggle('bad', !!v.error);
    note.textContent = v.error
      ? `⚠️ ${v.error}`
      : `While any agent on any floor is working, or a queued task, a Firm audit or a gate-check is running, the office asks this computer not to sleep, and lets go once everything has been idle for ${v.idleMinutes} minutes. The screen can still turn off. It never outlives the office.${v.admin ? '' : ' Admins can change it.'}`;
    lid.replaceChildren(lidNote(v.platform));
  };
  idleSave.addEventListener('click', () => void send({ idleMinutes: Number(idle.value) }));
  idle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void send({ idleMinutes: Number(idle.value) });
  });
  const load = async () => {
    const v = await call();
    if (v) ((view = v), paint());
  };
  paint();
  void load();
  const timer = setInterval(() => void load(), 5_000);
  return { section, off: () => clearInterval(timer) };
}
