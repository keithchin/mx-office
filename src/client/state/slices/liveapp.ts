import type { LiveAppState } from '../../../shared/protocol';
import type { Slice } from '../store';

// The live app of the project you're on, as the office last said it (liveapp.state: what runs, its served
// revision, where it answers). The Live app tab (ui/liveapp.ts) asks for it on arriving and keeps its own
// copy for drawing; this is the same message kept for what else shows it without asking again (the App
// Workspace's canvas, ui/app-workspace/).

declare module '../store' {
  interface Store {
    /** The live app of the floor you're on, once the office said (null before, and on another floor). */
    liveApp: LiveAppState | null;
  }
  interface Topics {
    liveApp: true;
  }
}

export const liveApp: Slice = {
  init(s) {
    s.liveApp = null;
  },
  on: {
    'liveapp.state'(s, m) {
      if (m.state.floor !== s.floor) return;
      s.liveApp = m.state;
      return ['liveApp'];
    },
  },
  enter(s) {
    s.liveApp = null;
    return ['liveApp'];
  },
};
