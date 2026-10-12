// The New project start page: "What would you like to build?" How to start (Plan with the team, Change an
// existing app, Migrate an app, and Assurance only under More), one large description box with a + menu
// to attach documents, and Draft project brief with what it costs. "Fill in the brief yourself" is the same
// brief without the Chief Analyst, and the way on when it can't draft (its reason is said).
import type { DraftView, StartMode } from '../../../../shared/brief';
import { READ_LABEL, attachProblem } from '../../../../shared/brief';
import { usdCents } from '../../../../shared/budget/money';
import { store } from '../../../state';
import { h, toast } from '../../dom';
import { wizardApi } from '../api';
import { unfinishedSection } from '../unfinished';
import { briefApi } from './api';
import { openDialog } from './dialog';
import { caAvatar, icon } from './parts';
import type { Flow } from './index';

const MODES: { id: StartMode; title: string; icon: string; desc: string; go: string; rec?: boolean }[] = [
  { id: 'plan', title: 'Plan with the team', icon: 'spark', desc: 'A new app, from an idea or from requirements. The Chief Analyst drafts a brief from your description and documents, then the team plans and builds.', go: 'Greenfield or requirements-driven', rec: true },
  { id: 'change', title: 'Change an existing app', icon: 'pencil', desc: 'Point at an app’s repository. The team reads it first, then plans the change with you.', go: 'Existing-app change' },
  { id: 'migrate', title: 'Migrate an app', icon: 'swap', desc: 'Move an app from another platform or an older version, with an inventory and a migration plan.', go: 'Migration' },
];

const COPY: Record<StartMode, [string, string]> = {
  plan: ['Describe the app', 'Who uses it, what problem it solves, what success looks like. Attach BRDs, workshop notes or specs.'],
  change: ['Describe the change', 'Which app (its repository), what should change and why. Attach tickets or specs.'],
  migrate: ['Describe the migration', 'Where the app runs today, what it does, and what must keep working. Attach inventories or docs.'],
  assurance: ['Describe the app to assure', 'Which app (its repository) and what you want checked: tests, security, readiness.'],
};

const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

/** The plan's repository kind and entry mode for a start mode (and whether files are attached). */
export function entryFor(mode: StartMode, files: number): { kind: 'new' | 'change'; entry: 'greenfield' | 'requirements-driven' | 'existing-app-change' | 'migration' | 'assurance' } {
  if (mode === 'change') return { kind: 'change', entry: 'existing-app-change' };
  if (mode === 'assurance') return { kind: 'change', entry: 'assurance' };
  if (mode === 'migrate') return { kind: 'new', entry: 'migration' };
  return { kind: 'new', entry: files ? 'requirements-driven' : 'greenfield' };
}

export function startView(flow: Flow, opts: { resume: DraftView | null }) {
  let mode: StartMode = flow.draft?.mode ?? 'plan';
  const files = () => flow.draft?.attachments ?? [];
  const admin = flow.info.admin;

  // ---- How to start
  const cards = MODES.map((m) =>
    h('button.nw-mode', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-mode': m.id }, h('span.nw-mode-t', {}, icon(m.icon), m.title, m.rec ? h('span.nw-badge.rec', {}, 'Recommended') : null), h('span.nw-mode-d', {}, m.desc), h('span.nw-mode-go', {}, m.go)),
  );
  const modes = h('div.nw-modes', { role: 'radiogroup', 'aria-labelledby': 'nw-modes-h' }, ...cards);
  const assurance = h('button.nw-link', { type: 'button', 'aria-pressed': 'false' }, 'Assurance only');
  const assuranceWhy = h('span.nw-muted', { hidden: true }, ' · review and test an app the team won’t change.');

  // ---- The description
  const promptH = h('h2.nw-h', { id: 'nw-prompt-h' }, '');
  const promptSub = h('p.nw-sub', {}, '');
  const ta = h('textarea.nw-prompt-ta', { id: 'nw-prompt', 'aria-labelledby': 'nw-prompt-h', placeholder: 'Describe the app: who uses it, what problem it solves, what success looks like. Attach BRDs, workshop notes or specs.' }) as HTMLTextAreaElement;
  ta.value = flow.draft?.prompt ?? '';
  const chips = h('div.nw-chips', { 'aria-label': 'Attached files' });
  const plus = h('button.nw-iconbtn', { type: 'button', 'aria-label': 'Add files or sources', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('plus'));
  const detected = h('span.nw-detected.nw-grow', {});
  const draftBtn = h('button.btn.primary.nw-primary', { type: 'button' }, icon('spark'), 'Draft project brief') as HTMLButtonElement;
  const upload = h('button', { type: 'button', role: 'menuitem' }, icon('upload'), 'Upload files…');
  const soon = (name: string) => h('button', { type: 'button', role: 'menuitem', 'aria-disabled': 'true', title: 'Coming later' }, icon('cloud'), `Add from ${name}`, h('span.nw-soon', {}, 'coming later'));
  const menu = h('div.nw-menu', { role: 'menu', 'aria-label': 'Add to the description', hidden: true }, upload, h('hr'), h('div.nw-mh', {}, 'Sources'), soon('Confluence'), soon('SharePoint'));
  const repo = h('input', { type: 'text', id: 'nw-start-repo', placeholder: 'owner/name', autocomplete: 'off', spellcheck: 'false', list: 'nw-start-repos' }) as HTMLInputElement;
  const repoList = h('datalist', { id: 'nw-start-repos' });
  const repoRow = h('div.nw-field.nw-start-repo', {}, h('label', { for: 'nw-start-repo' }, 'The app’s repository'), repo, h('span.nw-hint', {}, 'A repository that is already a floor is used where it is; any other is cloned as a new floor first.'), repoList);
  const foot = h('p.nw-footnote', {});
  const manualBtn = h('button.nw-link', { type: 'button' }, icon('pencil'), 'Fill in the brief yourself');
  const problem = h('p.nw-problem', { role: 'alert' });

  const resumeBox = opts.resume?.brief || opts.resume?.prompt ? resumeCard(opts.resume) : null;
  const unfinished = unfinishedSection({ net: flow.net, go: (f) => (flow.close(), flow.go(f)), carryOn: (id) => void wizardApi.job(id).then((j) => flow.started(j), (e: Error) => toast(e.message, 'error')) });

  const el = h(
    'section.nw-view.nw-start',
    { 'aria-label': 'Start a new project' },
    h(
      'div.nw-start-in',
      {},
      unfinished.el,
      resumeBox,
      h('div.nw-eyebrow', {}, caAvatar(true), ' Chief Analyst'),
      h('h1', {}, 'What would you like to build?'),
      h('p.nw-lede', {}, 'Tell the team about the app. You’ll review a project brief before anything is created.'),
      admin ? null : h('p.nw-warn', {}, '🔒 Only admins (operators) can set up projects. You can look, but not create anything.'),
      h('h2.nw-h', { id: 'nw-modes-h' }, 'How do you want to start?'),
      modes,
      h('p.nw-more', {}, 'More: ', assurance, assuranceWhy),
      promptH,
      promptSub,
      h('div.nw-prompt', {}, ta, chips, h('div.nw-prompt-bar', {}, plus, detected, draftBtn), menu),
      repoRow,
      problem,
      foot,
      h('p.nw-manual', {}, manualBtn, h('span.nw-muted', {}, ' · the same brief, empty, with no AI')),
    ),
  );

  function resumeCard(d: DraftView): HTMLElement {
    const go = h('button.btn', { type: 'button' }, 'Continue');
    const drop = h('button.btn.nw-ghost', { type: 'button' }, 'Discard');
    const box = h('div.nw-resume', { role: 'region', 'aria-label': 'Your draft' }, h('span.nw-grow', {}, h('b', {}, d.brief?.title || 'Your draft'), h('span.nw-muted', {}, ` · ${d.brief ? `DRAFT v${d.version}` : 'not drafted yet'}${d.approved ? ' · scope approved' : ''}`)), go, drop);
    go.addEventListener('click', () => {
      flow.setDraft(d);
      box.remove();
      if (d.brief || d.status === 'drafting') flow.show('plan');
    });
    drop.addEventListener('click', () => void briefApi.discard(d.id).then(() => (box.remove(), flow.say('Draft discarded'))).catch((e: Error) => toast(e.message, 'error')));
    return box;
  }

  const setMode = (m: StartMode) => {
    mode = m;
    cards.forEach((c) => c.setAttribute('aria-checked', String(c.dataset.mode === m)));
    assurance.setAttribute('aria-pressed', String(m === 'assurance'));
    assuranceWhy.hidden = m !== 'assurance';
    promptH.textContent = COPY[m][0];
    promptSub.textContent = COPY[m][1];
    repoRow.hidden = m !== 'change' && m !== 'assurance';
    if (!repoRow.hidden && !store.repos.at && !store.repos.loading) flow.net.send({ t: 'floor.repos' });
    update();
  };
  cards.forEach((c) => c.addEventListener('click', () => setMode(c.dataset.mode as StartMode)));
  modes.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const i = cards.indexOf(document.activeElement as HTMLButtonElement);
    const n = cards[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : cards.length - 1)) % cards.length];
    n.focus();
    setMode(n.dataset.mode as StartMode);
  });
  assurance.addEventListener('click', () => setMode(mode === 'assurance' ? 'plan' : 'assurance'));
  ta.addEventListener('input', () => update());

  // ---- The + menu and the files dialog
  const closeMenu = (refocus: boolean) => {
    if (menu.hidden) return;
    menu.hidden = true;
    plus.setAttribute('aria-expanded', 'false');
    if (refocus) plus.focus();
  };
  plus.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menu.hidden) return closeMenu(true);
    menu.hidden = false;
    plus.setAttribute('aria-expanded', 'true');
    setTimeout(() => upload.focus(), 10);
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll<HTMLElement>('[role=menuitem]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') (e.preventDefault(), items[(i + 1) % items.length].focus());
    if (e.key === 'ArrowUp') (e.preventDefault(), items[(i + items.length - 1) % items.length].focus());
    if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), closeMenu(true));
    if (e.key === 'Tab') closeMenu(false);
  });
  el.addEventListener('click', (e) => !(e.target as HTMLElement).closest('.nw-menu') && closeMenu(false));
  upload.addEventListener('click', () => {
    closeMenu(false);
    filesDialog();
  });

  /** A draft in the office to attach files to and draft from: made on first need. */
  async function ensureDraft(): Promise<DraftView> {
    if (flow.draft && !flow.draft.job) {
      if (flow.draft.prompt !== ta.value || flow.draft.mode !== mode) flow.setDraft(await briefApi.update(flow.draft.id, { prompt: ta.value, mode }));
      return flow.draft;
    }
    const d = await briefApi.create({ mode, prompt: ta.value, interview: flow.plan.interview });
    flow.setDraft(d);
    return d;
  }

  async function attach(list: File[], note: (t: string) => void) {
    for (const f of list) {
      const bad = attachProblem(f.name, f.size, files().length);
      if (bad) {
        note(bad);
        continue;
      }
      try {
        const d = await ensureDraft();
        flow.setDraft(await briefApi.attach(d.id, f));
        flow.say(`${f.name} attached`);
      } catch (err) {
        note((err as Error).message);
      }
    }
  }

  function filesDialog() {
    const input = h('input', { type: 'file', multiple: true, hidden: true, accept: flow.status.limits.types.join(',') }) as HTMLInputElement;
    const drop = h('div.nw-drop', { tabindex: '0', role: 'button', 'aria-label': 'Drag and drop files here, or press Enter to choose files' }, icon('upload'), h('strong', {}, 'Drag and drop files here', h('br'), 'or click to choose'), h('small', {}, `BRDs, workshop notes, specs. ${flow.status.limits.types.map((t) => t.slice(1).toUpperCase()).join(', ')} · up to ${flow.status.limits.maxBytes / 1024 / 1024} MB each, ${flow.status.limits.maxFiles} files`));
    const list = h('div.nw-filelist', {});
    const err = h('p.nw-problem', { role: 'alert' });
    const honesty = h('p.nw-hint', {}, flow.status.fake ? 'The test planner reads .md, .txt and .docx text; it doesn’t read PDFs.' : 'Text files are read as they are, a .docx as its text (no images); a PDF is handed to the Chief Analyst to read, and the brief says whether it did.');
    const render = () => list.replaceChildren(...files().map((a) => h('div.nw-fileline', {}, icon('file'), h('span.nw-grow', {}, a.name, h('small', {}, ` · ${READ_LABEL[a.read]}${a.note ? ` (${a.note})` : ''}`)), h('span.nw-faint', {}, size(a.size)), removeBtn(a.name, render))));
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()));
    drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    const add = (fl: File[]) => {
      err.textContent = '';
      void attach(fl, (t) => (err.textContent = t)).then(render);
    };
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      add([...(e.dataTransfer?.files ?? [])]);
    });
    input.addEventListener('change', () => (add([...(input.files ?? [])]), (input.value = '')));
    render();
    const done = h('button.btn.primary', { type: 'button' }, 'Done');
    const dlg = openDialog(el, 'Add files', [drop, input, honesty, err, list], { opener: plus, foot: [done] });
    done.addEventListener('click', () => dlg.close());
  }

  function removeBtn(name: string, after: () => void): HTMLElement {
    return h('button.nw-iconbtn', { type: 'button', 'aria-label': `Remove ${name}`, onclick: () => void briefApi.unattach(flow.draft!.id, name).then((d) => (flow.setDraft(d), after(), flow.say('File removed'))).catch((e: Error) => toast(e.message, 'error')) }, icon('x'));
  }

  // ---- Draft, or fill in by hand
  const repoProblem = () => (repoRow.hidden ? undefined : /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo.value.trim()) ? undefined : 'Name the app’s repository as owner/name');
  const applyRepo = () => {
    const e = entryFor(mode, files().length);
    flow.plan.kind = e.kind;
    flow.plan.entry = e.entry;
    if (e.kind === 'change') {
      const [owner, name] = repo.value.trim().split('/');
      flow.plan.owner = owner ?? flow.plan.owner;
      flow.plan.name = name ?? '';
      flow.touched.add('name');
    }
  };
  draftBtn.addEventListener('click', async () => {
    const bad = repoProblem();
    if (bad) return ((problem.textContent = bad), repo.focus());
    draftBtn.disabled = true;
    problem.textContent = '';
    try {
      const d = await ensureDraft();
      applyRepo();
      flow.setDraft(await briefApi.draft(d.id));
      flow.show('plan');
    } catch (err) {
      problem.textContent = (err as Error).message;
    } finally {
      update();
    }
  });
  manualBtn.addEventListener('click', async () => {
    const bad = repoProblem();
    if (bad) return ((problem.textContent = bad), repo.focus());
    try {
      const d = await ensureDraft();
      applyRepo();
      flow.setDraft(await briefApi.manual(d.id));
      flow.show('plan');
    } catch (err) {
      problem.textContent = (err as Error).message;
    }
  });

  function update() {
    const att = files();
    chips.replaceChildren(...att.map((a) => h('span.nw-chip', { title: `${READ_LABEL[a.read]}${a.note ? ` (${a.note})` : ''}` }, icon('file'), h('span.nw-fn', {}, a.name), h('span.nw-sz', {}, size(a.size)), removeBtn(a.name, () => undefined))));
    if (mode === 'plan') detected.replaceChildren(icon('info'), ' Entry mode: ', h('b', {}, att.length ? 'Requirements-driven' : 'Greenfield'), att.length ? ', because you attached a document' : '. Attach a spec to make it requirements-driven');
    else detected.replaceChildren();
    const s = flow.status;
    const mb = att.reduce((n, a) => n + a.size, 0) / 1e6;
    const about = Math.max(0.05, Math.ceil((s.estimateUsd + s.perMbUsd * mb) * 20) / 20);
    foot.replaceChildren(
      icon('info'),
      h(
        'span',
        {},
        !s.available
          ? `The Chief Analyst can’t draft right now: ${s.why}. Fill in the brief yourself instead; nothing is spent.`
          : s.fake
            ? 'The test planner drafts a sample brief (no model call, nothing spent). Nothing is created until you approve.'
            : `The Chief Analyst drafts with AI (${s.model}): about ${usdCents(about)} of office spend (capped at ${usdCents(s.capUsd)}). Nothing is created until you approve.`,
      ),
    );
    draftBtn.disabled = !admin || !s.available || (!ta.value.trim() && !att.length) || flow.draft?.status === 'drafting';
    manualBtn.disabled = !admin;
    if (repoList.childElementCount === 0 && store.floors.length) repoList.replaceChildren(...[...new Set([...store.floors.map((f) => f.repo).filter((r): r is string => !!r), ...store.repos.list.map((r) => r.name)])].map((r) => h('option', { value: r })));
  }

  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !draftBtn.disabled) (e.preventDefault(), draftBtn.click());
  });
  setMode(mode);
  return { el, update, focus: () => ta.focus({ preventScroll: true }) };
}
