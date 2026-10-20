// ⚙️ Settings › 👥 Team: the office's autonomy policy for new projects (roster/autonomy-choice.ts), under the
// project's own team settings. Off by default; an admin can limit the levels the New project flow's autonomy
// step offers, or fix one level (then shown locked there, and acknowledged by whoever creates the project).
// It applies to projects created from now on, and to later level changes on the Team settings; it never
// moves a project's current level. Each change is audited as settings.change.
import { AUTONOMY, type AutonomyLevel } from '../../../shared/roster/autonomy';
import { LEVELS, policyWords, type AutonomyPolicy } from '../../../shared/roster/autonomy-step';
import { store } from '../../state';
import { h } from '../dom';
import { setting, type Built } from './kit';

interface View {
  policy: AutonomyPolicy;
  admin: boolean;
}

export function autonomyPolicyPart(): Built {
  const body = h('div.ap-set', {}, h('p.setting-note', {}, 'Asking the office…'));
  let gone = false;
  const draw = (v: View, said = '') => {
    const off = !v.admin;
    let mode = v.policy.mode;
    const allowed = new Set<AutonomyLevel>(v.policy.mode === 'limit' ? (v.policy.allowed ?? []) : []);
    let level: AutonomyLevel = v.policy.level ?? 2;
    const note = h('p.setting-note', { role: 'status' }, said);
    const name = h('input.ro-text', { type: 'text', value: v.policy.name ?? '', placeholder: 'e.g. Delivery rules', disabled: off, 'aria-label': 'What your organisation calls this policy', size: '28' }) as HTMLInputElement;
    const radio = (m: AutonomyPolicy['mode'], label: string) => {
      const i = h('input', { type: 'radio', name: 'ap-mode', value: m, checked: mode === m, disabled: off }) as HTMLInputElement;
      i.addEventListener('change', () => ((mode = m), shown()));
      return h('label.ro-check', {}, i, ' ', label);
    };
    const limits = h('div.ap-limits', {}, ...LEVELS.map((l) => {
      const c = h('input', { type: 'checkbox', checked: allowed.has(l), disabled: off, 'data-ap-allow': String(l) }) as HTMLInputElement;
      c.addEventListener('change', () => (c.checked ? allowed.add(l) : allowed.delete(l)));
      return h('label.ro-check', {}, c, ` ${l} ${AUTONOMY[l].name}`);
    }));
    const fixedSel = h('select.ro-select', { disabled: off, 'aria-label': 'The fixed level' }, ...LEVELS.map((l) => h('option', { value: String(l), selected: l === level }, `${l} ${AUTONOMY[l].name}`))) as HTMLSelectElement;
    fixedSel.addEventListener('change', () => (level = Number(fixedSel.value) as AutonomyLevel));
    const shown = () => {
      limits.hidden = mode !== 'limit';
      fixedSel.hidden = mode !== 'fixed';
    };
    shown();
    const save = h('button.btn.primary', { type: 'button', disabled: off, id: 'ap-save' }, 'Save policy');
    save.addEventListener('click', async () => {
      note.textContent = 'Saving…';
      const res = await fetch('/api/autonomy/policy', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, allowed: [...allowed], level, name: name.value, by: store.me.account?.name ?? store.profile.name }) }).catch(() => undefined);
      const out = (await res?.json().catch(() => ({}))) as (View & { error?: string }) | undefined;
      if (gone) return;
      if (!res?.ok || !out?.policy) return void (note.textContent = `Not saved: ${out?.error ?? 'the office could not be reached'}`);
      draw(out, 'Saved (audited).');
    });
    body.replaceChildren(
      h('p.setting-note', {}, `Now: ${policyWords(v.policy)}. The New project flow’s autonomy step honours it, and so do later level changes on a project’s Team settings; a project’s current level is never moved by it.`),
      radio('none', 'None (default): every level may be chosen'),
      radio('limit', 'Limit the levels new projects may choose:'),
      limits,
      h('p.ro-row', {}, radio('fixed', 'Fix one level for every new project: '), fixedSel),
      h('p.ro-row', {}, 'Name ', name),
      ...(off ? [h('p.setting-note', {}, 'Only an admin can change it.')] : [save]),
      ...(v.policy.by && v.policy.at ? [h('p.setting-note', {}, `Last changed by ${v.policy.by}, ${new Date(v.policy.at).toLocaleString()}.`)] : []),
      note,
    );
  };
  void (async () => {
    try {
      const res = await fetch('/api/autonomy/policy', { credentials: 'same-origin' });
      const v = (await res.json()) as View & { error?: string };
      if (!res.ok) throw new Error(v.error ?? `HTTP ${res.status}`);
      if (!gone) draw(v);
    } catch (err) {
      if (!gone) body.replaceChildren(h('p.setting-note', {}, `Couldn’t ask the office: ${(err as Error).message}`));
    }
  })();
  return { nodes: [setting('Autonomy policy for new projects', 'office', body)], off: () => (gone = true) };
}
