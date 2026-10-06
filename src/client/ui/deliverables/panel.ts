import './deliverables.css';
// 📦 Deliverables, as a checklist (shared/deliverables.ts): a team's expected outputs grouped by toolkit
// stage, each on main, on a branch not merged yet (with the branch and who), a draft, or missing, and
// the files under it, which open in the viewer (viewer.ts). The team pages put it in a panel; the
// Command Center's setup panel shows a line of counts per stage (summary.ts) that opens the whole
// floor's list in a window.

import {
  DELIVERABLE_STAGES,
  DELIVERABLES,
  STAGE_TITLE,
  stageCounts,
  type DeliverableFile,
  type DeliverableItem,
  type DeliverablesView,
  type DeliverableStatus,
} from '../../../shared/deliverables';
import { TEAM_META } from '../../../shared/roster/card-team';
import { ROLE_BY_ID } from '../../../shared/roster/roles';
import { staleText } from '../../../shared/wizard';
import { h, timeAgo } from '../dom';
import { openDeliverable, whereText } from './viewer';

export const STATUS_TEXT: Record<DeliverableStatus, string> = { present: 'On main', branch: 'On a branch', draft: 'Draft', missing: 'Missing' };
const KIND_TAG: Record<string, string> = { html: 'HTML', md: 'MD', pdf: 'PDF', image: 'IMG', xlsx: 'XLSX', csv: 'CSV', json: 'JSON', text: 'TXT' };
/** Files shown under an item before "n more". */
const SHOWN = 4;

function fileRow(floor: string, f: DeliverableFile, view: DeliverablesView): HTMLElement {
  const w = f.where[0];
  const meta = [f.status === 'present' ? '' : whereText(w), f.where.length > 1 ? (f.status === 'present' ? `other versions on ${f.where.length - 1} branch${f.where.length > 2 ? 'es' : ''}` : `also on ${f.where.length - 1} more`) : '', f.mtime ? timeAgo(f.mtime) : ''].filter(Boolean).join(' · ');
  return h(
    'li.dv-file',
    { class: `dv-${f.status}` },
    h('span.dv-tag', {}, KIND_TAG[f.kind] ?? f.kind),
    h('button.tm-link.dv-open', { type: 'button', title: `Open ${f.path}`, onclick: () => openDeliverable(floor, f, view) }, f.path),
    meta ? h('span.dv-file-meta', {}, meta) : null,
  );
}

function itemRow(floor: string, item: DeliverableItem, view: DeliverablesView, showTeam: boolean): HTMLElement {
  const spec = DELIVERABLES.find((d) => d.id === item.id);
  const status = item.status === 'missing' && item.optional ? 'optional' : item.status;
  const branchy = item.files.find((f) => f.status !== 'present')?.where[0];
  const files = item.files;
  const list = files.length ? h('ul.dv-files', {}, ...files.slice(0, SHOWN).map((f) => fileRow(floor, f, view))) : null;
  const rest = files.length > SHOWN || item.more ? h('details.dv-more', {}, h('summary', {}, `${files.length - SHOWN + (item.more ?? 0)} more`), h('ul.dv-files', {}, ...files.slice(SHOWN).map((f) => fileRow(floor, f, view))), item.more ? h('p.dv-dim', {}, `…and ${item.more} not listed.`) : null) : null;
  return h(
    'li.dv-item',
    { class: `dv-${status}`, 'data-item': item.id },
    h(
      'div.dv-item-head',
      {},
      h('span.dv-badge', { class: `dv-${status}` }, status === 'optional' ? 'Optional' : STATUS_TEXT[item.status]),
      h('b.dv-title', {}, item.title),
      showTeam ? h('span.dv-team', { class: `tm-${item.team}` }, TEAM_META[item.team].name) : null,
      item.owner && !showTeam ? h('span.dv-owner', {}, ROLE_BY_ID.get(item.owner)?.title ?? '') : null,
    ),
    item.status === 'branch' && branchy ? h('p.dv-note', {}, `Not merged: ${whereText(branchy)}. It counts once its pull request lands.`) : null,
    item.status === 'missing' && spec ? h('p.dv-note', {}, 'Expected at ', ...spec.globs.flatMap((g, i) => [i ? ', ' : '', h('code', {}, g)])) : null,
    item.id === 'unsorted-reports' ? h('p.dv-note', {}, 'Reports straight under ', h('code', {}, 'reports/'), " that are no analyst report: each team keeps its own in ", h('code', {}, 'reports/<team>/'), '.') : null,
    list,
    rest,
  );
}

/** The checklist for `view`'s items (one team's, or all with `showTeam`). */
export function deliverablesList(floor: string, view: DeliverablesView | undefined, showTeam = false): HTMLElement {
  if (!view) return h('p.tm-dim', {}, 'Looking for deliverables…');
  const groups: HTMLElement[] = [];
  const counts = new Map(stageCounts(view.items).map((c) => [c.stage, c]));
  for (const stage of DELIVERABLE_STAGES) {
    const items = view.items.filter((i) => i.stage === stage);
    if (!items.length) continue;
    const c = counts.get(stage);
    groups.push(
      h(
        'section.dv-stage',
        { 'data-stage': stage },
        h('h4.dv-stage-h', {}, h('span.dv-stage-id', {}, stage), STAGE_TITLE[stage], c ? h('span.dv-count', {}, `${c.present}/${c.expected} on main${c.branch ? ` · ${c.branch} on a branch` : ''}${c.draft ? ` · ${c.draft} draft` : ''}`) : null),
        h('ul.dv-items', {}, ...items.map((i) => itemRow(floor, i, view, showTeam))),
      ),
    );
  }
  const extras = view.items.filter((i) => !i.stage && i.files.length);
  if (extras.length) groups.push(h('section.dv-stage', { 'data-stage': 'extras' }, h('h4.dv-stage-h', {}, h('span.dv-stage-id', {}, '+'), 'Beyond the toolkit'), h('ul.dv-items', {}, ...extras.map((i) => itemRow(floor, { ...i, title: showTeam && i.id.startsWith('extras-') ? 'More files' : i.title }, view, showTeam)))));
  const mainName = view.main ?? 'main';
  const looked = view.sources.length ? `Looked on ${mainName}, ${view.sources.map((s) => (s.src.startsWith('wt:') ? s.label : s.branch)).join(', ')}.` : `Looked on ${mainName} (no team worktrees or office branches with deliverables).`;
  // On main is origin/<default>: say so when the floor's folder is elsewhere.
  const note = view.checkout ? h('p.dv-stale', { role: 'note' }, '⚠️ ', staleText(view.checkout, '"On main" below is')) : null;
  return h('div.dv', {}, note, ...groups, h('p.dv-foot', {}, `${looked} Merged work is the source of truth; branch work shows here so you can see it early.`));
}
