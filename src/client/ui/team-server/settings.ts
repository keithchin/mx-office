// ⚙️ Settings › ☁️ Team Server (shared/settings-sections.ts): the project's card (card.ts) for the project you're on.
import { store } from '../../state';
import { h } from '../dom';
import { setting, type Built } from '../settings/kit';
import { teamServerCard } from './card';

export function teamServerPart(): Built {
  const floor = store.floor;
  if (!floor) return { nodes: [h('p.setting-note', {}, 'Open a project first: this is about the project you’re on.')], off: () => {} };
  return { nodes: [setting('Mendix Team Server', 'floor', teamServerCard(floor))], off: () => {} };
}
