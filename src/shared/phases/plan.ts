// The phase plan's rules, pure (shared/phases/types.ts): reading a stored plan back safely, turning the team's
// proposed phases into phases, and applying edits (PhaseOp) the same way on the page (the editors' preview) and
// on the server (what is saved). Done phases are locked: no edit touches them. A row and a journey belong to
// one phase. Every edit set comes with its words, for the change history.

import { LIMITS, emptyPlan, type ChangeKind, type Phase, type PhaseDraft, type PhaseLite, type PhaseOp, type PhasePlan, type PhaseStatus, PHASE_STATUSES } from './types.js';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));
const money = (v: unknown) => Math.max(0, Math.min(1e7, Math.round(num(v) || 0)));
const ints = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.map((x) => Math.trunc(num(x))).filter((n) => Number.isInteger(n) && n > 0 && n < 1e6))].sort((a, b) => a - b).slice(0, max) : []);
const words = (v: unknown, max: number, each = 40) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, each)).filter(Boolean))].slice(0, max) : []);
const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** A phase read back from disk or a request, with everything in range. */
export function cleanPhase(v: unknown, i: number): Phase {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const est = (o.estimate ?? {}) as Record<string, unknown>;
  const min = money(est.min);
  const max = Math.max(min, money(est.max));
  const status = PHASE_STATUSES.includes(o.status as PhaseStatus) ? (o.status as PhaseStatus) : 'planned';
  const early = o.early && typeof o.early === 'object' ? (o.early as Record<string, unknown>) : undefined;
  const id = /^ph-\d{1,4}$/.test(String(o.id)) ? String(o.id) : `ph-${i + 1}`;
  return {
    id,
    name: str(o.name, LIMITS.name) || `Phase ${i + 1}`,
    goal: str(o.goal, LIMITS.goal),
    foundation: o.foundation === true,
    rows: ints(o.rows, LIMITS.rows),
    useCases: words(o.useCases, 60),
    journeys: words(o.journeys, LIMITS.journeys),
    estimate: { min, max },
    ...(num(o.days) > 0 ? { days: Math.min(365, Math.round(num(o.days))) } : {}),
    checkpoint: o.checkpoint !== false,
    publish: o.publish !== false,
    status,
    overlapsWith: words(o.overlapsWith, LIMITS.phases, 10).filter((x) => /^ph-\d+$/.test(x) && x !== id),
    ...(early && time(early.since) ? { early: { since: time(early.since)!, teams: words(early.teams, 6, 20), what: str(early.what, 40) || 'design' } } : {}),
    ...(time(o.startedAt) ? { startedAt: time(o.startedAt) } : {}),
    ...(time(o.endedAt) ? { endedAt: time(o.endedAt) } : {}),
    ...(o.exit && typeof o.exit === 'object' ? { exit: o.exit as Phase['exit'] } : {}),
    ...(o.deploy && typeof o.deploy === 'object' ? { deploy: o.deploy as Phase['deploy'] } : {}),
    ...(typeof o.reportDocId === 'string' ? { reportDocId: o.reportDocId.slice(0, 200) } : {}),
  };
}

/** A stored plan read back: anything missing or broken is the empty plan's. */
export function cleanPlan(v: unknown): PhasePlan {
  const base = emptyPlan();
  if (!v || typeof v !== 'object') return base;
  const o = v as Record<string, unknown>;
  const prefs = (o.prefs ?? {}) as Record<string, unknown>;
  const env = prefs.envelope as unknown;
  const phases = Array.isArray(o.phases) ? o.phases.slice(0, LIMITS.phases).map(cleanPhase) : [];
  const seen = new Set<string>();
  for (const p of phases) {
    if (seen.has(p.id)) p.id = nextPhaseId(phases);
    seen.add(p.id);
  }
  const cut = o.cutover as Record<string, unknown> | undefined;
  return {
    version: 1,
    delivery: o.delivery === 'phases' ? 'phases' : 'one-go',
    prefs: {
      publishAtPhaseEnd: prefs.publishAtPhaseEnd !== false,
      checkpointAtPhaseEnd: prefs.checkpointAtPhaseEnd !== false,
      envelope: env && typeof env === 'object' && num((env as { warnAbove?: unknown }).warnAbove) > 0 ? { warnAbove: money((env as { warnAbove: unknown }).warnAbove) } : 'team-estimate',
    },
    state: o.state === 'proposed' || o.state === 'approved' ? o.state : 'none',
    phases,
    ...(cut && typeof cut === 'object' ? { cutover: { min: money(cut.min), max: Math.max(money(cut.min), money(cut.max)), ...(num(cut.days) > 0 ? { days: Math.round(num(cut.days)) } : {}) } } : {}),
    changes: Array.isArray(o.changes) ? (o.changes as PhasePlan['changes']).slice(-LIMITS.changes) : [],
    proposals: Array.isArray(o.proposals) ? (o.proposals as PhasePlan['proposals']).slice(-LIMITS.proposals) : [],
    ...(time(o.approvedAt) ? { approvedAt: time(o.approvedAt) } : {}),
  };
}

/** The next free phase id. */
export function nextPhaseId(phases: readonly Pick<Phase, 'id'>[]): string {
  const n = phases.reduce((m, p) => Math.max(m, Number(/^ph-(\d+)$/.exec(p.id)?.[1] ?? 0)), 0);
  return `ph-${n + 1}`;
}

export const nextChangeId = (plan: Pick<PhasePlan, 'changes'>) => `C-${plan.changes.reduce((m, c) => Math.max(m, Number(/^C-(\d+)$/.exec(c.id)?.[1] ?? 0)), 0) + 1}`;
export const nextProposalId = (plan: Pick<PhasePlan, 'proposals'>) => `P-${plan.proposals.reduce((m, c) => Math.max(m, Number(/^P-(\d+)$/.exec(c.id)?.[1] ?? 0)), 0) + 1}`;

/** A team's draft, checked: why it can't be taken, or the drafts cleaned. */
export function checkDrafts(v: unknown): PhaseDraft[] | string {
  if (!Array.isArray(v) || !v.length) return 'Give the phases: a list of { name, goal, rows, journeys, estimate: { min, max } }';
  if (v.length > LIMITS.phases) return `At most ${LIMITS.phases} phases`;
  const out = v.map((d, i) => {
    const p = cleanPhase({ ...(d as object), id: `ph-${i + 1}`, status: 'planned' }, i);
    return { name: p.name, goal: p.goal, foundation: p.foundation, rows: p.rows, useCases: p.useCases, journeys: p.journeys, estimate: p.estimate, ...(p.days ? { days: p.days } : {}), checkpoint: p.checkpoint, publish: p.publish } satisfies PhaseDraft;
  });
  const rowOwner = new Map<number, number>();
  for (const [i, d] of out.entries()) {
    if (!(v[i] as { name?: unknown })?.name) return `Phase ${i + 1} needs a name`;
    for (const r of d.rows) {
      if (rowOwner.has(r)) return `Row ${r} is in two phases (${rowOwner.get(r)! + 1} and ${i + 1}): a row belongs to one phase`;
      rowOwner.set(r, i);
    }
  }
  const jOwner = new Map<string, number>();
  for (const [i, d] of out.entries())
    for (const j of d.journeys ?? []) {
      if (jOwner.has(j)) return `Journey ${j} is in two phases (${jOwner.get(j)! + 1} and ${i + 1}): a journey belongs to one phase; later phases re-run it as regression`;
      jOwner.set(j, i);
    }
  return out;
}

/** The drafts as planned phases (ph-1, ph-2… in order), the plan's switches as their defaults. */
export function phasesOfDrafts(drafts: readonly PhaseDraft[]): Phase[] {
  return drafts.map((d, i) => cleanPhase({ ...d, id: `ph-${i + 1}`, status: 'planned', overlapsWith: [] }, i));
}

export const lite = (phases: readonly Phase[]): PhaseLite[] => phases.map((p) => ({ id: p.id, name: p.name, rows: [...p.rows], status: p.status, checkpoint: p.checkpoint, publish: p.publish }));

/** "3 Events": a phase's place and name, as the history says it. */
export const phaseWord = (phases: readonly Pick<Phase, 'id' | 'name'>[], id: string) => {
  const i = phases.findIndex((p) => p.id === id);
  return i < 0 ? id : `${i + 1} ${phases[i].name}`;
};

const rowsWord = (rows: readonly number[]) => (rows.length === 1 ? `row ${rows[0]}` : `rows ${rows.join(', ')}`);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

const OP_KIND: Record<PhaseOp['op'], ChangeKind> = { rename: 'rename', 'move-rows': 'move-rows', reorder: 'reorder', split: 'split', merge: 'merge', toggle: 'toggle', overlap: 'overlap', estimate: 'estimate', journeys: 'edit', add: 'add' };

/** The change's kind: the one op's, or 'edit' for several kinds. */
export function kindOf(ops: readonly PhaseOp[]): ChangeKind {
  const kinds = new Set(ops.map((o) => OP_KIND[o.op]));
  return kinds.size === 1 ? [...kinds][0] : 'edit';
}

/** One op in words, against the phases before it. */
export function opWords(o: PhaseOp, before: readonly Phase[]): string {
  const w = (id: string) => phaseWord(before, id);
  switch (o.op) {
    case 'rename':
      return o.name ? `Renamed ${w(o.phase)} to ${o.name}` : `Changed the goal of ${w(o.phase)}`;
    case 'move-rows': {
      const from = [...new Set(o.rows.map((r) => before.find((p) => p.rows.includes(r))?.id).filter((x): x is string => !!x))];
      return `Moved ${rowsWord(o.rows)}${from.length ? ` from ${list(from.map(w))}` : ''} to ${w(o.to)}`;
    }
    case 'reorder':
      return `Reordered the phases: ${o.order.map((id) => before.find((p) => p.id === id)?.name ?? id).join(', ')}`;
    case 'split':
      return `Split ${w(o.phase)}: ${rowsWord(o.rows)} into a new phase ${o.name}`;
    case 'merge':
      return `Merged ${list(o.phases.map(w))}`;
    case 'toggle': {
      const parts = [o.checkpoint !== undefined ? `checkpoint ${o.checkpoint ? 'on' : 'off'}` : '', o.publish !== undefined ? `publish ${o.publish ? 'on' : 'off'}` : '', o.foundation !== undefined ? `foundation ${o.foundation ? 'on' : 'off'}` : ''].filter(Boolean);
      return `Turned ${parts.join(', ')} for ${w(o.phase)}`;
    }
    case 'overlap':
      return `${w(o.phase)} starts early (${o.what}), overlapping the phase in progress`;
    case 'estimate':
      return `Estimate for ${w(o.phase)}: $${o.min}–${o.max}${o.days ? `, ${o.days} days` : ''}`;
    case 'journeys':
      return `Journeys for ${w(o.phase)}: ${o.journeys.join(', ') || 'none'}`;
    case 'add':
      return `Added a phase ${o.name}`;
  }
}

/** The words for a set of ops: same-kind toggles folded ("Checkpoint turned off for 6 Platform and 7 Extras"). */
export function opsWords(ops: readonly PhaseOp[], before: readonly Phase[]): string {
  const toggles = ops.filter((o): o is Extract<PhaseOp, { op: 'toggle' }> => o.op === 'toggle');
  const sameToggle = toggles.length > 1 && toggles.length === ops.length && toggles.every((t) => t.checkpoint === toggles[0].checkpoint && t.publish === toggles[0].publish && t.foundation === toggles[0].foundation);
  if (sameToggle) {
    const what = toggles[0].checkpoint !== undefined ? `Checkpoint turned ${toggles[0].checkpoint ? 'on' : 'off'}` : toggles[0].publish !== undefined ? `Publish turned ${toggles[0].publish ? 'on' : 'off'}` : `Foundation turned ${toggles[0].foundation ? 'on' : 'off'}`;
    return `${what} for ${list(toggles.map((t) => phaseWord(before, t.phase)))}`;
  }
  return ops.map((o) => opWords(o, before)).join('; ');
}

const locked = (p: Phase | undefined) => !!p && (p.status === 'done' || p.status === 'stopped');

/**
 * Applies `ops` in order to a copy of `phases`; the phases after, or why an op can't be applied (done phases are
 * locked; a row or journey belongs to one phase). `now` dates a phase started early.
 */
export function applyOps(phases: readonly Phase[], ops: readonly PhaseOp[], now: number): Phase[] | string {
  let ps: Phase[] = structuredClone(phases as Phase[]);
  const get = (id: string) => ps.find((p) => p.id === id);
  const open = (id: string, what: string): Phase | string => {
    const p = get(id);
    if (!p) return `There is no phase ${id}`;
    if (locked(p)) return `${p.name} is ${p.status}: done phases are locked (${what})`;
    return p;
  };
  if (!ops.length) return 'Nothing to change';
  for (const o of ops) {
    switch (o.op) {
      case 'rename': {
        const p = open(o.phase, 'rename');
        if (typeof p === 'string') return p;
        if (o.name !== undefined) {
          const n = str(o.name, LIMITS.name);
          if (!n) return 'A phase needs a name';
          p.name = n;
        }
        if (o.goal !== undefined) p.goal = str(o.goal, LIMITS.goal);
        break;
      }
      case 'move-rows': {
        const to = open(o.to, 'move rows into it');
        if (typeof to === 'string') return to;
        const rows = ints(o.rows, LIMITS.rows);
        if (!rows.length) return 'Say which rows to move';
        for (const r of rows) {
          const from = ps.find((p) => p.rows.includes(r));
          if (from && locked(from)) return `Row ${r} is in ${from.name}, which is ${from.status}: done phases are locked`;
          if (from) from.rows = from.rows.filter((x) => x !== r);
        }
        to.rows = [...new Set([...to.rows, ...rows])].sort((a, b) => a - b);
        break;
      }
      case 'reorder': {
        const ids = o.order;
        if (ids.length !== ps.length || new Set(ids).size !== ids.length || ids.some((id) => !get(id))) return 'The new order must name every phase once';
        const next = ids.map((id) => get(id)!);
        for (const [i, p] of ps.entries()) if (locked(p) && next[i].id !== p.id) return `${p.name} is ${p.status}: done phases keep their place`;
        ps = next;
        break;
      }
      case 'split': {
        const p = open(o.phase, 'split');
        if (typeof p === 'string') return p;
        const rows = ints(o.rows, LIMITS.rows).filter((r) => p.rows.includes(r));
        if (!rows.length || rows.length >= p.rows.length) return `Split ${p.name} by naming some of its rows (not all) for the new phase`;
        const name = str(o.name, LIMITS.name);
        if (!name) return 'The new phase needs a name';
        if (ps.length >= LIMITS.phases) return `At most ${LIMITS.phases} phases`;
        p.rows = p.rows.filter((r) => !rows.includes(r));
        const share = rows.length / (rows.length + p.rows.length);
        const est = { min: Math.round(p.estimate.min * share), max: Math.round(p.estimate.max * share) };
        p.estimate = { min: p.estimate.min - est.min, max: p.estimate.max - est.max };
        const fresh: Phase = { id: nextPhaseId(ps), name, goal: str(o.goal, LIMITS.goal), foundation: false, rows, useCases: [], journeys: [], estimate: est, ...(p.days ? { days: Math.max(1, Math.round(p.days * share)) } : {}), checkpoint: p.checkpoint, publish: p.publish, status: 'planned', overlapsWith: [] };
        if (p.days) p.days = Math.max(1, p.days - (fresh.days ?? 0));
        ps.splice(ps.indexOf(p) + 1, 0, fresh);
        break;
      }
      case 'merge': {
        const ids = [...new Set(o.phases)];
        if (ids.length < 2) return 'Name two or more phases to merge';
        const all: Phase[] = [];
        for (const id of ids) {
          const p = open(id, 'merge');
          if (typeof p === 'string') return p;
          all.push(p);
        }
        all.sort((a, b) => ps.indexOf(a) - ps.indexOf(b));
        const [keep, ...rest] = all;
        for (const r of rest) {
          keep.rows = [...new Set([...keep.rows, ...r.rows])].sort((a, b) => a - b);
          keep.journeys = [...new Set([...keep.journeys, ...r.journeys])];
          keep.useCases = [...new Set([...keep.useCases, ...r.useCases])];
          keep.estimate = { min: keep.estimate.min + r.estimate.min, max: keep.estimate.max + r.estimate.max };
          if (keep.days || r.days) keep.days = (keep.days ?? 0) + (r.days ?? 0);
          keep.foundation ||= r.foundation;
          keep.checkpoint ||= r.checkpoint;
          keep.publish ||= r.publish;
          if (r.status === 'active' || r.status === 'checkpoint') keep.status = r.status;
          keep.startedAt = Math.min(keep.startedAt ?? Infinity, r.startedAt ?? Infinity);
          if (!Number.isFinite(keep.startedAt)) delete keep.startedAt;
        }
        const gone = new Set(rest.map((r) => r.id));
        ps = ps.filter((p) => !gone.has(p.id));
        for (const p of ps) p.overlapsWith = p.overlapsWith.filter((x) => !gone.has(x) && x !== p.id);
        break;
      }
      case 'toggle': {
        const p = open(o.phase, 'switch');
        if (typeof p === 'string') return p;
        if (o.checkpoint !== undefined) p.checkpoint = !!o.checkpoint;
        if (o.publish !== undefined) p.publish = !!o.publish;
        if (o.foundation !== undefined) p.foundation = !!o.foundation;
        break;
      }
      case 'overlap': {
        const p = open(o.phase, 'start early');
        if (typeof p === 'string') return p;
        if (p.status !== 'planned') return `${p.name} has started already`;
        const running = ps.filter((x) => x.status === 'active' || x.status === 'checkpoint');
        if (!running.length) return 'No phase is in progress to overlap: start it instead';
        p.early = { since: now, teams: words(o.teams, 6, 20).length ? words(o.teams, 6, 20) : ['design'], what: str(o.what, 40) || 'design' };
        for (const r of running) {
          if (!p.overlapsWith.includes(r.id)) p.overlapsWith.push(r.id);
          if (!r.overlapsWith.includes(p.id)) r.overlapsWith.push(p.id);
        }
        break;
      }
      case 'estimate': {
        const p = open(o.phase, 'estimate');
        if (typeof p === 'string') return p;
        const min = money(o.min);
        p.estimate = { min, max: Math.max(min, money(o.max)) };
        if (num(o.days) > 0) p.days = Math.round(num(o.days));
        break;
      }
      case 'journeys': {
        const p = open(o.phase, 'journeys');
        if (typeof p === 'string') return p;
        const js = words(o.journeys, LIMITS.journeys);
        for (const x of ps) if (x !== p && !locked(x)) x.journeys = x.journeys.filter((j) => !js.includes(j));
        p.journeys = js;
        break;
      }
      case 'add': {
        const name = str(o.name, LIMITS.name);
        if (!name) return 'The new phase needs a name';
        if (ps.length >= LIMITS.phases) return `At most ${LIMITS.phases} phases`;
        const at = o.after ? ps.findIndex((p) => p.id === o.after) + 1 : ps.length;
        if (at > 0 && at < ps.length && locked(ps[at])) return 'A new phase goes after the done ones';
        const fresh = cleanPhase({ id: nextPhaseId(ps), name, goal: o.goal, rows: [], status: 'planned' }, ps.length);
        ps.splice(at <= 0 ? ps.length : at, 0, fresh);
        if (o.rows?.length) {
          const moved = applyOps(ps, [{ op: 'move-rows', rows: o.rows, to: fresh.id }], now);
          if (typeof moved === 'string') return moved;
          ps = moved;
        }
        break;
      }
      default:
        return 'Not an edit the office knows';
    }
  }
  return ps;
}

/** A request's ops, cleaned (anything unknown dropped); a string when there's nothing usable. */
export function readOps(v: unknown): PhaseOp[] | string {
  if (!Array.isArray(v) || !v.length) return 'Give the changes as a list of ops';
  const ops: PhaseOp[] = [];
  for (const raw of v.slice(0, 50)) {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = (x: unknown) => str(x, 10);
    switch (o.op) {
      case 'rename':
        ops.push({ op: 'rename', phase: id(o.phase), ...(o.name !== undefined ? { name: str(o.name, LIMITS.name) } : {}), ...(o.goal !== undefined ? { goal: str(o.goal, LIMITS.goal) } : {}) });
        break;
      case 'move-rows':
        ops.push({ op: 'move-rows', rows: ints(o.rows, LIMITS.rows), to: id(o.to) });
        break;
      case 'reorder':
        ops.push({ op: 'reorder', order: words(o.order, LIMITS.phases, 10) });
        break;
      case 'split':
        ops.push({ op: 'split', phase: id(o.phase), rows: ints(o.rows, LIMITS.rows), name: str(o.name, LIMITS.name), ...(o.goal ? { goal: str(o.goal, LIMITS.goal) } : {}) });
        break;
      case 'merge':
        ops.push({ op: 'merge', phases: words(o.phases, LIMITS.phases, 10) });
        break;
      case 'toggle':
        ops.push({ op: 'toggle', phase: id(o.phase), ...(typeof o.checkpoint === 'boolean' ? { checkpoint: o.checkpoint } : {}), ...(typeof o.publish === 'boolean' ? { publish: o.publish } : {}), ...(typeof o.foundation === 'boolean' ? { foundation: o.foundation } : {}) });
        break;
      case 'overlap':
        ops.push({ op: 'overlap', phase: id(o.phase), teams: words(o.teams, 6, 20), what: str(o.what, 40) });
        break;
      case 'estimate':
        ops.push({ op: 'estimate', phase: id(o.phase), min: money(o.min), max: money(o.max), ...(num(o.days) > 0 ? { days: Math.round(num(o.days)) } : {}) });
        break;
      case 'journeys':
        ops.push({ op: 'journeys', phase: id(o.phase), journeys: words(o.journeys, LIMITS.journeys) });
        break;
      case 'add':
        ops.push({ op: 'add', name: str(o.name, LIMITS.name), ...(o.goal ? { goal: str(o.goal, LIMITS.goal) } : {}), ...(Array.isArray(o.rows) ? { rows: ints(o.rows, LIMITS.rows) } : {}), ...(o.after ? { after: id(o.after) } : {}) });
        break;
    }
  }
  return ops.length ? ops : 'None of the ops is one the office knows (rename, move-rows, reorder, split, merge, toggle, overlap, estimate, journeys, add)';
}

/** Whether a plan exists to show (proposed or approved phases). */
export const isPhased = (plan: Pick<PhasePlan, 'state' | 'phases'>) => plan.state !== 'none' && plan.phases.length > 0;
