// "Resolve old incidents…" on the Incidents page (admins): a window listing exactly the incidents it would
// resolve (mitigated, or not seen for 7+ days: shared/incidents-bulk.ts), each ticked, with a short note
// they're all resolved with. ✕ or Esc goes back to the button it was opened from. The office resolves
// each through the normal path and checks each again (POST /api/incidents/bulk-resolve,
// server/incidents/bulk.ts). Through Phone access it asks for the password first, like resolving one.

import { BULK_NOTE, BULK_STALE_DAYS, bulkCandidates } from '../../../shared/incidents-bulk';
import { STATUS_LABEL, incidentRef, type Incident, type IncidentList } from '../../../shared/incidents';
import { h, openModal, toast } from '../dom';
import { fmtTime } from './logic';

export interface BulkDeps {
  /** The page's scope: a floor's id, '_office' or 'all'. */
  scope: string;
  floorName(id: string): string;
  /** After it resolved some: the page fetches its list and counts again. */
  done(): void;
}

async function candidates(scope: string): Promise<Incident[] | undefined> {
  try {
    const r = await fetch(`/api/incidents?floor=${encodeURIComponent(scope)}&status=open,mitigated`, { credentials: 'same-origin' });
    if (!r.ok) return undefined;
    return bulkCandidates((await r.json() as IncidentList).incidents, Date.now());
  } catch {
    return undefined;
  }
}

/** Opens the window from `opener` (the page's button). */
export async function bulkResolveDialog(opener: HTMLElement, deps: BulkDeps) {
  const list = await candidates(deps.scope);
  if (!list) return toast("Couldn't load the incidents", 'warn');
  const err = h('p.inc-err', { role: 'alert' });
  const note = h('textarea', { name: 'note', rows: '2', maxlength: '500', required: true }) as HTMLTextAreaElement;
  note.value = BULK_NOTE;
  const boxes = list.map((i) => h('input', { type: 'checkbox', value: i.id, checked: true, 'aria-label': `${incidentRef(i)} ${i.title}` }) as HTMLInputElement);
  const go = h('button.btn.primary', { type: 'submit' }) as HTMLButtonElement;
  const count = () => {
    const n = boxes.filter((b) => b.checked).length;
    go.textContent = `Resolve ${n} incident${n === 1 ? '' : 's'}`;
    go.disabled = n === 0;
  };
  const rows = list.map((i, n) =>
    h(
      'tr',
      {},
      h('td', {}, boxes[n]),
      h('td.inc-ref', {}, incidentRef(i)),
      h('td', {}, i.title),
      h('td', {}, i.floors.length ? i.floors.map(deps.floorName).join(', ') : 'Office-wide'),
      h('td', {}, STATUS_LABEL[i.status]),
      h('td', { title: new Date(i.lastSeenAt).toISOString() }, fmtTime(i.lastSeenAt)),
    ),
  );
  const table = h('table.inc-bulk-table', {}, h('thead', {}, h('tr', {}, h('th', { 'aria-label': 'Resolve' }), h('th', {}, 'Incident'), h('th', {}, 'Title'), h('th', {}, 'Project'), h('th', {}, 'Status'), h('th', {}, 'Last seen'))), h('tbody', {}, ...rows));
  table.addEventListener('change', count);
  const form = h(
    'form.inc-form',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const ids = boxes.filter((b) => b.checked).map((b) => b.value);
        if (!note.value.trim()) return void (err.textContent = 'Say in a few words why they are resolved');
        if (!ids.length) return;
        go.disabled = true;
        try {
          const res = await fetch('/api/incidents/bulk-resolve', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids, note: note.value }) });
          const j = (await res.json().catch(() => ({}))) as { resolved?: { id: string }[]; skipped?: { id: string; why: string }[]; error?: string; reauth?: boolean };
          if (!res.ok) return void (err.textContent = j.reauth ? 'Through Phone access this needs your password again: sign in again, then try once more' : (j.error ?? `The office said ${res.status}`));
          modal.close();
          const n = j.resolved?.length ?? 0;
          const skipped = j.skipped?.length ?? 0;
          toast(`Resolved ${n} incident${n === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped: seen recently or resolved already)` : ''}`);
          deps.done();
        } catch {
          err.textContent = "Couldn't reach the office";
        } finally {
          go.disabled = false;
        }
      },
    },
    h('header', {}, h('h2', {}, 'Resolve old incidents')),
    list.length
      ? h('p.inc-hint', {}, `These are mitigated or haven't been seen for more than ${BULK_STALE_DAYS} days. Each is resolved with the note below; untick any to keep it open.`)
      : h('p.inc-hint', {}, `Nothing to resolve: every open incident here was seen in the last ${BULK_STALE_DAYS} days and none is mitigated.`),
    list.length ? h('div.inc-bulk-list', {}, table) : null,
    list.length ? h('label.inc-field', {}, h('span.inc-label', {}, 'Resolution note'), note, h('small.inc-hint', {}, 'Required. On each incident’s timeline and in the audit log')) : null,
    err,
    list.length ? h('div.inc-buttons', {}, go) : null,
  );
  count();
  // Closed by ✕ or Esc: back to the button it was opened from.
  const modal = openModal(h('div.panel.inc-modal', {}, form), { doing: 'resolving old incidents', onClose: () => void (opener.isConnected && opener.focus()) });
  (list.length ? go : (modal.el.querySelector('button') as HTMLElement | null))?.focus();
}
