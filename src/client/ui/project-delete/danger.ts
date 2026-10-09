// ⚙️ Settings › ⚠️ Danger zone (admins, about the project you're on): GitHub's red-bordered box at the
// bottom of a repository's settings, a row per thing that can't be taken back lightly, each with what it
// does and its button. Remove from office keeps the folder and the repository; Delete project can take
// them too. Both open the same confirmation (dialog.ts).

import './dialog.css';
import { store } from '../../state';
import { h } from '../dom';
import type { Built } from '../settings/kit';
import { openDeleteDialog } from './dialog';

export function dangerPart(): Built {
  const id = store.floor;
  const floor = id ? store.floors.find((f) => f.id === id) : undefined;
  if (!floor)
    return {
      nodes: [h('p.setting-note', {}, 'Open a project first: this is about the project you’re on.')],
      off: () => {},
    };
  if (!store.me.admin)
    return {
      nodes: [h('p.setting-note', {}, 'Only admins can remove or delete a project.')],
      off: () => {},
    };
  const row = (title: string, text: string, label: string, run: () => void, strong = false) =>
    h('div.pd-row', {}, h('div.pd-row-text', {}, h('h4', {}, title), h('p', {}, text)), h(strong ? 'button.btn.danger.pd-row-btn' : 'button.btn.pd-row-btn.pd-outline', { type: 'button', onclick: run }, label));
  const name = floor.name;
  return {
    nodes: [
      h(
        'section.pd-zone',
        { 'aria-label': 'Danger zone' },
        row(
          'Remove from office',
          `Stops and sends home every agent of ${name}, removes the worktrees the office made, archives the office’s data for it and takes it off the office. The folder ${floor.dir}${floor.repo ? ` and the repository ${floor.repo}` : ''} stay.`,
          'Remove from office',
          () => openDeleteDialog(floor.id, name, 'remove'),
        ),
        row(
          'Delete this project',
          `Everything Remove from office does, and if you tick them, the local folder and the GitHub repository too. Once deleted, it’s gone. Please be certain.`,
          'Delete this project',
          () => openDeleteDialog(floor.id, name, 'delete'),
          true,
        ),
      ),
      h('p.setting-note', {}, 'Archiving a project (hidden, agents stopped, kept for later) isn’t here yet: Pause project on the Command Center stops its agents and keeps everything.'),
    ],
    off: () => {},
  };
}
