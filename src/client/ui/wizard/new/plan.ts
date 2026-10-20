// The New project plan: the live brief on the left (with its header: DRAFT vN · auto-saved, how many
// assumptions and open questions, and the one primary action), the Chief Analyst on the right. The primary
// action moves on: Approve scope (a gentle check first when items are still Assumed: they're recorded as
// ASSUMED), then the functional domains are mapped, then Create project starts the setup.
import { counts, titleOf } from '../../../../shared/brief';
import { slugify } from '../../../../shared/wizard';
import type { DraftView } from '../../../../shared/brief';
import { h, toast } from '../../dom';
import { wizardApi } from '../api';
import { briefApi } from './api';
import { briefPanel } from './brief-view';
import { chatPanel } from './chat';
import { openDialog } from './dialog';
import { domainsPanel } from './domains';
import { entryFor } from './start';
import { teamCard } from './team-card';
import { autonomyPanel } from './autonomy-step';
import { createSummary } from './create-summary';
import { caAvatar, icon } from './parts';
import type { Flow } from './index';

const CREATE_HINT = 'Sets up the repository, app, toolkit and team. Nothing is spent on the build until then.';

export function planView(flow: Flow) {
  const chat = chatPanel(flow);
  const brief = briefPanel(flow, { prefill: (t) => chat.prefill(t) });
  const domains = domainsPanel(flow);
  const team = teamCard(flow);
  // The required autonomy step (autonomy-step.ts): Create project waits for it.
  const autonomy = autonomyPanel(flow, () => syncCreate());

  const state = h('span.nw-badge.draft', {}, 'DRAFT');
  const ver = h('span', {}, '');
  const title = h('h1', {}, '');
  const rename = h('button.nw-link.nw-rename', { type: 'button', 'aria-label': 'Rename the project' }, icon('pencil'));
  const counter = h('span.nw-counter', { 'aria-live': 'polite', hidden: true });
  const primaryWrap = h('div.nw-approve-wrap', {});
  const problem = h('div.nw-banner', { role: 'alert', hidden: true });
  const initials = flow.me.split(/s+/).filter(Boolean).map((w) => [...w][0]).slice(0, 2).join('').toUpperCase() || '?';
  const people = h('div.nw-people', { 'aria-label': 'On this plan: you and the Chief Analyst', role: 'img' }, h('span.nw-av.me', {}, initials), caAvatar());
  const head = h('div.nw-dochead', {}, h('div.nw-grow', {}, h('div.nw-meta', {}, state, ver), h('div.nw-title-row', {}, title, rename)), counter, people, primaryWrap);
  const docIn = h('div.nw-doc-in', {}, problem, brief.el, domains.el, autonomy.el, team.el);
  const doc = h('div.nw-doc', {}, head, docIn);
  const el = h('section.nw-view.nw-plan', { 'aria-label': 'Project plan' }, doc, chat.el);
  let stage: 'approve' | 'mapping' | 'create' | undefined;
  let creating = false;

  rename.addEventListener('click', () => {
    const d = flow.draft;
    if (!d?.brief || d.approved) return;
    const input = h('input.nw-title-in', { type: 'text', value: d.brief.title, 'aria-label': 'Project name' }) as HTMLInputElement;
    const done = (save: boolean) => {
      input.replaceWith(title);
      rename.hidden = false;
      if (save && input.value.trim() && input.value.trim() !== d.brief!.title) void briefApi.item(d.id, { op: 'title', text: input.value }).then((x) => flow.setDraft(x), (e: Error) => toast(e.message, 'warn'));
      rename.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (e.preventDefault(), done(true));
      if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), done(false));
    });
    input.addEventListener('blur', () => input.isConnected && done(true));
    title.replaceWith(input);
    rename.hidden = true;
    input.focus();
    input.select();
  });

  function setPrimary(next: typeof stage) {
    if (next === stage && primaryWrap.firstChild) return;
    stage = next;
    if (next === 'approve') {
      const b = h('button.btn.primary.nw-primary', { type: 'button', id: 'nw-approve' }, icon('check'), 'Approve scope');
      b.addEventListener('click', () => onApprove(b));
      primaryWrap.replaceChildren(b, h('span.nw-approve-hint', {}, 'Approving records your scope decision for ✋ Stage 0 in PROJECT.md. Stage 0 passes when the Chief Analyst’s triage is signed off.'));
    } else if (next === 'mapping') {
      primaryWrap.replaceChildren(h('button.btn.primary.nw-primary', { type: 'button', disabled: true }, 'Mapping domains…'), h('span.nw-approve-hint', {}, 'Next: team & budget, then create.'));
    } else {
      const b = h('button.btn.primary.nw-primary', { type: 'button', id: 'nw-create' }, icon('arrow'), 'Create project');
      b.addEventListener('click', () => void create(b));
      primaryWrap.replaceChildren(b, h('span.nw-approve-hint', {}, CREATE_HINT));
    }
  }

  function onApprove(btn: HTMLElement) {
    const d = flow.draft;
    if (!d?.brief) return;
    const n = counts(d.brief).assumed;
    if (!n) return void approve();
    const review = h('button.btn', { type: 'button' }, 'Review them');
    const anyway = h('button.btn.primary', { type: 'button' }, 'Approve anyway');
    const dlg = openDialog(
      el,
      'Approve with assumptions?',
      [h('p', {}, `${n} item${n === 1 ? ' is' : 's are'} still Assumed; ${n === 1 ? 'it' : 'they'}’ll be recorded as ASSUMED. Approve anyway?`), h('p.nw-hint', {}, 'The team can still confirm them later: the Chief Analyst starts Discovery by confirming them with the client, and Stage 0 passes when its triage is signed off.')],
      { opener: btn, foot: [review, anyway] },
    );
    review.addEventListener('click', () => (dlg.close(), setTimeout(() => brief.reviewAssumed(), 200)));
    anyway.addEventListener('click', () => (dlg.close(), void approve()));
  }

  async function approve() {
    const d = flow.draft!;
    try {
      flow.setDraft(await briefApi.approve(d.id));
      flow.say('Scope approved and recorded for Stage 0. Mapping functional domains');
      setTimeout(() => domains.el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 240);
    } catch (err) {
      toast((err as Error).message, 'warn');
    }
  }

  /** The plan's defaults from the draft: the repository's name and description from the brief, the entry mode, the tier the domains suggest. */
  function defaults(d: DraftView) {
    const p = flow.plan;
    const e = entryFor(d.mode, d.attachments.length);
    p.entry = e.entry;
    if (p.kind !== e.kind) p.kind = e.kind;
    p.interview = d.interview;
    if (d.brief && p.kind === 'new' && !flow.touched.has('name')) p.name = slugify(titleOf(d.brief));
    // A change keeps the repository the draft names (a resumed draft too) until it's picked by hand.
    if (p.kind === 'change' && d.repo && !p.name && !flow.touched.has('name')) ((p.owner = d.repo.owner), (p.name = d.repo.name));
    if (d.brief && !flow.touched.has('description')) p.description = d.brief.description;
    if (!flow.touched.has('tier')) p.tier = d.domains?.tier ?? 'standard';
  }

  async function create(btn: HTMLButtonElement) {
    const d = flow.draft;
    if (!d?.brief || creating) return;
    defaults(d);
    if (!team.validate()) return flow.say('Some fields need attention: see Advanced');
    // Agents brought from another project: their Move is confirmed before anything starts (team-from.ts).
    if (autonomy.problem()) return (autonomy.focus(), flow.say(autonomy.problem()!));
    if (!(await team.confirm(btn))) return flow.say('Not created: the agents stay where they are');
    // Ready to create: the summary, with the autonomy level and who chose it (create-summary.ts).
    if (!(await createSummary({ plan: flow.plan, me: flow.me, host: el, opener: btn, changeAutonomy: () => autonomy.focus() }))) return;
    creating = true;
    btn.disabled = true;
    const p = flow.plan;
    const plan = { ...p, intake: p.intake.filter((a) => a.text.trim()), brief: { draftId: d.id, brief: d.brief, domains: d.domains, approved: d.approved, attachments: d.attachments, manual: d.manual } };
    try {
      const job = await wizardApi.start(plan, flow.me);
      flow.started(job);
    } catch (err) {
      problem.hidden = false;
      problem.textContent = `❌ ${(err as Error).message}`;
      btn.disabled = false;
      problem.scrollIntoView({ block: 'nearest' });
    } finally {
      creating = false;
    }
  }

  function update(prev?: DraftView) {
    const d = flow.draft;
    if (!d) return;
    defaults(d);
    title.textContent = d.brief?.title || (d.status === 'drafting' ? 'Drafting the brief…' : 'Name your project');
    rename.hidden = !d.brief || !!d.approved;
    state.textContent = d.approved ? 'IN PLANNING' : 'DRAFT';
    ver.textContent = d.brief ? ` v${Math.max(1, d.version)} · Auto-saved${d.manual ? ' · by hand' : ''}` : d.status === 'drafting' ? ' Drafting…' : '';
    if (d.brief && !d.approved) {
      const c = counts(d.brief);
      counter.hidden = false;
      counter.replaceChildren(h('span', {}, h('i.nw-dot.warn'), `${c.assumed} assumption${c.assumed === 1 ? '' : 's'}`), h('span', {}, h('i.nw-dot'), `${c.open} open question${c.open === 1 ? '' : 's'}`));
    } else counter.hidden = true;
    // Drafting stopped without a brief: say why, and offer the way on.
    if (d.status === 'failed' && !d.brief) {
      const manual = h('button.btn', { type: 'button' }, 'Fill in the brief yourself');
      manual.addEventListener('click', () => void briefApi.manual(d.id).then((x) => flow.setDraft(x), (e: Error) => toast(e.message, 'error')));
      const back = h('button.btn.nw-ghost', { type: 'button', onclick: () => flow.show('start') }, 'Back to the description');
      problem.hidden = false;
      problem.replaceChildren(h('p', {}, d.message ?? 'The Chief Analyst couldn’t draft the brief.'), h('div.nw-row', {}, manual, back));
    } else if (d.message && (d.status === 'failed' || d.domainsStatus === 'failed' || /budget|capped|paused/i.test(d.message))) {
      problem.hidden = false;
      problem.textContent = d.message;
    } else if (!creating) problem.hidden = true;
    setPrimary(!d.approved ? 'approve' : d.domainsStatus === 'mapping' || d.busy === 'domains' ? 'mapping' : 'create');
    const approveBtn = primaryWrap.querySelector<HTMLButtonElement>('#nw-approve');
    if (approveBtn) approveBtn.disabled = !d.brief || d.status === 'drafting' || !!d.busy || !flow.info.admin || !d.brief.title.trim();
    autonomy.update();
    syncCreate();
    brief.update(prev);
    chat.update();
    domains.update();
    team.update();
  }

  /** Create project: an admin's, once the autonomy step has its answer (the reason in the hint until then). */
  function syncCreate() {
    const b = primaryWrap.querySelector<HTMLButtonElement>('#nw-create');
    if (!b) return;
    const why = autonomy.problem();
    b.disabled = !flow.info.admin || !!why;
    const hint = primaryWrap.querySelector('.nw-approve-hint');
    if (hint) hint.textContent = why ? `${why}: see Autonomy, below.` : CREATE_HINT;
  }

  return {
    el,
    update,
    focus: () => (primaryWrap.querySelector<HTMLElement>('button:not(:disabled)') ?? title).focus?.({ preventScroll: true }),
    /** Esc inside the plan: an edit or the phone's chat sheet first (true when it handled it). */
    escape: () => brief.escape() || chat.escape(),
  };
}
