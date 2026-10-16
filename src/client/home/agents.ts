// Home › 👥 Agents (server/profiles/): every agent profile in the office, and a profile's own page: its name
// (✏️ for admins), id, roles, the projects it worked on with dates and how each ended, a track record that
// says "not measured yet", the owner's notes (admins; never given to agents), and an open move with Retry and
// Cancel. Said on both: a profile is a name and a history, not knowledge or skill. Fetched when the tab
// shows and from what an action answers; nothing while it's hidden. ?tab=agents&profile=<id> opens a page.

import { NOT_MEASURED, PROFILE_HONESTY, TRACK_ROWS, type MoveOp, type ProfilesView, type ProfileView } from '../../shared/profiles';
import { store } from '../state';
import { h, openModal } from '../ui/dom';
import { profileAct, profilesView, type ProfileActResult } from '../ui/profiles/api';
import { periodText, roleTitle, rolesText, whereText } from '../ui/profiles/words';
import '../ui/profiles/profiles.css';

/** The profile a link asked for, read before Home tidies its address. */
const askedProfile = new URLSearchParams(location.search).get('profile') ?? undefined;

const REASON: Record<string, string> = { migrated: 'on the team before profiles', hired: 'hired', reused: 'hired from your agents', 'moved-in': 'moved here' };

function moveText(m: MoveOp, name: (f: string) => string): string {
  const to = `${name(m.to.floor)} (${roleTitle(m.to.role)})`;
  if (m.state === 'source-benching') return `Moving to ${to}: writing a handoff note on ${m.from ? name(m.from.floor) : 'its project'} first.`;
  if (m.state === 'dest-hiring') return `Moving to ${to}: being hired there now.`;
  return `The move to ${to} stopped${m.stage === 'source' ? ' before the bench finished' : ' at the hire'}: ${m.error ?? 'unknown reason'}. It is still on ${m.from ? name(m.from.floor) : 'no project'}.`;
}

/** A one-field dialog (rename), with ✕; ✕ and Esc give focus back to the opener. */
function renameDialog(opener: HTMLElement | null, p: ProfileView, done: (r: ProfileActResult) => void) {
  const input = h('input.pr-input', { type: 'text', maxlength: '24', value: p.displayName, 'aria-label': 'Name' }) as HTMLInputElement;
  const status = h('p.pr-status', { role: 'status' });
  const save = h('button.btn.primary', { type: 'button' }, 'Rename');
  const content = h('div.modal.pr-dialog', { role: 'dialog', 'aria-label': `Rename ${p.displayName}` }, h('header', {}, h('h2', {}, `Rename ${p.displayName}`)), h('div.body', {}, h('label.pr-field', {}, h('span', {}, 'Name (unique in this office)'), input), h('p.pr-hint', {}, 'The id stays the same. A seat it holds, and its live session, take the new name.'), status), h('footer', {}, save));
  const modal = openModal(content, { onClose: () => opener?.focus?.() });
  const go = async () => {
    status.textContent = 'Renaming…';
    const r = await profileAct({ action: 'rename', profile: p.id, name: input.value });
    if (r.error) return void (status.textContent = r.error);
    modal.close();
    done(r);
  };
  save.onclick = () => void go();
  input.onkeydown = (e) => e.key === 'Enter' && void go();
  setTimeout(() => input.select(), 0);
}

export function homeAgents(root: HTMLElement) {
  let view: ProfilesView | undefined;
  let open: string | undefined = askedProfile;
  let showing = false;
  let error = '';
  const after = (r: ProfileActResult) => {
    error = r.error ?? '';
    if (r.view) view = r.view;
    render();
  };
  const name = (floor: string, fallback = floor) => store.floors.find((f) => f.id === floor)?.name ?? fallback;

  function list(v: ProfilesView): (HTMLElement | null)[] {
    return [
      h('div.pr-head', {}, h('h2', {}, 'Agents')),
      h('p.pr-note', {}, PROFILE_HONESTY),
      v.profiles.length
        ? h(
            'ul.pr-list',
            {},
            ...[...v.profiles]
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((p) => h('li', {}, h('button.pr-open', { type: 'button', onclick: () => ((open = p.id), render()), 'aria-label': `Open the agent ${p.label}` }, h('span.pr-name', {}, p.label), h('span.pr-where', { 'data-kind': p.where.kind }, whereText(p)), h('span.pr-meta', {}, `${rolesText(p)} · ${p.projects} project${p.projects === 1 ? '' : 's'}`)))),
          )
        : h('p.pr-hint', {}, 'No agents yet. Each team member gets a profile the first time it is hired; existing team members get one when the office starts.'),
    ];
  }

  function page(v: ProfilesView, p: ProfileView): (HTMLElement | null)[] {
    const admin = v.admin && store.me.admin;
    const act = (fn: (opener: HTMLElement) => void) => (e: Event) => fn(e.currentTarget as HTMLElement);
    const notes = h('textarea.pr-input', { rows: '4', maxlength: '2000', placeholder: 'Your notes about this agent (only admins see them; never given to an agent)', 'aria-label': 'Your notes' }, p.notes?.text ?? '') as HTMLTextAreaElement;
    const move = p.move;
    return [
      h('p', {}, h('button.pt-link.pr-back', { type: 'button', onclick: () => ((open = undefined), render()) }, '← All agents')),
      h('div.pr-head', {}, h('h2', {}, p.label), h('span.pr-where', { 'data-kind': p.where.kind }, whereText(p)), admin ? h('button.btn.small', { type: 'button', title: 'Rename this agent', onclick: act((o) => renameDialog(o, p, after)) }, '✏️ Rename') : null),
      h('p.pr-note', {}, PROFILE_HONESTY),
      error ? h('p.pr-hint', { role: 'alert' }, error) : null,
      move
        ? h('section.pr-part.pr-move-card', {}, h('h3', {}, 'Move'), h('p', {}, moveText(move, name)), admin && move.state === 'failed' ? h('div.pr-acts', {}, h('button.btn.primary', { type: 'button', onclick: () => void profileAct({ action: 'retry', move_id: move.id }).then(after) }, 'Retry'), h('button.btn', { type: 'button', onclick: () => void profileAct({ action: 'cancel', move_id: move.id }).then(after) }, 'Cancel move')) : admin && move.state === 'source-benching' ? h('div.pr-acts', {}, h('button.btn', { type: 'button', title: 'The bench goes on; the agent stays benched where it is', onclick: () => void profileAct({ action: 'cancel', move_id: move.id }).then(after) }, 'Cancel move')) : null)
        : null,
      h('section.pr-part', {}, h('h3', {}, 'Profile'), h('dl.pr-dl', {}, h('dt', {}, 'Id'), h('dd', {}, h('code', {}, p.id)), h('dt', {}, 'Since'), h('dd', {}, new Date(p.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + (p.createdBy === 'migration' ? ' (given to an existing team member)' : '')), h('dt', {}, 'Roles'), h('dd', {}, rolesText(p)))),
      h(
        'section.pr-part',
        {},
        h('h3', {}, 'Projects'),
        p.assignments.length
          ? h('table.pr-table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Project'), h('th', {}, 'Role'), h('th', {}, 'How'), h('th', {}, 'When'))), h('tbody', {}, ...[...p.assignments].reverse().map((a) => h('tr', {}, h('td', {}, store.floors.some((f) => f.id === a.floor) ? h('a', { href: `/lite?floor=${encodeURIComponent(a.floor)}&tab=team` }, name(a.floor, a.project)) : a.project), h('td', {}, roleTitle(a.role)), h('td', {}, REASON[a.reason] ?? a.reason), h('td', {}, periodText(a))))))
          : h('p.pr-hint', {}, 'No projects yet.'),
      ),
      h('section.pr-part', {}, h('h3', {}, 'Track record'), h('dl.pr-dl', {}, ...TRACK_ROWS.flatMap((r) => [h('dt', {}, r), h('dd.pr-dim', {}, NOT_MEASURED)])), h('p.pr-hint', {}, 'Figures need each piece of work attributed to the agent when it happens; until then nothing is shown rather than a guess. Results depend on the model, the configuration and the project too.')),
      admin
        ? h('section.pr-part', {}, h('h3', {}, 'Your notes'), notes, h('p.pr-hint', {}, p.notes ? `Last saved ${new Date(p.notes.at).toLocaleString()} by ${p.notes.by || 'someone'}. Never given to an agent.` : 'Only admins see them. Never given to an agent.'), h('button.btn', { type: 'button', onclick: () => void profileAct({ action: 'notes', profile: p.id, text: notes.value }).then(after) }, 'Save notes'))
        : null,
    ];
  }

  function render() {
    if (!showing) return;
    if (!view) return void root.replaceChildren(h('p.pr-hint', {}, 'Asking the office…'));
    const p = open ? view.profiles.find((x) => x.id === open) : undefined;
    root.replaceChildren(h('div.pr-wrap', {}, ...(p ? page(view, p) : list(view))));
  }

  async function load() {
    try {
      view = await profilesView();
    } catch (err) {
      root.replaceChildren(h('p.pr-hint', {}, `Couldn’t ask the office: ${(err as Error).message}`));
      return;
    }
    render();
  }

  return {
    show() {
      showing = true;
      render();
      void load();
    },
    hide() {
      showing = false;
    },
    /** Opens one profile's page (for links and screenshots). */
    open(id: string) {
      open = id;
      render();
    },
  };
}
