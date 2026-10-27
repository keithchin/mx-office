// "Ready to create": the New project plan's last look before Create project starts the setup. What the
// project is, where its code goes (Team Server, Team Server + GitHub mirror, GitHub, or local only), the agent
// team's autonomy (the level, who chose it and that the office records it when you press Create, with Change back
// to the step), the approvals that level leaves with you, the budget (set separately from autonomy, with its total
// to type here; auto-pause at 100 % as the plan has it), the team, the Claude sign-in hiring it runs on (checked
// now, not at the setup's last step: server/wizard/claude-signin.ts), and deployment (agents never deploy). A
// dialog with ✕ and Esc that gives focus back to Create project; true when the person pressed Create there.
import { AUTONOMY } from '../../../../shared/roster/autonomy';
import { HELD_LABEL, levelPreview } from '../../../../shared/roster/autonomy-step';
import { SHAPES, shapeForRoles } from '../../../../shared/roster/coverage';
import { usd } from '../../../../shared/budget/money';
import { ENTRY_MODE_INFO, type ProjectPlan, type WizardInfo } from '../../../../shared/wizard';
import { REPO_HOME_INFO, homeOf } from '../../../../shared/team-server';
import type { Net } from '../../../net';
import { h } from '../../dom';
import { openSignIns } from '../../signins';
import { openDialog } from './dialog';

type SignIn = WizardInfo['claudeSignIn'];

export interface SummaryOpts {
  plan: ProjectPlan;
  /** Who is creating it (the page's profile name, or the account's). */
  me: string;
  host: HTMLElement;
  opener: HTMLElement;
  /** Back to the autonomy step (Change). */
  changeAutonomy(): void;
  /** The creating person's Claude sign-in as the office last saw it (undefined: none needed). */
  signIn?: SignIn;
  /** Asks the office again (after signing in). */
  recheck?(): Promise<SignIn>;
  net?: Net;
}

/** What the summary says about the Claude sign-in hiring the team runs on. */
export const SIGN_IN_FIX = 'Sign in to Claude: ☰ → 🔐 Your sign-ins';

/** The summary's rows, as [label, value, note?]: also what the DOM test reads. */
export function summaryRows(plan: ProjectPlan, me: string, signIn?: SignIn): [string, string, string?][] {
  const rows: [string, string, string?][] = [];
  rows.push(['Project', `${plan.owner}/${plan.name}`, `${ENTRY_MODE_INFO[plan.entry]?.label ?? plan.entry}${plan.description ? ` · ${plan.description}` : ''}`]);
  if (plan.kind === 'new') {
    const home = homeOf(plan);
    const appId = plan.teamServer?.projectId;
    rows.push(['Code', REPO_HOME_INFO[home].label, plan.teamServer ? (appId ? `Links the existing Mendix Portal app ${appId}, then pushes main to its Team Server repository${plan.teamServer.mirror ? ' and mirrors it to GitHub' : ''}.` : `Creates the app in the Mendix Portal with this project’s name, then pushes main to its Team Server repository${plan.teamServer.mirror ? ' and mirrors it to GitHub' : ''}. The office never deletes that app.`) : home === 'local' ? 'A git repository on this machine only: nothing is pushed anywhere.' : `A GitHub repository, ${plan.private ? 'private' : 'public'}.`]);
  }
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
  if (signIn && plan.roles.length) rows.push(['Claude sign-in', signIn.ready ? 'Ready: the team is hired on your Claude sign-in' : SIGN_IN_FIX, signIn.ready ? undefined : `Hiring the team is the setup’s last step and runs on your own Claude plan, so Create waits until you’re signed in${signIn.office ? ' (or pick the office’s own sign-in there)' : ''}.`]);
  rows.push(['Deployment', 'Agents never deploy. A person deploys outside the office, as today.']);
  return rows;
}

export function createSummary(o: SummaryOpts): Promise<boolean> {
  return new Promise((done) => {
    let answered = false;
    let signIn = o.signIn;
    const change = h('button.nw-link', { type: 'button' }, 'Change autonomy');
    const back = h('button.btn', { type: 'button' }, 'Back');
    const go = h('button.btn.primary', { type: 'button', autofocus: true, id: 'nw-create-go' }, 'Create project') as HTMLButtonElement;
    const tbody = h('tbody');
    const blocked = () => !!signIn && !signIn.ready && o.plan.roles.length > 0;
    const draw = () => {
      tbody.replaceChildren(...summaryRows(o.plan, o.me, signIn).map(([k, v, note]) => h('tr', { 'data-row': k }, h('td', {}, k), h('td', {}, h('b', {}, v), note ? h('p.aw-small', {}, note) : null))));
      go.disabled = blocked();
      fix.hidden = !blocked();
    };
    // The fix, when the sign-in is missing: open 🔐 Your sign-ins, then look again.
    const open = h('button.btn', { type: 'button', id: 'nw-signin-open' }, 'Open your sign-ins');
    const again = h('button.btn', { type: 'button', id: 'nw-signin-again' }, 'Check again') as HTMLButtonElement;
    const fix = h('div.nw-row.nw-signin-fix', { hidden: true }, open, again);
    open.addEventListener('click', () => o.net && openSignIns(o.net, signIn?.why));
    again.addEventListener('click', async () => {
      if (!o.recheck) return;
      again.disabled = true;
      again.textContent = 'Checking…';
      signIn = await o.recheck().catch(() => signIn);
      again.disabled = false;
      again.textContent = 'Check again';
      draw();
    });
    // The total, typed: the level and its settings stay, and so does auto-pause at 100 % (on unless the plan turned it off).
    const b = o.plan.budget;
    const total = b ? (h('input', { type: 'number', id: 'nw-sum-total', min: '1', step: '50', value: String(Math.round(b.total)), inputmode: 'decimal' }) as HTMLInputElement) : null;
    total?.addEventListener('change', () => {
      const v = Math.round(Number(total.value));
      if (!b || !Number.isFinite(v) || v < 1) return void (total.value = String(Math.round(b?.total ?? 0)));
      b.total = v;
      draw();
    });
    const budget = total && b ? h('div.nw-field', {}, h('label', { for: 'nw-sum-total' }, 'Total budget (USD)'), total, h('span.nw-hint', {}, b.autoPause === false ? 'For the whole project. Auto-pause is off: the office warns at the threshold and keeps going.' : 'For the whole project. The team pauses at 100 % of it and tells you; raise it later on the Budget page.')) : null;
    draw();
    const dlg = openDialog(o.host, 'Ready to create', [h('p.nw-hint', {}, 'Check what happens next. The agent team starts only when you press Create project.'), h('table.aw-sum', {}, tbody), fix, ...(budget ? [budget] : []), h('p', {}, change)], {
      opener: o.opener,
      foot: [back, go],
      onClose: () => !answered && done(false),
    });
    // Create project has the focus, as before the total field came (the dialog would pick the first input); the fix when Create waits.
    setTimeout(() => (blocked() ? open : go).focus(), 40);
    const finish = (yes: boolean) => {
      answered = true;
      dlg.close();
      done(yes);
    };
    back.addEventListener('click', () => finish(false));
    go.addEventListener('click', () => !blocked() && finish(true));
    change.addEventListener('click', () => {
      finish(false);
      setTimeout(() => o.changeAutonomy(), 200);
    });
  });
}
