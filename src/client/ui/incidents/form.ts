// The Incidents sub-tab's windows, each with a ✕ in its top right and closed by Esc (openModal): an
// incident's form (new, from an audit event, or editing one, corrective actions included), resolving
// one with its root cause, and the detection rules' settings. Admins only; the server checks too.

import {
  ACTION_LINK_KINDS,
  ACTION_STATUSES,
  INCIDENT_RULES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  RULE_META,
  SEVERITY_LABEL,
  STATUS_LABEL,
  type CorrectiveAction,
  type Incident,
  type IncidentSettings,
  type RuleSetting,
} from '../../../shared/incidents';
import type { FloorInfo } from '../../../shared/protocol';
import { h, openModal, toast } from '../dom';

export interface IncidentDraft {
  title?: string;
  severity?: Incident['severity'];
  status?: Incident['status'];
  summary?: string;
  floors?: string[];
  impact?: Incident['impact'];
  rootCause?: string;
  actions?: CorrectiveAction[];
  linkAudit?: string[];
  workers?: Incident['workers'];
  detectedAt?: number;
}

async function post(url: string, body: unknown): Promise<{ incident?: Incident; error?: string } | undefined> {
  try {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { incident?: Incident; error?: string };
    return res.ok ? json : { error: json.error ?? `The office said ${res.status}` };
  } catch {
    return undefined;
  }
}

export const saveIncident = (id: string | undefined, body: unknown) => post(id ? `/api/incidents/${encodeURIComponent(id)}` : '/api/incidents', body);
export const noteIncident = (id: string, text: string) => post(`/api/incidents/${encodeURIComponent(id)}/note`, { text });

const field = (label: string, input: HTMLElement, hint?: string) => h('label.inc-field', {}, h('span.inc-label', {}, label), input, hint ? h('small.inc-hint', {}, hint) : null);
const select = <T extends string>(name: string, values: readonly T[], labels: Record<T, string>, value: T) => h('select', { name }, ...values.map((v) => h('option', { value: v, selected: v === value }, labels[v])));

/** One corrective action's row in the form. */
function actionRow(a: Partial<CorrectiveAction>, remove: (row: HTMLElement) => void): HTMLElement {
  const row: HTMLElement = h(
    'div.inc-action-edit',
    { 'data-id': a.id ?? '' },
    h('input', { name: 'text', value: a.text ?? '', placeholder: 'What will be done', 'aria-label': 'Corrective action' }),
    select('status', ACTION_STATUSES, { open: 'Open', done: 'Done', wontfix: "Won't do" }, a.status ?? 'open'),
    h('select', { name: 'linkKind', 'aria-label': 'Link kind' }, h('option', { value: '' }, 'No link'), ...ACTION_LINK_KINDS.map((k) => h('option', { value: k, selected: a.link?.kind === k }, k))),
    h('input', { name: 'linkRef', value: a.link?.ref ?? '', placeholder: 'Commit, #PR, issue, setting or URL', 'aria-label': 'Link' }),
    h('button.btn.inc-x', { type: 'button', title: 'Remove this action', 'aria-label': 'Remove this action', onclick: () => remove(row) }, '✕'),
  );
  return row;
}

function readActions(box: HTMLElement): CorrectiveAction[] {
  return [...box.querySelectorAll<HTMLElement>('.inc-action-edit')].map((row, n) => {
    const v = (name: string) => (row.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement).value.trim();
    const kind = v('linkKind');
    const ref = v('linkRef');
    return { id: row.dataset.id || `a${Date.now().toString(36)}${n}`, text: v('text'), status: v('status') as CorrectiveAction['status'], ...(kind && ref ? { link: { kind: kind as NonNullable<CorrectiveAction['link']>['kind'], ref } } : {}) };
  });
}

/** The form for a new incident (`id` missing) or for changing one; `saved` hears the incident as the office keeps it. */
export function incidentForm(id: string | undefined, d: IncidentDraft, floors: readonly FloorInfo[], saved: (i: Incident) => void) {
  const title = h('input', { name: 'title', value: d.title ?? '', required: true, maxlength: '160', placeholder: 'What went wrong, in a line' });
  const severity = select('severity', INCIDENT_SEVERITIES, SEVERITY_LABEL, d.severity ?? 'sev3');
  const status = select('status', INCIDENT_STATUSES, STATUS_LABEL, d.status ?? 'open');
  const summary = h('textarea', { name: 'summary', rows: '3', placeholder: 'What happened' });
  summary.value = d.summary ?? '';
  const rootCause = h('textarea', { name: 'rootCause', rows: '2', placeholder: 'Why it happened (needed to resolve it)' });
  rootCause.value = d.rootCause ?? '';
  const spend = h('input', { name: 'spendUsd', type: 'number', min: '0', step: '0.01', value: d.impact?.spendUsd ?? '', placeholder: '0.00' });
  const agents = h('input', { name: 'agents', type: 'number', min: '0', step: '1', value: d.impact?.agents ?? '' });
  const data = h('input', { name: 'data', value: d.impact?.data ?? '', placeholder: 'e.g. throwaway worktrees only' });
  const impactText = h('input', { name: 'impactText', value: d.impact?.text ?? '', placeholder: 'Anything else it affected' });
  const floorBox = h('div.inc-floor-picks', { role: 'group', 'aria-label': 'Floors' }, ...floors.filter((f) => !f.cloning).map((f) => h('label.inc-pick', {}, h('input', { type: 'checkbox', value: f.id, checked: d.floors?.includes(f.id) }), ` ${f.name}`)));
  const actions = h('div.inc-actions-edit');
  const remove = (row: HTMLElement) => row.remove();
  for (const a of d.actions ?? []) actions.append(actionRow(a, remove));
  const addAction = h('button.btn.inc-add', { type: 'button', onclick: () => actions.append(actionRow({}, remove)) }, '+ Corrective action');
  const err = h('p.inc-err', { role: 'alert' });
  const save = h('button.btn.primary', { type: 'submit' }, id ? 'Save' : 'Open incident');
  const form = h(
    'form.inc-form',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        if (!title.value.trim()) return void (err.textContent = 'An incident needs a title');
        save.setAttribute('disabled', '');
        const body = {
          title: title.value,
          severity: severity.value,
          ...(id ? { status: status.value } : {}),
          summary: summary.value,
          rootCause: rootCause.value,
          impact: { spendUsd: spend.value, agents: agents.value, data: data.value, text: impactText.value },
          floors: [...floorBox.querySelectorAll<HTMLInputElement>('input:checked')].map((x) => x.value),
          actions: readActions(actions),
          ...(id ? {} : { linkAudit: d.linkAudit ?? [], workers: d.workers ?? [], ...(d.detectedAt ? { detectedAt: d.detectedAt } : {}) }),
        };
        const r = await saveIncident(id, body);
        save.removeAttribute('disabled');
        if (!r?.incident) return void (err.textContent = r?.error ?? "Couldn't reach the office");
        modal.close();
        toast(id ? 'Incident saved' : 'Incident opened');
        saved(r.incident);
      },
    },
    h('header', {}, h('h2', {}, id ? 'Edit incident' : '🚨 New incident')),
    field('Title', title),
    h('div.inc-row2', {}, field('Severity', severity), id ? field('Status', status) : null),
    field('Summary', summary),
    h('fieldset.inc-impact', {}, h('legend', {}, 'Impact'), h('div.inc-row4', {}, field('Spend ($)', spend), field('Agents', agents), field('Data touched', data), field('Other', impactText))),
    field('Root cause', rootCause),
    floors.length ? h('fieldset', {}, h('legend', {}, 'Floors'), floorBox, h('small.inc-hint', {}, 'None ticked: the office as a whole')) : null,
    h('fieldset', {}, h('legend', {}, 'Corrective actions'), actions, addAction),
    d.linkAudit?.length ? h('p.inc-hint', {}, `Links ${d.linkAudit.length} audit event${d.linkAudit.length === 1 ? '' : 's'}`) : null,
    err,
    h('div.inc-buttons', {}, save),
  );
  const modal = openModal(h('div.panel.inc-modal', {}, form), { doing: id ? 'editing an incident' : 'opening an incident' });
  title.focus();
}

/** Resolving: the root cause is asked for (and kept if there already is one). */
export function resolveForm(i: Incident, saved: (i: Incident) => void) {
  const cause = h('textarea', { name: 'rootCause', rows: '4', required: true, placeholder: 'What caused it' });
  cause.value = i.rootCause ?? '';
  const err = h('p.inc-err', { role: 'alert' });
  const form = h(
    'form.inc-form',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        if (!cause.value.trim()) return void (err.textContent = 'Say what the root cause was');
        const r = await saveIncident(i.id, { status: 'resolved', rootCause: cause.value });
        if (!r?.incident) return void (err.textContent = r?.error ?? "Couldn't reach the office");
        modal.close();
        saved(r.incident);
      },
    },
    h('header', {}, h('h2', {}, `Resolve INC-${i.number}`)),
    field('Root cause', cause, 'Kept on the incident and in the audit log'),
    err,
    h('div.inc-buttons', {}, h('button.btn.primary', { type: 'submit' }, 'Resolve')),
  );
  const modal = openModal(h('div.panel.inc-modal.inc-narrow', {}, form), { doing: 'resolving an incident' });
  cause.focus();
}

/** The detection rules: each on or off, with its thresholds. */
export function rulesForm(s: IncidentSettings, saved: (s: IncidentSettings) => void) {
  const num = (rule: string, k: keyof RuleSetting, v: number | undefined, label: string, step = '1') => (v === undefined ? null : h('label.inc-num', {}, `${label} `, h('input', { type: 'number', min: '0', step, value: v, 'data-rule': rule, 'data-k': k })));
  const rows = INCIDENT_RULES.map((id) => {
    const r = s.rules[id];
    return h(
      'div.inc-rule',
      {},
      h('label.inc-rule-on', {}, h('input', { type: 'checkbox', checked: r.on, 'data-rule': id, 'data-k': 'on' }), h('b', {}, RULE_META[id].label)),
      h('small.inc-hint', {}, RULE_META[id].what),
      h('div.inc-nums', {}, num(id, 'count', r.count, 'count'), num(id, 'minutes', r.minutes, 'minutes'), num(id, 'factor', r.factor, '× average', '0.5'), num(id, 'minUsd', r.minUsd, 'at least $', '0.5'), num(id, 'absUsd', r.absUsd, 'or past $/h', '1')),
    );
  });
  const dedupe = h('input', { type: 'number', min: '1', step: '1', value: s.dedupeHours });
  const err = h('p.inc-err', { role: 'alert' });
  const form = h(
    'form.inc-form',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const next: IncidentSettings = structuredClone(s);
        next.dedupeHours = Number(dedupe.value) || s.dedupeHours;
        for (const el of form.querySelectorAll<HTMLInputElement>('input[data-rule]')) {
          const rule = next.rules[el.dataset.rule as keyof IncidentSettings['rules']];
          if (el.dataset.k === 'on') rule.on = el.checked;
          else (rule as unknown as Record<string, number>)[el.dataset.k!] = Number(el.value);
        }
        try {
          const res = await fetch('/api/incidents/settings', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
          if (!res.ok) return void (err.textContent = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't save");
          modal.close();
          toast('Detection rules saved');
          saved((await res.json()) as IncidentSettings);
        } catch {
          err.textContent = "Couldn't reach the office";
        }
      },
    },
    h('header', {}, h('h2', {}, 'Detection rules')),
    h('p.inc-hint', {}, 'Each rule opens an incident, or counts again into the open one from the same rule on the same floor.'),
    ...rows,
    field('Same incident if seen again within (hours)', dedupe),
    err,
    h('div.inc-buttons', {}, h('button.btn.primary', { type: 'submit' }, 'Save')),
  );
  const modal = openModal(h('div.panel.inc-modal', {}, form), { doing: 'tuning the incident rules' });
}
