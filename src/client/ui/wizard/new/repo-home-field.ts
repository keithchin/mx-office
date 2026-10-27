// Where the code lives, under Advanced (shared/team-server.ts RepoHome): Mendix Team Server, Team Server with a GitHub
// mirror, GitHub only, or Local only. Team Server is the default when the office has a Mendix token; otherwise GitHub as
// before. A choice that can't be made says why, with a link to 🔌 Connections. A Team Server choice can take an
// existing Portal app's App ID instead of creating one. A choice made by hand is kept (local-only-field.ts byHand).
import type { WizardInfo, ProjectPlan } from '../../../../shared/wizard';
import { REPO_HOMES, REPO_HOME_INFO, cleanProjectId, defaultRepoHome, homeOf, planFor, repoHomeBlocked, type RepoHome, type RepoHomeAvailability } from '../../../../shared/team-server';
import { h } from '../../dom';
import { openConnections } from '../../connections';
import { chosenByHand, markByHand } from './local-only-field';
import './repo-home.css';

export const availabilityOf = (info: Pick<WizardInfo, 'mendixToken' | 'adminToken' | 'offline'>): RepoHomeAvailability => ({ mendixToken: !!info.mendixToken, githubToken: info.adminToken.configured, offline: info.offline });

/** Sets the plan's choice, keeping an App ID already typed for a Team Server choice. */
export function setHome(plan: ProjectPlan, home: RepoHome) {
  const keep = plan.teamServer?.projectId;
  const next = planFor(home);
  plan.localOnly = next.localOnly ?? false;
  plan.teamServer = next.teamServer ? { ...next.teamServer, ...(keep ? { projectId: keep } : {}) } : undefined;
}

/** The default choice for a new project nobody chose for (after defaultLocalOnly). */
export function defaultHome(plan: ProjectPlan, info: Pick<WizardInfo, 'mendixToken' | 'adminToken' | 'offline'>) {
  if (plan.kind !== 'new' || chosenByHand(plan)) return;
  setHome(plan, defaultRepoHome(availabilityOf(info)));
}

/** What's wrong with the plan's choice now (for planProblems). */
export function homeProblem(plan: ProjectPlan, info: Pick<WizardInfo, 'mendixToken' | 'adminToken' | 'offline'>): string | undefined {
  if (plan.kind !== 'new') return undefined;
  const why = repoHomeBlocked(homeOf(plan), availabilityOf(info));
  if (why) return why;
  const typed = plan.teamServer?.projectId;
  if (typed !== undefined && typed !== '' && !cleanProjectId(typed)) return 'That isn’t an App ID (copy it from the Portal: the app’s Settings › General › App ID)';
  return undefined;
}

export function repoHomeField(plan: ProjectPlan, info: WizardInfo, redraw: () => void, error: HTMLElement): HTMLElement | null {
  if (plan.kind !== 'new') return null;
  const a = availabilityOf(info);
  const now = homeOf(plan);
  const options = REPO_HOMES.map((home) => {
    const why = repoHomeBlocked(home, a);
    const radio = h('input', { type: 'radio', name: 'nw-home', value: home, id: `nw-home-${home}`, checked: home === now, disabled: !!why && home !== now }) as HTMLInputElement;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      markByHand(plan);
      setHome(plan, home);
      redraw();
    });
    const fix = why ? h('button.nw-link', { type: 'button', onclick: () => openConnections(home === 'teamserver-github' && a.mendixToken ? 'github-admin' : 'mendix') }, '🔌 Connections') : null;
    return h(
      'label.nw-home-opt',
      { for: `nw-home-${home}`, class: why ? 'off' : '', 'data-home': home },
      radio,
      h('span.nw-home-body', {}, h('b', {}, REPO_HOME_INFO[home].label, home === defaultRepoHome(a) ? h('span.nw-home-tag', {}, 'default') : ''), h('span.nw-hint', {}, REPO_HOME_INFO[home].text), why ? h('span.nw-home-why', {}, `Unavailable: ${why}. `, fix) : null),
    );
  });
  let appId: HTMLElement | null = null;
  if (plan.teamServer) {
    const input = h('input', { type: 'text', id: 'nw-a-appid', value: plan.teamServer.projectId ?? '', placeholder: 'Leave empty to create the app', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
    input.addEventListener('input', () => {
      const v = input.value.trim();
      if (plan.teamServer) plan.teamServer = { mirror: plan.teamServer.mirror, ...(v ? { projectId: cleanProjectId(v) ?? v } : {}) };
    });
    appId = h('div.nw-field.nw-home-appid', {}, h('label', { for: 'nw-a-appid' }, 'Existing Portal app (optional)'), input, h('span.nw-hint', {}, 'The App ID of an app already in the Mendix Portal (its Settings › General). Empty: the office creates the app with the project’s name and Mendix version, and never deletes it.'));
  }
  return h('fieldset.nw-adv-group.nw-home', { 'aria-describedby': error.id }, h('legend', {}, h('h4', {}, 'Where the code lives')), ...options, appId, error);
}
