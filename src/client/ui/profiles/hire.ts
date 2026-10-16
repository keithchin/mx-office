// Hire from your agents, from a free seat's card on the Team tab: the office's agent profiles (the ones that
// held this role first), each with its roles, projects and dates, where it is now and "not measured yet";
// pick one, then Hire. A profile working on another project needs the Move confirmed in the same window:
// what happens there (handoff note, kept there; benched), then a fresh session here. No concurrent use.
// ✕ and Esc give focus back to the button that opened it.

import { NOT_MEASURED, PROFILE_HONESTY, type NeedsMove, type ProfileView } from '../../../shared/profiles';
import type { RoleId } from '../../../shared/roster/roles';
import { h, openModal, toast } from '../dom';
import { profileAct, profilesView } from './api';
import { hireOrder, moveLines, projectsText, roleTitle, rolesText, whereText } from './words';
import './profiles.css';

export function hireFromAgents(opener: HTMLElement | null, floor: string, role: RoleId, done: () => void) {
  const status = h('p.pr-status', { role: 'status' }, 'Asking the office…');
  const list = h('div.pr-pick', { role: 'group', 'aria-label': 'Your agents' });
  const task = h('textarea.pr-input', { rows: '2', maxlength: '4000', placeholder: 'A task to start on (optional)', 'aria-label': 'A task to start on (optional)' }) as HTMLTextAreaElement;
  const hire = h('button.btn.primary', { type: 'button', disabled: '' }, '🤝 Hire');
  const body = h('div.body', {}, h('p.pr-note', {}, PROFILE_HONESTY), list, h('label.pr-field', {}, h('span', {}, 'Task'), task), status);
  const foot = h('footer', {}, hire);
  const content = h('div.modal.pr-dialog', { role: 'dialog', 'aria-label': `Hire from your agents: ${roleTitle(role)}` }, h('header', {}, h('h2', {}, `👥 Hire from your agents · ${roleTitle(role)}`)), body, foot);
  const modal = openModal(content, { onClose: () => opener?.focus?.() });
  let picked: ProfileView | undefined;

  const go = async (move: boolean) => {
    if (!picked) return;
    hire.setAttribute('disabled', '');
    status.textContent = move ? 'Starting the move…' : 'Hiring…';
    const r = await profileAct({ action: 'hire', profile: picked.id, floor, role, ...(task.value.trim() ? { task: task.value.trim() } : {}), ...(move ? { move: true } : {}) });
    hire.removeAttribute('disabled');
    if (r.needsMove && !move) return confirmMove(r.needsMove);
    if (r.error) return void (status.textContent = r.error);
    modal.close();
    toast(`🤝 Hired ${picked.displayName}: a fresh session`);
    done();
  };

  // The Move, explained in the same window: its effect on the source project first.
  const confirmMove = (n: NeedsMove) => {
    const yes = h('button.btn.primary', { type: 'button' }, `🧳 Move ${n.name} here`);
    const no = h('button.btn', { type: 'button' }, 'Cancel');
    body.replaceChildren(h('p', {}, h('strong', {}, `${n.name} is ${n.from.status === 'active' ? 'working on' : 'benched on'} ${n.from.project}.`), ' Moving is the only way to bring it here.'), h('ul.pr-move', {}, ...moveLines(n).map((l) => h('li', {}, l))), status);
    status.textContent = '';
    (content.querySelector('header h2') as HTMLElement).textContent = `Move ${n.name} here?`;
    foot.replaceChildren(no, yes);
    no.onclick = () => modal.close();
    yes.onclick = async () => {
      yes.setAttribute('disabled', '');
      status.textContent = n.from.status === 'active' ? `Asking ${n.name} for a handoff note on ${n.from.project}…` : 'Hiring…';
      const r = await profileAct({ action: 'hire', profile: n.profile, floor, role, ...(task.value.trim() ? { task: task.value.trim() } : {}), move: true });
      yes.removeAttribute('disabled');
      if (r.error) return void (status.textContent = r.error);
      modal.close();
      toast(r.op?.state === 'done' ? `🧳 Moved ${n.name} here: a fresh session` : `🧳 ${n.name} is writing a handoff note on ${n.from.project}; it joins here when that's done (Home › Agents shows the move)`);
      done();
    };
    setTimeout(() => yes.focus(), 0);
  };
  hire.onclick = () => void go(false);

  void profilesView().then(
    (v) => {
      const rows = hireOrder(v.profiles, floor, role);
      status.textContent = rows.length ? '' : 'No agents yet: hire someone new first. Each hire gets a profile of its own.';
      list.replaceChildren(
        ...rows.map((p) => {
          const busy = !!p.move && p.move.state !== 'failed';
          const row = h(
            'button.pr-row',
            { type: 'button', 'aria-pressed': 'false', ...(busy ? { disabled: '' } : {}) },
            h('span.pr-row-h', {}, h('b', {}, p.label), h('span.pr-where', { 'data-kind': p.where.kind }, whereText(p))),
            h('span.pr-row-l', {}, `Roles: ${rolesText(p)}`),
            h('span.pr-row-l', {}, `Projects: ${projectsText(p) || 'none'}`),
            h('span.pr-row-l.pr-dim', {}, `Track record: ${NOT_MEASURED}`),
          );
          row.onclick = () => {
            picked = p;
            for (const x of list.querySelectorAll('.pr-row')) x.setAttribute('aria-pressed', String(x === row));
            hire.textContent = p.where.kind === 'free' ? `🤝 Hire ${p.displayName}` : `🤝 Hire ${p.displayName}…`;
            hire.removeAttribute('disabled');
          };
          return row;
        }),
      );
      list.querySelector<HTMLElement>('.pr-row:not([disabled])')?.focus();
    },
    (err) => (status.textContent = `Couldn’t ask the office: ${(err as Error).message}`),
  );
  return modal;
}
