// The Build Plan gate's phases editor, on the Roadmap while the phases wait for approval (plan state
// 'proposed'): the sign-off header (who proposed, how many phases, the delivery switches), the proposed phases
// as a table (number, name with Foundation, goal, its rows to open with Move to on each, the journeys that prove
// it, the estimate, the checkpoint and publish switches), Split / Merge / + Add phase, the totals against the
// budget, and Ask for changes / Approve phases and start Build. Edits stay on the page (highlighted, "unsaved")
// until Approve sends them with the approval: one recorded change, C-1.

import { applyOps } from '../../../shared/phases/plan';
import type { Phase, PhaseOp, PhaseProposal } from '../../../shared/phases/types';
import { rangeText, usd, type PhasesView } from '../../../shared/phases/view';
import { h } from '../dom';
import { phasesOfView, toggle } from './edit';

export interface GateActs {
  approve(ops: PhaseOp[]): Promise<void>;
  askChanges(p: PhaseProposal | undefined): void;
}

export function gateEditor(v: PhasesView, acts: GateActs): HTMLElement {
  const base = phasesOfView(v);
  const proposal = v.proposals.find((p) => p.kind === 'plan' && p.status === 'open') ?? v.proposals.find((p) => p.kind === 'plan');
  const stepOf = new Map(v.buildRows.map((r) => [r.n, r.step]));
  const titleOf = new Map(v.journeysAll.map((j) => [j.id, j.title]));
  let ops: PhaseOp[] = [];
  const open = new Set<string>();
  const moved = new Map<number, string>();
  const msg = h('p.rm-msg', { role: 'status', 'aria-live': 'polite' });
  const table = h('tbody');
  const foot = h('div.rm-gate-sum');
  const now = Date.now();
  const cur = (): Phase[] => {
    const r = ops.length ? applyOps(base, ops, now) : base;
    return typeof r === 'string' ? base : r;
  };
  const push = (op: PhaseOp) => {
    const r = applyOps(base, [...ops, op], now);
    if (typeof r === 'string') return void (msg.textContent = r);
    ops.push(op);
    msg.textContent = ops.length ? `${ops.length} unsaved edit${ops.length === 1 ? '' : 's'}: saved with the approval, as one recorded change.` : '';
    paint();
  };
  const approveBtn = h('button.btn.primary', { type: 'button', disabled: !v.admin }, '✓ Approve phases and start Build') as HTMLButtonElement;
  approveBtn.onclick = async () => {
    approveBtn.disabled = true;
    await acts.approve(ops);
    approveBtn.disabled = false;
  };

  function paint() {
    const ps = cur();
    const rows = ps.flatMap((p, i) => {
      const n = i + 1;
      const exp = h('button.rm-exp', { type: 'button', 'aria-expanded': String(open.has(p.id)), onclick: () => (open.has(p.id) ? open.delete(p.id) : open.add(p.id), paint()) }, `${open.has(p.id) ? '▾' : '▸'} ${p.rows.length} rows`);
      const est = p.estimate.max > 0 ? rangeText(p.estimate) : '—';
      const tr = h(
        'tr.rm-ph',
        { 'data-phase': p.id },
        h('td', {}, h(`span.rm-num${p.foundation ? '.f' : ''}`, {}, String(n))),
        h('td', {}, h('div.rm-pname', {}, p.name, p.foundation ? h('span.rm-badge.b-found', {}, 'Foundation') : null), p.goal ? h('div.rm-pgoal', {}, p.goal) : null),
        h('td', {}, exp),
        h('td', {}, h('div.rm-jl', {}, ...(p.journeys.length ? p.journeys.map((j) => h('code.rm-jchip', { title: titleOf.get(j) ?? j }, j)) : [h('span.rm-muted', {}, 'none yet')]))),
        h('td.nowrap', {}, est),
        h('td.c', {}, toggle(p.checkpoint, `Checkpoint for ${p.name}`, (on) => push({ op: 'toggle', phase: p.id, checkpoint: on }), !v.admin)),
        h('td.c', {}, toggle(p.publish, `Publish ${p.name}`, (on) => push({ op: 'toggle', phase: p.id, publish: on }), !v.admin)),
      );
      if (!open.has(p.id)) return [tr];
      const list = h(
        'div.rm-rowlist',
        {},
        h('div.rm-hint', {}, 'Use ', h('b', {}, 'Move to'), ' on a row to put it in another phase. Every move is recorded with the approval.'),
        ...p.rows.map((r) => {
          const sel = h('select', { 'aria-label': `Move row ${r} to`, ...(!v.admin ? { disabled: true } : {}) }, ...ps.map((x, j) => h('option', { value: x.id, ...(x.id === p.id ? { selected: true } : {}) }, `${j + 1} · ${x.name}`))) as HTMLSelectElement;
          sel.onchange = () => {
            const from = base.find((x) => x.rows.includes(r));
            moved.set(r, from ? `${base.indexOf(from) + 1}` : '?');
            push({ op: 'move-rows', rows: [r], to: sel.value });
          };
          const was = moved.get(r);
          const isMoved = was !== undefined && base.find((x) => x.rows.includes(r))?.id !== p.id;
          return h('div.rm-bprow', { class: isMoved ? 'moved' : '' }, h('code', {}, `Row ${r}`), h('span', {}, stepOf.get(r) ?? ''), isMoved ? h('span.rm-moved', {}, `Moved from ${was} · unsaved`) : h('span'), sel);
        }),
      );
      return [tr, h('tr.rm-rowsrow', {}, h('td', { colspan: 7 }, list))];
    });
    table.replaceChildren(...rows);
    const totalRows = ps.reduce((n, p) => n + p.rows.length, 0);
    const journeys = ps.reduce((n, p) => n + p.journeys.length, 0);
    const min = ps.reduce((n, p) => n + p.estimate.min, 0);
    const max = ps.reduce((n, p) => n + p.estimate.max, 0);
    const disc = v.discovery.spend;
    const cut = v.plan.cutover;
    const all = { min: min + disc + (cut?.min ?? 0), max: max + disc + (cut?.max ?? 0) };
    const over = v.budget && all.max > v.budget.total ? all.max - v.budget.total : 0;
    const unplaced = v.buildRows.filter((r) => !ps.some((p) => p.rows.includes(r.n))).length;
    const parts: (HTMLElement | null)[] = [
      h('span', {}, h('b', {}, `${ps.length} phases`), ` · ${totalRows} rows · ${journeys} journeys`),
      h('span', {}, 'Build estimate ', h('b', {}, `$${min}–${max}`)),
      h('span.rm-muted', {}, `+ Discovery ${usd(disc)} spent${cut ? ` + Cutover ${rangeText(cut)}` : ''} = `, h('b', {}, `$${Math.round(all.min)}–${Math.round(all.max)}`), v.budget ? ` of ${usd(v.budget.total)}` : ''),
      over ? h('span.rm-badge.b-warn', {}, `⚠ Top of range is ${usd(over)} over the budget`) : null,
      unplaced ? h('span.rm-badge.b-warn', { title: 'Build-plan rows at main that no phase has' }, `${unplaced} build-plan rows in no phase`) : null,
    ];
    foot.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  }

  const ps0 = cur();
  const splitBtn = h('button.btn.sm', { type: 'button', disabled: !v.admin, onclick: () => {
    const p = cur().find((x) => x.rows.length > 1 && x.status === 'planned');
    if (p) push({ op: 'split', phase: p.id, rows: p.rows.slice(Math.ceil(p.rows.length / 2)), name: `${p.name} (2)` });
  } }, 'Split a phase');
  const mergeBtn = h('button.btn.sm', { type: 'button', disabled: !v.admin || ps0.length < 2, onclick: () => {
    const ps = cur();
    if (ps.length > 1) push({ op: 'merge', phases: [ps[ps.length - 2].id, ps[ps.length - 1].id] });
  } }, 'Merge phases');
  const addBtn = h('button.btn.sm', { type: 'button', disabled: !v.admin, onclick: () => push({ op: 'add', name: `New phase ${cur().length + 1}` }) }, '+ Add phase');
  const delivery = `${v.plan.prefs.checkpointAtPhaseEnd ? 'checkpoints on' : 'checkpoints off'} · publish to sandbox ${v.plan.prefs.publishAtPhaseEnd ? 'on' : 'off'}`;
  paint();
  return h(
    'section.rm-gate',
    { 'aria-label': 'Build Plan gate: proposed phases' },
    h(
      'div.rm-gate-h',
      {},
      h('div', {}, h('div.rm-gate-t', {}, 'Sign-off: Build Plan and proposed phases'), h('div.rm-muted', {}, `${proposal ? `${proposal.by.name}${proposal.by.role ? ` (${proposal.by.role})` : ''} proposed ${base.length} phases from the build plan` : `${base.length} phases`} · Delivery: `, h('b', {}, 'In phases'), ` · ${delivery}`), proposal?.reason ? h('div.rm-muted.rm-small', {}, `“${proposal.reason}”`) : null),
      h('span.rm-grow'),
      h('span.rm-badge.b-warn', {}, proposal?.status === 'declined' ? 'Changes asked' : 'Waiting on you'),
    ),
    h(
      'div.rm-card.rm-gate-card',
      {},
      h('div.rm-ct-row', {}, h('h3.rm-ct', {}, 'Proposed phases ', h('span.rm-plain', {}, 'Business outcomes, foundation first')), h('span.rm-grow'), splitBtn, mergeBtn, addBtn),
      h('div.rm-scroll', {}, h('table.rm-ptable', {}, h('thead', {}, h('tr', {}, h('th'), h('th', {}, 'Phase and goal'), h('th', {}, 'Build plan rows'), h('th', {}, 'Journeys that prove it'), h('th', {}, 'Estimate'), h('th.c', {}, 'Checkpoint'), h('th.c', {}, 'Publish'))), table)),
      foot,
      msg,
      h('div.rm-gate-f', {}, h('span.rm-muted', {}, 'Approving starts Build with phase 1. Later changes (split, merge, reorder, move rows) are always recorded on the Roadmap.'), h('span.rm-grow'), h('button.btn', { type: 'button', disabled: !v.admin, onclick: () => acts.askChanges(proposal) }, 'Ask for changes'), approveBtn),
    ),
  );
}
