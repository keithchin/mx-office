// The home page's 🧾 Audit log: every floor's events and the office's own, with a floor column and a
// floor picker (the 1D view's tab, ui/audit/, opened on the whole building).

import { store } from '../state';
import type { ServerMsg } from '../../shared/protocol';
import { auditView } from '../ui/audit';

export function homeAudit(root: HTMLElement) {
  const view = auditView(root, { floors: () => store.floors, showFloor: true, admin: () => store.me.admin, storeKey: 'agent-office.audit-home' });
  return {
    show: () => view.show(),
    hide: () => view.hide(),
    onMessage: (msg: ServerMsg) => view.onMessage(msg),
  };
}
