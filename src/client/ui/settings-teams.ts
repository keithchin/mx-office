// ⚙️ Settings → Notifications → Microsoft Teams (server/notify-teams/): the Workflows webhook (masked
// once saved: only where it goes), Test, which floors post, the level, quiet hours, a pause, and the
// office's public address for each card's Open button. Admins change it; everyone sees it.

import './settings-teams.css';
import type { QuietHours, TeamsSettingsPatch, TeamsSettingsView } from '../../shared/notify-teams';
import { h, timeAgo, toast } from './dom';

/** Your name as this browser has it, for the record (an account's name wins on the server). */
function myName(): string | undefined {
  try {
    return JSON.parse(localStorage.getItem('agent-office.profile') ?? 'null')?.name;
  } catch {
    return undefined;
  }
}

async function call(path: string, body?: unknown): Promise<TeamsSettingsView | { ok: true } | undefined> {
  try {
    const res = await fetch(path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(body as object), by: myName() }) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
    return data;
  } catch (err) {
    // A refresh that failed says nothing: the next one may get through. A change that failed says why.
    if (body !== undefined) toast((err as Error).message, 'warn');
    return undefined;
  }
}

const LEVELS: [TeamsSettingsView['level'], string][] = [
  ['needs', '🔴 Needs you only'],
  ['digest', '🔴 Needs you + 📋 daily digest'],
];

const radio = (label: string, on: boolean, click: () => void, disabled: boolean) =>
  h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'on' : '', disabled, onclick: click }, label);

/** The setting, made by `frame` from what goes in it, and what to call when Settings closes. */
export function teamsSetting(frame: (body: Node[]) => HTMLElement): { section: HTMLElement; off: () => void } {
  let view: TeamsSettingsView | undefined;
  const status = h('p.setting-note.teams-status');
  const urlInput = h('input', { type: 'password', placeholder: 'https://…logic.azure.com/workflows/…', 'aria-label': 'Teams Workflows webhook URL', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const urlSave = h('button.btn.primary', { type: 'button' }, 'Save');
  const test = h('button.btn', { type: 'button' }, '📨 Send a test card');
  const remove = h('button.btn.danger', { type: 'button' }, 'Remove');
  const urlActions = h('div.seg', { style: 'margin-top:8px' }, test, remove);
  const floorsRow = h('div.seg.teams-floors', { role: 'group', 'aria-label': 'Floors that post' });
  const levelRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'What is posted' });
  const quietOn = h('input', { type: 'checkbox', 'aria-label': 'Quiet hours' }) as HTMLInputElement;
  const quietStart = h('input', { type: 'time', value: '22:00', 'aria-label': 'Quiet from' }) as HTMLInputElement;
  const quietEnd = h('input', { type: 'time', value: '07:00', 'aria-label': 'Quiet until' }) as HTMLInputElement;
  const quietSave = h('button.btn', { type: 'button' }, 'Save');
  const pauseRow = h('div.seg');
  const publicInput = h('input', { type: 'text', placeholder: 'https://office.example.com (empty: cards have no Open button)', 'aria-label': 'Public office address', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const publicSave = h('button.btn', { type: 'button' }, 'Save');
  const more = h('div.teams-more');
  const adminNote = h('p.setting-note');

  const send = async (patch: TeamsSettingsPatch) => {
    const v = await call('/api/notify/teams', patch);
    if (v && 'level' in v) ((view = v), paint());
    return v;
  };

  more.append(
    h('h5', {}, 'Floors that post'),
    floorsRow,
    h('h5', {}, 'What’s posted'),
    levelRow,
    h('p.setting-note', {}, 'Red items are the same as the Command Center’s Needs you: an agent asking in its terminal, an escalation, the spend cap, failing PR checks, a Firm report, a gate to sign off, Studio Pro changes to commit. One card per item, never again after a restart; items raised within a minute share a card. The digest comes per floor after its morning standup (or half an hour after the standup time): yesterday’s merges, what needs you, spend against the cap, stage progress and the top three escalations by Jeff’s priority.'),
    h('h5', {}, 'Quiet hours'),
    h('div.teams-quiet', {}, h('label', {}, quietOn, ' Hold cards from '), quietStart, h('span', {}, ' to '), quietEnd, quietSave),
    h('p.setting-note', {}, 'On the office computer’s clock. Held items go out as one catch-up card when quiet hours end (only the ones still open are listed).'),
    h('h5', {}, 'Pause'),
    pauseRow,
    h('h5', {}, 'Public office address'),
    h('div.webhook', {}, publicInput, publicSave),
    h('p.setting-note', {}, 'Each card’s Open button goes here (the floor’s 1D view), so it works from your phone. Leave it empty while the office is only reachable on this network: cards then have no button. Phone access fills this in when it’s set up.'),
  );

  const section = frame([status, h('div.webhook', {}, urlInput, urlSave), urlActions, more, adminNote]);

  const paint = () => {
    const v = view;
    if (!v) return void (status.textContent = 'Loading…');
    const admin = v.admin;
    for (const el of [urlInput, urlSave, test, remove, quietOn, quietStart, quietEnd, quietSave, publicInput, publicSave]) (el as HTMLInputElement).disabled = !admin;
    urlInput.closest('.webhook')?.classList.toggle('hidden', !admin);
    urlActions.classList.toggle('hidden', !v.on || !admin);
    more.classList.toggle('hidden', !v.on);
    urlSave.textContent = v.on ? 'Replace' : 'Save';
    status.classList.toggle('bad', !!v.error);
    const held = v.held ? ` · ${v.held} held` : '';
    const pending = v.pending ? ` · ${v.pending} waiting to post` : '';
    status.textContent = !v.on
      ? 'Posts an Adaptive Card to a Teams channel when something needs a person. In Teams, add the “Post to a channel when a webhook request is received” workflow to your channel, copy its HTTP POST URL and paste it here (see the docs: Teams notifications).'
      : v.error
        ? `⚠️ Posting to Teams (${v.hint}) failed: ${v.error}${pending}${held}`
        : `📣 Posting to Teams (${v.hint})${v.by && v.at ? `, set by ${v.by} ${timeAgo(v.at)}` : ''}${v.lastSentAt ? ` · last card ${timeAgo(v.lastSentAt)}` : ''}${pending}${held}.${v.storedIn === 'settings-file' ? ' The URL is kept in the office’s settings file and never shown again.' : v.storedIn === 'credential-store' ? ' The URL is kept encrypted in 🔌 Connections and never shown again.' : ''}`;
    const all = v.floors === 'all';
    const picked = new Set(all ? v.allFloors.map((f) => f.id) : (v.floors as string[]));
    floorsRow.replaceChildren(
      radio('All floors', all, () => !all && void send({ floors: 'all' }), !admin),
      ...v.allFloors.map((f) =>
        h('label.teams-floor', { class: picked.has(f.id) && !all ? 'on' : '' }, h('input', { type: 'checkbox', checked: picked.has(f.id), disabled: !admin, onchange: (e: Event) => {
          const on = (e.target as HTMLInputElement).checked;
          const next = new Set(picked);
          if (on) next.add(f.id);
          else next.delete(f.id);
          void send({ floors: next.size === v.allFloors.length ? 'all' : [...next] });
        } }), ` ${f.name}`),
      ),
    );
    levelRow.replaceChildren(...LEVELS.map(([lv, label]) => radio(label, v.level === lv, () => v.level !== lv && void send({ level: lv }), !admin)));
    quietOn.checked = !!v.quiet;
    if (v.quiet && document.activeElement !== quietStart && document.activeElement !== quietEnd) ((quietStart.value = v.quiet.start), (quietEnd.value = v.quiet.end));
    const paused = v.pausedUntil && v.pausedUntil > Date.now();
    pauseRow.replaceChildren(
      ...(paused
        ? [h('span.teams-paused', {}, `⏸️ Paused until ${new Date(v.pausedUntil!).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`), h('button.btn', { type: 'button', disabled: !admin, onclick: () => void send({ pauseMinutes: 0 }) }, '▶️ Resume now')]
        : [60, 240, 720].map((m) => h('button.btn', { type: 'button', disabled: !admin, onclick: () => void send({ pauseMinutes: m }) }, `⏸️ ${m / 60} h`))),
    );
    if (document.activeElement !== publicInput) publicInput.value = v.publicUrl ?? '';
    adminNote.classList.toggle('hidden', admin);
    adminNote.textContent = 'Admins can change Teams notifications.';
  };

  const saveUrl = async () => {
    const url = urlInput.value.trim();
    if (!url) return urlInput.focus();
    if (await send({ url })) {
      urlInput.value = '';
      toast('📣 Saved the Teams webhook. Send a test card to check it.');
    }
  };
  urlSave.addEventListener('click', () => void saveUrl());
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void saveUrl();
  });
  remove.addEventListener('click', () => void send({ url: '' }));
  test.addEventListener('click', async () => {
    test.disabled = true;
    const ok = await call('/api/notify/teams/test', {});
    test.disabled = false;
    if (ok) toast('📨 Sent a test card to Teams');
    void load();
  });
  const saveQuiet = () => {
    const q: QuietHours | null = quietOn.checked ? { start: quietStart.value, end: quietEnd.value } : null;
    void send({ quiet: q });
  };
  quietSave.addEventListener('click', saveQuiet);
  quietOn.addEventListener('change', saveQuiet);
  publicSave.addEventListener('click', () => void send({ publicUrl: publicInput.value.trim() }));

  const load = async () => {
    const v = await call('/api/notify/teams');
    if (v && 'level' in v) ((view = v), paint());
  };
  paint();
  void load();
  const timer = setInterval(() => void load(), 15_000);
  return { section, off: () => clearInterval(timer) };
}
