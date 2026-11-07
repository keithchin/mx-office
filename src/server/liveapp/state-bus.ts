// Every change of a floor's live app state (./index.ts changed), for a feature that follows what the preview
// serves: Expert mode's asked → visible timer (expert/) stops at the first served reload after a model change.
// A listener's failure never reaches the live app.

import type { LiveAppState } from '../../shared/protocol.js';

type Listener = (state: LiveAppState) => void;
const listeners = new Set<Listener>();

/** Hears every live app state change; returns what stops it. */
export function onLiveState(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function noteLiveState(state: LiveAppState): void {
  for (const l of listeners) {
    try {
      l(state);
    } catch (err) {
      console.error(`agent-office: a live app state listener failed: ${(err as Error).message}`);
    }
  }
}
