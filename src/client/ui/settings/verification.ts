// ⚙️ Settings › ✅ Verification (Testing release 2): the project's verification policy, the checks a
// merged task needs on its merge commit before it counts as delivered ("Done (verified)"). A small,
// plain form, admins only (everyone else sees it read-only); every change is audited as testing.policy
// (server/testing/verify.ts). Waivers are given in App Insights › Testing › Verification. Above it, the
// two office-wide Testing switches (release 39, both off by default): judging merged tasks against
// checks, and scoring main automatically with mxcli; each change audited as settings.change.

import { CHECK_KEYS, CHECK_LABEL, DEFAULT_POLICY, policyWords, type CheckKey, type VerificationPolicy } from '../../../shared/testing/policy';
import type { VerificationView } from '../../../shared/testing/verify';
import { SWITCH_LABEL, type SwitchesView, type TestingSwitchKey } from '../../../shared/testing/switches';
import { store } from '../../state';
import { h } from '../dom';
import { setting, type Built } from './kit';

export function verificationPart(): Built {
  const floor = store.floor;
  const body = h('div', {}, h('p.setting-note', {}, floor ? 'Asking the office…' : 'Open a project to see its verification policy.'));
  let gone = false;
  const load = async () => {
    if (!floor) return;
    try {
      const res = await fetch(`/api/testing?floor=${encodeURIComponent(floor)}&part=verification`, { credentials: 'same-origin' });
      const v = (await res.json()) as VerificationView & { error?: string };
      if (!res.ok) throw new Error(v.error ?? `HTTP ${res.status}`);
      if (!gone) body.replaceChildren(form(floor, v, load));
    } catch (err) {
      if (!gone) body.replaceChildren(h('p.setting-note', {}, `Couldn’t ask the office: ${(err as Error).message}`));
    }
  };
  void load();
  const sw = switchesPart();
  return {
    nodes: [
      setting('Office-wide switches', 'office', sw.node),
      setting('Required checks', 'floor', body),
      setting(
        'What the states mean',
        null,
        h(
          'p.setting-note',
          {},
          'Each required check on a revision is passed, failed, missing (it never ran on that revision), skipped, or waived (by a named person, with a reason, audited). Missing and skipped never count as passed. A merged task is Done (verified) only when every required check passed or was waived on its merge commit; checks that passed on the PR head alone give “Passed on PR head, integrated revision not checked”.',
        ),
      ),
    ],
    off: () => {
      gone = true;
      sw.off();
    },
  };
}

const SWITCH_NOTE: Record<TestingSwitchKey, string> = {
  judge: 'Judges each merged task on its merge commit against the policy below, raises “Merged, not verified” items in Needs you, and fetches the default branch’s checks with gh. Off by default; when turned on, only pull requests merged from then on are judged.',
  autoScore: 'Works out the quality scores (mxcli report and lint, about 20 s of heavy CPU) for each new main commit, never while an agent on the project is working. Off by default; an admin’s “Score main now” on the Testing tab works either way.',
};

/** The two office-wide Testing switches (release 39), both off by default; only an admin changes them, each change audited. */
function switchesPart(): { node: HTMLElement; off(): void } {
  const node = h('div.vp', {}, h('p.setting-note', {}, 'Asking the office…'));
  let gone = false;
  const draw = (v: SwitchesView, said = '') => {
    const note = h('p.setting-note', { role: 'status' }, said);
    const row = (key: TestingSwitchKey) => {
      const box = h('input', { type: 'checkbox', checked: v.switches[key], disabled: !v.admin, 'data-switch': key }) as HTMLInputElement;
      box.onchange = async () => {
        box.disabled = true;
        note.textContent = 'Saving…';
        const res = await fetch('/api/testing/switches', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [key]: box.checked, by: store.me.account?.name ?? store.profile.name }) }).catch(() => undefined);
        const out = (await res?.json().catch(() => ({}))) as (SwitchesView & { error?: string }) | undefined;
        if (gone) return;
        if (!res?.ok || !out?.switches) {
          box.checked = !box.checked;
          box.disabled = false;
          note.textContent = `Not saved: ${out?.error ?? 'the office could not be reached'}`;
          return;
        }
        draw(out, 'Saved (audited).');
      };
      const since = key === 'judge' && v.switches.judgeSince ? ` Judging pull requests merged since ${new Date(v.switches.judgeSince).toLocaleString()}.` : '';
      return h('div.vp-switch', {}, h('label.vp-row', {}, box, ' ', h('b', {}, SWITCH_LABEL[key]), ` (${v.switches[key] ? 'on' : 'off'})`), h('p.setting-note', {}, SWITCH_NOTE[key], since));
    };
    node.replaceChildren(row('judge'), row('autoScore'), ...(v.admin ? [] : [h('p.setting-note', {}, 'Only an admin can change them.')]), note);
  };
  void (async () => {
    try {
      const res = await fetch('/api/testing/switches', { credentials: 'same-origin' });
      const v = (await res.json()) as SwitchesView & { error?: string };
      if (!res.ok) throw new Error(v.error ?? `HTTP ${res.status}`);
      if (!gone) draw(v);
    } catch (err) {
      if (!gone) node.replaceChildren(h('p.setting-note', {}, `Couldn’t ask the office: ${(err as Error).message}`));
    }
  })();
  return { node, off: () => (gone = true) };
}

function form(floor: string, v: VerificationView, reload: () => Promise<void>): HTMLElement {
  const admin = !!v.admin;
  const boxes = new Map<CheckKey, HTMLInputElement>();
  const row = (key: CheckKey) => {
    const box = h('input', { type: 'checkbox', checked: v.policy.required.includes(key), disabled: !admin }) as HTMLInputElement;
    boxes.set(key, box);
    return h('label.vp-row', {}, box, ` ${CHECK_LABEL[key]}`);
  };
  const linked = h('input', { type: 'checkbox', checked: v.policy.linkedCriteria, disabled: !admin }) as HTMLInputElement;
  const note = h('p.setting-note', { role: 'status' });
  const post = async (policy: VerificationPolicy | null) => {
    note.textContent = 'Saving…';
    const res = await fetch('/api/testing/verification', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ floor, action: 'policy', policy, by: store.me.account?.name ?? store.profile.name }),
    }).catch(() => undefined);
    const out = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    if (!res?.ok) {
      note.textContent = `Not saved: ${out?.error ?? 'the office could not be reached'}`;
      return;
    }
    await reload();
  };
  const save = h('button.btn.small', { type: 'button', disabled: !admin, onclick: () => void post({ v: 1, required: CHECK_KEYS.filter((k) => boxes.get(k)!.checked), linkedCriteria: linked.checked }) }, 'Save');
  const reset = h('button.btn.small', { type: 'button', disabled: !admin || v.from === 'default', title: `The default: ${policyWords(DEFAULT_POLICY)}`, onclick: () => void post(null) }, 'Reset to the default');
  return h(
    'div.vp',
    {},
    h('p.setting-note', {}, h('b', {}, 'In force: '), v.words, v.from === 'default' ? ' (the default: nothing has been set for this project)' : ` (set by ${v.by ?? 'an admin'})`),
    h('fieldset.vp-set', { disabled: !admin }, h('legend', {}, 'Required on the merge commit'), ...CHECK_KEYS.map(row), h('label.vp-row', {}, linked, ' E2E journeys for the task’s linked acceptance criteria (only when its PR says “Covers: AC-…”)')),
    h('div.seg', {}, save, reset),
    admin ? null : h('p.setting-note', {}, 'Only an admin can change it.'),
    note,
  );
}
