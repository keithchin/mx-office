// The Audit log's table: a dense row per event (time, floor, actor, action, target, summary, with a
// stripe for its severity) that opens to its details: the settings diff when it has one, and the rest
// as JSON with its place in the hash chain.

import { AUDIT_GROUPS, type AuditEvent } from '../../../shared/audit';
import { h } from '../dom';
import { ACTOR_META, diffRows, floorLabel, nameColor, pillGroup, rowTime } from './logic';

export interface RowOpts {
  showFloor: boolean;
  floorName: (id: string) => string | undefined;
  now: number;
  /** What goes under an opened event's details (an admin's incident buttons, ui/incidents/). */
  extra?: (e: AuditEvent) => HTMLElement | null;
}

export function headerRow(o: Pick<RowOpts, 'showFloor'>): HTMLElement {
  return h(
    'div.au-row.au-th',
    { role: 'row' },
    h('span.au-time', { role: 'columnheader' }, 'Time'),
    o.showFloor ? h('span.au-floor', { role: 'columnheader' }, 'Floor') : null,
    h('span.au-actor', { role: 'columnheader' }, 'Actor'),
    h('span.au-act', { role: 'columnheader' }, 'Action'),
    h('span.au-target', { role: 'columnheader' }, 'Target'),
    h('span.au-sum', { role: 'columnheader' }, 'Summary'),
  );
}

/** One event: its row, and its details under it once opened. */
export function eventItem(e: AuditEvent, o: RowOpts, open: boolean, toggle: (id: string) => void): HTMLElement {
  const meta = ACTOR_META[e.actor.kind] ?? ACTOR_META.office;
  const group = pillGroup(e.action);
  const target = e.target ? (e.target.label ?? e.target.id ?? e.target.kind) : '';
  const row = h(
    'div.au-row',
    {
      role: 'row',
      tabindex: '0',
      'aria-expanded': String(open),
      'data-sev': e.severity,
      title: new Date(e.at).toISOString(),
      onclick: () => toggle(e.id),
      onkeydown: (ev: Event) => {
        const k = (ev as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') {
          ev.preventDefault();
          toggle(e.id);
        }
      },
    },
    h('span.au-time', { role: 'cell' }, rowTime(e.at, o.now)),
    o.showFloor ? h('span.au-floor', { role: 'cell' }, floorLabel(e.floor, o.floorName)) : null,
    h(
      'span.au-actor',
      { role: 'cell', title: `${meta.label}: ${e.actor.name}` },
      h('span.au-av', { style: `--av:${nameColor(e.actor.name)}`, 'aria-hidden': 'true' }, meta.icon),
      h('span.au-name', {}, e.actor.name),
    ),
    h('span.au-act', { role: 'cell' }, h('span.au-pill', { class: `au-g-${group}`, title: group === 'other' ? e.action : AUDIT_GROUPS[group].label }, e.action)),
    h('span.au-target', { role: 'cell', title: target }, target),
    h('span.au-sum', { role: 'cell' }, e.summary),
  );
  return h('div.au-item', { 'data-id': e.id, class: open ? 'open' : '' }, row, open ? details(e, o.extra?.(e) ?? null) : null);
}

function details(e: AuditEvent, extra: HTMLElement | null): HTMLElement {
  const diff = diffRows(e.details);
  const rest = { ...(e.details ?? {}) };
  if (diff.length) {
    delete rest.before;
    delete rest.after;
  }
  const body: Record<string, unknown> = { action: e.action, actor: e.actor, ...(e.target ? { target: e.target } : {}), ...(Object.keys(rest).length ? { details: rest } : {}) };
  return h(
    'div.au-detail',
    {},
    diff.length
      ? h(
          'table.au-diff',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Setting'), h('th', {}, 'Before'), h('th', {}, 'After'))),
          h('tbody', {}, ...diff.map((d) => h('tr', {}, h('th', { scope: 'row' }, d.key), h('td.au-before', {}, d.before), h('td.au-after', {}, d.after)))),
        )
      : null,
    h('pre.au-json', {}, JSON.stringify(body, null, 2)),
    h('p.au-chainline', {}, `${new Date(e.at).toLocaleString()} · ${e.severity} · id ${e.id} · hash ${e.hash.slice(0, 12)}… ← prev ${e.prev ? `${e.prev.slice(0, 12)}…` : '(first)'}`),
    extra,
  );
}
