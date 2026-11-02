// The phase plan's changes, free of the office's context (index.ts wires the real one, the tests a fake): the
// team proposing the phases at the Build Plan gate or a change during Build (propose), the Project Manager
// approving the proposed phases with their own edits (approve), accepting or declining a team proposal, as it
// is or edited first (decide), changing the phases themselves (edit), and Go or Stop at a phase's checkpoint
// (go, stop); and the office moving a phase on when its exit criteria are met (tick). Every change is a
// recorded change (C-n) in the plan, audited, and the team is told what was decided.

import { applyOps, checkDrafts, kindOf, lite, nextChangeId, nextProposalId, opsWords, phasesOfDrafts, readOps } from '../../shared/phases/plan.js';
import { advance, startNext, type Advance } from '../../shared/phases/derive.js';
import { LIMITS, type PhaseChange, type PhaseExit, type PhaseOp, type PhasePlan, type PhaseProposal, type Who } from '../../shared/phases/types.js';
import type { PhaseStore } from './store.js';

export interface PhaseDeps {
  store: PhaseStore;
  now(): number;
  /** An audit line. */
  record(floorId: string, by: Who, action: string, summary: string, details?: Record<string, unknown>): void;
  /** The plan changed: the pages look again. */
  changed(floorId: string): void;
  /** Tells the team's lead (after their turn); why it couldn't, or nothing. */
  tellLead?(floorId: string, text: string, by: Who): Promise<string | undefined>;
  /** A toast for everyone on the project. */
  toast?(floorId: string, text: string): void;
}

export type Result = { ok: true; plan: PhasePlan; change?: PhaseChange; proposal?: PhaseProposal; note?: string } | { ok: false; status: 400 | 404 | 409; error: string };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (status: 400 | 404 | 409, error: string): Result => ({ ok: false, status, error });
const whoWord = (w: Who) => (w.kind === 'pm' ? `${w.name} (PM)` : w.name);

export class PhasesService {
  constructor(readonly d: PhaseDeps) {}

  plan(floorId: string): PhasePlan {
    return this.d.store.get(floorId);
  }

  private save(floorId: string, fn: (p: PhasePlan) => string | void): PhasePlan | Result {
    const r = this.d.store.update(floorId, fn);
    return typeof r === 'string' ? fail(409, r) : r;
  }

  private tell(floorId: string, text: string, by: Who) {
    void this.d.tellLead?.(floorId, text, by).catch(() => undefined);
  }

  /** The team proposes the whole set (kind plan, at the Build Plan gate) or a change to the approved phases. */
  propose(floorId: string, by: Who, body: unknown): Result {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const reason = str(b.reason, LIMITS.reason);
    if (!reason) return fail(400, 'Say why (reason): the Project Manager decides on it');
    const now = this.d.now();
    const current = this.plan(floorId);
    let proposal: PhaseProposal | undefined;
    if (b.kind === 'plan' || (b.kind === undefined && Array.isArray(b.phases))) {
      if (current.state === 'approved') return fail(409, 'The phases are approved already: propose a change instead (propose_phase_change), it keeps the done phases and the history');
      const drafts = checkDrafts(b.phases);
      if (typeof drafts === 'string') return fail(400, drafts);
      const r = this.save(floorId, (p) => {
        for (const x of p.proposals) if (x.status === 'open' && x.kind === 'plan') x.status = 'superseded';
        proposal = { id: nextProposalId(p), kind: 'plan', by, at: now, summary: str(b.summary, 300) || `${drafts.length} phases from the build plan`, reason, phases: drafts, base: p.changes.length, status: 'open' };
        p.proposals.push(proposal);
        p.delivery = 'phases';
        p.state = 'proposed';
        p.phases = phasesOfDrafts(drafts);
        const cut = b.cutover as { min?: unknown; max?: unknown; days?: unknown } | undefined;
        if (cut && typeof cut === 'object') p.cutover = { min: Number(cut.min) || 0, max: Number(cut.max) || 0, ...(Number(cut.days) > 0 ? { days: Number(cut.days) } : {}) };
      });
      if ('ok' in r) return r;
      this.d.record(floorId, by, 'phases.proposed', `${whoWord(by)} proposed ${drafts.length} phases at the Build Plan gate (${proposal!.id})`, { proposal: proposal!.id, phases: drafts.map((d) => d.name) });
      this.d.toast?.(floorId, `🗺️ ${by.name} proposed ${drafts.length} phases: see Roadmap`);
      this.d.changed(floorId);
      return { ok: true, plan: r, proposal: proposal! };
    }
    if (current.state !== 'approved') return fail(409, current.state === 'proposed' ? 'The phases are still waiting for the Build Plan gate: propose the whole set again (propose_phases) instead of a change' : 'This project has no phases yet: propose them first (propose_phases)');
    const ops = readOps(b.ops);
    if (typeof ops === 'string') return fail(400, ops);
    const after = applyOps(current.phases, ops, now);
    if (typeof after === 'string') return fail(409, after);
    const r = this.save(floorId, (p) => {
      proposal = { id: nextProposalId(p), kind: 'change', by, at: now, summary: str(b.summary, 300) || opsWords(ops, p.phases), reason, ops, base: p.changes.length, status: 'open' };
      p.proposals.push(proposal);
    });
    if ('ok' in r) return r;
    this.d.record(floorId, by, 'phases.change-proposed', `${whoWord(by)} proposed a change to the phases (${proposal!.id}): ${proposal!.summary}`, { proposal: proposal!.id, ops });
    this.d.toast?.(floorId, `🗺️ ${by.name} proposes a change to the phases: see Roadmap`);
    this.d.changed(floorId);
    return { ok: true, plan: r, proposal: proposal! };
  }

  /** The PM approves the proposed phases at the Build Plan gate, with their own edits on top: C-n, phase 1 starts. */
  approve(floorId: string, pm: Who, opsIn?: unknown, reasonIn?: unknown): Result {
    const now = this.d.now();
    const cur = this.plan(floorId);
    if (cur.state !== 'proposed') return fail(409, cur.state === 'approved' ? 'The phases are approved already' : 'There are no proposed phases to approve');
    const ops = opsIn === undefined || (Array.isArray(opsIn) && !opsIn.length) ? [] : readOps(opsIn);
    if (typeof ops === 'string') return fail(400, ops);
    const edited = ops.length ? applyOps(cur.phases, ops, now) : cur.phases;
    if (typeof edited === 'string') return fail(409, edited);
    let change: PhaseChange | undefined;
    const r = this.save(floorId, (p) => {
      const open = [...p.proposals].reverse().find((x) => x.status === 'open' && x.kind === 'plan');
      const before = lite(p.phases);
      p.phases = edited;
      startNext(p.phases, now);
      p.state = 'approved';
      p.delivery = 'phases';
      p.approvedAt = now;
      if (open) Object.assign(open, { status: 'accepted', decidedAt: now, decidedBy: pm });
      const edits = ops.length ? ` with ${ops.length === 1 ? 'one edit' : `${ops.length} edits`}: ${opsWords(ops, cur.phases)}` : '';
      change = { id: nextChangeId(p), kind: 'approve', summary: `${p.phases.length} phases approved at the Build Plan gate${edits}`, reason: str(reasonIn, LIMITS.reason) || open?.reason || 'Approved at the Build Plan gate', proposedBy: open?.by ?? pm, decidedBy: pm, decision: 'accepted', ...(open ? { proposal: open.id } : {}), at: now, diff: { before, after: lite(p.phases) } };
      p.changes.push(change);
    });
    if ('ok' in r) return r;
    const first = r.phases.find((x) => x.status === 'active');
    this.d.record(floorId, pm, 'phases.approved', `${change!.id}: ${change!.summary}${first ? `; ${first.name} started` : ''}`, { change: change!.id });
    this.tell(floorId, `The Project Manager approved the phases at the Build Plan gate (${change!.id}): ${r.phases.map((x, i) => `${i + 1} ${x.name}`).join(', ')}.${first ? ` Build starts with phase 1, ${first.name}: work its rows first.` : ''} Later changes go through propose_phase_change.`, pm);
    this.d.changed(floorId);
    return { ok: true, plan: r, change: change! };
  }

  /** Accept (as proposed, or with the PM's `ops` instead: Edit first) or decline a team proposal. */
  decide(floorId: string, pm: Who, proposalId: string, decision: 'accept' | 'decline', note?: unknown, opsIn?: unknown): Result {
    const cur = this.plan(floorId);
    const prop = cur.proposals.find((x) => x.id === proposalId);
    if (!prop) return fail(404, `There is no proposal ${proposalId}`);
    if (prop.status !== 'open') return fail(409, `${prop.id} is ${prop.status} already`);
    const words = str(note, LIMITS.reason);
    const now = this.d.now();
    if (decision === 'decline') {
      const r = this.save(floorId, (p) => {
        Object.assign(p.proposals.find((x) => x.id === proposalId)!, { status: 'declined', decidedAt: now, decidedBy: pm, ...(words ? { note: words } : {}) });
      });
      if ('ok' in r) return r;
      this.d.record(floorId, pm, 'phases.declined', `Declined ${prop.id} (${prop.summary})${words ? `: ${words}` : ''}`, { proposal: prop.id });
      this.tell(floorId, `The Project Manager declined ${prop.kind === 'plan' ? 'the proposed phases' : 'your change to the phases'} (${prop.id}: ${prop.summary})${words ? `: ${words}` : '.'} ${prop.kind === 'plan' ? 'Propose them again with propose_phases once changed.' : 'The phases stay as they are.'}`, pm);
      this.d.changed(floorId);
      return { ok: true, plan: r, proposal: prop };
    }
    if (prop.kind === 'plan') return this.approve(floorId, pm, opsIn, words || prop.reason);
    const ops = opsIn === undefined ? prop.ops ?? [] : readOps(opsIn);
    if (typeof ops === 'string') return fail(400, ops);
    const after = applyOps(cur.phases, ops, now);
    if (typeof after === 'string') return fail(409, `${prop.id} no longer applies (${after}): decline it, or make the change yourself with Edit phases`);
    const edited = opsIn !== undefined;
    let change: PhaseChange | undefined;
    const r = this.save(floorId, (p) => {
      const before = lite(p.phases);
      p.phases = after;
      startNext(p.phases, now);
      Object.assign(p.proposals.find((x) => x.id === proposalId)!, { status: 'accepted', decidedAt: now, decidedBy: pm, ...(words ? { note: words } : {}) });
      change = { id: nextChangeId(p), kind: kindOf(ops), summary: `${opsWords(ops, cur.phases)}${edited ? ' (edited by the PM)' : ''}`, reason: prop.reason, proposedBy: prop.by, decidedBy: pm, decision: 'accepted', proposal: prop.id, at: now, diff: { before, after: lite(p.phases) } };
      p.changes.push(change);
    });
    if ('ok' in r) return r;
    this.d.record(floorId, pm, 'phases.accepted', `${change!.id}: accepted ${prop.id} from ${prop.by.name}: ${change!.summary}`, { change: change!.id, proposal: prop.id });
    this.tell(floorId, `The Project Manager accepted your change to the phases (${prop.id} → ${change!.id})${edited ? ', edited first' : ''}: ${change!.summary}.`, pm);
    this.d.changed(floorId);
    return { ok: true, plan: r, change: change! };
  }

  /** The PM changes the phases themselves (Edit phases): one recorded change with their reason. */
  edit(floorId: string, pm: Who, opsIn: unknown, reasonIn: unknown): Result {
    const reason = str(reasonIn, LIMITS.reason);
    if (!reason) return fail(400, 'Give a reason for the change: it is kept in the history');
    const cur = this.plan(floorId);
    if (cur.state === 'none') return fail(409, 'This project has no phases to edit');
    const ops = readOps(opsIn);
    if (typeof ops === 'string') return fail(400, ops);
    const now = this.d.now();
    const after = applyOps(cur.phases, ops, now);
    if (typeof after === 'string') return fail(409, after);
    let change: PhaseChange | undefined;
    const r = this.save(floorId, (p) => {
      const before = lite(p.phases);
      p.phases = after;
      if (p.state === 'approved') startNext(p.phases, now);
      change = { id: nextChangeId(p), kind: kindOf(ops), summary: opsWords(ops, cur.phases), reason, proposedBy: pm, decidedBy: pm, decision: 'accepted', at: now, diff: { before, after: lite(p.phases) } };
      p.changes.push(change);
    });
    if ('ok' in r) return r;
    this.d.record(floorId, pm, 'phases.edited', `${change!.id}: ${change!.summary} (${reason})`, { change: change!.id, ops });
    if (r.state === 'approved') this.tell(floorId, `The Project Manager changed the phases (${change!.id}): ${change!.summary}. Reason: ${reason}`, pm);
    this.d.changed(floorId);
    return { ok: true, plan: r, change: change! };
  }

  /** Go at a phase's checkpoint: the phase is done and the next one starts (part 2's checkpoint card calls this too). */
  go(floorId: string, pm: Who, phaseId: string): Result {
    const now = this.d.now();
    let started: string | undefined;
    const r = this.save(floorId, (p) => {
      const ph = p.phases.find((x) => x.id === phaseId);
      if (!ph) return `There is no phase ${phaseId}`;
      if (ph.status !== 'checkpoint') return `${ph.name} isn't at its checkpoint (it is ${ph.status})`;
      ph.status = 'done';
      ph.endedAt = now;
      started = startNext(p.phases, now)?.name;
    });
    if ('ok' in r) return r;
    const name = r.phases.find((x) => x.id === phaseId)?.name ?? phaseId;
    this.d.record(floorId, pm, 'phases.go', `Go at ${name}'s checkpoint: done${started ? `; ${started} started` : ''}`, { phase: phaseId });
    this.tell(floorId, `The Project Manager said Go at ${name}'s checkpoint: it is done.${started ? ` ${started} starts now.` : ' That was the last phase.'}`, pm);
    this.d.changed(floorId);
    return { ok: true, plan: r };
  }

  /** Stop at a checkpoint: the phase stops, and so does early work on the next one (nothing new starts). */
  stop(floorId: string, pm: Who, phaseId: string, reasonIn: unknown): Result {
    const reason = str(reasonIn, LIMITS.reason) || 'Stopped at the checkpoint';
    const now = this.d.now();
    const r = this.save(floorId, (p) => {
      const ph = p.phases.find((x) => x.id === phaseId);
      if (!ph) return `There is no phase ${phaseId}`;
      if (ph.status !== 'checkpoint') return `${ph.name} isn't at its checkpoint (it is ${ph.status})`;
      ph.status = 'stopped';
      ph.endedAt = now;
      for (const x of p.phases) if (x.early && x.status === 'planned') delete x.early;
    });
    if ('ok' in r) return r;
    const name = r.phases.find((x) => x.id === phaseId)?.name ?? phaseId;
    this.d.record(floorId, pm, 'phases.stop', `Stopped at ${name}'s checkpoint: ${reason}`, { phase: phaseId });
    this.tell(floorId, `The Project Manager stopped Build at ${name}'s checkpoint: ${reason}. Start nothing new, early work on the next phase included; keep what was made.`, pm);
    this.d.changed(floorId);
    return { ok: true, plan: r };
  }

  /** The office moves the active phases whose exit criteria are met (to the checkpoint, or done and the next started). */
  tick(floorId: string, exits: ReadonlyMap<string, PhaseExit>): Advance[] {
    const cur = this.plan(floorId);
    if (cur.state !== 'approved' || !cur.phases.some((p) => p.status === 'active' && exits.get(p.id)?.met)) return [];
    const now = this.d.now();
    let moved: Advance[] = [];
    const r = this.d.store.update(floorId, (p) => {
      moved = advance(p.phases, exits, now);
      if (!moved.length) return 'nothing';
    });
    if (typeof r === 'string') return [];
    const office: Who = { kind: 'office', name: 'The office' };
    for (const m of moved) {
      const name = r.phases.find((x) => x.id === m.phase)?.name ?? m.phase;
      const next = m.started ? r.phases.find((x) => x.id === m.started)?.name : undefined;
      this.d.record(floorId, office, m.to === 'checkpoint' ? 'phases.checkpoint' : 'phases.done', m.to === 'checkpoint' ? `${name} passed its exit criteria at ${m.exit.commit?.slice(0, 7) ?? 'main'}: at its checkpoint, waiting for the Project Manager` : `${name} passed its exit criteria at ${m.exit.commit?.slice(0, 7) ?? 'main'}: done${next ? `; ${next} started` : ''}`, { phase: m.phase, exit: m.exit });
      this.d.toast?.(floorId, m.to === 'checkpoint' ? `🏁 ${name} passed its exit criteria: checkpoint` : `🏁 ${name} is done${next ? `; ${next} starts` : ''}`);
      if (m.to === 'done') this.tell(floorId, `${name} passed its exit criteria (journeys, mx check, data impact) and is done.${next ? ` ${next} starts now: work its rows.` : ''}`, office);
    }
    this.d.changed(floorId);
    return moved;
  }

  /** Ask the team for a change (the Roadmap's button): a message to the lead. */
  async ask(floorId: string, pm: Who, text: unknown): Promise<Result> {
    const words = str(text, 4000);
    if (!words) return fail(400, 'Say what you would like changed');
    const err = await this.d.tellLead?.(floorId, `The Project Manager asks for a change to the phases: ${words}\nPropose it with propose_phase_change (it shows on the Roadmap for them to accept).`, pm);
    if (err) return fail(409, err);
    this.d.record(floorId, pm, 'phases.asked', `Asked the team for a change to the phases: ${words.slice(0, 200)}`);
    return { ok: true, plan: this.plan(floorId), note: 'Sent to the team lead' };
  }
}

export type { PhaseOp };
