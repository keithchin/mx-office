// The rest of 🔌 Connections: the git / gh check (with the office's commit identity as its one fix),
// the office's folders, and the hourly worktree cleanup.
import type { ConnectionsView, PathState, SweepItem, ToolCheck, ToolsView } from '../../../shared/connections';
import { h, timeAgo } from '../dom';
import { connectionsApi } from './api';
import type { Run } from './cards';

const row = (label: string, c: ToolCheck) => h('li.cx-tool', { class: c.ok ? 'ok' : 'bad' }, h('b', {}, `${c.ok ? '✅' : '⚠️'} ${label}: `), c.text, c.fix ? h('p.cx-note', {}, c.fix) : null);

export function toolsSection(run: Run): HTMLElement {
  const body = h('div.cx-tools', {}, h('p.cx-note', {}, 'Checks git and gh on the office’s machine, and signs gh in with the agents’ token in a throwaway config, so your own gh login is never touched.'));
  const check = h('button.btn', { type: 'button' }, '🔍 Check git & gh');
  const paint = (t: ToolsView) => {
    const name = h('input', { type: 'text', placeholder: 'Agent Office', value: t.officeIdentity?.name ?? '', 'aria-label': 'Commit name' }) as HTMLInputElement;
    const email = h('input', { type: 'text', placeholder: 'agents@your-org.example', value: t.officeIdentity?.email ?? '', 'aria-label': 'Commit email' }) as HTMLInputElement;
    const set = h('button.btn.primary', { type: 'button' }, t.officeIdentity ? 'Update' : 'Use for the agents’ commits');
    set.addEventListener('click', () => void run(() => connectionsApi.identity(name.value, email.value), 'Commit identity set').then(load));
    const clear = t.officeIdentity ? h('button.btn', { type: 'button', onclick: () => void run(() => connectionsApi.clearIdentity(), 'Commit identity cleared').then(load) }, 'Clear') : null;
    body.replaceChildren(
      h('ul.cx-toollist', {}, row('git', t.git), row('gh', t.gh), row('gh with the agents’ token', t.ghAuth), row('Commit identity', t.identity)),
      !t.identity.ok || t.officeIdentity
        ? h('div.cx-form', {}, h('p.cx-sub', {}, 'The agents’ commits (GIT_AUTHOR_* / GIT_COMMITTER_* in their environment; git’s own settings stay as they are):'), h('div.cx-two', {}, name, email), h('div.cx-actions', {}, set, clear))
        : '',
    );
  };
  const load = async () => {
    check.disabled = true;
    check.textContent = 'Checking…';
    try {
      paint(await connectionsApi.tools());
    } catch (err) {
      body.replaceChildren(h('p.cx-err', {}, (err as Error).message));
    } finally {
      check.disabled = false;
      check.textContent = '🔍 Check again';
    }
  };
  check.addEventListener('click', () => void load());
  return h('section.cx-card', { id: 'cx-tools' }, h('div.cx-head', {}, h('span.cx-icon', { 'aria-hidden': 'true' }, '🧰'), h('h4', {}, 'git & gh on the office’s machine'), check), body);
}

const SOURCE: Record<PathState['source'], string> = { settings: 'picked here', env: 'from AGENT_OFFICE_TOOLKIT_DIR', default: 'the default', 'command line': 'from --projects / AGENT_OFFICE_PROJECTS' };

function pathRow(label: string, which: 'projectsDir' | 'toolkitDir', s: PathState, note: string, run: Run): HTMLElement {
  const input = h('input', { type: 'text', value: s.dir, spellcheck: 'false', autocomplete: 'off', 'aria-label': label }) as HTMLInputElement;
  const save = () => void run(() => connectionsApi.path(which, input.value), `${label} saved`);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  return h(
    'div.cx-path',
    {},
    h('p.cx-sub', {}, h('b', {}, label), ` (${SOURCE[s.source]})`),
    h('div.cx-two', {}, input, h('button.btn.primary', { type: 'button', onclick: save }, 'Save'), s.source === 'settings' ? h('button.btn', { type: 'button', onclick: () => void run(() => connectionsApi.path(which, ''), `${label} back to the default`) }, 'Default') : null),
    s.problem ? h('p.cx-warn', {}, `⚠️ ${s.problem}`) : h('p.cx-note', {}, `✅ ${note}`),
  );
}

export function pathsSection(view: ConnectionsView, run: Run): HTMLElement {
  return h(
    'section.cx-card',
    { id: 'cx-paths' },
    h('div.cx-head', {}, h('span.cx-icon', { 'aria-hidden': 'true' }, '📁'), h('h4', {}, 'Folders')),
    pathRow('Projects folder', 'projectsDir', view.paths.projectsDir, 'New projects are cloned into <folder>/<owner>/<repo>.', run),
    pathRow('Toolkit folder', 'toolkitDir', view.paths.toolkitDir, 'The mxcli-project-toolkit clone: the wizard runs its scripts, the Playbooks point at its skills.', run),
  );
}

const ITEM: Record<SweepItem['action'], string> = { removed: '🧹 Removed', kept: '📌 Kept', outside: '🚧 Outside', failed: '⚠️ Failed' };

export function sweepSection(view: ConnectionsView, run: Run): HTMLElement {
  const s = view.sweep;
  const toggle = h('button.btn', { type: 'button', role: 'switch', 'aria-checked': String(s.on) }, s.on ? '🟢 On' : '⚪ Off');
  toggle.addEventListener('click', () => void run(() => connectionsApi.sweep(!s.on), `Worktree cleanup ${s.on ? 'off' : 'on'}`));
  const now = h('button.btn', { type: 'button', disabled: s.running }, s.running ? 'Running…' : '▶ Run now');
  now.addEventListener('click', () => {
    now.disabled = true;
    now.textContent = 'Running…';
    void run(() => connectionsApi.sweepNow(), 'Worktree cleanup done');
  });
  const items = s.lastRun?.items ?? [];
  return h(
    'section.cx-card',
    { id: 'cx-sweep' },
    h('div.cx-head', {}, h('span.cx-icon', { 'aria-hidden': 'true' }, '🧹'), h('h4', {}, 'Worktree cleanup'), toggle, now),
    h('p.cx-note', {}, 'Every hour, worktrees under each project’s .agent-office/worktrees/ that no agent has any more, whose branch is merged and that hold no uncommitted changes, are removed with their branch (each one in the Audit log). Links inside them (node_modules junctions) are unlinked, never followed. Worktrees made anywhere else are only listed here.'),
    s.lastRun
      ? h('div.cx-sweep', {}, h('p.cx-sub', {}, `Last run ${timeAgo(s.lastRun.at)}: ${items.length ? '' : 'nothing to do.'}`), items.length ? h('ul', {}, ...items.map((i) => h('li', { class: i.action }, h('b', {}, `${ITEM[i.action]} `), `${i.floor ? `${i.floor}: ` : ''}${i.path}${i.branch ? ` (${i.branch})` : ''} — ${i.why}`))) : null)
      : h('p.cx-note', {}, 'Not run yet since the office started.'),
  );
}
