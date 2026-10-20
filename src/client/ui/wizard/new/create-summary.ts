// "Ready to create": the New project plan's last look before Create project starts the setup. What the
// project is, the agent team's autonomy (the level, who chose it and that the office records it when you
// press Create, with Change back to the step), the approvals that level leaves with you, the budget (set
// separately from autonomy), the team, and deployment (agents never deploy). A dialog with ✕ and Esc that
// gives focus back to Create project; true when the person pressed Create there.
import { AUTONOMY } from '../../../../shared/roster/autonomy';
import { HELD_LABEL, levelPreview } from '../../../../shared/roster/autonomy-step';
import { SHAPES, shapeForRoles } from '../../../../shared/roster/coverage';
import { usd } from '../../../../shared/budget/money';
import { ENTRY_MODE_INFO, type ProjectPlan } from '../../../../shared/wizard';
import { h } from '../../dom';
import { openDialog } from './dialog';

export interface SummaryOpts {
  plan: ProjectPlan;
  /** Who is creating it (the page's profile name, or the account's). */
  me: string;
  host: HTMLElement;
  opener: HTMLElement;
  /** Back to the autonomy step (Change). */
  changeAutonomy(): void;
}

/** The summary's rows, as [label, value, note?]: also what the DOM test reads. */
export function summaryRows(plan: ProjectPlan, me: string): [string, string, string?][] {
  const rows: [string, string, string?][] = [];
  rows.push(['Project', `${plan.owner}/${plan.name}`, `${ENTRY_MODE_INFO[plan.entry]?.label ?? plan.entry}${plan.description ? ` · ${plan.description}` : ''}`]);
  const a = plan.autonomy;
  if (a) {
    const p = levelPreview(a.level, { autoPause: plan.budget?.autoPause });
    const how = a.ack ? 'set by your organisation, acknowledged by' : 'chosen by';
    rows.push(['Agent team autonomy', `${a.level} ${AUTONOMY[a.level].name} · ${how} ${me}${a.byStage ? ' · rises to 3 Delegated once the build plan passes' : ''}`, `${p.one} Recorded with your name and the time when you press Create; you can change it later on the Team settings (the change is recorded too).`]);
    rows.push(['Still needs you', p.approvals.map((x) => `${x.text} (${HELD_LABEL[x.held]})`).join(' · ')]);
  }
  const b = plan.budget;
  rows.push(['Spend', b ? `Budget ${usd(b.total)} (${b.level[0].toUpperCase()}${b.level.slice(1)})${b.autoPause === false ? ' · no auto-pause' : ' · pauses at 100 % and tells you'}` : 'No budget', 'Set separately from autonomy: the budget level never changes what the team may do without asking.']);
  const shape = plan.shape ?? shapeForRoles(plan.roles);
  rows.push(['Team', `${SHAPES[shape].label} · ${plan.roles.length} agent${plan.roles.length === 1 ? '' : 's'}`]);
  rows.push(['Deployment', 'Agents never deploy. A person deploys outside the office, as today.']);
  return rows;
}

export function createSummary(o: SummaryOpts): Promise<boolean> {
  return new Promise((done) => {
    let answered = false;
    const change = h('button.nw-link', { type: 'button' }, 'Change autonomy');
    const back = h('button.btn', { type: 'button' }, 'Back');
    const go = h('button.btn.primary', { type: 'button', autofocus: true, id: 'nw-create-go' }, 'Create project');
    const table = h('table.aw-sum', {}, h('tbody', {}, ...summaryRows(o.plan, o.me).map(([k, v, note]) => h('tr', {}, h('td', {}, k), h('td', {}, h('b', {}, v), note ? h('p.aw-small', {}, note) : null)))));
    const dlg = openDialog(o.host, 'Ready to create', [h('p.nw-hint', {}, 'Check what happens next. The agent team starts only when you press Create project.'), table, h('p', {}, change)], {
      opener: o.opener,
      foot: [back, go],
      onClose: () => !answered && done(false),
    });
    const finish = (yes: boolean) => {
      answered = true;
      dlg.close();
      done(yes);
    };
    back.addEventListener('click', () => finish(false));
    go.addEventListener('click', () => finish(true));
    change.addEventListener('click', () => {
      finish(false);
      setTimeout(() => o.changeAutonomy(), 200);
    });
  });
}
