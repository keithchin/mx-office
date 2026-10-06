// The conversations the Command Center console's Chat view is watching (ui/pm/chat/), as the office
// sends them (server/convo/): a snapshot, then what's new.
import type { Slice } from '../store';
import { upsert, type Convo } from '../../ui/pm/chat/logic';

declare module '../store' {
  interface Store {
    /** Each watched worker's conversation, by worker id. */
    convo: Map<string, Convo>;
  }
  interface Topics {
    convo: true;
  }
}

export const convo: Slice = {
  init(s) {
    s.convo = new Map();
  },
  on: {
    'convo.snapshot'(s, m) {
      s.convo.set(m.workerId, { available: m.available, reason: m.reason, messages: upsert([], m.messages) });
      return ['convo'];
    },
    'convo.append'(s, m) {
      const c = s.convo.get(m.workerId);
      if (!c) return;
      s.convo.set(m.workerId, { ...c, messages: upsert(c.messages, m.messages) });
      return ['convo'];
    },
  },
  // Another floor's workers are that floor's: the console asks again for what it shows there.
  enter(s) {
    s.convo.clear();
    return ['convo'];
  },
};
