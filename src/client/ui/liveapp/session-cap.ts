// The 🌐 Live app tab's hint when the app refused a session: an unlicensed Mendix app keeps only 6 open
// (shared/liveapp/session-cap.ts says what was measured), and the person sees
// only "The current license does not allow more users to sign in." (or "Sign in failed." on login.html).
// It reads what the Console already streams (ui/liveapp/console.ts): the runtime's `Maximum number of
// sessions exceeded` line in the log, or a request the runtime answered 402. A runtime start (the log's
// `=== runtime start ===` mark, after a ⟳ Restart) ends every session, so it clears the hint.

import type { ServerMsg } from '../../../shared/protocol';
import { CAP_HINT, isSessionCap } from '../../../shared/liveapp/session-cap';
import { h } from '../dom';

export interface CapHint {
  readonly el: HTMLElement;
  route(msg: ServerMsg, floor: string | null): void;
}

export function sessionCapHint(): CapHint {
  const when = h('small', {});
  const el = h('p.la-note.bad.la-cap', { role: 'status', hidden: true }, CAP_HINT, ' ', when);
  /** `at`: the time of day it was refused (hh:mm:ss), when known. */
  const show = (at: string) => {
    el.hidden = false;
    when.textContent = at ? `(last refused at ${at})` : '';
  };
  return {
    el,
    route(msg, floor) {
      if (msg.t === 'welcome' || msg.t === 'floor.enter') return void (el.hidden = true);
      if (msg.t !== 'liveapp.console' || msg.floor !== floor) return;
      if (msg.reset) el.hidden = true;
      for (const e of msg.log ?? []) {
        if (e.mark) el.hidden = true;
        else if (isSessionCap(e.message)) show(e.time.slice(11, 19));
      }
      for (const r of msg.net ?? []) if (r.status === 402 && r.kind === 'xas') show(new Date(r.at).toTimeString().slice(0, 8));
    },
  };
}
