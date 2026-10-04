// The new-project wizard's five pages: the project, how it enters the toolkit's pipeline, the intake
// interview, the client and team, and a review of what's about to happen. Each page edits the one
// draft plan in place and asks for a re-render when something it shows depends on what changed.
import type { Net } from '../../net';
import { store } from '../../state';
import { ENTRY_MODE_INFO, ENTRY_MODES, PROJECT_ROLES, SETUP_STEPS, SMALL_TIER_LIMITS, slugify, slugProblem, ownerProblem, type AnswerKind, type EntryMode, type ProjectPlan, type WizardInfo } from '../../../shared/wizard';
import { h } from '../dom';

export interface PageCtx {
  draft: ProjectPlan;
  info: WizardInfo;
  net: Net;
  /** Editing a setup that already ran: the repository can't change. */
  editing: boolean;
  /** Something changed that other parts of the page show: draw it again. */
  redraw(): void;
}

export const PAGES = ['Project', 'Entry mode', 'Intake', 'Client & team', 'Review & create'] as const;
/** The intake questions the wizard answers from its other pages: entry mode (1), interview mode (9), exec approval (11). */
export const DERIVED = [1, 9, 11];

const field = (label: string, input: HTMLElement, note?: HTMLElement | string | null) => h('div.wz-field', {}, h('label', {}, label), input, note ? (typeof note === 'string' ? h('p.setting-note', {}, note) : note) : null);

function textInput(value: string, set: (v: string) => void, attrs: Record<string, string> = {}) {
  const input = h('input', { type: 'text', value, autocomplete: 'off', spellcheck: 'false', ...attrs }) as HTMLInputElement;
  input.addEventListener('input', () => set(input.value));
  return input;
}

/** Why the page can't be left forward yet, if it can't. */
export function pageProblem(i: number, c: PageCtx): string | undefined {
  const d = c.draft;
  if (i === 0) {
    if (!c.info.admin) return 'Only admins (operators) can set up projects';
    if (d.kind === 'new') return slugProblem(d.name) ?? ownerProblem(d.owner) ?? (needsHandMade(c) && !d.createdByHand ? 'No admin token: create the repository on GitHub yourself and tick the box, or set up the token' : undefined) ?? (d.mendix ? undefined : 'Pick a Studio Pro version');
    return d.name ? (d.mendix ? undefined : 'Pick a Studio Pro version') : 'Pick the repository';
  }
  return undefined;
}

const needsHandMade = (c: PageCtx) => !c.info.offline && !c.info.adminToken.configured;

// ---- 1. Project -------------------------------------------------------------------------------
export function projectPage(c: PageCtx): HTMLElement {
  const d = c.draft;
  const kinds = h(
    'div.wz-kinds',
    {},
    ...(
      [
        ['new', '✨ A new project', 'Creates a private repository in the organization and sets it up with the toolkit'],
        ['change', '🛠️ Changes to an existing app', "Picks a repository that's already there and runs the toolkit's existing-app change path on it"],
      ] as const
    ).map(([k, label, sub]) =>
      h('button.wz-card', { type: 'button', class: d.kind === k ? 'on' : '', disabled: c.editing && d.kind !== k, onclick: () => ((d.kind = k), k === 'change' && (d.entry = 'existing-app-change'), k === 'new' && d.entry === 'existing-app-change' && (d.entry = 'greenfield'), c.redraw()) }, h('strong', {}, label), h('span', {}, sub)),
    ),
  );
  const out = h('div.wz-page', {}, kinds);
  if (!c.info.admin) out.append(h('p.wz-warn', {}, '🔒 Only admins (operators) can set up projects. You can look through the wizard, but not create anything.'));
  if (d.kind === 'new') {
    const slugNote = h('p.setting-note', {});
    const showSlug = () => {
      const bad = slugProblem(d.name);
      slugNote.textContent = bad ? `⚠️ ${bad}` : `✓ github.com/${d.owner}/${d.name}`;
      slugNote.classList.toggle('bad', !!bad && !!d.name);
    };
    const name = textInput(d.name, (v) => {
      // Typed like a title ("Travel Approval"): offered as its slug once you leave the box.
      d.name = v.trim();
      showSlug();
    }, { placeholder: 'travel-approval', 'aria-label': 'Project name' });
    if (c.editing) name.setAttribute('disabled', '');
    name.addEventListener('change', () => {
      if (slugProblem(d.name) && slugify(d.name)) ((d.name = slugify(d.name)), (name.value = d.name), showSlug());
    });
    showSlug();
    const owner = textInput(d.owner, (v) => ((d.owner = v.trim()), showSlug()), { 'aria-label': 'Owner organization' });
    if (c.editing) owner.setAttribute('disabled', '');
    const desc = textInput(d.description, (v) => (d.description = v), { placeholder: 'One line about what it is for', 'aria-label': 'Description' });
    const priv = h('input', { type: 'checkbox', checked: d.private }) as HTMLInputElement;
    priv.addEventListener('change', () => (d.private = priv.checked));
    out.append(
      h('div.wz-row', {}, field('Project name (the repository)', name, slugNote), field('Owner organization', owner)),
      field('Description', desc),
      h('label.wz-check', {}, priv, ' Private repository (recommended: project repositories hold client material)'),
    );
    if (c.info.offline) out.append(h('p.wz-note', {}, '🧪 Offline test office: the repository is made as a local bare git repository, and issues as files. Nothing reaches GitHub.'));
    else if (!c.info.adminToken.configured) out.append(adminTokenBox(c));
  } else {
    out.append(repoPicker(c));
  }
  const ver = h('select', { 'aria-label': 'Studio Pro version' }, ...c.info.mendixVersions.map((v) => h('option', { value: v, selected: v === d.mendix }, `${v}${v === c.info.defaultMendix ? ' (mxcli’s validated line)' : ''}`))) as HTMLSelectElement;
  ver.addEventListener('change', () => (d.mendix = ver.value));
  out.append(field('Mendix (Studio Pro) version', ver, c.info.mendixVersions.length ? 'Installed on the office’s machine. It goes into .claude/toolkit.env and the decision register.' : '⚠️ No Studio Pro found on the office’s machine.'));
  if (c.info.problems.length) out.append(h('div.wz-warn', {}, h('strong', {}, '⚠️ The office’s machine is missing something the toolkit needs:'), h('ul', {}, ...c.info.problems.map((p) => h('li', {}, p)))));
  return out;
}

function adminTokenBox(c: PageCtx): HTMLElement {
  const d = c.draft;
  const box = h('input', { type: 'checkbox', checked: d.createdByHand }) as HTMLInputElement;
  box.addEventListener('change', () => ((d.createdByHand = box.checked), c.redraw()));
  return h(
    'div.wz-warn',
    {},
    h('strong', {}, '🔑 No admin token yet, so the office can’t create repositories.'),
    h('p', {}, 'The agents’ token deliberately can’t create repositories. An admin makes a separate token that only this wizard uses:'),
    h(
      'ol',
      {},
      h('li', {}, `On GitHub: Settings → Developer settings → Fine-grained tokens → Generate. Resource owner: ${d.owner || c.info.org}. Repository access: All repositories.`),
      h('li', {}, 'Permissions: Administration: Read and write, and Contents: Read and write. Nothing else.'),
      h('li', {}, `Save it as the only line of ${c.info.adminToken.file} on the office’s machine (or point AGENT_OFFICE_ADMIN_GH_TOKEN_FILE at another file), then open the wizard again.`),
    ),
    h('label.wz-check', {}, box, ` I created the repository myself on GitHub (${d.owner}/${d.name || '…'}, with a README): just clone it and carry on`),
  );
}

function repoPicker(c: PageCtx): HTMLElement {
  const d = c.draft;
  if (!store.repos.at && !store.repos.loading) c.net.send({ t: 'floor.repos' });
  const list = h('datalist', { id: 'wz-repos' }, ...[...new Set([...store.floors.map((f) => f.repo).filter((r): r is string => !!r), ...store.repos.list.map((r) => r.name)])].map((r) => h('option', { value: r })));
  const input = textInput(d.name ? `${d.owner}/${d.name}` : '', (v) => {
    const [owner, name] = v.trim().split('/');
    d.owner = owner ?? '';
    d.name = name ?? '';
  }, { list: 'wz-repos', placeholder: 'owner/name', 'aria-label': 'Repository' });
  if (c.editing) input.setAttribute('disabled', '');
  const note = store.repos.loading ? 'Asking GitHub for the repositories this office can see…' : store.repos.error ? `⚠️ ${store.repos.error}` : 'A repository that is already a floor is used where it is; any other is cloned as a new floor first.';
  return h('div', {}, field('Repository', input, note), list);
}

// ---- 2. Entry mode ----------------------------------------------------------------------------
export function entryPage(c: PageCtx): HTMLElement {
  const d = c.draft;
  const modes = ENTRY_MODES.filter((m) => d.kind === 'new' || m === 'existing-app-change' || m === 'assurance');
  const card = (m: EntryMode) => {
    const info = ENTRY_MODE_INFO[m];
    return h(
      'button.wz-card.wz-mode',
      { type: 'button', class: d.entry === m ? 'on' : '', onclick: () => ((d.entry = m), c.redraw()), 'aria-pressed': d.entry === m ? 'true' : 'false' },
      h('strong', {}, `${info.icon} ${info.label}`),
      h('span', {}, h('b', {}, 'You start from: '), info.from),
      h('span', {}, info.what),
      h('small', {}, `Stages: ${info.stages}`),
    );
  };
  const tier = (t: 'small' | 'standard', label: string, sub: string) => h('button.wz-card', { type: 'button', class: d.tier === t ? 'on' : '', onclick: () => ((d.tier = t), c.redraw()) }, h('strong', {}, label), h('span', {}, sub));
  return h(
    'div.wz-page',
    {},
    h('p.wz-intro', {}, 'How the project enters the toolkit’s pipeline. The stages are the same for everyone; this decides where you start and which analysis runs. First match wins: a live Mendix app you are changing → change an existing app; any legacy code → migration; any written requirements → requirements-driven; otherwise greenfield.'),
    h('div.wz-modes', {}, ...modes.map(card)),
    d.entry === 'assurance' ? h('p.wz-note', {}, 'Assurance has no stages or gates: the intake is optional, and the setup panel stays away.') : null,
    h('h3.wz-h', {}, 'Size tier'),
    h(
      'div.wz-kinds',
      {},
      tier('small', '🐣 Small', `At most ${SMALL_TIER_LIMITS}. Same gates, bounded artifacts: one BRD, a short blueprint, one brief.`),
      tier('standard', '🏗️ Standard', 'Anything bigger, or not sure yet. Stage 0’s inventory can still declare it small later.'),
    ),
  );
}

// ---- 3. Intake --------------------------------------------------------------------------------
const KINDS: [AnswerKind, string][] = [
  ['answered', 'Answered'],
  ['assumed', 'Assumed (you decide)'],
  ['unverified', 'Unverified: how to verify'],
];

export function intakePage(c: PageCtx): HTMLElement {
  const d = c.draft;
  const qs = c.info.questions.filter((q) => !DERIVED.includes(q.n));
  const answered = () => qs.filter((q) => d.intake.find((a) => a.n === q.n)?.text.trim()).length;
  const count = h('span.wz-count', {});
  const recount = () => (count.textContent = `${answered() + DERIVED.length} of ${c.info.questions.length} answered`);
  const select = <T extends string>(value: T, opts: [T, string][], set: (v: T) => void, label: string) => {
    const s = h('select', { 'aria-label': label }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l))) as HTMLSelectElement;
    s.addEventListener('change', () => set(s.value as T));
    return s;
  };
  const rows = qs.map((q) => {
    let a = d.intake.find((x) => x.n === q.n);
    if (!a) d.intake.push((a = { n: q.n, kind: 'answered', text: '' }));
    const ans = a;
    const ta = h('textarea', { rows: 2, placeholder: 'Leave blank for the Chief Analyst to ask in the interview', 'aria-label': `Answer to question ${q.n}` }) as HTMLTextAreaElement;
    ta.value = ans.text;
    ta.addEventListener('input', () => ((ans.text = ta.value), recount()));
    return h(
      'div.wz-q',
      {},
      h('div.wz-q-head', {}, h('span.wz-q-n', {}, String(q.n)), h('strong', {}, q.title)),
      q.help ? h('details', {}, h('summary', {}, 'What the toolkit wants to know'), h('p', {}, q.help)) : null,
      h('div.wz-q-answer', {}, select(ans.kind, KINDS, (v) => (ans.kind = v), `How question ${q.n} is answered`), ta),
    );
  });
  const derived = h(
    'div.wz-q.wz-derived',
    {},
    h('div.wz-q-head', {}, h('strong', {}, 'Answered from the wizard')),
    h('p', {}, `Q1 Entry mode: ${ENTRY_MODE_INFO[d.entry].token ?? 'none (assurance)'}`),
    h('div.wz-row', {}, field('Q9 Interview mode', select(d.interview, [['attended', 'Attended: every gate question is asked and waited for (default)'], ['unattended', 'Unattended: recommended options applied as ASSUMED']], (v) => (d.interview = v), 'Interview mode')), field('Q11 Exec approval', select(d.execApproval, [['auto', 'auto (default)'], ['ask', 'ask']], (v) => (d.execApproval = v), 'Exec approval'))),
  );
  recount();
  return h(
    'div.wz-page',
    {},
    h('p.wz-intro', {}, 'The toolkit’s kickoff interview (intake.md). Answer what you already know; anything left blank stays “Not yet asked” for the Chief Analyst to ask the client. Stage P passes once every question has an answer, an assumption, or a way to verify it. ', count),
    derived,
    ...rows,
  );
}

// ---- 4. Client & team -------------------------------------------------------------------------
export function teamPage(c: PageCtx): HTMLElement {
  const d = c.draft;
  const clients = textInput(d.clients.join(', '), (v) => (d.clients = v.split(',').map((s) => s.trim()).filter(Boolean)), { placeholder: 'Acme Travel BV, Jane Doe', 'aria-label': 'Clients' });
  const ops = textInput(d.operators.join(', '), (v) => (d.operators = v.split(',').map((s) => s.trim()).filter(Boolean)), { placeholder: 'Who answers for the client in the office', 'aria-label': 'Operators' });
  const roles = h(
    'div.wz-roles',
    {},
    ...PROJECT_ROLES.map((r) => {
      const box = h('input', { type: 'checkbox', checked: d.roles.includes(r.id) }) as HTMLInputElement;
      box.addEventListener('change', () => (d.roles = box.checked ? [...new Set([...d.roles, r.id])] : d.roles.filter((x) => x !== r.id)));
      return h('label.wz-role', {}, box, ` ${r.icon} ${r.label}`);
    }),
  );
  const issue = h('input', { type: 'checkbox', checked: d.discovery.issue }) as HTMLInputElement;
  issue.addEventListener('change', () => ((d.discovery.issue = issue.checked), issue.checked || (d.discovery.queue = false), c.redraw()));
  const queue = h('input', { type: 'checkbox', checked: d.discovery.queue, disabled: !d.discovery.issue }) as HTMLInputElement;
  queue.addEventListener('change', () => (d.discovery.queue = queue.checked));
  const model = h('select', { 'aria-label': 'Model', disabled: !d.discovery.issue }, ...['opus', 'sonnet', 'haiku'].map((m) => h('option', { value: m, selected: d.discovery.model === m }, m))) as HTMLSelectElement;
  model.addEventListener('change', () => (d.discovery.model = model.value));
  return h(
    'div.wz-page',
    {},
    field('Client name(s)', clients, 'Comma-separated. Kept in the project’s settings for the client portal; it isn’t committed to the repository.'),
    field('Operator(s)', ops, 'The people who speak for the client in the office and answer the Chief Analyst.'),
    h('h3.wz-h', {}, 'Roles to staff'),
    roles,
    h('p.setting-note', {}, 'Saved in the project’s settings file (.agent-office/project.json on its floor) for the team model to pick up.'),
    h('h3.wz-h', {}, 'Discovery'),
    h('label.wz-check', {}, issue, ' Open a “Discovery” issue for the Chief Analyst (Stages P → 4, stopping at every ✋ gate)'),
    h('div.wz-row.wz-indent', {}, h('label.wz-check', {}, queue, ' Queue it now for an agent'), model),
    c.info.offline ? h('p.wz-note', {}, '🧪 Offline test office: the issue is written to a file and nothing is queued.') : null,
  );
}

// ---- 5. Review --------------------------------------------------------------------------------
export function reviewPage(c: PageCtx): HTMLElement {
  const d = c.draft;
  const answered = d.intake.filter((a) => a.text.trim() && !DERIVED.includes(a.n)).length + DERIVED.length;
  const facts: [string, string][] = [
    ['Repository', `${d.owner}/${d.name}${d.kind === 'new' ? ` (new, ${d.private ? 'private' : 'public'}${d.createdByHand ? ', created by hand' : ''})` : ' (existing)'}`],
    ['Entry mode', `${ENTRY_MODE_INFO[d.entry].icon} ${ENTRY_MODE_INFO[d.entry].label} · ${d.tier} tier`],
    ['Studio Pro', d.mendix],
    ['Intake', `${answered} of ${c.info.questions.length} questions answered · interview ${d.interview} · exec approval ${d.execApproval}`],
    ['Client', d.clients.join(', ') || '—'],
    ['Operators', d.operators.join(', ') || '—'],
    ['Roles', PROJECT_ROLES.filter((r) => d.roles.includes(r.id)).map((r) => r.label).join(', ') || '—'],
    ['Discovery', d.discovery.issue ? `issue for the Chief Analyst${d.discovery.queue ? `, queued on ${d.discovery.model}` : ''}` : 'no issue'],
  ];
  const skip = new Set<string>([...(d.kind === 'change' ? ['repo'] : []), ...(d.discovery.issue ? [] : ['issue', 'queue']), ...(d.discovery.queue ? [] : ['queue'])]);
  return h(
    'div.wz-page',
    {},
    h('dl.wz-facts', {}, ...facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('h3.wz-h', {}, c.editing ? 'Saving writes the answers again and commits them' : 'What happens next'),
    h('ol.wz-plan', {}, ...SETUP_STEPS.filter((s) => !skip.has(s.id)).map((s) => h('li', {}, s.label))),
    h('p.setting-note', {}, 'Each step checks what is already done first, so if one fails you can fix the cause and Retry from there. The toolkit’s init takes a few minutes on Windows.'),
  );
}
