// The Roadmap's dialogs, each with ✕ top right and Esc, focus back where it was opened from: Edit phases (rename,
// ↑ ↓, Split, Merge ↓, the checkpoint and publish switches, a required reason; done phases locked; saved as one
// recorded change), the same for a team proposal's Edit first (prefilled with what it proposes, saved as the
// accepted proposal), Ask the team for a change (a message to the lead), and a decline's or stop's reason.
// The edits are PhaseOps, previewed with the same rules the server applies (shared/phases/plan.ts).

import { applyOps } from '../../../shared/phases/plan';
import type { Phase, PhaseOp } from '../../../shared/phases/types';
import type { PhasesView } from '../../../shared/phases/view';
import { h, openModal } from '../dom';

/** The view's lines as phases, enough for the rules (status, rows, switches). */
export const phasesOfView = (v: PhasesView): Phase[] =>
  v.phases.map((l) => ({ id: l.id, name: l.name, goal: l.goal, foundation: l.foundation, rows: l.rows.map((r) => r.n), useCases: l.useCases, journeys: l.journeys.map((j) => j.id), estimate: l.estimate, ...(l.days ? { days: l.days } : {}), checkpoint: l.checkpoint, publish: l.publish, status: l.status, overlapsWith: l.overlaps.map((o) => v.phases[o - 1]?.id).filter(Boolean), ...(l.early ? { early: l.early } : {}), ...(l.startedAt ? { startedAt: l.startedAt } : {}) }));

export const toggle = (checked: boolean, label: string, onchange: (on: boolean) => void, disabled = false) => {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label, ...(disabled ? { disabled: true } : {}) }) as HTMLInputElement;
  input.checked = checked;
  input.onchange = () => onchange(input.checked);
  return h('label.rm-sw', {}, input, h('span'));
};

const locked = (p: Phase) => p.status === 'done' || p.status === 'stopped';

export interface EditOpts {
  title: string;
  lead: string;
  save: string;
  /** Edits already made (a proposal's, for Edit first). */
  ops?: PhaseOp[];
  reason?: string;
  /** Saves; resolves to an error to show, or nothing when it's done. */
  submit(ops: PhaseOp[], reason: string): Promise<string | undefined>;
}

export function openEditPhases(v: PhasesView, o: EditOpts) {
  const back = document.activeElement as HTMLElement | null;
  const base = phasesOfView(v);
  let ops: PhaseOp[] = [...(o.ops ?? [])];
  const msg = h('p.rm-msg', { role: 'status', 'aria-live': 'polite' });
  const reason = h('input.rm-inp', { type: 'text', maxlength: 1000, 'aria-label': 'Reason for this change', placeholder: 'e.g. Move admin earlier so moderation is ready for the launch event' }) as HTMLInputElement;
  reason.value = o.reason ?? '';
  const save = h('button.btn.primary', { type: 'button' }, o.save) as HTMLButtonElement;
  const body = h('tbody');
  const now = Date.now();
  const current = (): Phase[] => {
    const r = ops.length ? applyOps(base, ops, now) : base;
    return typeof r === 'string' ? base : r;
  };
  const push = (op: PhaseOp) => {
    const next = applyOps(base, [...ops, op], now);
    if (typeof next === 'string') return void (msg.textContent = next);
    // Renames of the same phase fold into one.
    const last = ops[ops.length - 1];
    if (op.op === 'rename' && last?.op === 'rename' && last.phase === op.phase) ops[ops.length - 1] = op;
    else ops.push(op);
    msg.textContent = '';
    paint();
  };
  function paint() {
    const ps = current();
    save.disabled = !ops.length || reason.value.trim().length < 3;
    body.replaceChildren(
      ...ps.map((p, i) => {
        const lock = locked(p);
        const name = h('input.rm-inp', { type: 'text', value: p.name, maxlength: 80, 'aria-label': `Name of phase ${i + 1}`, ...(lock ? { disabled: true } : {}) }) as HTMLInputElement;
        name.onchange = () => name.value.trim() && name.value.trim() !== p.name && push({ op: 'rename', phase: p.id, name: name.value.trim() });
        const move = (d: -1 | 1) => {
          const order = ps.map((x) => x.id);
          const j = i + d;
          if (j < 0 || j >= order.length) return;
          [order[i], order[j]] = [order[j], order[i]];
          push({ op: 'reorder', order });
        };
        const half = p.rows.slice(Math.ceil(p.rows.length / 2));
        const acts = lock
          ? h('span.rm-muted', {}, `${p.status === 'done' ? 'Done' : 'Stopped'} · locked`)
          : h(
              'span.rm-eacts',
              {},
              h('button.pt-link.rm-link', { type: 'button', 'aria-label': `Move ${p.name} up`, disabled: i === 0 || locked(ps[i - 1]), onclick: () => move(-1) }, '↑'),
              h('button.pt-link.rm-link', { type: 'button', 'aria-label': `Move ${p.name} down`, disabled: i === ps.length - 1, onclick: () => move(1) }, '↓'),
              h('button.pt-link.rm-link', { type: 'button', disabled: p.rows.length < 2, title: 'Split off the second half of its rows into a new phase', onclick: () => push({ op: 'split', phase: p.id, rows: half, name: `${p.name} (2)` }) }, 'Split'),
              i < ps.length - 1 && !locked(ps[i + 1]) ? h('button.pt-link.rm-link', { type: 'button', title: `Merge with ${ps[i + 1].name}`, onclick: () => push({ op: 'merge', phases: [p.id, ps[i + 1].id] }) }, 'Merge ↓') : null,
            );
        return h(
          'tr',
          { class: lock ? 'locked' : '' },
          h('td', {}, h(`span.rm-num${lock ? '.f' : ''}`, {}, String(i + 1))),
          h('td', {}, name),
          h('td.c', {}, String(p.rows.length)),
          h('td.c', {}, toggle(p.checkpoint, `Checkpoint for ${p.name}`, (on) => push({ op: 'toggle', phase: p.id, checkpoint: on }), lock)),
          h('td.c', {}, toggle(p.publish, `Publish ${p.name}`, (on) => push({ op: 'toggle', phase: p.id, publish: on }), lock)),
          h('td', {}, acts),
        );
      }),
    );
  }
  reason.oninput = () => (save.disabled = !ops.length || reason.value.trim().length < 3);
  const content = h(
    'div.modal.rm-modal',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title },
    h('header', {}, h('div', {}, h('h2', {}, o.title), h('p.rm-muted', {}, o.lead))),
    h(
      'div.body.rm-mbody',
      {},
      h('table.rm-etable', {}, h('thead', {}, h('tr', {}, h('th'), h('th', {}, 'Phase'), h('th.c', {}, 'Rows'), h('th.c', {}, 'Checkpoint'), h('th.c', {}, 'Publish'), h('th'))), body),
      h('label.rm-field', {}, h('span', {}, 'Reason for this change (required)'), reason),
      h('p.rm-muted.rm-small', {}, 'To move single rows between phases, use Move to on a row in the Build Plan gate view, or ask the team.'),
      msg,
    ),
    h('footer', {}, h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Cancel'), save),
  );
  const modal = openModal(content, { onClose: () => back?.focus?.() });
  save.onclick = async () => {
    save.disabled = true;
    const err = await o.submit(ops, reason.value.trim());
    if (err) {
      msg.textContent = err;
      save.disabled = false;
      return;
    }
    modal.close();
  };
  paint();
  (body.querySelector('input:not([disabled])') as HTMLInputElement | null)?.focus();
}

/** A text box in a dialog (Ask the team, a decline's or a stop's reason); `submit` resolves to an error or nothing. */
export function openTextDialog(o: { title: string; lead: string; label: string; placeholder: string; action: string; required?: boolean; submit(text: string): Promise<string | undefined> }) {
  const back = document.activeElement as HTMLElement | null;
  const text = h('textarea.rm-inp.rm-ta', { rows: 4, maxlength: 4000, 'aria-label': o.label, placeholder: o.placeholder }) as HTMLTextAreaElement;
  const msg = h('p.rm-msg', { role: 'status', 'aria-live': 'polite' });
  const go = h('button.btn.primary', { type: 'button', disabled: !!o.required }, o.action) as HTMLButtonElement;
  text.oninput = () => (go.disabled = !!o.required && text.value.trim().length < 3);
  const content = h('div.modal.rm-modal.rm-narrow', { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title }, h('header', {}, h('div', {}, h('h2', {}, o.title), h('p.rm-muted', {}, o.lead))), h('div.body.rm-mbody', {}, h('label.rm-field', {}, h('span', {}, o.label), text), msg), h('footer', {}, h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Cancel'), go));
  const modal = openModal(content, { onClose: () => back?.focus?.() });
  go.onclick = async () => {
    go.disabled = true;
    const err = await o.submit(text.value.trim());
    if (err) {
      msg.textContent = err;
      go.disabled = false;
      return;
    }
    modal.close();
  };
  text.focus();
}
