// The Expert wizard (docs/site/using-the-office/expert-mode.md): one page in three sections, as in the approved
// mockup. 1 App: the name, the Mendix version (11.12.4 by default, from the list the Team wizard uses), create the
// app on Team Server or connect an existing one (the Mendix account from Settings shows "connected"; never a token
// field). 2 Tools and safety: the toolkit and mxcli pins (latest release by default), git with the push to Team
// Server (locked on), demo users for local work. 3 Budget and brief: the total in USD with the session paused at
// 100 %, the model (Sonnet by default), an optional one-paragraph brief saved in the project for the session to read.
// "Create and open session" sends it all to POST /api/expert/create; the rules are shared/expert-setup.ts's.
import type { JobView, WizardInfo } from '../../../../shared/wizard';
import { EXPERT_BRIEF_FILE, EXPERT_BRIEF_MAX, LATEST, blankExpertForm, DEFAULT_EXPERT_MENDIX, expertFormProblem, type ExpertForm, type ExpertSetupInfo } from '../../../../shared/expert-setup';
import { slugify } from '../../../../shared/wizard';
import { h } from '../../dom';
import { loadProfile } from '../../../state/persist';
import { openConnections } from '../../connections';
import { wizardApi } from '../api';
import { icon } from '../new/parts';
import { createExpert, setupInfo } from './api';

export interface ExpertFormOptions {
  back(): void;
  started(job: JobView): void;
  keep: { form?: ExpertForm };
}

const short = (sha: string) => sha.slice(0, 7);

function section(n: number, title: string, ...body: (HTMLElement | null)[]): HTMLElement {
  return h('section.xw-sec', { 'aria-labelledby': `xw-sec-${n}` }, h('header.xw-sec-h', {}, h('span.xw-num', { 'aria-hidden': 'true' }, String(n)), h('h2', { id: `xw-sec-${n}` }, title)), h('div.xw-sec-b', {}, ...body));
}

function field(id: string, label: string, control: HTMLElement, hint?: HTMLElement | string): HTMLElement {
  return h('div.nw-field', {}, h('label', { for: id }, label), control, hint ? (typeof hint === 'string' ? h('span.nw-hint', {}, hint) : hint) : null);
}

/** A switch: a real checkbox, drawn as a toggle; `locked` ones can't be changed and say why. */
function toggle(id: string, title: string, text: string, checked: boolean, locked: boolean, change?: (on: boolean) => void, badge = locked): HTMLElement {
  const input = h('input.xw-sw', { type: 'checkbox', id, role: 'switch', checked, disabled: locked, 'aria-describedby': `${id}-d` }) as HTMLInputElement;
  input.addEventListener('change', () => change?.(input.checked));
  return h(
    'div.xw-tog',
    {},
    input,
    h('div', {}, h('label', { for: id }, title, badge ? h('span.xw-lock', {}, icon('lock'), 'always on') : null), h('p.nw-hint', { id: `${id}-d` }, text)),
  );
}

export async function expertForm(opts: ExpertFormOptions): Promise<{ el: HTMLElement; focus: HTMLElement } | undefined> {
  let info: WizardInfo;
  let pins: ExpertSetupInfo;
  try {
    [info, pins] = await Promise.all([wizardApi.info(), setupInfo()]);
  } catch {
    return undefined;
  }
  const f: ExpertForm = (opts.keep.form ??= blankExpertForm(info.mendixVersions, info.defaultMendix));
  const problem = h('p.xw-problem', { role: 'status', 'aria-live': 'polite' });
  const create = h('button.btn.primary', { type: 'button', id: 'xw-create' }, icon('arrow'), 'Create and open session') as HTMLButtonElement;

  // 1 App
  const name = h('input', { id: 'xw-name', type: 'text', value: f.name, placeholder: 'Order Desk', autocomplete: 'off', spellcheck: 'false', maxlength: '64' }) as HTMLInputElement;
  const folder = h('span.nw-hint', {});
  const sayFolder = () => (folder.textContent = f.name.trim() ? `Folder and Team Server app: ${slugify(f.name) || '…'}` : 'The folder and the Team Server app take this name.');
  name.addEventListener('input', () => ((f.name = name.value), sayFolder(), check()));
  sayFolder();
  const mendix = h(
    'select',
    { id: 'xw-mendix' },
    ...info.mendixVersions.map((v) => h('option', { value: v, selected: v === f.mendix }, v === DEFAULT_EXPERT_MENDIX ? `${v} (default)` : v)),
  ) as HTMLSelectElement;
  const mxHint = h('span.nw-hint', {});
  const sayMx = () => (mxHint.textContent = info.mendixVersions.includes(f.mendix) ? `Studio Pro ${f.mendix} is installed.` : 'No Studio Pro on the office’s machine.');
  mendix.addEventListener('change', () => ((f.mendix = mendix.value), sayMx(), check()));
  sayMx();

  const appId = h('input', { id: 'xw-appid', type: 'text', value: f.appId ?? '', placeholder: 'App ID, like 1a2b3c4d-…', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  appId.addEventListener('input', () => ((f.appId = appId.value.trim()), check()));
  const appIdField = field('xw-appid', 'App ID of the existing app', appId, 'The Portal: the app’s Settings › General › App ID. The office clones it here and never deletes it.');
  const segBtn = (v: ExpertForm['app'], label: string) => h('button', { type: 'button', role: 'radio', 'data-app': v, 'aria-checked': String(f.app === v) }, label);
  const seg = h('div.nw-seg.xw-seg', { role: 'radiogroup', 'aria-label': 'Mendix app' }, segBtn('create', 'Create on Team Server'), segBtn('connect', 'Connect existing app'));
  const appHint = h('p.nw-hint', {});
  const drawApp = () => {
    for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.app === f.app));
    appIdField.hidden = f.app !== 'connect';
    appHint.textContent = f.app === 'create' ? 'The office creates the app on Team Server and clones it here. No token is asked for: the Mendix account in Settings is used.' : 'The office connects the app already in the Mendix Portal and clones it here.';
  };
  seg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-app]');
    if (!b) return;
    f.app = b.dataset.app as ExpertForm['app'];
    drawApp();
    check();
  });
  drawApp();
  const settingsLink = h('button.nw-link', { type: 'button', onclick: () => openConnections('mendix') }, info.mendixToken ? 'Change in Settings' : 'Connect in Settings');
  const account = info.offline
    ? h('span.xw-acct.warn', {}, 'Test office: no Team Server, a local stand-in is used')
    : info.mendixToken
      ? h('span.xw-acct.ok', {}, icon('check'), 'Mendix account connected', settingsLink)
      : h('span.xw-acct.warn', {}, 'Mendix account not connected', settingsLink);

  // 2 Tools and safety
  const tk = pins.toolkit;
  const toolkit = h(
    'select',
    { id: 'xw-toolkit' },
    h('option', { value: LATEST, selected: f.toolkit === LATEST }, tk.latest ? `Latest release · ${short(tk.latest.sha)}${tk.latest.date ? ` (${tk.latest.date})` : ''}` : 'Latest release'),
    ...tk.recent.filter((c) => c.sha !== tk.latest?.sha).map((c) => h('option', { value: c.sha, selected: f.toolkit === c.sha }, `${short(c.sha)}${c.date ? ` · ${c.date}` : ''}${c.subject ? ` · ${c.subject.slice(0, 60)}` : ''}`)),
  ) as HTMLSelectElement;
  toolkit.addEventListener('change', () => ((f.toolkit = toolkit.value), check()));
  const mx = pins.mxcli;
  const mxcli = h(
    'select',
    { id: 'xw-mxcli' },
    h('option', { value: LATEST, selected: f.mxcli === LATEST }, mx.latest ? `Latest release · ${mx.latest}` : 'Latest release'),
    ...mx.versions.map((v) => h('option', { value: v, selected: f.mxcli === v }, v)),
  ) as HTMLSelectElement;
  mxcli.addEventListener('change', () => ((f.mxcli = mxcli.value), check()));

  // 3 Budget and brief
  const budget = h('input', { id: 'xw-budget', type: 'number', min: '1', step: '1', inputmode: 'decimal', value: String(f.budget) }) as HTMLInputElement;
  budget.addEventListener('input', () => ((f.budget = Number(budget.value)), check()));
  const model = h('select', { id: 'xw-model' }, h('option', { value: 'sonnet', selected: f.model === 'sonnet' }, 'Sonnet (default)'), h('option', { value: 'opus', selected: f.model === 'opus' }, 'Opus')) as HTMLSelectElement;
  model.addEventListener('change', () => ((f.model = model.value as ExpertForm['model']), check()));
  const brief = h('textarea', { id: 'xw-brief', rows: '3', maxlength: String(EXPERT_BRIEF_MAX), placeholder: 'What the app is for, who uses it, and what matters most.' }, f.brief ?? '') as HTMLTextAreaElement;
  const count = h('span.xw-count', {});
  const sayCount = () => (count.textContent = `${brief.value.length} / ${EXPERT_BRIEF_MAX}`);
  brief.addEventListener('input', () => ((f.brief = brief.value), sayCount(), check()));
  sayCount();

  const form = h(
    'div.xw-form',
    {},
    section(
      1,
      'App',
      h('div.xw-row', {}, field('xw-name', 'Project name', name, folder), field('xw-mendix', 'Mendix version', mendix, mxHint)),
      h('div.nw-field', {}, h('span.nw-lbl', {}, 'Mendix app'), h('div.xw-approw', {}, seg, account), appHint),
      appIdField,
    ),
    section(
      2,
      'Tools and safety',
      h('div.xw-row', {}, field('xw-toolkit', 'Toolkit version', toolkit, 'Pinned for this project. Update later from Settings, with rollback.'), field('xw-mxcli', 'mxcli version', mxcli, 'Written into the project’s toolkit settings, so sessions use this version.')),
      toggle('xw-git', 'Git, with auto-commit and push to Team Server', 'Every model change becomes a commit on your session branch and is pushed. Nothing to remember; history from minute one.', true, true),
      toggle('xw-demo', 'Demo users, local only', 'Handy while you build. Lock in blocks Deploy until seed users replace them; local work is fine.', f.demoUsers, false, (on) => ((f.demoUsers = on), check())),
    ),
    section(
      3,
      'Budget and brief',
      h(
        'div.xw-row.three',
        {},
        field('xw-budget', 'Budget, total (USD)', budget, 'Spend from this session and the checks behind it.'),
        h('div.nw-field', {}, h('span.nw-lbl', {}, 'At 100 %'), toggle('xw-pause', 'Pause the session', 'Always on. Alert at 80 %; paused, never stopped mid-write.', true, true, undefined, false)),
        field('xw-model', 'Model', model, 'Opus is one switch away: here, or /model in the session.'),
      ),
      h('div.nw-field', {}, h('label', { for: 'xw-brief' }, 'Brief ', h('span.xw-opt', {}, '(optional, one paragraph)')), brief, h('span.xw-brief-h', {}, h('span.nw-hint', {}, `Saved to ${EXPERT_BRIEF_FILE}. The office never sends it to the session: ask the session to read it, or just start talking.`), count)),
    ),
  );

  const next = h(
    'aside.xw-aside',
    {},
    h(
      'div.xw-next',
      {},
      h('h3', {}, 'What happens next'),
      h(
        'ol',
        {},
        h('li', {}, f.app === 'connect' ? 'The app is connected on Team Server and cloned' : 'The app is created on Team Server and cloned'),
        h('li', {}, 'The toolkit and mxcli are installed at their pins'),
        h('li', {}, 'Your brief, model, budget and demo-user choice are saved'),
        h('li', {}, 'The first commit is pushed to Team Server'),
        h('li', {}, 'The session opens in the project folder'),
      ),
      h('p.nw-hint', {}, 'Usually a few minutes. No team step, no interview: the session asks what it needs.'),
    ),
    h('div.xw-alt', {}, icon('team'), h('div', {}, h('p', {}, 'Need a governed team instead?'), h('button.nw-link', { type: 'button', onclick: () => opts.back() }, 'Back to mode choice'))),
  );

  const back = h('button.btn', { type: 'button', onclick: () => opts.back() }, 'Back');
  const view = h(
    'section.nw-view.xw-wizard',
    { 'aria-label': 'New project, Expert mode' },
    h(
      'div.xw-in.wide',
      {},
      h('p.xw-crumb', {}, 'Projects / New project / Expert mode'),
      h('h1', {}, 'New project · Expert mode'),
      h('p.xw-lede', {}, 'Set it up once. After this, every session in the project folder runs on the toolkit: its CLAUDE.md, skills, subagents and Playbook rules load on their own.'),
      h('div.xw-grid', {}, form, next),
      h('div.xw-foot', {}, problem, h('span.nw-grow'), back, create),
    ),
  );

  function check(): string | undefined {
    const bad = !info.admin ? 'Only admins (operators) can set up projects' : expertFormProblem(f, info.mendixVersions);
    // Said once something was typed: a fresh form doesn't open with a warning.
    problem.textContent = bad && (f.name || problem.textContent) ? bad : '';
    name.setAttribute('aria-invalid', String(!!bad && /name/i.test(bad) && !!f.name));
    create.disabled = !!bad;
    return bad;
  }
  check();

  create.addEventListener('click', async () => {
    const bad = check();
    if (bad) return void (problem.textContent = bad);
    create.disabled = true;
    problem.textContent = 'Starting the setup…';
    try {
      const job = await createExpert(f, loadProfile()?.name);
      opts.started(job);
    } catch (err) {
      problem.textContent = (err as Error).message;
      create.disabled = false;
    }
  });
  return { el: view, focus: name };
}
