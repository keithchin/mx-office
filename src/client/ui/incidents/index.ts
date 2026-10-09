// 🚨 The Incidents sub-tab of the 🧾 Audit log (GET /api/incidents, server/incidents/): what went wrong or
// nearly did, each with its severity, status, impact, cause and follow-up. Counts and a chain badge on
// top, filters (floor, status, severity, search), a list worst-first, and an incident's detail in its
// place (detail.ts). Admins open one, tune the detection rules (form.ts), and from an audit event's row
// open an incident from it or link it to one (eventActions). The 1D view and the home page both have it.

import { OFFICE_FLOOR, type AuditEvent } from '../../../shared/audit';
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, SEVERITY_SHORT, STATUS_LABEL, incidentRef, type Incident, type IncidentList, type IncidentSeverity, type IncidentStatus } from '../../../shared/incidents';
import type { FloorInfo, ServerMsg } from '../../../shared/protocol';
import { h, toast } from '../dom';
import { incidentDetail, sevChip, statusChip } from './detail';
import { incidentForm, rulesForm, saveIncident } from './form';
import { draftFromEvent, fmtTime, fmtUsd, incQuery, type IncFilter } from './logic';
import './ui.css';

export interface IncidentsViewOpts {
  floor?: () => string | undefined;
  floors: () => readonly FloorInfo[];
  admin: () => boolean;
  storeKey: string;
  /** Opens an audit event on the Events sub-tab. */
  showEvent(id: string): void;
  /** The open count changed (for the sub-tab's label). */
  counted?(open: number): void;
}

function load(key: string, dflt: string): IncFilter {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}');
    return {
      floor: typeof v.floor === 'string' ? v.floor : dflt,
      status: Array.isArray(v.status) ? v.status.filter((s: unknown) => INCIDENT_STATUSES.includes(s as IncidentStatus)) : [],
      severity: Array.isArray(v.severity) ? v.severity.filter((s: unknown) => INCIDENT_SEVERITIES.includes(s as IncidentSeverity)) : [],
      q: '',
    };
  } catch {
    return { floor: dflt, status: [], severity: [], q: '' };
  }
}

export function incidentsView(root: HTMLElement, opts: IncidentsViewOpts) {
  const filter = load(opts.storeKey, opts.floor ? 'floor' : 'all');
  let data: IncidentList | undefined;
  let selected: string | undefined;
  let visible = false;
  let gen = 0;

  const floorName = (id: string) => opts.floors().find((f) => f.id === id)?.name ?? id;
  const floorOf = () => (filter.floor === 'floor' ? (opts.floor?.() ?? OFFICE_FLOOR) : filter.floor);
  const save = () => {
    try {
      localStorage.setItem(opts.storeKey, JSON.stringify({ floor: filter.floor, status: filter.status, severity: filter.severity }));
    } catch {
      // Just for this visit.
    }
  };

  const counts = h('span.inc-counts', { role: 'status' });
  const badge = h('span.au-badge');
  const tools = h('span.inc-headtools');
  const head = h('div.au-head', {}, h('h2.lite-h', {}, '🚨 Incidents'), counts, badge, tools);
  const bar = h('div.au-filters.inc-filters', { role: 'search' });
  const body = h('div.inc-body');
  root.replaceChildren(h('section.au.inc', {}, head, bar, body));

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function chipGroup<T extends string>(label: string, values: readonly T[], words: (v: T) => string, on: T[], attr: string) {
    return h(
      'div.au-chips',
      { role: 'group', 'aria-label': label },
      ...values.map((v) =>
        h(
          'button.btn.au-chip',
          {
            type: 'button',
            [attr]: v,
            'aria-pressed': String(on.includes(v)),
            onclick: () => {
              const i = on.indexOf(v);
              if (i >= 0) on.splice(i, 1);
              else on.push(v);
              changed();
            },
          },
          words(v),
          h('span.au-n', {}),
        ),
      ),
    );
  }
  function renderBar() {
    const scopes: [string, string][] = [...(opts.floor ? ([['floor', 'This floor']] as [string, string][]) : []), [OFFICE_FLOOR, 'Office-wide'], ['all', 'Every floor'], ...(opts.floor ? [] : opts.floors().filter((f) => !f.cloning).map((f) => [f.id, f.name] as [string, string]))];
    const scope = h('select.au-scope', { 'aria-label': 'Which floor', onchange: (e: Event) => ((filter.floor = (e.target as HTMLSelectElement).value), changed()) }, ...scopes.map(([v, l]) => h('option', { value: v, selected: v === filter.floor }, l)));
    const search = h('input.au-q', {
      type: 'search',
      placeholder: 'Search titles, summaries, causes, agents…',
      'aria-label': 'Search incidents',
      value: filter.q,
      oninput: (e: Event) => {
        filter.q = (e.target as HTMLInputElement).value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => void fetchList(), 250);
      },
    });
    bar.replaceChildren(h('div.au-line', {}, scope, chipGroup('Status', INCIDENT_STATUSES, (s) => STATUS_LABEL[s], filter.status, 'data-status'), chipGroup('Severity', INCIDENT_SEVERITIES, (s) => SEVERITY_SHORT[s], filter.severity, 'data-sev')), h('div.au-line', {}, search));
    renderCounts();
  }
  function renderCounts() {
    const c = data?.counts;
    for (const el of bar.querySelectorAll<HTMLElement>('[data-status] .au-n')) el.textContent = c ? String(c.status[(el.parentElement as HTMLElement).dataset.status as IncidentStatus] ?? '') : '';
    for (const el of bar.querySelectorAll<HTMLElement>('[data-sev] .au-n')) el.textContent = c ? String(c.severity[(el.parentElement as HTMLElement).dataset.sev as IncidentSeverity] ?? '') : '';
  }
  function renderHead() {
    const c = data?.counts.status;
    counts.textContent = c ? `${c.open} open · ${c.mitigated} mitigated · ${c.resolved} resolved` : '';
    opts.counted?.(c?.open ?? 0);
    const chain = data?.chain;
    badge.className = `au-badge ${!chain ? '' : chain.ok ? 'ok' : 'bad'}`;
    badge.textContent = !chain ? '' : chain.ok ? '🔒 History verified' : '⚠️ History edited';
    badge.title = chain?.ok ? 'Every change to an incident is kept, each line pointing at the one before' : 'A line of the incidents file was edited or taken out since it was written';
    tools.replaceChildren(
      ...(data?.admin
        ? [
            h('button.btn', { type: 'button', onclick: () => incidentForm(undefined, { floors: filter.floor !== 'all' && filter.floor !== OFFICE_FLOOR ? [floorOf()] : [] }, opts.floors(), (i) => opened(i)) }, '+ New incident'),
            h('button.btn', { type: 'button', onclick: () => data && rulesForm(data.settings, () => void fetchList()) }, '⚙️ Detection rules'),
          ]
        : []),
    );
  }

  function row(i: Incident): HTMLElement {
    const open = () => show(i.id);
    return h(
      'div.inc-row',
      {
        role: 'row',
        tabindex: '0',
        'data-sev': i.severity,
        'data-status': i.status,
        onclick: open,
        onkeydown: (e: Event) => {
          const k = (e as KeyboardEvent).key;
          if (k === 'Enter' || k === ' ') {
            e.preventDefault();
            open();
          }
        },
      },
      h('span.inc-c-sev', { role: 'cell' }, sevChip(i)),
      h('span.inc-c-main', { role: 'cell' }, h('span.inc-rowtitle', {}, h('span.inc-ref', {}, incidentRef(i)), ' ', i.title), h('span.inc-rowsum', {}, i.summary)),
      h('span.inc-c-where', { role: 'cell' }, i.floors.length ? i.floors.map(floorName).join(', ') : 'Office'),
      h('span.inc-c-status', { role: 'cell' }, statusChip(i), i.retrospective ? h('span.inc-retro', { title: 'Recorded retrospectively' }, 'retro') : null, i.occurrences > 1 ? h('span.inc-occ', {}, `${i.occurrences}×`) : null),
      h('span.inc-c-impact', { role: 'cell' }, [i.impact.spendUsd !== undefined ? fmtUsd(i.impact.spendUsd) : '', i.impact.agents !== undefined ? `${i.impact.agents} agent${i.impact.agents === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')),
      h('span.inc-c-time', { role: 'cell', title: new Date(i.detectedAt).toISOString() }, fmtTime(i.detectedAt)),
    );
  }

  function render() {
    if (!data) return body.replaceChildren(h('p.au-empty', {}, visible ? 'Loading…' : ''));
    const cur = selected ? data.incidents.find((x) => x.id === selected) : undefined;
    if (cur) {
      return body.replaceChildren(
        incidentDetail(cur, {
          admin: data.admin,
          floors: opts.floors(),
          floorName,
          back: () => ((selected = undefined), render()),
          changed: (i) => opened(i),
          showEvent: opts.showEvent,
        }),
      );
    }
    const list = data.incidents;
    body.replaceChildren(
      h(
        'div.inc-table',
        { role: 'table', 'aria-label': 'Incidents' },
        h('div.inc-row.inc-th', { role: 'row' }, h('span', { role: 'columnheader' }, 'Severity'), h('span', { role: 'columnheader' }, 'Incident'), h('span', { role: 'columnheader' }, 'Where'), h('span', { role: 'columnheader' }, 'Status'), h('span', { role: 'columnheader' }, 'Impact'), h('span', { role: 'columnheader' }, 'Detected')),
        ...list.map(row),
        list.length ? null : h('p.au-empty', {}, 'No incidents for this filter. Good.'),
      ),
    );
  }

  async function fetchList() {
    const my = ++gen;
    if (filter.floor === 'floor' && !opts.floor?.()) return;
    try {
      const res = await fetch(`/api/incidents?${incQuery({ ...filter, floor: floorOf() })}`, { credentials: 'same-origin' });
      if (my !== gen) return;
      data = res.ok ? ((await res.json()) as IncidentList) : undefined;
    } catch {
      data = undefined;
    }
    if (my !== gen) return;
    renderHead();
    renderCounts();
    render();
    if (!data) body.replaceChildren(h('p.au-empty', {}, "Couldn't load the incidents."));
  }

  /** An incident was made or changed here: show it (in the list, whatever the filter). */
  function opened(i: Incident) {
    selected = i.id;
    if (data && !data.incidents.some((x) => x.id === i.id)) data.incidents.unshift(i);
    else if (data) data.incidents = data.incidents.map((x) => (x.id === i.id ? i : x));
    render();
    void fetchList();
  }
  async function countOpen() {
    if (filter.floor === 'floor' && !opts.floor?.()) return;
    try {
      const r = await fetch(`/api/incidents?${incQuery({ floor: floorOf(), status: [], severity: [], q: '' })}`, { credentials: 'same-origin' });
      if (r.ok) opts.counted?.(((await r.json()) as IncidentList).counts.status.open);
    } catch {
      // Next time.
    }
  }
  function show(id: string) {
    selected = id;
    render();
  }
  function changed() {
    save();
    renderBar();
    void fetchList();
  }

  return {
    show(id?: string) {
      visible = true;
      if (id) selected = id;
      renderBar();
      void fetchList();
    },
    hide() {
      visible = false;
    },
    floorChanged() {
      if (visible && filter.floor === 'floor') void fetchList();
    },
    /** Shows `i` (made from an audit event). */
    opened,
    onMessage(msg: ServerMsg) {
      if (msg.t !== 'audit.new' || !msg.event.action.startsWith('incident.')) return;
      if (visible) void fetchList();
      else void countOpen();
    },
    /** Counts the open ones, for the sub-tab's label, without drawing anything. */
    count: () => void countOpen(),
  };
}

export type IncidentsView = ReturnType<typeof incidentsView>;

/**
 * What an admin can do with an audit event, under its details: open an incident from it, or link it to
 * one that's not resolved yet. `opened` hears the incident either way.
 */
export function eventActions(e: AuditEvent, floors: () => readonly FloorInfo[], opened: (i: Incident) => void): HTMLElement {
  const pick = h('select.inc-linkpick', { 'aria-label': 'Link to an incident' }, h('option', { value: '' }, 'Link to incident…'));
  let loaded = false;
  const fill = async () => {
    if (loaded) return;
    loaded = true;
    const r = await fetch('/api/incidents?floor=all&status=open,mitigated', { credentials: 'same-origin' }).catch(() => undefined);
    const list = r?.ok ? ((await r.json()) as IncidentList).incidents : [];
    pick.append(...list.map((i) => h('option', { value: i.id, disabled: i.auditIds.includes(e.id) }, `${incidentRef(i)} ${i.title}`.slice(0, 80))));
  };
  pick.addEventListener('focus', () => void fill());
  pick.addEventListener('pointerdown', () => void fill());
  pick.addEventListener('change', async () => {
    if (!pick.value) return;
    const r = await saveIncident(pick.value, { linkAudit: [e.id] });
    pick.value = '';
    if (r?.incident) {
      toast(`Linked to ${incidentRef(r.incident)}`);
      opened(r.incident);
    } else toast(r?.error ?? "Couldn't link it", 'warn');
  });
  return h('div.inc-eventtools', {}, h('button.btn', { type: 'button', onclick: (ev: Event) => (ev.stopPropagation(), incidentForm(undefined, draftFromEvent(e), floors(), opened)) }, '🚨 Create incident from this event'), pick);
}
