// A Lead's subagents with their track record (the org chart under each Lead, and compact on its team's
// board): name, model, grade A–F, runs, accept rate, reworks, where it stands (active, on warning,
// benched until…), and for the Project Manager Warn, Bench, Swap model and Reinstate. Also the card a
// Lead's proposed subagent action gets in the approvals.

import type { RoleId } from '../../../shared/roster/roles';
import { modelWord, OP_ASK, OP_ICON, type SubagentAction, type SubagentView } from '../../../shared/roster/subagents';
import type { RosterView } from '../../../shared/roster/types';
import { h, timeAgo } from '../dom';
import { act } from './api';
import { askText } from './ask';

const SWAP_MODELS = ['haiku', 'sonnet', 'opus', 'inherit'].map((value) => ({ value, label: value === 'inherit' ? "Inherit (the Lead's)" : modelWord(value) }));

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function statePill(s: SubagentView): HTMLElement {
  if (s.state === 'benched') return h('span.sa-pill.sa-benched', { title: s.benchReason ?? '' }, `🪑 benched${s.benchedUntil ? ` until ${hhmm(s.benchedUntil)}` : ''}`);
  if (s.state === 'warning') return h('span.sa-pill.sa-warning', { title: s.lastWarning ?? '' }, '⚠️ warning');
  return h('span.sa-pill.sa-active', {}, 'active');
}

/** The Project Manager's Warn, Bench, Model and Reinstate for a subagent (also on its card's detail: ui/subagents/). Null for anyone else. */
export function subagentActions(v: RosterView, s: SubagentView, redraw: (v: RosterView) => void): HTMLElement | null {
  const run = (op: string, extra: Record<string, unknown> = {}) => void act(v.floor, 'subagent', { role: s.lead, name: s.name, op, ...extra }).then((r) => r && redraw(r));
  const lead = v.members.find((m) => m.role === s.lead);
  return v.admin
    ? h(
        'span.sa-actions',
        {},
        h('button.btn.small', { type: 'button', title: `Add a warning to ${s.name}'s definition`, onclick: () => askText({ title: `Warn ${s.name}`, label: `What went wrong? It goes into ${s.name}'s definition for its next runs`, long: true, ok: '⚠️ Warn' }, (reason) => run('warn', { reason })) }, '⚠️ Warn'),
        s.state !== 'benched' ? h('button.btn.small', { type: 'button', title: `Take ${s.name} off ${lead?.name ?? 'its Lead'}'s team until its cool-down ends`, onclick: () => askText({ title: `Bench ${s.name}`, label: 'Why? The Lead is told, and the Playbook says not to dispatch it', long: true, ok: '🪑 Bench' }, (reason) => run('bench', { reason })) }, '🪑 Bench') : null,
        h('button.btn.small', { type: 'button', title: `Set ${s.name}'s model`, onclick: () => askText({ title: `${s.name}'s model`, label: 'Written into its definition (model:)', ok: 'Save', pickOnly: true, pick: { label: 'Model', options: SWAP_MODELS, value: s.model } }, (_, model) => model && model !== s.model && run('swap-model', { model })) }, '🔁 Model'),
        s.state !== 'active' ? h('button.btn.small.ro-approve', { type: 'button', title: 'Back on the team (its warning notes stay)', onclick: () => run('reinstate') }, '✅ Reinstate') : null,
      )
    : null;
}

function subagentRow(v: RosterView, s: SubagentView, redraw: (v: RosterView) => void, compact: boolean): HTMLElement {
  const sc = s.score;
  const pct = sc.reviewed ? Math.round((100 * sc.accepted) / sc.reviewed) : undefined;
  const buttons = compact ? null : subagentActions(v, s, redraw);
  return h(
    'li.sa-row',
    { class: `sa-${s.state}`, 'data-subagent': s.name },
    h('span.sa-grade', { class: `sa-g-${sc.grade ?? 'none'}`, title: sc.grade ? `${sc.score}% accepted over the last ${sc.reviewed} reviewed runs` : `Graded from 3 reviewed runs (${sc.reviewed} so far)` }, sc.grade ?? '–'),
    h('span.sa-who', {}, h('b', {}, s.name), h('span.sa-model', {}, modelWord(s.model))),
    h('span.sa-stats', {}, `${sc.runs} run${sc.runs === 1 ? '' : 's'}`, pct !== undefined ? ` · ${pct}% accepted` : '', ` · ${sc.reworks} rework${sc.reworks === 1 ? '' : 's'}`, sc.underperforming ? h('span.sa-flag', { title: sc.why ?? '' }, ' · 📉') : null),
    statePill(s),
    buttons,
  );
}

/** One Lead's subagents; `compact` for a team's board (no buttons). */
export function subagentList(v: RosterView, lead: RoleId, redraw: (v: RosterView) => void, compact = false): HTMLElement | null {
  const rows = (v.subagents ?? []).filter((s) => s.lead === lead);
  if (!rows.length) return null;
  return h('div.sa-box', { class: compact ? 'sa-compact' : '' }, compact ? null : h('span.ro-journal-h', {}, '👥 Subagents'), h('ul.sa-list', {}, ...rows.map((s) => subagentRow(v, s, redraw, compact))));
}

/** A Lead's proposed subagent action, for the Project Manager to approve or reject. */
export function subagentActionCard(v: RosterView, a: SubagentAction, redraw: (v: RosterView) => void): HTMLElement {
  const decide = (decision: 'approve' | 'reject', reason?: string) => void act(v.floor, 'subagent-decide', { id: a.id, decision, reason }).then((r) => r && redraw(r));
  const lead = v.members.find((m) => m.role === a.lead);
  const s = v.subagents.find((x) => x.lead === a.lead && x.name === a.name);
  const track = s ? `${modelWord(s.model)} · ${s.score.grade ? `grade ${s.score.grade}` : 'ungraded'} · ${s.score.runs} runs · ${s.score.reworks} reworks${s.score.why ? ` · ${s.score.why}` : ''}` : '';
  return h(
    'article.ro-prop.ro-prop-pending',
    { 'data-action': a.id },
    h('div.ro-prop-h', {}, h('span.ro-kind', {}, 'subagent'), h('b.ro-prop-title', {}, `${OP_ICON[a.op]} ${a.by} proposes to ${OP_ASK[a.op]} ${a.name}${a.op === 'swap-model' && a.model ? ` → ${modelWord(a.model)}` : ''}`), h('span.ro-prop-state', {}, a.status === 'pending' ? '⏳ Awaiting you' : a.status)),
    a.reason ? h('p.ro-prop-detail', {}, a.reason) : null,
    h('p.ro-prop-meta', {}, `${lead?.title ?? a.lead} · ${timeAgo(a.at)}${track ? ` · ${track}` : ''}`),
    a.status === 'pending' && v.admin
      ? h(
          'div.ro-actions',
          {},
          h('button.btn.small.ro-approve', { type: 'button', onclick: () => decide('approve') }, '✅ Approve'),
          h('button.btn.small', { type: 'button', onclick: () => askText({ title: `Reject: ${OP_ASK[a.op]} ${a.name}`, label: `Why? ${a.by} is told`, long: true, ok: '❌ Reject', optional: true }, (r) => decide('reject', r || undefined)) }, '❌ Reject'),
        )
      : null,
  );
}
