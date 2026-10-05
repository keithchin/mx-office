// Call an audit: the wizard on /firm and behind the 1D view's "📑 Call an audit". Pick the floor,
// the teams and reviewers, the tests, artifacts, documentation and recommendations, the depth, a
// model per reviewer, the budget, time and whether benched Leads may be hired back; it shows the
// estimate as it changes, then a confirmation screen before anything starts (an admin's).

import { ARTIFACT_LABEL, ARTIFACTS, AUDIT_TEAMS, DEPTHS, DOC_LABEL, DOCS, TEST_TYPE_LABEL, TEST_TYPES, type EngagementConfig, type Estimate } from '../../shared/firm/engagement';
import { FIRM_MODELS, firmModelLabel, REVIEWERS, REVIEWER_BY_ID } from '../../shared/firm/roles';
import { h, openModal, toast } from '../ui/dom';
import { fetchDefaults, firmAction, postEstimate, usd } from './api';
import './wizard.css';

const TEAM_LABEL: Record<string, string> = { design: '🎨 Design', development: '🛠️ Development', testing: '🧪 Testing', analysis: '📈 Analysis' };

export interface WizardOpts {
  floors: { id: string; name: string; auditing?: boolean }[];
  floor?: string;
  admin: boolean;
  onStarted?: (id: string) => void;
}

export async function openAuditWizard(o: WizardOpts) {
  const floors = o.floors.filter((f) => !f.auditing);
  if (!floors.length) return toast(o.floors.length ? 'The Firm is already auditing every project' : 'No project to audit yet', 'warn');
  let floor = floors.find((f) => f.id === o.floor)?.id ?? floors[0].id;
  let cfg: EngagementConfig;
  let est: Estimate;
  try {
    ({ config: cfg, estimate: est } = await fetchDefaults(floor));
  } catch (err) {
    return toast((err as Error).message, 'error');
  }
  const box = h('div.modal.firm-wizard', { role: 'dialog', 'aria-label': 'Call an audit' });
  const modal = openModal(box, { doing: 'calling an audit' });
  let timer: ReturnType<typeof setTimeout> | undefined;

  const reestimate = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        ({ config: cfg, estimate: est } = await postEstimate(cfg));
        draw();
      } catch (err) {
        toast((err as Error).message, 'warn');
      }
    }, 200);
  };
  const toggle = <T extends string>(list: T[], v: T, on: boolean): T[] => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));
  const check = (label: string, on: boolean, change: (on: boolean) => void, disabled = false) =>
    h('label.firm-check', { class: on ? 'on' : '' }, h('input', { type: 'checkbox', checked: on, disabled, onchange: (e: Event) => change((e.target as HTMLInputElement).checked) }), label);
  const field = (title: string, ...kids: (HTMLElement | null)[]) => h('fieldset.firm-field', {}, h('legend', {}, title), ...kids);

  function form(): HTMLElement {
    return h('div.firm-wiz-body', {},
      field('Project',
        h('select.firm-input', { 'aria-label': 'Project', onchange: async (e: Event) => {
          floor = (e.target as HTMLSelectElement).value;
          ({ config: cfg, estimate: est } = await fetchDefaults(floor));
          draw();
        } }, ...floors.map((f) => h('option', { value: f.id, selected: f.id === floor }, f.name))),
      ),
      field('Teams to attach a reviewer to', h('div.firm-checks', {}, ...AUDIT_TEAMS.map((t) => check(TEAM_LABEL[t], cfg.teams.includes(t), (on) => {
        cfg.teams = toggle(cfg.teams, t, on);
        const spec = REVIEWERS.find((r) => r.staffing === 'default' && r.team === t)!;
        cfg.reviewers = toggle(cfg.reviewers, spec.id, on);
        reestimate();
      })))),
      field('Reviewers & models', h('ul.firm-wiz-revs', {}, ...REVIEWERS.map((r) => {
        const on = cfg.reviewers.includes(r.id);
        const locked = r.staffing === 'always' || (r.staffing === 'default' && !cfg.teams.includes(r.team));
        return h('li', { class: on ? 'on' : '' },
          check(`${r.icon} ${r.name} — ${r.title}`, on, (v) => ((cfg.reviewers = toggle(cfg.reviewers, r.id, v)), reestimate()), locked),
          h('select.firm-input.small', { 'aria-label': `${r.name}'s model`, disabled: !on, onchange: (e: Event) => ((cfg.models = { ...cfg.models, [r.id]: (e.target as HTMLSelectElement).value }), reestimate()) },
            ...FIRM_MODELS.map((m) => h('option', { value: m.id, selected: (cfg.models[r.id] ?? 'claude-fable-5-1') === m.id }, m.label))),
        );
      }))),
      field('Test types', h('div.firm-checks', {}, ...TEST_TYPES.map((t) => check(TEST_TYPE_LABEL[t], cfg.tests.includes(t), (on) => ((cfg.tests = toggle(cfg.tests, t, on)), reestimate()))))),
      field('Artifacts to produce', h('div.firm-checks', {}, ...ARTIFACTS.map((a) => check(ARTIFACT_LABEL[a], cfg.artifacts.includes(a), (on) => ((cfg.artifacts = toggle(cfg.artifacts, a, on)), reestimate()))))),
      field('Documentation & recommendations', h('div.firm-checks', {},
        ...DOCS.map((d) => check(DOC_LABEL[d], cfg.docs.includes(d), (on) => ((cfg.docs = toggle(cfg.docs, d, on)), reestimate()))),
        check('Prioritised recommendations (now / next / later, owner team)', cfg.recommendations, (on) => ((cfg.recommendations = on), reestimate())),
      )),
      field('Depth', h('div.firm-seg', {}, ...DEPTHS.map((d) => h('button.btn.small', { type: 'button', class: cfg.depth === d ? 'on' : '', onclick: () => ((cfg.depth = d), reestimate()) }, d[0].toUpperCase() + d.slice(1))))),
      field('Budget & time',
        h('div.firm-row', {},
          h('label', {}, 'Budget cap ($) ', h('input.firm-input.num', { type: 'number', min: 1, step: 5, value: cfg.budget, onchange: (e: Event) => ((cfg.budget = Number((e.target as HTMLInputElement).value)), reestimate()) })),
          h('label', {}, 'Max time (min) ', h('input.firm-input.num', { type: 'number', min: 10, step: 10, value: cfg.maxMinutes, onchange: (e: Event) => ((cfg.maxMinutes = Number((e.target as HTMLInputElement).value)), reestimate()) })),
        ),
        check('Allow hiring a benched Lead back just to answer the Firm', cfg.allowRehire, (on) => ((cfg.allowRehire = on), reestimate())),
      ),
    );
  }

  function estimateBox(): HTMLElement {
    const over = est.total > cfg.budget;
    return h('aside.firm-estimate', { class: over ? 'over' : '' },
      h('div.firm-est-total', {}, h('small', {}, 'Estimated cost'), h('b', {}, usd(est.total)), h('small', {}, `budget cap ${usd(cfg.budget)}`)),
      h('ul', {}, ...est.perReviewer.map((p) => h('li', {}, `${REVIEWER_BY_ID.get(p.id)!.name}`, h('span', {}, `${firmModelLabel(p.model)} · ${usd(p.usd)}`)))),
      h('p.firm-est-note', {}, `An estimate, not a quote: model prices × the tokens a ${cfg.depth} review is expected to use (EST_TOKENS). The budget cap is what's enforced: warned at 80%, wrapped up at 100%.`),
      over ? h('p.firm-est-warn', {}, '⚠️ The estimate is over the budget cap: the reviewers will likely be wrapped up early.') : null,
    );
  }

  function draw() {
    box.replaceChildren(
      h('header', {}, h('h2', {}, '📑 Call an audit'), h('span.firm-wiz-sub', {}, 'The Firm sends an independent team of Reviewer Agents')),
      h('div.firm-wiz', {}, form(), estimateBox()),
      h('footer.firm-wiz-foot', {},
        h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
        h('button.btn.firm-brass', { type: 'button', disabled: !o.admin, title: o.admin ? '' : 'Only the Project Manager (an admin) can call an audit', onclick: confirmScreen }, 'Review & confirm →'),
      ),
    );
  }

  function confirmScreen() {
    const fl = floors.find((f) => f.id === floor)!;
    box.replaceChildren(
      h('header', {}, h('h2', {}, '📑 Confirm the engagement')),
      h('div.firm-confirm', {},
        h('p', {}, `The Firm will audit `, h('b', {}, fl.name), ` with ${cfg.reviewers.length} reviewers at ${cfg.depth} depth. Each works in its own read-only checkout pinned to today's commit, with no access to the project team's instructions, memory or GitHub credentials, and interviews its Lead through the office.`),
        h('ul.firm-confirm-list', {},
          ...cfg.reviewers.map((id) => h('li', {}, `${REVIEWER_BY_ID.get(id)!.icon} ${REVIEWER_BY_ID.get(id)!.name}, ${REVIEWER_BY_ID.get(id)!.title} — ${firmModelLabel(cfg.models[id] ?? '')}`)),
        ),
        h('p', {}, `Tests: ${cfg.tests.map((t) => TEST_TYPE_LABEL[t]).join(', ')}.`),
        h('p', {}, `Artifacts: ${cfg.artifacts.map((a) => ARTIFACT_LABEL[a]).join(', ') || '—'}. Documentation: ${cfg.docs.map((d) => DOC_LABEL[d]).join(', ') || '—'}.`),
        h('p.firm-confirm-money', {}, `Estimated ${usd(est.total)} (an estimate) · budget cap ${usd(cfg.budget)} · at most ${cfg.maxMinutes} minutes${cfg.allowRehire ? ' · may hire benched Leads back' : ''}.`),
      ),
      h('footer.firm-wiz-foot', {},
        h('button.btn', { type: 'button', onclick: draw }, '← Back'),
        h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
        h('button.btn.firm-brass', { type: 'button', id: 'firm-confirm', disabled: !o.admin, onclick: start }, `Start the audit (${usd(est.total)} est.)`),
      ),
    );
  }

  async function start() {
    try {
      const r = await firmAction({ action: 'start', config: cfg });
      modal.close();
      toast('📑 The Firm is staffing the engagement');
      if (r.engagement) o.onStarted?.(r.engagement.id);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  draw();
}
