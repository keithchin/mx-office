// The Team settings' autonomy, beyond the radio: how the level was set (chosen in the New project flow's
// step by whom and when, set by the organisation's policy, the default for an older caller, or nothing
// recorded for a project from before the step) and the latest change since; and the confirmation a change
// of level asks for, saying what it does: it applies to new work, what already waits for you keeps waiting
// (raising never approves it), the Leads at work get their Playbook rewritten and a message between turns,
// and the change is recorded with who and when.
import { AUTONOMY, type AutonomyLevel } from '../../../shared/roster/autonomy';
import { changeLine, choiceLine, policyWords } from '../../../shared/roster/autonomy-step';
import type { RosterSettings, RosterView } from '../../../shared/roster/types';
import { h, openModal } from '../dom';

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** "2 Guided, chosen by Alex Lee on 20 Oct 2026." and the latest change, under the levels. */
export function autonomyOrigin(v: RosterView): HTMLElement {
  const r = v.autonomyRecord;
  const lines = [choiceLine(r?.choice, day), changeLine(r?.last, day)].filter(Boolean);
  if (r?.policy && r.policy.mode !== 'none') lines.push(`Office policy for new projects: ${policyWords(r.policy)}${r.policy.name ? ` (${r.policy.name})` : ''}.`);
  return h('p.ro-sub.ro-origin', { 'data-origin': r?.choice?.source ?? 'none' }, lines.join(' '));
}

/** What already waits for the Project Manager: it keeps waiting whatever the level becomes. */
export function waitingCount(v: RosterView): number {
  return v.proposals.filter((p) => p.status === 'pending').length + v.escalations.filter((e) => e.status === 'open').length + v.subagentActions.filter((a) => a.status === 'pending').length;
}

/** The confirmation's sentences for a change from `from` to `to` (also what the DOM test reads). */
export function changeWords(v: RosterView, from: AutonomyLevel, to: AutonomyLevel, byStage: boolean): string[] {
  const n = waitingCount(v);
  const up = to > from;
  const out = [
    `From ${from} ${AUTONOMY[from].name} to ${to} ${AUTONOMY[to].name}: it applies to new work, the proposals the Leads make at the next standups and the escalations raised from now on.`,
    n
      ? `${n} item${n === 1 ? '' : 's'} already waiting for you (proposals, escalations, subagent actions) keep${n === 1 ? 's' : ''} ${n === 1 ? 'its' : 'their'} status: ${up ? 'raising autonomy doesn’t approve them' : 'they stay waiting'}; escalations keep the alert level they were raised with.`
      : 'Nothing is waiting for you right now. What waits later is decided at the new level.',
    up ? '' : 'What the team already decided on its own stays decided.',
    to >= 4 && from < 4 ? 'At 4 Autonomous the team’s open pull requests stop being listed under Approvals (the office never blocked a merge; only branch protection on GitHub does).' : '',
    'Every Lead at work has its Playbook rewritten and is told the new level in a short message, as today (not while it is asking you something, nor past the daily cap; an asleep one reads its Playbook when it wakes).',
    byStage ? 'Autonomy by stage is on: when the build plan’s gate passes the office sets the stage’s level itself.' : '',
    'The change is recorded in the audit log with your name, the time and both levels.',
  ];
  return out.filter(Boolean);
}

/** Asks before a level change is saved; true to save. Esc and ✕ cancel and give focus back to `opener`. */
export function confirmAutonomyChange(v: RosterView, next: RosterSettings, opener: HTMLElement | null): Promise<boolean> {
  const from = v.settings.autonomy;
  const to = next.autonomy;
  return new Promise((done) => {
    let yes = false;
    const cancel = h('button.btn', { type: 'button' }, 'Cancel');
    const ok = h('button.btn.primary', { type: 'button', id: 'ro-autonomy-ok' }, `Change to ${to} ${AUTONOMY[to].name}`);
    const el = h(
      'div.modal.ro-autonomy-confirm',
      { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ro-ac-h' },
      h('header', {}, h('h2', { id: 'ro-ac-h' }, 'Change the team’s autonomy?')),
      h('div.body', {}, h('ul', {}, ...changeWords(v, from, to, next.autonomyByStage?.enabled === true).map((t) => h('li', {}, t)))),
      h('footer', {}, h('span.grow'), cancel, ok),
    );
    const modal = openModal(el, {
      onClose: () => {
        if (opener && document.contains(opener)) opener.focus();
        done(yes);
      },
    });
    cancel.addEventListener('click', () => modal.close());
    ok.addEventListener('click', () => ((yes = true), modal.close()));
    setTimeout(() => ok.focus(), 20);
  });
}
