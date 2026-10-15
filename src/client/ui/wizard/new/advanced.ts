// Advanced, under the Team & budget card of the New project plan: everything else the classic wizard asked
// for, with its defaults (the office's settings and the brief): the repository (owner, name, visibility,
// description; or the existing app's repository), the admin token or "I created it myself", the Mendix
// version, the size tier, exec approval, the client and operators, the Discovery issue and who works it, the
// kickoff questions the brief doesn't answer, and the toolkit line. Problems show next to their field.
import { INTERVIEW_MODE_INFO, ownerProblem, slugProblem, slugify, type AnswerKind, type ProjectPlan } from '../../../../shared/wizard';
import { SHAPES, shapeForRoles } from '../../../../shared/roster/coverage';
import { ROLE_BY_ID } from '../../../../shared/roster/roles';
import { store } from '../../../state';
import { h, toast } from '../../dom';
import { connectionsApi } from '../../connections/api';
import { openConnections } from '../../connections';
import { briefApi } from './api';
import { repoFrom, repoText } from '../../../../shared/brief';
import type { Flow } from './index';
import { portfolioField } from './portfolio-field';

/** The intake questions the brief answers (shared/brief-map.ts) and the ones the flow decides itself. */
export const FROM_BRIEF = [2, 4, 5, 8];
export const DERIVED = [1, 9, 11];

export type FieldId = 'owner' | 'name' | 'repo' | 'mendix' | 'byhand';

/** What's wrong with the plan, field by field (empty when it can be created). */
export function planProblems(flow: Flow): Partial<Record<FieldId, string>> {
  const d = flow.plan;
  const out: Partial<Record<FieldId, string>> = {};
  if (d.kind === 'new') {
    const n = slugProblem(d.name);
    if (n) out.name = n;
    const o = ownerProblem(d.owner);
    if (o) out.owner = o;
    if (!flow.info.offline && !flow.info.adminToken.configured && !d.createdByHand) out.byhand = 'No admin token: create the repository on GitHub yourself and tick this, or save a token';
  } else if (!d.name || !d.owner) out.repo = 'Pick the app’s repository (owner/name)';
  if (!d.mendix) out.mendix = flow.info.mendixVersions.length ? 'Pick a Studio Pro version' : 'No Studio Pro is installed on the office’s machine';
  return out;
}

const KINDS: [AnswerKind, string][] = [
  ['answered', 'Answered'],
  ['assumed', 'Assumed (you decide)'],
  ['unverified', 'Unverified: how to verify'],
];

export function advancedPanel(flow: Flow, redraw: () => void) {
  const errs = new Map<FieldId, HTMLElement>();
  const err = (id: FieldId) => {
    const p = h('p.nw-field-err', { id: `nw-err-${id}`, role: 'alert' });
    errs.set(id, p);
    return p;
  };
  const field = (id: string, label: string, input: HTMLElement, ...more: (HTMLElement | null)[]) => {
    input.id = `nw-a-${id}`;
    return h('div.nw-field', {}, h('label', { for: `nw-a-${id}` }, label), input, ...more);
  };
  const text = (v: string, set: (x: string) => void, attrs: Record<string, string> = {}) => {
    const i = h('input', { type: 'text', value: v, autocomplete: 'off', spellcheck: 'false', ...attrs }) as HTMLInputElement;
    i.addEventListener('input', () => set(i.value));
    return i;
  };
  const select = <T extends string>(value: T, opts: [T, string][], set: (v: T) => void) => {
    const s = h('select', {}, ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l))) as HTMLSelectElement;
    s.addEventListener('change', () => set(s.value as T));
    return s;
  };

  function build(): HTMLElement {
    errs.clear();
    const d = flow.plan;
    const parts: (HTMLElement | null)[] = [];
    if (d.kind === 'new') {
      const name = text(d.name, (v) => ((d.name = v.trim()), flow.touched.add('name')), { placeholder: 'visitor-registration' });
      name.addEventListener('change', () => slugProblem(d.name) && slugify(d.name) && ((d.name = slugify(d.name)), (name.value = d.name)));
      parts.push(
        h(
          'div.nw-adv',
          {},
          field('owner', 'GitHub owner', text(d.owner, (v) => (d.owner = v.trim())), err('owner')),
          field('name', 'Repository name', name, err('name')),
          field('vis', 'Visibility', select(d.private ? 'private' : 'public', [['private', 'Private (recommended: project repositories hold client material)'], ['public', 'Public']], (v) => (d.private = v === 'private'))),
          field('desc', 'Description', text(d.description, (v) => ((d.description = v), flow.touched.add('description')), { placeholder: 'One line about what it is for' })),
        ),
      );
      if (flow.info.offline) parts.push(h('p.nw-note', {}, '🧪 Offline test office: the repository is made as a local bare git repository, and issues as files. Nothing reaches GitHub.'));
      else if (!flow.info.adminToken.configured) parts.push(adminToken(flow, redraw, err('byhand')));
    } else {
      const repos = [...new Set([...store.floors.map((f) => f.repo).filter((r): r is string => !!r), ...store.repos.list.map((r) => r.name)])];
      const repo = text(d.name ? `${d.owner}/${d.name}` : '', (v) => {
        const [o, n] = v.trim().split('/');
        d.owner = o ?? '';
        d.name = n ?? '';
        flow.touched.add('name');
      }, { list: 'nw-a-repos', placeholder: 'owner/name' });
      // Kept on the draft too, so a resumed draft still knows it.
      repo.addEventListener('change', () => {
        const id = flow.draft?.id;
        const r = repoFrom(repo.value, store.repos.list);
        if (id && r && repoText(flow.draft?.repo) !== repoText(r)) void briefApi.update(id, { repo: r }).then((x) => flow.setDraft(x), () => undefined);
      });
      parts.push(field('repo', 'The app’s repository', repo, h('datalist', { id: 'nw-a-repos' }, ...repos.map((r) => h('option', { value: r }))), err('repo')));
    }
    const ver = select(d.mendix, flow.info.mendixVersions.map((v) => [v, `${v}${v === flow.info.defaultMendix ? ' (default)' : ''}`] as [string, string]), (v) => (d.mendix = v));
    const tierNote = flow.draft?.domains?.tier ? `The domains suggest ${flow.draft.domains.tier}${flow.draft.domains.tierWhy ? ` (${flow.draft.domains.tierWhy.trim().replace(/[.\s]+$/, '')})` : ''}.` : 'Small: at most 1 module, 8 screens and 25 use cases.';
    parts.push(
      h(
        'div.nw-adv',
        {},
        field('mendix', 'Mendix version', ver, h('span.nw-hint', {}, d.kind === 'new' ? 'Installed on the office’s machine; the new app is created with it.' : 'Installed on the office’s machine.'), err('mendix')),
        field('tier', 'Size tier', select(d.tier, [['standard', 'Standard'], ['small', 'Small']], (v) => ((d.tier = v), flow.touched.add('tier'), redraw())), h('span.nw-hint', {}, tierNote)),
        field('exec', 'Exec approval (intake Q11)', select(d.execApproval, [['auto', 'auto (default)'], ['ask', 'ask']], (v) => (d.execApproval = v))),
        field('interview', 'Interview mode (intake Q9)', h('output', {}, `${d.interview}: ${INTERVIEW_MODE_INFO[d.interview].does}. Change it with Interview style in the chat.`)),
      ),
    );
    parts.push(clientAndDiscovery(flow, d, redraw, text));
    parts.push(otherQuestions(flow, d));
    parts.push(portfolioField(d, redraw));
    parts.push(h('div.nw-field', {}, h('span.nw-lbl', {}, 'Toolkit version'), h('span', {}, 'The newest commit of the toolkit fork, pinned for this project when it’s created (see Toolkit versions in the docs).')));
    if (flow.info.problems.length) parts.push(h('div.nw-warn', {}, h('strong', {}, '⚠️ The office’s machine is missing something the toolkit needs:'), h('ul', {}, ...flow.info.problems.map((p) => h('li', {}, p)))));
    const root = h('div', {}, ...parts);
    root.addEventListener('input', clearFixed);
    root.addEventListener('change', clearFixed);
    return root;
  }

  /** A problem already shown goes as soon as its field is fixed (new ones still wait for Create project). */
  function clearFixed() {
    const probs = planProblems(flow);
    for (const [id, p] of errs) {
      if (!p.textContent || probs[id]) continue;
      p.textContent = '';
      p.parentElement?.querySelector('input, select')?.removeAttribute('aria-invalid');
    }
  }

  /** Shows each problem next to its field; true when there are none. */
  function showProblems(): boolean {
    const probs = planProblems(flow);
    for (const [id, p] of errs) {
      p.textContent = probs[id] ?? '';
      const input = p.parentElement?.querySelector('input, select');
      if (input) (probs[id] ? input.setAttribute('aria-invalid', 'true') : input.removeAttribute('aria-invalid'), input.setAttribute('aria-describedby', p.id));
    }
    return !Object.keys(probs).length;
  }

  return { build, showProblems, errs };
}

function adminToken(flow: Flow, redraw: () => void, error: HTMLElement): HTMLElement {
  const d = flow.plan;
  const box = h('input', { type: 'checkbox', checked: d.createdByHand, id: 'nw-a-byhand' }) as HTMLInputElement;
  box.addEventListener('change', () => ((d.createdByHand = box.checked), redraw()));
  const input = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…', 'aria-label': 'Admin token' }) as HTMLInputElement;
  const save = h('button.btn', { type: 'button' }, 'Save to Connections');
  save.addEventListener('click', () => {
    if (!input.value.trim()) return input.focus();
    save.disabled = true;
    connectionsApi
      .save('github-admin', input.value)
      .then(() => ((flow.info.adminToken.configured = true), (flow.info.adminToken.source = 'connections'), redraw()))
      .catch((e: Error) => toast(e.message, 'warn'))
      .finally(() => ((save.disabled = false), (input.value = '')));
  });
  return h(
    'div.nw-warn',
    {},
    h('strong', {}, '🔑 No admin token yet, so the office can’t create repositories.'),
    h('p', {}, `On GitHub: Settings → Developer settings → Fine-grained tokens. Resource owner ${d.owner || flow.info.org}, all repositories; Administration and Contents: read and write. It’s saved in 🔌 Connections, encrypted, and only this wizard uses it.`),
    h('div.nw-row', {}, input, save, h('button.btn.nw-ghost', { type: 'button', onclick: () => openConnections('github-admin') }, '🔌 Connections')),
    h('label.nw-check', {}, box, h('span', {}, ` I created this repository myself on GitHub (in ${d.owner || flow.info.org}, with a README): just clone it and carry on`)),
    error,
  );
}

function clientAndDiscovery(flow: Flow, d: ProjectPlan, redraw: () => void, text: (v: string, set: (x: string) => void, attrs?: Record<string, string>) => HTMLInputElement): HTMLElement {
  const who = SHAPES[d.shape ?? shapeForRoles(d.roles)].coverage.analysis;
  const title = ROLE_BY_ID.get(who)?.title ?? 'Chief Analyst';
  const onTeam = d.roles.includes(who as (typeof d.roles)[number]);
  const issue = h('input', { type: 'checkbox', checked: d.discovery.issue }) as HTMLInputElement;
  issue.addEventListener('change', () => ((d.discovery.issue = issue.checked), issue.checked || (d.discovery.queue = false), redraw()));
  const queue = h('input', { type: 'checkbox', checked: d.discovery.queue, disabled: !d.discovery.issue }) as HTMLInputElement;
  queue.addEventListener('change', () => ((d.discovery.queue = queue.checked), redraw()));
  const model = h('select', { 'aria-label': 'Model for Discovery', disabled: !d.discovery.issue }, ...['opus', 'sonnet', 'haiku'].map((m) => h('option', { value: m, selected: d.discovery.model === m }, m))) as HTMLSelectElement;
  model.addEventListener('change', () => (d.discovery.model = model.value));
  const names = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);
  const clients = text(d.clients.join(', '), (v) => (d.clients = names(v)), { placeholder: 'Acme Travel BV, Jane Doe' });
  clients.id = 'nw-a-clients';
  const ops = text(d.operators.join(', '), (v) => (d.operators = names(v)), { placeholder: 'Who answers for the client in the office' });
  ops.id = 'nw-a-ops';
  return h(
    'div.nw-adv-group',
    {},
    h('h4', {}, 'Client & Discovery'),
    h('div.nw-adv', {}, h('div.nw-field', {}, h('label', { for: 'nw-a-clients' }, 'Client name(s)'), clients, h('span.nw-hint', {}, 'Comma-separated; kept in agent-office.project.json for the client portal.')), h('div.nw-field', {}, h('label', { for: 'nw-a-ops' }, 'Operator(s)'), ops, h('span.nw-hint', {}, 'The people who speak for the client and answer the Chief Analyst.'))),
    h('label.nw-check', {}, issue, h('span', {}, ` Open a “Discovery” issue for the ${title} (Stages P → 4, stopping at every ✋ gate)`)),
    h('label.nw-check.nw-indent', {}, queue, h('span', {}, onTeam ? ` Hand it to the ${title} now, as its first task` : ' Queue it now for an agent')),
    h('div.nw-row.nw-indent', {}, h('span.nw-hint', {}, onTeam && d.discovery.queue ? `The ${title} is hired on this model for Discovery:` : 'Model for Discovery:'), model),
    flow.info.offline ? h('p.nw-hint', {}, '🧪 Offline test office: the issue is written to a file.') : null,
  );
}

/** The kickoff questions the brief doesn't answer (Q3 fidelity, Q6 licence, Q7 SME, Q10 work done elsewhere…). */
function otherQuestions(flow: Flow, d: ProjectPlan): HTMLElement {
  const qs = flow.info.questions.filter((q) => !DERIVED.includes(q.n) && !FROM_BRIEF.includes(q.n));
  const rows = qs.map((q) => {
    let a = d.intake.find((x) => x.n === q.n);
    if (!a) d.intake.push((a = { n: q.n, kind: 'answered', text: '' }));
    const ans = a;
    const kind = h('select', { 'aria-label': `How question ${q.n} is answered` }, ...KINDS.map(([v, l]) => h('option', { value: v, selected: v === ans.kind }, l))) as HTMLSelectElement;
    kind.addEventListener('change', () => (ans.kind = kind.value as AnswerKind));
    const ta = h('textarea', { rows: 2, 'aria-label': `Answer to question ${q.n}: ${q.title}`, placeholder: 'Leave blank for the Chief Analyst to ask in the interview' }) as HTMLTextAreaElement;
    ta.value = ans.text;
    ta.addEventListener('input', () => (ans.text = ta.value));
    return h('div.nw-q', {}, h('div.nw-q-t', {}, h('span.nw-q-n', {}, String(q.n)), q.title), h('div.nw-q-a', {}, kind, ta));
  });
  return h('div.nw-adv-group', {}, h('h4', {}, 'Kickoff questions the brief doesn’t answer'), h('p.nw-hint', {}, `Written to intake.md. Q2, Q4, Q5 and Q8 come from the brief; Q1, Q9 and Q11 from the choices above. Leave any blank for the Chief Analyst to ask.`), ...(rows.length ? rows : [h('p.nw-hint', {}, 'The toolkit’s questions couldn’t be read (see the problems below).')]));
}
