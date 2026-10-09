// First-run setup's steps (all but the prerequisites, which are prereqs.ts): each builds its body from
// the office's view and hands back what Continue needs. The token cards are 🔌 Connections' own
// (ui/connections/cards.ts), with their Test buttons, so a token saved here is saved there.
import type { ConnectionsView, CredentialId } from '../../shared/connections';
import { PASSWORD_MIN_CHARS, type FirstRunView } from '../../shared/first-run';
import { h, toast } from '../ui/dom';
import { credentialCard } from '../ui/connections/cards';
import { connectionsApi } from '../ui/connections/api';
import { loadProfile, saveProfile, AVATAR_COLORS } from '../state/persist';
import { setupApi } from './api';

export interface StepCtx {
  view: FirstRunView;
  /** Takes the office's new view and redraws. */
  update(v: FirstRunView): void;
  /** On to the next step. */
  next(): void;
}

const SOURCE: Record<FirstRunView['password']['source'], string> = {
  generated: 'still the generated one',
  env: 'set by the launcher (AGENT_OFFICE_PASSWORD or --password)',
  connections: 'set in the office',
  accounts: 'people sign in with their own accounts',
};

/** Runs a change, shows its error, and redraws with what the office says now. */
function act(c: StepCtx, what: () => Promise<FirstRunView>, done?: string, btn?: HTMLButtonElement) {
  if (btn) btn.disabled = true;
  return what()
    .then((v) => {
      if (done) toast(done);
      c.update(v);
    })
    .catch((e: Error) => toast(e.message, 'error'))
    .finally(() => btn && (btn.disabled = false));
}

// ---- 1. Welcome --------------------------------------------------------------------------------

export function welcomeStep(c: StepCtx): HTMLElement {
  const pw = c.view.password;
  const name = h('input', { type: 'text', autocomplete: 'name', maxlength: '32', placeholder: 'Your name (optional)', value: loadProfile()?.name ?? '', 'aria-label': 'Your name' }) as HTMLInputElement;
  const keepName = () => {
    const n = name.value.trim().slice(0, 32);
    if (!n) return;
    const had = loadProfile();
    saveProfile({ name: n, color: had?.color ?? AVATAR_COLORS[0], look: had?.look });
  };
  const err = h('p.cx-err');
  const intro = h(
    'div.fr-intro',
    {},
    h('p', {}, 'This takes about 20 minutes, and every step can be done again later from ⚙️ Settings › 🔌 Connections. You’ll:'),
    h('ol', {}, h('li', {}, 'set the office password'), h('li', {}, 'check this machine has what the agents need'), h('li', {}, 'connect GitHub and Mendix'), h('li', {}, 'pick or clone the mxcli project toolkit'), h('li', {}, 'create your first project')),
  );
  if (pw.set) {
    const go = h('button.btn.primary', { type: 'button' }, 'Continue');
    go.addEventListener('click', () => (keepName(), c.next()));
    return h('div.fr-step-body', {}, intro, h('p.fr-ok', {}, `✅ The office password is ${SOURCE[pw.source]}.`), h('label.fr-field', {}, h('span', {}, 'Your name'), name), h('div.fr-actions', {}, go));
  }
  const a = h('input', { type: 'password', autocomplete: 'new-password', placeholder: `At least ${PASSWORD_MIN_CHARS} characters`, 'aria-label': 'Office password' }) as HTMLInputElement;
  const b = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'The same again', 'aria-label': 'Office password again' }) as HTMLInputElement;
  const go = h('button.btn.primary', { type: 'button' }, 'Set the password and continue');
  const submit = () => {
    err.textContent = '';
    if (a.value.length < PASSWORD_MIN_CHARS) return void ((err.textContent = `Pick a password of at least ${PASSWORD_MIN_CHARS} characters`), a.focus());
    if (a.value !== b.value) return void ((err.textContent = 'The two don’t match'), b.focus());
    keepName();
    const value = a.value;
    a.value = b.value = '';
    go.disabled = true;
    setupApi
      .password(value)
      .then((v) => {
        toast('Office password set');
        c.update(v);
        c.next();
      })
      .catch((e: Error) => (err.textContent = e.message))
      .finally(() => (go.disabled = false));
  };
  go.addEventListener('click', submit);
  for (const i of [a, b]) i.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  return h(
    'div.fr-step-body',
    {},
    intro,
    h('p', {}, 'Anyone who signs in with the office password is an admin. Only its hash is kept; the generated one stops working.'),
    h('label.fr-field', {}, h('span', {}, 'Office password'), a),
    h('label.fr-field', {}, h('span', {}, 'Again'), b),
    h('label.fr-field', {}, h('span', {}, 'Your name'), name),
    err,
    h('div.fr-actions', {}, go),
  );
}

// ---- 3. GitHub and 4. Mendix: Connections' own cards ---------------------------------------------

/** Connections' cards for `ids`, loaded now and redrawn after each change. */
function cards(ids: CredentialId[]): HTMLElement {
  const box = h('div.cx.fr-cards', {}, h('p.cx-note', {}, 'Loading…'));
  const paint = (v: ConnectionsView) => box.replaceChildren(...v.credentials.filter((x) => ids.includes(x.id)).map((x) => credentialCard(x, v, run)));
  async function run(what: () => Promise<ConnectionsView>, done?: string) {
    try {
      const v = await what();
      if (done) toast(done);
      paint(v);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  void run(() => connectionsApi.view());
  return box;
}

export function githubStep(c: StepCtx): HTMLElement {
  const org = h('input', { type: 'text', spellcheck: 'false', value: c.view.org.value, placeholder: 'your-org', 'aria-label': 'GitHub organization or user' }) as HTMLInputElement;
  const save = h('button.btn', { type: 'button' }, 'Save');
  save.addEventListener('click', () => void act(c, () => setupApi.org(org.value), 'Organization saved', save));
  const note = c.view.org.source === 'settings' ? 'Saved here.' : c.view.org.source === 'env' ? 'From AGENT_OFFICE_PROJECT_ORG (saving one here beats it).' : 'The office’s old default: save your own.';
  return h(
    'div.fr-step-body',
    {},
    h('h3', {}, 'Where new projects go'),
    h('p', {}, 'The GitHub organization (or your user name) the new-project wizard creates repositories in.'),
    h('div.fr-inline', {}, org, save),
    h('p.cx-note', {}, note),
    h('h3', {}, 'Tokens'),
    h('p', {}, 'The agents’ token works on the projects’ repositories; the admin token only creates new repositories. Each is stored encrypted for this Windows user and never shown again. Use 🧪 Test once saved.'),
    cards(['github-agents', 'github-admin']),
  );
}

export function mendixStep(c: StepCtx): HTMLElement {
  const m = c.view.mendix;
  let picker: HTMLElement;
  if (m.versions.length) {
    const sel = h('select', { 'aria-label': 'Default Studio Pro version' }, ...m.versions.map((v) => h('option', { value: v, selected: v === m.preferred }, v))) as HTMLSelectElement;
    const save = h('button.btn', { type: 'button' }, 'Save');
    save.addEventListener('click', () => void act(c, () => setupApi.mendix(sel.value), `New projects start on Studio Pro ${sel.value}`, save));
    picker = h('div', {}, h('div.fr-inline', {}, sel, save), h('p.cx-note', {}, m.saved ? `Saved: ${m.saved}.` : `Not saved yet: the wizard picks ${m.preferred} (the newest 11.12).`));
  } else picker = h('p.fr-bad', {}, `No Studio Pro found under ${m.dir}. Install it, then come back to this step.`);
  return h(
    'div.fr-step-body',
    {},
    h('h3', {}, 'Mendix token'),
    h('p', {}, 'A Mendix personal access token lets agents look up your Mendix apps (switched on per project).'),
    cards(['mendix']),
    h('h3', {}, 'Default Studio Pro version'),
    h('p', {}, 'The version the new-project wizard starts new apps on.'),
    picker,
  );
}

// ---- 5. Toolkit -----------------------------------------------------------------------------------

export function toolkitStep(c: StepCtx): HTMLElement {
  const t = c.view.toolkit;
  const status = t.problem ? h('p.fr-bad', {}, `❌ ${t.problem}`) : h('p.fr-ok', {}, `✅ The toolkit is at ${t.dir}`);
  const dir = h('input', { type: 'text', spellcheck: 'false', value: t.problem ? '' : t.dir, placeholder: 'C:\\Users\\you\\mendix-toolkit', 'aria-label': 'Toolkit folder' }) as HTMLInputElement;
  const use = h('button.btn', { type: 'button' }, 'Use this folder');
  use.addEventListener('click', () => void act(c, () => setupApi.toolkit(dir.value), 'Toolkit folder saved', use));
  const url = h('input', { type: 'text', spellcheck: 'false', value: t.repoUrl, 'aria-label': 'Toolkit Git URL' }) as HTMLInputElement;
  const into = h('input', { type: 'text', spellcheck: 'false', value: t.defaultCloneDir, 'aria-label': 'Clone into' }) as HTMLInputElement;
  const log = h('pre.fr-log', { hidden: true, 'aria-live': 'polite' });
  const clone = h('button.btn', { type: 'button', class: t.problem ? 'primary' : '' }, '⬇️ Clone');
  clone.addEventListener('click', () => {
    clone.disabled = true;
    log.hidden = false;
    log.textContent = `git clone ${url.value}\n`;
    let ok = false;
    void setupApi
      .clone(url.value, into.value, (e) => {
        if (e.t === 'line') {
          // git's progress rewrites its line: keep the last of each kind.
          const lines = log.textContent!.split('\n').filter(Boolean);
          const kind = e.text.replace(/[\d.,:%()/|]+.*$/, '');
          if (lines.length > 1 && lines.at(-1)!.startsWith(kind) && kind.length > 4) lines.pop();
          log.textContent = `${[...lines, e.text].join('\n')}\n`;
        } else if (e.ok) {
          ok = true;
          log.textContent += `✅ Cloned into ${e.dir}\n`;
        } else log.textContent += `❌ ${e.error}\n`;
        log.scrollTop = log.scrollHeight;
      })
      .catch((e: Error) => (log.textContent += `❌ ${e.message}\n`))
      .finally(() => {
        clone.disabled = false;
        if (ok) void setupApi.view().then((v) => (toast('Toolkit cloned'), c.update(v)));
      });
  });
  return h(
    'div.fr-step-body',
    {},
    h('p', {}, 'Every Mendix project is set up from the mxcli project toolkit: its scripts, gates and playbooks.'),
    status,
    h('h3', {}, 'Already have it?'),
    h('div.fr-inline', {}, dir, use),
    h('h3', {}, 'Or clone it'),
    h('label.fr-field', {}, h('span', {}, 'From'), url),
    h('label.fr-field', {}, h('span', {}, 'Into'), into),
    h('p.cx-note', {}, 'Its upstream by default; use your organization’s fork if it has one. A private one needs git to be signed in to GitHub (gh auth setup-git).'),
    h('div.fr-actions', {}, clone),
    log,
  );
}

// ---- 6. Done -----------------------------------------------------------------------------------

export function doneStep(c: StepCtx, prereqsOk: boolean | undefined): HTMLElement {
  const v = c.view;
  const item = (ok: boolean | undefined, text: string) => h('li', { class: ok === undefined ? '' : ok ? 'ok' : 'bad' }, ok === undefined ? text : `${ok ? '✅' : '⚠️'} ${text}`);
  const create = h('button.btn.primary', { type: 'button' }, '✨ Create your first project');
  create.addEventListener('click', () => void setupApi.finish().then(() => location.assign('/home?new=1'), (e: Error) => toast(e.message, 'error')));
  const home = h('button.btn', { type: 'button' }, 'Finish');
  home.addEventListener('click', () => void setupApi.finish().then(() => location.assign('/home'), (e: Error) => toast(e.message, 'error')));
  return h(
    'div.fr-step-body',
    {},
    h('p', {}, v.completedAt ? 'Setup was finished before; everything below can be changed again.' : 'That’s it. Here’s where the office stands:'),
    h(
      'ul.fr-summary-list',
      {},
      item(v.password.set, v.password.set ? 'The office password is set' : 'The office password is still the generated one'),
      item(prereqsOk, prereqsOk === undefined ? 'Prerequisites: not checked in this visit' : prereqsOk ? 'Everything required is installed' : 'Some prerequisites are still missing (step 2)'),
      item(undefined, `New projects go in github.com/${v.org.value}`),
      item(v.mendix.versions.length > 0, v.mendix.versions.length ? `New projects start on Studio Pro ${v.mendix.preferred}` : 'No Studio Pro installed yet'),
      item(!v.toolkit.problem, v.toolkit.problem ? `Toolkit: ${v.toolkit.problem}` : `Toolkit at ${v.toolkit.dir}`),
      item(undefined, `Projects are cloned into ${v.projectsDir}`),
    ),
    h('div.fr-actions', {}, create, home, h('a.btn', { href: '/docs/get-started/new-machine', target: '_blank', rel: 'noopener' }, '📚 Open docs')),
  );
}
