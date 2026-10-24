// The data-impact card on the 🌐 Live app tab (server/data-impact/, rules and words in shared/data-impact.ts):
// shown while the guard holds main's newest commit off the live preview. It says the separate fact (merged
// on main at <sha>; not applied to the live preview), each finding with its unit, element, plain risk line
// and the rows that have data there when the database answered, the uncertainty, mxcli's warnings where the
// office has them, the alternatives, who holds the `data-impact approval` permission, and Approve… for those
// who do (./dialog.ts). Members without it see who can. Asked when the live app's state changes, never on a
// timer.

import type { LiveAppState } from '../../../shared/protocol';
import { heldFactLine, recoveryWords, type DataImpactApproval, type DataImpactView, type ImpactFinding } from '../../../shared/data-impact';
import { h } from '../dom';
import { openApproveDialog } from './dialog';
import './data-impact.css';

export interface ImpactCard {
  readonly el: HTMLElement;
  /** The live app's state changed: asks again when the hold it shows changed. */
  update(s: LiveAppState | null): void;
  /** Asks the office again. */
  refresh(): Promise<void>;
}

const short = (sha?: string) => sha?.slice(0, 7) ?? '';

function finding(f: ImpactFinding): HTMLElement {
  return h(
    'li.di-finding',
    { 'data-kind': f.kind },
    h('span.di-unit', {}, f.unit),
    h('code.di-el', {}, f.element),
    h('span.di-risk', {}, f.risk),
    f.rows !== undefined ? h('span.di-rows', {}, f.rows === 0 ? 'no rows with data here in the live preview' : `${f.rows} row${f.rows === 1 ? '' : 's'} with data here in the live preview`) : null,
  );
}

function approvalLine(a: DataImpactApproval): HTMLElement {
  const when = new Date(a.at).toLocaleString();
  return h(
    'li.di-approval',
    { 'data-void': a.void ? 'true' : 'false' },
    `${a.void ? 'Void: ' : ''}approved by ${a.by.name}, ${when}: live preview ${short(a.base)} → ${short(a.target)}; recovery ${recoveryWords(a.recovery)}; reason "${a.reason}"`,
    a.void ? h('small', {}, ` (${a.void.why})`) : null,
  );
}

export function impactCard(floorOf: () => string | undefined): ImpactCard {
  const el = h('section.di-card', { hidden: true, 'aria-label': 'Data-impact hold' });
  let view: DataImpactView | null = null;
  let key = '';
  let branch = 'main';

  function draw() {
    const v = view;
    const held = v?.held;
    el.hidden = !held;
    if (!v || !held) return el.replaceChildren();
    const a = v.assessment;
    const unknown = held.status === 'unknown';
    const approve = v.canApprove ? (h('button.btn.primary.di-approve', { type: 'button' }, 'Approve…') as HTMLButtonElement) : null;
    approve?.addEventListener('click', () => openApproveDialog(v, () => void refresh()));
    el.replaceChildren(
      ...([
        h('h3.di-title', {}, h('span', { 'aria-hidden': 'true' }, '✋ '), unknown ? 'Update held: data impact unknown' : 'Update held: possible data impact'),
        h('p.di-fact', { role: 'status' }, `${heldFactLine(branch, held.target).replace(/^m/, 'M')}. The live preview keeps running ${short(held.base)}; nothing of ${short(held.target)} is applied until someone with the ${v.permission} permission approves it.`),
        unknown ? h('p.di-unknown', {}, `The office couldn't tell what this change does to stored data${a?.error ? `: ${a.error}` : ''}. It holds rather than guess.`) : null,
        a?.findings.length ? h('ul.di-findings', { 'aria-label': 'What may change in stored data' }, ...a.findings.map(finding)) : null,
        a?.warnings.length ? h('div.di-warn', {}, h('b', {}, "mxcli's warnings: "), h('pre', {}, a.warnings.join('\n'))) : null,
        h('p.di-uncertain', {}, v.uncertainty),
        h('details.di-alt', {}, h('summary', {}, 'Other ways than approving'), h('ul', {}, ...v.alternatives.map((t) => h('li', {}, t)))),
        h('p.di-who', {}, v.canApprove ? `You hold the ${v.permission} permission. Who holds it: ${v.approvers}.` : `You don't hold the ${v.permission} permission. Who can approve: ${v.approvers}.`),
        approve ? h('div.di-actions', {}, approve) : null,
        v.approvals.length ? h('details.di-history', {}, h('summary', {}, `Approvals (${v.approvals.length})`), h('ul', {}, ...v.approvals.map(approvalLine))) : null,
      ] as (HTMLElement | null)[]).filter((x): x is HTMLElement => !!x),
    );
  }

  async function refresh() {
    const floor = floorOf();
    if (!floor) return;
    try {
      const res = await fetch(`/api/data-impact?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      const v = (await res.json()) as DataImpactView;
      if (floorOf() !== floor) return;
      view = v;
    } catch {
      view = null;
    }
    draw();
  }

  return {
    el,
    update(s) {
      const f = s?.failure;
      branch = s?.branch ?? 'main';
      const k = f?.kind === 'held' ? `${s?.floor}|${f.sha}|${f.at}` : `${s?.floor ?? ''}|none`;
      if (k === key) return;
      key = k;
      if (f?.kind === 'held') void refresh();
      else {
        view = null;
        draw();
      }
    },
    refresh,
  };
}
