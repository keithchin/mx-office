// ▶ Resume and ⏸ Pause project as workflows on the office's engine (flow/): checkpointed after every
// step, so a restart carries a run on where it was (the service resumes interrupted runs at start),
// with pause and cancel, and each agent's progress in the run's state for the browser to show.
//
// Resume: lift the floor's pause, then one step per agent in waking order, each waiting for a slot
// (order.ts waitBeforeNext: at most N booting, a gap apart) before it wakes the agent with its brief
// (brief.ts) as a person's turn; then wait until every wake has reached a live session.
//
// Pause: hold the floor's office prompts (store.ts), then wind every awake agent down: one mid-turn
// finishes it (never interrupted), one with a question open is left alone and listed (nothing is
// ever typed into needs_input), one between turns is asked for a handoff note, and once that turn is
// over it's put to sleep with its session kept, so Resume carries it on.

import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import { PAUSE_SETTLE_MS, type Pacing, type PauseWhy, type ResumeAction, type RunAgent } from '../../shared/project-run.js';
import { latestEntry } from '../../shared/roster/journal.js';
import { ROLE_BY_ID } from '../../shared/roster/roles.js';
import { audit, byWhom, office } from '../audit/index.js';
import { END, type StepCtx, type WorkflowDef } from '../flow/types.js';
import { HANDOFF_START_MS, isAsleepStatus } from '../roster/bench.js';
import { readJournal } from '../roster/journal-io.js';
import { handoffPrompt, resumeBrief } from './brief.js';
import { coordinatorRelays } from './relays.js';
import { managerRole } from '../roster/coverage.js';
import { waitBeforeNext } from './order.js';
import { noteResumed, noteSlept, projectPause, setPauseWaiting, setProjectPause } from './store.js';
import { resumeWhy } from '../roster/awareness.js';
import type { RunDeps, RunFloor } from './types.js';
import type { Candidate } from './preview.js';
import { asksSoon } from '../roster/asks-hook.js';

export const RESUME_FLOW = 'project-resume';
export const PAUSE_FLOW = 'project-pause';
const BOOT_MS = 5 * 60_000;
const POLL_MS = 2_000;

export interface ResumeAgent extends RunAgent {
  key: string;
  startedAt?: number;
  /** What the preview found, for its brief. */
  candidate?: Omit<Candidate, 'options' | 'order'>;
}

export interface ResumeRun {
  floor: string;
  by: string;
  byId?: string;
  agents: ResumeAgent[];
  i: number;
  lastAt?: number;
  pacing: Pacing;
  begun?: boolean;
  /** Said by the safe restart that started it (restart/). */
  reason?: string;
  /** When the pause was lifted, and how that's said ("after a safe restart"): for the notes after it (roster/awareness.ts). */
  resumedAt?: number;
  why?: string;
  /** Whoever covers Management has heard the project resumed: in its resume brief, or the note after the wakes. */
  told?: boolean;
}

export interface PauseAgent extends RunAgent {
  key: string;
  askedAt?: number;
  /** When the pause first saw it mid-turn (its bound counts from then). */
  finishingAt?: number;
  sawBusy?: boolean;
  /** deps.turnsStarted when it was asked: a turn started since is its handoff, however short. */
  turnsAt?: number;
}

export interface PauseRun {
  floor: string;
  by: string;
  byId?: string;
  why: PauseWhy;
  agents: PauseAgent[];
  begun?: boolean;
  settled?: boolean;
}

const target = (f: RunFloor) => ({ kind: 'floor', id: f.team.id, label: f.team.name });
const live = (w: WorkerInfo | undefined) => !!w && !isAsleepStatus(w.status) && w.status !== 'starting';
const between = (s: WorkerStatus) => s === 'idle' || s === 'done';
const busy = (s: WorkerStatus) => s === 'working' || s === 'starting';

function floorOf(deps: RunDeps, id: string): RunFloor {
  const f = deps.floor(id);
  if (!f) throw new Error(`The project ${id} is gone`);
  return f;
}

/** The workers a run's agents are now (a re-hired member's is a new one). */
function workerOf(deps: RunDeps, f: RunFloor, a: Pick<RunAgent, 'workerId' | 'role'>): WorkerInfo | undefined {
  if (a.role) {
    const id = deps.roster.data(f.team.id).members[a.role].workerId;
    if (id) return f.team.worker(id);
  }
  return a.workerId ? f.team.worker(a.workerId) : undefined;
}

// ---- Resume -------------------------------------------------------------------------------------

/** Settles the wakes still booting: live ones are woken, ones that never came up have failed. True when one changed. */
function settle(deps: RunDeps, f: RunFloor, s: ResumeRun, now: number, bootMs: number): boolean {
  let changed = false;
  for (const a of s.agents) {
    if (a.status !== 'starting') continue;
    const w = workerOf(deps, f, a);
    if (live(w)) {
      a.status = 'woken';
      changed = true;
      audit.record({ floor: f.team.id, actor: office('Resume project'), action: 'agent.woken', target: { kind: 'worker', id: w!.id, label: a.name }, summary: `${a.name} is back at work (resumed by ${s.by})`, details: { action: a.action } });
    } else if (!w || now - (a.startedAt ?? now) >= bootMs) {
      a.status = 'failed';
      a.note = w ? 'Its session never came up' : 'It left the project';
      changed = true;
    }
  }
  return changed;
}

/** The brief an agent is woken with, from what the preview found and what landed since its last turn. */
async function briefFor(deps: RunDeps, f: RunFloor, s: ResumeRun, a: ResumeAgent, w: WorkerInfo | undefined): Promise<{ text: string; mark: () => void }> {
  const d = deps.roster.data(f.team.id);
  const c = a.candidate;
  const since = w?.lastInput?.at ?? deps.roster.idleSince(w?.id ?? '') ?? deps.now() - 86_400_000;
  const merges = w ? await f.merges(w, since).catch(() => []) : [];
  const involves = (e: (typeof d.escalations)[number]) => (a.role && e.role === a.role) || (w && (e.workerId === w.id || e.also?.some((x) => x.workerId === w.id)));
  const escalations = d.escalations
    .filter((e) => involves(e) && (e.at >= since || (e.resolution?.at ?? 0) >= since))
    .map((e) => (e.status === 'resolved' && e.resolution ? `“${e.title}”: ${e.resolution.verdict}${e.resolution.text ? ` — ${e.resolution.text}` : ''} (${e.resolution.by})` : `“${e.title}” raised by ${e.by}, still open`));
  const owed = w ? deps.roster.escalations.owedTo(f.team, w) : a.role ? deps.roster.escalations.owed(f.team, a.role) : { lines: [], mark() {} };
  const notes = a.role && a.role !== 'pm' ? (d.outbox.leads[a.role]?.lines ?? []) : [];
  // Whoever covers Management hears the Coordinator's relays in its brief (the Coordinator on an Enterprise team).
  const relays = a.role && a.role === managerRole(d) ? coordinatorRelays(deps.roster, f.team) : undefined;
  const text = resumeBrief({
    name: a.name,
    role: a.role,
    autonomy: d.settings.autonomy,
    by: s.by,
    merges,
    base: c?.base,
    escalations: escalations.slice(-6),
    chatter: f.chatter(a.name, since).slice(-5),
    open: deps.roster.openAsks(f.team.id, w?.id ?? ''),
    behind: c?.behind ?? 0,
    dirty: c?.dirty ?? 0,
    cutOff: !!c?.facts.cutOff,
    owed: owed.lines,
    notes,
    relays: relays?.text,
    reasons: c?.reasons ?? [],
  });
  // Whoever covers Management hears who's awake and who's asleep, and to re-plan, in the same message.
  const manages = !!a.role && a.role === managerRole(d) && s.resumedAt !== undefined;
  const waking = s.agents.filter((x) => (x.action === 'wake' || x.action === 'rehire') && x.status !== 'failed').map((x) => x.name);
  const note = manages ? deps.roster.awareness.resumeNote(f.team, { at: s.resumedAt!, why: s.why ?? 'after a pause', me: w?.id, waking }) : undefined;
  return {
    text: note ? `${text}\n\n${note}` : text,
    mark: () => {
      owed.mark();
      if (notes.length && a.role) delete d.outbox.leads[a.role];
      relays?.mark(w ?? workerOf(deps, f, a));
      if (note) s.told = true;
      // Its resume brief says the project resumed: never the once-only note as well (roster/awareness.ts).
      if (w) deps.roster.awareness.ack(f.team, w.id);
      deps.roster.touch(f.team, true);
    },
  };
}

/** Does one agent's action: wake it with its brief, hire it again, or send it home. */
async function act(deps: RunDeps, f: RunFloor, s: ResumeRun, a: ResumeAgent): Promise<void> {
  const action = a.action as ResumeAction;
  const w = workerOf(deps, f, a);
  const by = s.by;
  if (action === 'send-home') {
    if (w) await f.team.stop(w.id);
    a.status = 'sent-home';
    return;
  }
  // Carried on after a restart that came between waking it and saving that: it's up already.
  if (w && !isAsleepStatus(w.status) && (action === 'wake' || w.id !== a.workerId)) {
    a.status = 'woken';
    a.note = 'It was already awake';
    return;
  }
  const brief = await briefFor(deps, f, s, a, w);
  if (action === 'rehire' && a.role) {
    // A worker whose folder or session is gone goes first; its handoff note primes the new hire.
    if (w) await f.team.stop(w.id);
    const err = await deps.roster.members.hire(f.team, a.role, by, undefined, brief.text);
    if (err) {
      a.status = 'failed';
      a.note = err;
      return;
    }
    brief.mark();
    a.workerId = deps.roster.data(f.team.id).members[a.role].workerId;
  } else {
    if (!w) {
      a.status = 'failed';
      a.note = 'It left the project';
      return;
    }
    const r = deps.roster.delivery.send(f.team, w, brief.text, { origin: 'person', by, wake: true, note: false });
    if (r.status === 'refused') {
      a.status = 'failed';
      a.note = r.why;
      return;
    }
    brief.mark();
  }
  a.status = 'starting';
  a.startedAt = deps.now();
  s.lastAt = a.startedAt;
}

/**
 * After the wakes, whoever covers Management (the Coordinator, a Solo Lead) hears the project resumed,
 * who's awake and who's asleep, and to re-plan, unless its resume brief said so. It isn't every Lead:
 * the Coordinator decides who's needed. An office message: woken with it when asleep, typed after
 * the turn under way when busy, never past the spend cap.
 */
function tellManager(deps: RunDeps, f: RunFloor, s: ResumeRun) {
  const w = deps.roster.awareness.manager(f.team);
  const actor = office('Resume project');
  if (!w) {
    audit.record({ floor: s.floor, actor, action: 'resume.coordinator', target: target(f), summary: 'Nobody covering Management is at work to hear the project resumed', details: {} });
    return;
  }
  const text = deps.roster.awareness.resumeNote(f.team, { at: s.resumedAt ?? deps.now(), why: s.why ?? 'after a pause', me: w.id });
  const r = deps.roster.delivery.send(f.team, w, text, { origin: 'office', wake: true, resume: false, note: false, id: `resume-note-${s.floor}-${s.resumedAt ?? 0}` });
  if (r.status !== 'refused') deps.roster.awareness.ack(f.team, w.id);
  const how = r.status === 'refused' ? `couldn't: ${r.why}` : r.status === 'woke' ? 'woken with it' : r.status === 'held' ? 'after its current turn' : 'typed now';
  audit.record({ floor: s.floor, actor, action: 'resume.coordinator', target: { kind: 'worker', id: w.id, label: w.name }, summary: `Told ${w.name} the project resumed, to re-plan (${how})`, details: { status: r.status }, severity: r.status === 'refused' ? 'notice' : 'info' });
}

export function resumeFlow(deps: RunDeps): WorkflowDef<ResumeRun> {
  const poll = deps.pollMs ?? POLL_MS;
  const bootMs = deps.bootMs ?? BOOT_MS;
  return {
    id: RESUME_FLOW,
    version: 1,
    floorOf: (s) => s.floor,
    limits: { maxSteps: 1000 },
    steps: [
      {
        id: 'begin',
        label: 'Lift the pause',
        done: (s) => !!s.begun,
        async run({ state: s }) {
          const f = floorOf(deps, s.floor);
          const resumedAt = deps.now();
          const why = resumeWhy(s.reason, projectPause(s.floor), s.by);
          setProjectPause(s.floor, undefined);
          // Everyone the pause wound down is owed, once, word that it's over (roster/awareness.ts).
          noteResumed(s.floor, { at: resumedAt, why, by: s.by });
          audit.record({ floor: s.floor, actor: byWhom(s.by, s.byId), action: 'resume.started', target: target(f), summary: `Resumed the project: ${s.agents.length} agent${s.agents.length === 1 ? '' : 's'} to wake${s.reason ? ` (${s.reason})` : ''}`, details: { agents: s.agents.map((a) => ({ name: a.name, action: a.action })), pacing: s.pacing } });
          deps.chatter?.(s.floor, `▶ ${s.by} resumed the project: waking ${s.agents.map((a) => a.name).join(', ') || 'nobody'}.`);
          f.team.changed();
          return { begun: true, resumedAt, why };
        },
      },
      {
        id: 'agent',
        label: 'Wake the next agent',
        done: (s) => s.i >= s.agents.length,
        async run(ctx: StepCtx<ResumeRun>) {
          const s = ctx.state;
          const f = floorOf(deps, s.floor);
          const a = s.agents[s.i];
          if (a.status !== 'pending') return { i: s.i + 1 };
          if (a.action === 'wake' || a.action === 'rehire') {
            const pace = { concurrent: s.pacing.concurrent, gapMs: s.pacing.gapSec * 1000, bootMs };
            for (;;) {
              if (settle(deps, f, s, deps.now(), bootMs)) ctx.save();
              const starting = s.agents.filter((x) => x.status === 'starting').map((x) => ({ key: x.key, at: x.startedAt ?? 0 }));
              const wait = waitBeforeNext(deps.now(), starting, s.lastAt, pace);
              if (wait <= 0) break;
              await deps.sleep(Math.min(wait, poll), ctx.signal);
            }
          }
          await act(deps, f, s, a);
          const w = workerOf(deps, f, a);
          const done = a.status as RunAgent['status'];
          if (done === 'failed' || done === 'sent-home')
            audit.record({ floor: s.floor, actor: office('Resume project'), action: done === 'failed' ? 'agent.skipped' : 'agent.sent-home', target: { kind: 'worker', id: w?.id ?? a.key, label: a.name }, summary: done === 'failed' ? `Couldn't wake ${a.name}: ${a.note}` : `Sent ${a.name} home instead of waking it: its branch is merged`, details: { action: a.action }, severity: done === 'failed' ? 'notice' : 'info' });
          f.team.changed();
          return { i: s.i + 1, agents: s.agents, lastAt: s.lastAt, told: s.told };
        },
      },
      {
        id: 'settle',
        label: 'Wait for sessions to come up',
        done: (s) => !s.agents.some((a) => a.status === 'starting'),
        async run(ctx: StepCtx<ResumeRun>) {
          const s = ctx.state;
          const f = floorOf(deps, s.floor);
          while (s.agents.some((a) => a.status === 'starting')) {
            if (settle(deps, f, s, deps.now(), bootMs)) {
              ctx.save();
              f.team.changed();
            }
            if (!s.agents.some((a) => a.status === 'starting')) break;
            await deps.sleep(poll, ctx.signal);
          }
          return { agents: s.agents };
        },
      },
      {
        id: 'coordinator',
        label: 'Tell the Coordinator',
        done: (s) => !!s.told,
        async run({ state: s }) {
          tellManager(deps, floorOf(deps, s.floor), s);
          return { told: true };
        },
      },
      {
        id: 'end',
        label: 'Done',
        async run({ state: s }) {
          const f = floorOf(deps, s.floor);
          const n =(st: RunAgent['status']) => s.agents.filter((a) => a.status === st).length;
          const summary = `Resumed the project: ${n('woken')} woken, ${n('failed')} couldn't be, ${n('sent-home')} sent home`;
          audit.record({ floor: s.floor, actor: byWhom(s.by, s.byId), action: 'resume.finished', target: target(f), summary, details: { agents: s.agents.map((a) => ({ name: a.name, status: a.status, note: a.note })) } });
          deps.chatter?.(s.floor, `▶ ${summary}.`);
          f.team.changed();
        },
      },
    ],
    edges: { agent: (s) => (s.i < s.agents.length ? 'agent' : 'settle'), end: END },
  };
}

// ---- Pause --------------------------------------------------------------------------------------

/**
 * An agent whose turn (or handoff turn) didn't end within the bound is stopped, its session kept so Resume carries it
 * on: Pause settles, and the spend stops (the real-build test's "Pausing 0/1" ran 8 minutes, spend rising). True when it did.
 */
function forceStop(deps: RunDeps, f: RunFloor, s: PauseRun, a: PauseAgent, w: WorkerInfo, now: number, settleMs: number): boolean {
  const since = a.status === 'handoff' ? a.askedAt : a.finishingAt;
  if (since === undefined || now - since < settleMs || !busy(w.status)) return false;
  if (a.status === 'handoff') keepHandoff(deps, f, a, w);
  const err = f.sleep(w.id);
  const mins = Math.round(settleMs / 60_000);
  a.status = err ? 'failed' : 'asleep';
  a.note = err ?? `Stopped after ${mins} min: its turn hadn't ended. Its session is kept, so Resume carries it on`;
  a.forced = !err;
  delete a.until;
  if (!err) audit.record({ floor: s.floor, actor: office('Pause project'), action: 'agent.force-slept', target: { kind: 'worker', id: w.id, label: a.name }, summary: `${a.name} was stopped mid-turn after ${mins} min so the pause could settle (paused by ${s.by}); its session is kept`, details: { bound: settleMs } });
  return true;
}

/** One look at every agent being paused; true when anything changed. */
function windDown(deps: RunDeps, f: RunFloor, s: PauseRun, now: number): boolean {
  let changed = false;
  const settleMs = deps.settleMs ?? PAUSE_SETTLE_MS;
  const set = (a: PauseAgent, status: RunAgent['status'], note?: string) => {
    if (a.status === status && a.note === note) return;
    a.status = status;
    a.note = note;
    changed = true;
  };
  for (const a of s.agents) {
    if (a.status === 'asleep' || a.status === 'skipped' || a.status === 'failed') continue;
    const w = f.team.worker(a.workerId ?? '');
    if (!w) {
      set(a, 'skipped', 'It left the project');
      continue;
    }
    if (isAsleepStatus(w.status)) {
      if (a.status === 'handoff') keepHandoff(deps, f, a, w);
      set(a, 'asleep');
      continue;
    }
    if ((a.status === 'handoff' || a.status === 'finishing') && forceStop(deps, f, s, a, w, now, settleMs)) {
      changed = true;
      continue;
    }
    if (a.status === 'handoff') {
      if (busy(w.status) && !a.sawBusy) ((a.sawBusy = true), (changed = true));
      // A handoff turn shorter than a look's interval started and ended between two looks: counted all the same.
      if (!a.sawBusy && a.turnsAt !== undefined && (deps.turnsStarted?.(w.id) ?? 0) > a.turnsAt) ((a.sawBusy = true), (changed = true));
      // A question in its handoff turn is its own: it waits for a person like any other.
      if (w.status === 'needs_input') {
        set(a, 'handoff', 'Asking something in its terminal');
        continue;
      }
      if (between(w.status) && (a.sawBusy || now - (a.askedAt ?? now) >= HANDOFF_START_MS)) {
        keepHandoff(deps, f, a, w);
        const err = f.sleep(w.id);
        if (err) set(a, 'failed', err);
        else {
          set(a, 'asleep');
          audit.record({ floor: s.floor, actor: office('Pause project'), action: 'agent.slept', target: { kind: 'worker', id: w.id, label: a.name }, summary: `${a.name} wrote its handoff and went to sleep (paused by ${s.by})`, details: {} });
        }
      }
      continue;
    }
    // Never typed into a question: it's left for a person, and listed.
    if (w.status === 'needs_input') set(a, 'waiting-on-you', 'Waiting on you in its terminal');
    else if (busy(w.status)) {
      if (a.finishingAt === undefined) ((a.finishingAt = now), (a.until = now + settleMs), (changed = true));
      set(a, 'finishing', 'Finishing its turn');
    }
    else if (between(w.status)) {
      const r = deps.roster.delivery.send(f.team, w, handoffPrompt(s.by, a.role, deps.roster.members.stamp(f.team)), { origin: 'person', by: s.by, between: true });
      if (r.status === 'refused') set(a, 'failed', r.why);
      else {
        a.askedAt = now;
        a.until = now + settleMs;
        a.sawBusy = false;
        a.turnsAt = deps.turnsStarted?.(w.id);
        set(a, 'handoff', 'Writing its handoff note');
      }
    }
  }
  return changed;
}

/** A member's handoff note, from its journal, kept for a fresh hire should its session be lost. */
function keepHandoff(deps: RunDeps, f: RunFloor, a: PauseAgent, w: WorkerInfo) {
  if (!a.role) return;
  const note = latestEntry(readJournal(f.team, w, ROLE_BY_ID.get(a.role)!.team), 'handoff');
  if (!note) return;
  deps.roster.data(f.team.id).members[a.role].handoff = { at: deps.now(), text: `${note.heading}\n\n${note.body}` };
  deps.roster.touch(f.team, true);
  // Its AWAITING-PM items become escalations (server/asks/): a pause handoff is read like a bench one.
  asksSoon(f.team.id, 'as the project was paused');
}

/** Every agent still being wound down is done, but those waiting on a person (they stay listed). */
const settled = (s: PauseRun) => s.agents.every((a) => a.status === 'asleep' || a.status === 'skipped' || a.status === 'failed' || a.status === 'waiting-on-you');

export function pauseFlow(deps: RunDeps): WorkflowDef<PauseRun> {
  const poll = deps.pollMs ?? POLL_MS;
  return {
    id: PAUSE_FLOW,
    version: 1,
    floorOf: (s) => s.floor,
    steps: [
      {
        id: 'begin',
        label: 'Hold the office’s prompts',
        done: (s) => !!s.begun,
        async run({ state: s }) {
          const f = floorOf(deps, s.floor);
          setProjectPause(s.floor, { by: s.by, at: deps.now(), why: s.why, waiting: [] });
          const agents: PauseAgent[] = f.team
            .workers()
            .filter((w) => w.kind === 'agent' && !isAsleepStatus(w.status))
            .map((w) => ({ key: w.id, workerId: w.id, role: deps.roster.roleOf(f.team, w.id), name: w.name, action: 'pause', status: 'pending' }));
          // Each is told the project is pausing: once it's resumed, each is owed word of that (roster/awareness.ts).
          noteSlept(s.floor, agents.map((a) => a.key));
          audit.record({ floor: s.floor, actor: byWhom(s.by, s.byId), action: 'pause.started', target: target(f), summary: `Paused the project${s.why === 'restart' ? ' for a safe restart' : s.why === 'budget' ? ' (budget reached)' : ''}: ${agents.length} agent${agents.length === 1 ? '' : 's'} to wind down`, details: { agents: agents.map((a) => a.name), why: s.why } });
          deps.chatter?.(s.floor, `⏸ ${s.by} paused the project${s.why === 'restart' ? ' for a safe restart' : s.why === 'budget' ? ': its budget is reached' : ''}: agents finish their turn, write a handoff note and sleep.`);
          f.team.changed();
          return { begun: true, agents };
        },
      },
      {
        id: 'wind-down',
        label: 'Finish turns, hand off, sleep',
        done: (s) => !!s.settled,
        async run(ctx: StepCtx<PauseRun>) {
          const s = ctx.state;
          const f = floorOf(deps, s.floor);
          for (;;) {
            if (windDown(deps, f, s, deps.now())) {
              ctx.save();
              setPauseWaiting(s.floor, s.agents.filter((a) => a.status === 'waiting-on-you').map((a) => a.name));
              f.team.changed();
            }
            if (settled(s)) break;
            await deps.sleep(poll, ctx.signal);
          }
          return { settled: true, agents: s.agents };
        },
      },
      {
        id: 'end',
        label: 'Done',
        async run({ state: s }) {
          const f = floorOf(deps, s.floor);
          const waiting = s.agents.filter((a) => a.status === 'waiting-on-you').map((a) => a.name);
          setPauseWaiting(s.floor, waiting);
          for (const a of s.agents.filter((x) => x.status === 'skipped' || x.status === 'failed' || x.status === 'waiting-on-you'))
            audit.record({ floor: s.floor, actor: office('Pause project'), action: 'agent.skipped', target: { kind: 'worker', id: a.workerId ?? a.key, label: a.name }, summary: `${a.name} wasn't put to sleep: ${a.note ?? a.status}`, details: { status: a.status } });
          const asleep = s.agents.filter((a) => a.status === 'asleep').length;
          const summary = `Paused the project: ${asleep} asleep${waiting.length ? `, ${waiting.length} waiting on you (${waiting.join(', ')})` : ''}`;
          audit.record({ floor: s.floor, actor: byWhom(s.by, s.byId), action: 'pause.finished', target: target(f), summary, details: { agents: s.agents.map((a) => ({ name: a.name, status: a.status })) } });
          deps.chatter?.(s.floor, `⏸ ${summary}.`);
          f.team.changed();
        },
      },
    ],
  };
}
