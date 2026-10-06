import type { StudioState } from '../../../shared/studio';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Studio mode on the floor you're on, as the office last said it changed (ui/studio/ asks for it too). */
    studio: StudioState | null;
  }
  interface Topics {
    studio: true;
  }
}

export const studio: Slice = {
  init(s) {
    s.studio = null;
  },
  on: {
    'studio.state'(s, m) {
      if (m.state.floor !== s.floor) return;
      s.studio = m.state;
      return ['studio'];
    },
  },
  // Another floor's Studio mode is that floor's: ui/studio/ asks the office again on arriving.
  enter(s) {
    s.studio = null;
    return ['studio'];
  },
};
