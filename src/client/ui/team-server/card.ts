// ☁️ Team Server in ⚙️ Settings (the project's section, GET/POST /api/team-server, server/team-server/): for a
// project on Team Server, its Mendix Portal app (with the link), the remote and the last time main went there, and an
// admin's Push to Team Server now; for a local-only project, Connect to Team Server: create the app in the Portal
// (or paste an existing App ID), add the remote and push main, after a confirm that says exactly that. The token
// never comes to the page.
import './card.css';
import { REPO_SCOPES, APP_CREATE_SCOPE, STUDIO_PUBLISH_HINTS, cleanProjectId, environmentWords, offGitHubWords, syncWords, type CloudEnvironments, type TeamServerView } from '../../../shared/team-server';
import { h, openModal, timeAgo, toast } from '../dom';
import { openConnections } from '../connections';

async function call(body: Record<string, unknown>): Promise<{ view?: TeamServerView; error?: string }> {
  const res = await fetch('/api/team-server', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const b = (await res.json().catch(() => ({}))) as { view?: TeamServerView; error?: string };
  return res.ok ? b : { error: b.error ?? `The office said ${res.status}` };
}

/** The confirm step of Connect to Team Server: what it does, in words, before anything is sent. True: go. */
export function confirmConnect(projectId: string | undefined, opener: HTMLElement | null): Promise<boolean> {
  return new Promise((done) => {
    let answered = false;
    const go = h('button.btn.primary', { type: 'button', id: 'ts-connect-go' }, projectId ? 'Link and push' : 'Create the app and push');
    const back = h('button.btn', { type: 'button' }, 'Never mind');
    const what = projectId
      ? [`Links the existing Mendix Portal app ${projectId} to this project.`, 'Adds its Team Server repository as the `teamserver` remote and pushes the project’s main there (its history is kept; Team Server’s first commit becomes a parent, nothing is forced).']
      : ['Creates a new app in the Mendix Portal, named after this project, with your office’s Mendix token.', 'Adds its Team Server repository as the `teamserver` remote and pushes the project’s main there (its history is kept, nothing is forced).'];
    const el = h(
      'div.modal.ts-confirm',
      { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ts-confirm-title' },
      h('header', {}, h('h2', { id: 'ts-confirm-title' }, 'Connect to Team Server?')),
      h('div.body', {}, h('ul', {}, ...what.map((t) => h('li', {}, t)), h('li', {}, 'Records the app in agent-office.project.json and the Team Server rule in CLAUDE.md, in one commit on main.'), h('li', {}, 'From then on the office pushes main to Team Server after every merge. The office never deletes the Portal app.')), h('p.ts-small', {}, 'Studio Pro and deployments read Team Server. The code leaves this machine: check the client allows it.')),
      h('footer', {}, back, go),
    );
    const modal = openModal(el, {
      onClose: () => {
        if (!answered) done(false);
        // Focus back where it came from, with no extra click.
        opener?.focus();
      },
    });
    const finish = (yes: boolean) => {
      answered = true;
      done(yes);
      modal.close();
    };
    back.addEventListener('click', () => finish(false));
    go.addEventListener('click', () => finish(true));
    setTimeout(() => go.focus(), 30);
  });
}

/** The app's Mendix Cloud environments (Deploy API, read with the office's token, cached): a line each, with its URL. */
export function environmentsFacts(e: CloudEnvironments | undefined): HTMLElement[] {
  if (!e) return [h('dt', {}, 'Cloud'), h('dd', { class: 'ts-small' }, 'Not read yet (the office needs its Mendix token).')];
  const rows = e.list.map((x) => h('div.ts-env', { 'data-env': x.name }, x.url ? h('a', { href: x.url, target: '_blank', rel: 'noopener' }, `${environmentWords(x)} ↗`) : environmentWords(x), x.planName ? h('span.ts-small', {}, ` · ${x.planName}`) : '', x.isProduction ? h('span.ts-small', {}, ' · production') : ''));
  const none = !e.list.length && !e.error ? [h('span.ts-small', {}, 'No cloud environments yet: Publish from Studio Pro makes the Free App sandbox.')] : [];
  return [h('dt', {}, 'Cloud'), h('dd', { class: e.error && !e.list.length ? 'bad' : '' }, ...rows, ...none, e.error ? h('div.ts-small', {}, e.error) : '', h('div.ts-small', {}, `Read ${timeAgo(e.at)}`))];
}

export function teamServerCard(floor: string): HTMLElement {
  const el = h('div.ts-card', {}, h('p.setting-note', {}, 'Loading…'));
  const paint = (v: TeamServerView) => {
    if (v.record) {
      const r = v.record;
      const push = v.may ? (h('button.btn', { type: 'button', disabled: v.running || !v.token, id: 'ts-push' }, v.running ? 'Working…' : '⬆ Push to Team Server now') as HTMLButtonElement) : null;
      push?.addEventListener('click', async () => {
        push.disabled = true;
        push.textContent = 'Pushing…';
        const b = await call({ floor, action: 'sync' });
        if (b.error) toast(b.error, 'warn');
        if (b.view) paint(b.view);
        else void load();
      });
      const last = v.last;
      return el.replaceChildren(
        h(
          'dl.ts-facts',
          {},
          h('dt', {}, 'Portal app'),
          h('dd', {}, h('a', { href: v.portalUrl ?? '#', target: '_blank', rel: 'noopener' }, `${r.projectId} ↗`), r.how === 'linked' ? ' (linked)' : ' (created by the office)'),
          h('dt', {}, 'Remote'),
          h('dd', {}, h('code', {}, `${r.remote}  ${r.url}`)),
          h('dt', {}, 'Main'),
          h('dd', { class: last && (last.state === 'diverged' || last.state === 'failed') ? 'bad' : last?.state === 'unreachable' ? 'ts-wait' : '' }, syncWords(last), last ? h('span.ts-small', {}, ` · ${timeAgo(last.at)}`) : null, last?.retryAt ? h('span.ts-small', {}, ` · tries again ${new Date(last.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`) : null),
          h('dt', {}, 'Code'),
          h('dd', {}, offGitHubWords(v.home)),
          ...(r.mirror ? [h('dt', {}, 'GitHub'), h('dd', {}, 'A mirror: pull requests and checks there, its main kept equal to Team Server’s.')] : []),
          ...environmentsFacts(v.environments),
          ...(v.studio ? [h('dt', {}, 'Studio copy'), h('dd', {}, h('code', {}, v.studio.dir), h('span.ts-small', {}, v.studio.ready ? ' · Edit in Studio Pro opens it (origin: Team Server)' : ' · made by the first Edit in Studio Pro'))] : []),
        ),
        !v.token ? h('p.setting-note.bad', {}, 'No Mendix token in 🔌 Connections, so the office can’t push to Team Server. ', h('button.nw-link', { type: 'button', onclick: () => openConnections('mendix') }, '🔌 Connections')) : '',
        push ? h('div.seg', {}, push) : '',
        h('p.setting-note', {}, 'After every merge into main the office pushes main to Team Server (fast-forward only, never forced) and checks it landed; commits made in Studio Pro come back to main the same way, and the team is told main moved. If both moved, nothing is pushed and this says so.'),
        h('details.ts-publish', {}, h('summary', {}, 'Editing and publishing in Studio Pro'), h('ul', {}, ...STUDIO_PUBLISH_HINTS.map((t) => h('li', {}, t)))),
      );
    }
    if (!v.localOnly) return el.replaceChildren(h('p.setting-note', {}, 'This project is on GitHub, not on Team Server. To add Team Server, follow Migrate an app › Team Server in the docs (the office pushes main there once agent-office.project.json records it).'));
    if (!v.may) return el.replaceChildren(h('p.setting-note', {}, `${offGitHubWords('local')}. An admin can connect it to Mendix Team Server here.`));
    const id = h('input', { type: 'text', id: 'ts-appid', placeholder: 'App ID (empty: create a new app)', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Existing Portal App ID' }) as HTMLInputElement;
    const btn = h('button.btn.primary', { type: 'button', id: 'ts-connect', disabled: !v.token || v.running }, v.running ? 'Working…' : '☁️ Connect to Team Server…') as HTMLButtonElement;
    btn.addEventListener('click', async () => {
      const typed = id.value.trim();
      const pid = typed ? cleanProjectId(typed) : undefined;
      if (typed && !pid) return toast('That isn’t an App ID: copy it from the Portal (the app’s Settings › General › App ID)', 'warn');
      if (!(await confirmConnect(pid, btn))) return;
      btn.disabled = true;
      btn.textContent = pid ? 'Linking and pushing…' : 'Creating the app and pushing…';
      const b = await call({ floor, action: 'connect', ...(pid ? { projectId: pid } : { create: true }) });
      if (b.error) {
        toast(b.error, 'warn');
        btn.disabled = false;
        btn.textContent = '☁️ Connect to Team Server…';
        return;
      }
      toast('Connected to Team Server');
      if (b.view) paint(b.view);
    });
    el.replaceChildren(
      h('p.setting-note', {}, `${offGitHubWords('local')}. Connect it to Mendix Team Server so Studio Pro and deployments can use it.`),
      !v.token ? h('p.setting-note.bad', {}, `No Mendix token in 🔌 Connections: add one with ${APP_CREATE_SCOPE} and ${REPO_SCOPES}. `, h('button.nw-link', { type: 'button', onclick: () => openConnections('mendix') }, '🔌 Connections')) : '',
      h('div.ts-connect', {}, id, btn),
    );
  };
  const load = async () => {
    const res = await fetch(`/api/team-server?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    const b = (await res.json().catch(() => ({}))) as TeamServerView & { error?: string };
    if (!res.ok) return void el.replaceChildren(h('p.setting-note.bad', {}, b.error ?? `The office said ${res.status}`));
    paint(b);
  };
  void load();
  return el;
}
