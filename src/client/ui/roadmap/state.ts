// What the page knows of the project's phases outside the Roadmap itself: the lite answer of GET /api/phases
// for the project you're on (./api.ts), asked on arriving at a project and when the office says it changed (at
// most every few seconds). The navigation lists Roadmap only while the project has phases (./tab.ts `shown`,
// tabs/registry.ts tabVisibilityChanged), and the Overview's strip (./strip.ts) draws from the same answer.

import { store } from '../../state';
import { tabVisibilityChanged } from '../../tabs/registry';
import { onRoster } from '../teams/world';
import { getPhases, type LiteView } from './api';
import type { PhasesView } from '../../../shared/phases/view';

/** At most one look this often when the office keeps saying the project changed. */
const MIN_GAP_MS = 4000;

export type PhasesAnswer = PhasesView | (LiteView & { offer?: number });

let answer: PhasesAnswer | undefined;
let last = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
const listeners = new Set<(v: PhasesAnswer | undefined) => void>();

/** Whether the project you're on has phases (proposed or approved). */
export const hasPhases = (v: PhasesAnswer | undefined = answer) => !!v && v.plan.state !== 'none' && v.phases.length > 0;

export const phasesNow = () => answer;

async function load() {
  const floor = store.floor;
  last = Date.now();
  if (!floor) return set(undefined);
  const v = await getPhases(floor, true);
  if (floor === store.floor) set(v as PhasesAnswer | undefined);
}

function set(v: PhasesAnswer | undefined) {
  const was = hasPhases();
  answer = v;
  if (was !== hasPhases()) tabVisibilityChanged();
  for (const fn of listeners) fn(v);
}

/** Asks again soon (after a change of the plan made on this page, or the office's word). */
export function phasesChanged() {
  clearTimeout(timer);
  timer = setTimeout(() => void load(), Math.max(400, MIN_GAP_MS - (Date.now() - last)));
}

/** Follows the project's phases; `fn` hears every answer. Starts the looking the first time. */
export function onPhases(fn: (v: PhasesAnswer | undefined) => void): void {
  listeners.add(fn);
  if (answer) fn(answer);
  if (started) return;
  started = true;
  store.on('floor', () => {
    set(undefined);
    void load();
  });
  onRoster(phasesChanged);
  void load();
}
