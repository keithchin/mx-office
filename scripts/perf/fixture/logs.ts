// The append-only logs of the fixture: a floor's chatter (chatter/<floor>.jsonl and its state), its
// audit log (audit/<floor>.jsonl, hash-chained exactly as server/audit/log.ts writes it), the office's
// incidents (incidents/incidents.jsonl, chained as server/incidents/store.ts writes it) and the
// analysis runs (analysis/runs.jsonl and classes.json).

import type { RunRecord } from '../../../src/shared/analysis.js';
import type { AuditActor, AuditEvent, AuditSeverity } from '../../../src/shared/audit.js';
import type { ChatterKind, ChatterMessage, ChatterParty, ChatterTo } from '../../../src/shared/chatter.js';
import type { Incident, IncidentSeverity, IncidentStatus } from '../../../src/shared/incidents.js';
import { ROLE_BY_ID } from '../../../src/shared/roster/roles.js';
import { sha256 } from '../../../src/server/audit/log.js';
import type { RosterData } from '../../../src/server/roster/store.js';
import { DAY, Gen, HOUR, MIN, PEOPLE } from './gen.js';
import type { Cast } from './workers.js';

const KINDS: ChatterKind[] = ['relay', 'escalation', 'answer', 'journal', 'handoff', 'dispatch', 'review', 'standup', 'nudge', 'message'];

function party(g: Gen, cast: Cast): ChatterParty {
  const r = g.int(0, 9);
  if (r === 0) return { name: g.pick(PEOPLE), role: 'Project Manager', kind: 'human' };
  if (r === 1) return { name: 'The office', kind: 'office' };
  const w = g.pick(cast.workers);
  return { name: w.name, kind: 'agent', workerId: w.id, ...(w.role ? { roleId: w.role, team: ROLE_BY_ID.get(w.role)!.team, role: ROLE_BY_ID.get(w.role)!.title } : {}) };
}

/** `n` chatter messages over the last `days` days, oldest first, as JSONL; and the state with every roster source key seen. */
export function chatter(g: Gen, cast: Cast, roster: RosterData, n: number, days: number): { jsonl: string; state: string } {
  const lines: string[] = [];
  const step = (days * DAY) / Math.max(1, n);
  for (let i = 0; i < n; i++) {
    const at = Math.round(g.base - (n - i) * step);
    const kind = g.pick(KINDS);
    const to: ChatterTo = g.chance(0.3) ? { group: g.pick(['team', 'pm'] as const) } : party(g, cast);
    const m: ChatterMessage = { id: g.shortId(), at, floor: cast.floor, from: party(g, cast), to, kind, text: g.paragraph(g.int(1, 3), 14) };
    if (kind === 'escalation' || kind === 'answer') m.ref = { escalationId: g.pick(roster.escalations)?.id };
    else if (kind === 'standup') m.ref = { standup: Gen.day(at) };
    else if (kind === 'dispatch' || kind === 'review') m.ref = { subagent: g.pick(Object.values(roster.subagents))?.name };
    else if (g.chance(0.1)) m.ref = { pr: g.int(1, 400) };
    lines.push(JSON.stringify(m));
  }
  // What the roster source (chatter/sources.ts) would turn into messages, marked seen, so the office
  // doesn't add them all again at start.
  const seen: Record<string, number> = {};
  for (const e of roster.escalations) {
    seen[`esc:${e.id}`] = e.at;
    if (e.resolution) seen[`ans:${e.id}`] = e.resolution.at;
  }
  for (const p of roster.proposals) if (p.decidedAt) seen[`prop:${p.id}:${p.status}`] = p.decidedAt;
  for (const a of roster.subagentActions) {
    seen[`sa:${a.id}`] = a.at;
    if (a.decidedAt) seen[`sa-dec:${a.id}`] = a.decidedAt;
  }
  for (const s of roster.standups) {
    seen[`su:${s.id}`] = s.startedAt;
    seen[`sc:${s.id}`] = s.compiledAt ?? s.startedAt;
    for (const r of s.reports) seen[`sr:${s.id}:${r.role}`] = s.compiledAt ?? s.startedAt;
  }
  for (const [role, m] of Object.entries(roster.members)) {
    if (m.handoff) seen[`ho:${role}:${m.handoff.at}`] = m.handoff.at;
    if (m.workerId && m.handoff) seen[`hire:${role}:${m.workerId}`] = m.hiredAt ?? m.handoff.at;
  }
  for (const rec of Object.values(roster.subagents)) for (const r of rec.runs) if (r.reviewedAt) seen[`rv:${rec.lead}/${rec.name}:${r.id}:${r.reviewedAt}`] = r.reviewedAt;
  return { jsonl: lines.length ? `${lines.join('\n')}\n` : '', state: JSON.stringify({ seen, journals: {} }) };
}

const ACTIONS: [string, string][] = [
  ['worker.hire', 'worker'], ['worker.prompt', 'worker'], ['worker.stop', 'worker'], ['worker.resume', 'worker'], ['queue.add', 'task'], ['queue.start', 'task'],
  ['escalation.raise', 'escalation'], ['escalation.answer', 'escalation'], ['proposal.decide', 'proposal'], ['standup.run', 'standup'], ['subagent.review', 'subagent'],
  ['pr.open', 'pr'], ['pr.merge', 'pr'], ['issue.create', 'issue'], ['settings.change', 'settings'], ['judge.act', 'issue'], ['budget.book', 'budget'],
];

/** `n` audit events for `floor` (undefined: the office's own) over the last `days` days, as audit/log.ts would chain them. */
export function audit(g: Gen, cast: Cast | undefined, floor: string | undefined, n: number, days: number): string {
  const out: string[] = [];
  let prev = '';
  const step = (days * DAY) / Math.max(1, n);
  for (let i = 0; i < n; i++) {
    const at = Math.round(g.base - (n - i) * step);
    const [action, kind] = floor ? g.pick(ACTIONS) : g.pick([['login.ok', 'account'], ['settings.change', 'settings'], ['floor.add', 'floor'], ['account.create', 'account']] as [string, string][]);
    const w = cast ? g.pick(cast.workers) : undefined;
    const actor: AuditActor = g.chance(0.4) || !w ? { kind: 'human', name: g.pick(PEOPLE) } : g.chance(0.2) ? { kind: 'office', name: 'the office' } : { kind: 'agent', name: w.name, id: w.id };
    const severity: AuditSeverity = g.chance(0.05) ? 'warning' : g.chance(0.2) ? 'notice' : 'info';
    const id = `${at.toString(36).padStart(9, '0')}${(i % 1296).toString(36).padStart(2, '0')}${g.hex(6)}`;
    const body: Omit<AuditEvent, 'hash'> = {
      id,
      at,
      ...(floor ? { floor } : {}),
      actor,
      action,
      target: { kind, ...(w && kind === 'worker' ? { id: w.id } : {}), label: g.title() },
      summary: g.sentence(10),
      ...(g.chance(0.3) ? { details: { before: g.int(0, 9), after: g.int(0, 9), note: g.sentence(5) } } : {}),
      severity,
      prev,
    };
    const line = JSON.stringify({ ...body, hash: sha256(JSON.stringify(body)) });
    out.push(line);
    prev = sha256(line);
  }
  return out.length ? `${out.join('\n')}\n` : '';
}

const SEVERITIES: IncidentSeverity[] = ['sev1', 'sev2', 'sev3', 'sev3', 'near-miss', 'near-miss'];

/** `n` incidents, each created and then perhaps updated and resolved: the lines of incidents.jsonl, chained. */
export function incidents(g: Gen, floors: string[], n: number, days: number): string {
  type Line = { at: number; op: 'create' | 'update' | 'resolve'; by: string; incident: Incident };
  const lines: Line[] = [];
  for (let i = 0; i < n; i++) {
    const detectedAt = Math.round(g.base - (n - i) * ((days * DAY) / Math.max(1, n)));
    const by = g.chance(0.6) ? 'the office' : g.pick(PEOPLE);
    const rule = g.pick(['spendSpike', 'crashLoop', 'interrupted', 'escalationUndelivered', 'flowFailed', 'sweepErrors'] as const);
    const auto = by === 'the office';
    const inc: Incident = {
      id: `inc-${g.hex(14)}`,
      number: i + 1,
      title: `${g.title()} ${g.pick(['failed', 'stalled', 'ran over budget', 'crashed twice'])}`,
      severity: g.pick(SEVERITIES),
      status: 'open',
      detectedAt,
      detectedBy: auto ? { kind: 'rule', name: rule, rule } : { kind: 'person', name: by },
      floors: g.chance(0.85) ? [g.pick(floors)] : [],
      summary: g.paragraph(2),
      impact: { ...(g.chance(0.5) ? { spendUsd: Math.round(g.rand() * 5000) / 100 } : {}), agents: g.int(0, 4), text: g.sentence(7) },
      timeline: [{ at: detectedAt, by, text: g.sentence(8), kind: 'detected' }],
      actions: [{ id: 'a1', text: g.sentence(7), status: 'open' }],
      auditIds: [],
      workers: [],
      ...(auto ? { dedupeKey: `${rule}:${g.pick(floors)}:${i}` } : {}),
      occurrences: 1,
      lastSeenAt: detectedAt,
      createdAt: detectedAt,
      updatedAt: detectedAt,
    };
    lines.push({ at: detectedAt, op: 'create', by, incident: structuredClone(inc) });
    let at = detectedAt;
    const end: IncidentStatus = g.pick(['open', 'mitigated', 'resolved', 'resolved']);
    if (end !== 'open') {
      at += g.int(10, 600) * MIN;
      inc.status = end;
      inc.rootCause = g.sentence(10);
      inc.timeline.push({ at, by: g.pick(PEOPLE), text: `Status: ${end}`, kind: 'status' });
      inc.updatedAt = at;
      if (end === 'resolved') {
        inc.resolvedAt = at;
        inc.actions[0].status = 'done';
      }
      lines.push({ at, op: end === 'resolved' ? 'resolve' : 'update', by: g.pick(PEOPLE), incident: structuredClone(inc) });
    }
  }
  lines.sort((a, b) => a.at - b.at);
  const out: string[] = [];
  for (const l of lines) {
    const body = { ...l, prev: out.length ? sha256(out[out.length - 1]) : '' };
    out.push(JSON.stringify({ ...body, hash: sha256(JSON.stringify(body)) }));
  }
  return out.length ? `${out.join('\n')}\n` : '';
}

const TYPES = ['domain-model', 'ui-pages', 'logic', 'security'] as const;

/** `n` analysis runs for the floor's past workers (analysis/store.ts) and the classifier's cache for them. */
export function analysis(g: Gen, cast: Cast, n: number, days: number): { runs: RunRecord[]; classes: Record<string, unknown> } {
  const runs: RunRecord[] = [];
  const classes: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    const workerId = i < cast.workers.length ? cast.workers[i].id : g.workerId();
    const startedAt = g.ago(days, HOUR);
    const durationMs = g.int(2, 300) * MIN;
    const model = g.pick(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']);
    const issue = g.int(1, 500);
    const outcome = g.pick(['merged', 'merged', 'open', 'closed', 'no-pr'] as const);
    const apiCalls = g.int(3, 600);
    const types = g.some(TYPES, 0.4);
    const r: RunRecord = {
      id: `${cast.floor}:${workerId}`,
      floor: cast.floor,
      worker: i < cast.workers.length ? cast.workers[i].name : g.pick(cast.workers).name,
      workerId,
      provider: 'claude',
      model,
      modelLabel: model.includes('opus') ? 'Opus 5.5' : model.includes('haiku') ? 'Haiku 4.5' : 'Sonnet 5.5',
      title: g.title(),
      issue,
      prompt: `Work on GitHub issue #${issue}: ${g.sentence(10)}`,
      startedAt,
      endedAt: startedAt + durationMs,
      durationMs,
      activeMs: Math.round(durationMs * (0.3 + g.rand() * 0.6)),
      apiCalls,
      toolCalls: Math.round(apiCalls * 0.8),
      tokens: { input: apiCalls * 300, output: apiCalls * 250, cacheWrite: apiCalls * 8000, cacheRead: apiCalls * 40000 },
      cost: Math.round(apiCalls * (0.005 + g.rand() * 0.05) * 1e4) / 1e4,
      humanPrompts: g.int(0, 4),
      needsInput: g.int(0, 3),
      needsInputMs: g.int(0, 30) * MIN,
      outcome,
      ...(outcome !== 'no-pr' ? { pr: { number: 500 + i, url: `https://github.invalid/example/${cast.floor}/pull/${500 + i}`, title: g.title(), state: outcome === 'merged' ? 'MERGED' : outcome === 'open' ? 'OPEN' : 'CLOSED', additions: g.int(5, 2000), deletions: g.int(0, 800), changedFiles: g.int(1, 40) } } : {}),
      types: [...types],
      typesBy: 'keywords',
      note: g.sentence(12),
      ...(outcome === 'no-pr' && apiCalls < 10 ? { excluded: 'no pull request and under 10 API calls' } : {}),
      updatedAt: startedAt + durationMs + HOUR,
    };
    runs.push(r);
    classes[r.id] = { hash: g.hex(16), types: r.types, note: r.note, by: 'keywords' };
  }
  return { runs, classes };
}

