// ⚙️ Settings › 🧭 Stuck detection (server/stuck/): on or off for the whole office (on by default) and
// its thresholds in hours. Admins change them, everyone else sees them read-only; each change is audited
// as settings.change. Snoozes and dismissals are per item, on the item's card in Needs you.

import { STUCK_HOURS_KEYS, STUCK_HOURS_LABEL, type StuckHoursKey, type StuckSettings } from '../../../shared/stuck';
import { store } from '../../state';
import { h } from '../dom';
import { setting, type Built } from './kit';

interface View {
  settings: StuckSettings;
  admin: boolean;
}

const NOTE: Record<StuckHoursKey, string> = {
  prHours: 'An open, ready pull request with no new commits, comments or reviews for this long.',
  decisionHours: 'A build-plan pending decision that blocks rows, or a PROJECT.md open question that is yours or the client’s, open this long.',
  failingHours: 'A journey, test or required check failing with the same failure for this long.',
  circlesHours: 'Agents working, but no merged pull request, no stage change and no build-plan row change for this long.',
};

export function stuckPart(): Built {
  const body = h('div.stk-set', {}, h('p.setting-note', {}, 'Asking the office…'));
  let gone = false;
  const save = async (patch: Record<string, unknown>, note: HTMLElement) => {
    note.textContent = 'Saving…';
    const res = await fetch('/api/stuck/settings', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...patch, by: store.me.account?.name ?? store.profile.name }) }).catch(() => undefined);
    const out = (await res?.json().catch(() => ({}))) as (View & { error?: string }) | undefined;
    if (gone) return;
    if (!res?.ok || !out?.settings) {
      note.textContent = `Not saved: ${out?.error ?? 'the office could not be reached'}`;
      return void load();
    }
    draw(out, 'Saved (audited).');
  };
  const draw = (v: View, said = '') => {
    const note = h('p.setting-note', { role: 'status' }, said);
    const on = h('input', { type: 'checkbox', checked: v.settings.on, disabled: !v.admin, 'data-stuck': 'on' }) as HTMLInputElement;
    on.onchange = () => void save({ on: on.checked }, note);
    const hours = (k: StuckHoursKey) => {
      const box = h('input.stk-h', { type: 'number', min: '1', max: '720', step: '1', value: String(v.settings[k]), disabled: !v.admin || !v.settings.on, 'data-stuck': k, 'aria-label': `${STUCK_HOURS_LABEL[k]}, in hours` }) as HTMLInputElement;
      box.onchange = () => void save({ [k]: Number(box.value) }, note);
      return h('label.stk-row', {}, h('span.stk-l', {}, h('b', {}, STUCK_HOURS_LABEL[k]), h('small', {}, NOTE[k])), h('span.stk-in', {}, box, ' h'));
    };
    body.replaceChildren(
      h('label.stk-row', {}, h('span.stk-l', {}, h('b', {}, 'Stuck detection'), h('small', {}, 'Raises each stuck item once in Needs you (with phone and Teams alerts, by their rules), updates it in place and resolves it by itself when the condition clears. The office never writes to GitHub.')), h('span.stk-in', {}, on)),
      ...STUCK_HOURS_KEYS.map(hours),
      ...(v.admin ? [] : [h('p.setting-note', {}, 'Only an admin can change these.')]),
      ...(v.settings.by && v.settings.at ? [h('p.setting-note', {}, `Last changed by ${v.settings.by}, ${new Date(v.settings.at).toLocaleString()}.`)] : []),
      note,
    );
  };
  const load = async () => {
    try {
      const res = await fetch('/api/stuck/settings', { credentials: 'same-origin' });
      const v = (await res.json()) as View & { error?: string };
      if (!res.ok) throw new Error(v.error ?? `HTTP ${res.status}`);
      if (!gone) draw(v);
    } catch (err) {
      if (!gone) body.replaceChildren(h('p.setting-note', {}, `Couldn’t ask the office: ${(err as Error).message}`));
    }
  };
  void load();
  return {
    nodes: [setting('Office-wide', 'office', body)],
    off: () => {
      gone = true;
    },
  };
}
