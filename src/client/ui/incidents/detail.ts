// One incident in full: what happened and how bad, its impact, root cause and corrective actions, its
// timeline (with a box for an admin's note), the audit events it links (each opens on the Events
// sub-tab) and the workers it touched; admins edit, mitigate, resolve or reopen it from its head.

import { SEVERITY_LABEL, SEVERITY_SHORT, STATUS_LABEL, incidentRef, type Incident } from '../../../shared/incidents';
import { h, toast } from '../dom';
import { actionHref, auditIdTime, fmtTime, fmtUsd } from './logic';
import { incidentForm, noteIncident, resolveForm, saveIncident } from './form';
import type { FloorInfo } from '../../../shared/protocol';

export interface DetailOpts {
  admin: boolean;
  floors: readonly FloorInfo[];
  floorName: (id: string) => string;
  back(): void;
  /** The incident changed: show it as it is now. */
  changed(i: Incident): void;
  /** Opens a linked audit event on the Events sub-tab. */
  showEvent(id: string): void;
}

export const sevChip = (i: Pick<Incident, 'severity'>) => h('span.inc-sev', { 'data-sev': i.severity, title: SEVERITY_LABEL[i.severity] }, SEVERITY_SHORT[i.severity]);
export const statusChip = (i: Pick<Incident, 'status'>) => h('span.inc-status', { 'data-status': i.status }, STATUS_LABEL[i.status]);

const section = (title: string, ...body: (Node | string | null)[]) => h('section.inc-sec', {}, h('h3', {}, title), ...body);

export function incidentDetail(i: Incident, o: DetailOpts): HTMLElement {
  const where = i.floors.length ? i.floors.map(o.floorName).join(', ') : 'The office';
  const set = async (status: Incident['status']) => {
    const r = await saveIncident(i.id, { status });
    if (r?.incident) o.changed(r.incident);
    else toast(r?.error ?? "Couldn't change it", 'warn');
  };
  const buttons = o.admin
    ? h(
        'div.inc-tools',
        {},
        h('button.btn', { type: 'button', onclick: () => incidentForm(i.id, { ...i, linkAudit: undefined }, o.floors, o.changed) }, '✏️ Edit'),
        i.status === 'open' ? h('button.btn', { type: 'button', onclick: () => void set('mitigated') }, 'Mark mitigated') : null,
        i.status !== 'resolved' ? h('button.btn.primary', { type: 'button', onclick: () => resolveForm(i, o.changed) }, '✅ Resolve…') : h('button.btn', { type: 'button', onclick: () => void set('open') }, 'Reopen'),
      )
    : null;
  const impact = [
    i.impact.spendUsd !== undefined ? h('li', {}, h('b', {}, 'Spend: '), fmtUsd(i.impact.spendUsd)) : null,
    i.impact.agents !== undefined ? h('li', {}, h('b', {}, 'Agents: '), String(i.impact.agents)) : null,
    i.impact.data ? h('li', {}, h('b', {}, 'Data: '), i.impact.data) : null,
    i.impact.text ? h('li', {}, i.impact.text) : null,
  ].filter(Boolean) as HTMLElement[];
  const actions = i.actions.map((a) => {
    const href = actionHref(a.link);
    const link = a.link ? (href ? h('a.inc-link', { href, target: '_blank', rel: 'noopener' }, `${a.link.kind}: ${a.link.ref}`) : h('code.inc-link', {}, `${a.link.kind}: ${a.link.ref}`)) : null;
    return h('li.inc-action', { 'data-status': a.status }, h('span.inc-astatus', {}, a.status === 'done' ? 'Done' : a.status === 'wontfix' ? "Won't do" : 'Open'), h('span', {}, a.text), link);
  });
  const note = h('textarea.inc-note', { rows: '2', placeholder: 'Add a note to the timeline…', 'aria-label': 'Note' });
  const addNote = async () => {
    if (!note.value.trim()) return;
    const r = await noteIncident(i.id, note.value);
    if (r?.incident) o.changed(r.incident);
    else toast(r?.error ?? "Couldn't add the note", 'warn');
  };
  const timeline = [...i.timeline].reverse().map((t) => h('li.inc-tl', { 'data-kind': t.kind }, h('time', { datetime: new Date(t.at).toISOString() }, fmtTime(t.at)), h('span.inc-tl-by', {}, t.by), h('span.inc-tl-text', {}, t.text)));
  const events = i.auditIds.map((id) => {
    const at = auditIdTime(id);
    return h('li', {}, h('button.btn.inc-event', { type: 'button', title: 'Open it in the Events tab', onclick: () => o.showEvent(id) }, `${at ? fmtTime(at) : 'Event'} · ${id.slice(-8)} ↗`));
  });
  return h(
    'article.inc-detail',
    { 'data-sev': i.severity },
    h('button.btn.inc-back', { type: 'button', onclick: () => o.back() }, '← All incidents'),
    h('header.inc-dhead', {}, h('div.inc-chips', {}, sevChip(i), statusChip(i), i.retrospective ? h('span.inc-retro', {}, 'Recorded retrospectively') : null, i.occurrences > 1 ? h('span.inc-occ', { title: 'Times its rule fired into it' }, `${i.occurrences}×`) : null), h('h2.inc-title', {}, h('span.inc-ref', {}, incidentRef(i)), ' ', i.title), buttons),
    h('p.inc-meta', {}, `Detected ${fmtTime(i.detectedAt)} by ${i.detectedBy.name}${i.detectedBy.kind === 'rule' ? ' (automatic rule)' : ''} · ${where}${i.resolvedAt ? ` · resolved ${fmtTime(i.resolvedAt)}` : ''}`),
    i.summary ? section('Summary', h('p.inc-text', {}, i.summary)) : null,
    section('Impact', impact.length ? h('ul.inc-impact-list', {}, ...impact) : h('p.inc-none', {}, 'Not recorded')),
    section('Root cause', i.rootCause ? h('p.inc-text', {}, i.rootCause) : h('p.inc-none', {}, i.status === 'resolved' ? 'Not recorded' : 'Not known yet')),
    section('Corrective actions', actions.length ? h('ul.inc-actions', {}, ...actions) : h('p.inc-none', {}, 'None yet')),
    section('Timeline', o.admin ? h('div.inc-noteline', {}, note, h('button.btn', { type: 'button', onclick: () => void addNote() }, 'Add note')) : null, h('ol.inc-timeline', {}, ...timeline)),
    i.workers.length ? section('Workers', h('ul.inc-workers', {}, ...i.workers.map((w) => h('li', {}, w.name, w.floor && i.floors.length !== 1 ? ` (${o.floorName(w.floor)})` : '')))) : null,
    section('Linked audit events', events.length ? h('ul.inc-events', {}, ...events) : h('p.inc-none', {}, 'None yet: expand a row on the Events tab and use “Link to incident…”')),
  );
}
