/**
 * The floor picker on the flat views' top bar (the 1D board at /lite and the 2D pixel office at
 * /pixel). Every floor's card, and adding a project, are on the home page (/home, see home/). No
 * three.js here: both flat views import it.
 */
import type { Net } from '../net';
import { store } from '../state';
import { cloneLabel } from '../../shared/floors';
import type { FloorInfo } from '../../shared/protocol';
import { $, h } from '../ui/dom';
import { renderTitle } from './title';
import { isWatched, onProjectPrefs } from './project-prefs';

const floorLabel = (f: FloorInfo) => `${f.name}${f.cloning ? ` (${cloneLabel(f.clone)})` : f.waiting ? ` · 🙋 ${f.waiting}` : ''}`;

/** Goes to `floor` on this page, if it isn't the one you're on already. */
function go(net: Net, floor: string) {
  if (floor !== store.floor) net.send({ t: 'floor.go', floor });
}

/**
 * The floor picker on the top bar (#floor), what the floor is (#floor-meta), and a button straight
 * to any other floor you watch where someone's waiting (#elsewhere, when the page has one; a project's
 * 👁 on Home's Portal cards turns watching off, shared/project-prefs.ts).
 */
export function floorPicker(net: Net, opts: { onGo?: () => void } = {}) {
  const select = $('floor') as HTMLSelectElement;
  const render = () => {
    const options = store.floors.map((f) => h('option', { value: f.id, disabled: !!f.cloning }, floorLabel(f)));
    if (!store.floors.length) options.push(h('option', { value: '' }, 'No floors yet'));
    select.replaceChildren(...options);
    select.value = store.floor ?? '';
    select.disabled = store.floors.length < 2;
    const p = store.project;
    const f = store.currentFloor();
    $('floor-meta').textContent = p ? [p.branch && `⎇ ${p.branch}`, f?.repo ?? p.dir, f && `👥 ${f.people} here`].filter(Boolean).join(' · ') : store.floors.length ? '' : 'No floors yet: 🏠 Home adds a project.';
    const box = document.getElementById('elsewhere');
    if (box) {
      const elsewhere = store.floors.filter((o) => o.id !== store.floor && o.waiting > 0 && !o.cloning && isWatched(o.id));
      box.classList.toggle('hidden', !elsewhere.length);
      box.replaceChildren(
        ...elsewhere.map((o) => h('button.btn.lite-go', { type: 'button', onclick: () => (opts.onGo?.(), go(net, o.id)) }, `🙋 ${o.waiting} waiting on ${o.name}`, h('span', { 'aria-hidden': 'true' }, '→'))),
      );
    }
    renderTitle();
  };
  select.addEventListener('change', () => {
    if (select.value) go(net, select.value);
  });
  store.on('floors', render);
  onProjectPrefs(render);
  store.on('floor', render);
  store.on('project', render);
  render();
}
