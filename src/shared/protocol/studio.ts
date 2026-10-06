// Studio mode (server/studio/watch.ts): Studio Pro open on a floor's Mendix project, detected on the
// office's machine. Browsers only hear about it; nothing they send changes it.
import type { StudioState } from '../studio.js';

export type StudioServerMsg =
  /** A floor's Studio mode changed, to everyone on that floor. */
  { t: 'studio.state'; state: StudioState };
