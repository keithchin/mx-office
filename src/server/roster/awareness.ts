// What the office tells agents about the project's run state, so none of them goes on believing "the
// project is paused" once it isn't. A ⏸ Pause (a person's, a safe restart's, the budget's) tells every
// awake agent it's pausing and puts it to sleep; ▶ Resume wakes only those with work waiting. The rest
// kept "paused" as their latest context: the live Coordinator told the Project Manager, a day after a
// restart, that nothing had changed since the pause and to go and resume a project that was running.
//
// So, three notes, each short (they cost tokens):
// - after every resume, whoever covers Management hears when and why it resumed, who's awake and who's
//   asleep, and to re-plan (project-run/flows.ts sends it: in its resume brief when it's woken, else
//   as an office message, which waits for its turn's end and respects the spend cap);
// - an agent that slept through the pause hears, once, with its next message, that the project was
//   resumed and to carry on (project-run/store.ts keeps who's still owed that, per resume);
// - what the Project Manager asks the Coordinator (the console, its quick questions) goes in with a
//   one-line fact block: the run state, who's working, awake and asleep, and the last resume.

import type { WorkerInfo } from '../../shared/protocol.js';
import { ROLE_BY_ID } from '../../shared/roster/roles.js';
import { ackResume, lastResume, projectPause, resumeOwed } from '../project-run/store.js';
import { isAsleepStatus } from './bench.js';
import { managerRole } from './coverage.js';
import type { Roster } from './index.js';
import type { TeamFloor } from './types.js';

/** "Sat 10 Oct 13:20", in the floor's time zone. */
export function whenIn(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${p('weekday')} ${p('day')} ${p('month')} ${p('hour')}:${p('minute')}`;
}

const NAMES_MAX = 8;
/** "Ada, Bo and 3 more", or "nobody". */
export function names(list: string[]): string {
  if (!list.length) return 'nobody';
  const shown = list.slice(0, NAMES_MAX).join(', ');
  return list.length > NAMES_MAX ? `${shown} and ${list.length - NAMES_MAX} more` : shown;
}

/** What an agent that slept through the pause hears, once, before its next message. */
export const resumedNote = (when: string, task: string | undefined): string =>
  `Note from the office: the project was resumed on ${when} — you're running; carry on with ${task ? task.replace(/[.\s]+$/, '') : 'your work'}.`;

/** What whoever covers Management hears after a resume. */
export const coordinatorNote = (o: { when: string; why: string; awake: string[]; asleep: string[] }): string =>
  `The project resumed at ${o.when} (${o.why}). Awake now: ${names(o.awake)}. Asleep: ${names(o.asleep)}. Re-plan: hand out next steps to the Leads you need (wake them with office-workers / your tools), or tell the Project Manager what needs them.`;

/** How a resume is said: "after a safe restart", "after a pause by Keith", "Keith pressed ▶ Resume project". */
export function resumeWhy(reason: string | undefined, pause: { why: string; by: string } | undefined, by: string): string {
  if (reason) return /^after\b/i.test(reason) ? reason : `after ${reason}`;
  if (pause?.why === 'restart') return 'after a safe restart';
  if (pause?.why === 'budget') return 'after the budget pause';
  if (pause) return `after a pause by ${pause.by}`;
  return `${by} pressed ▶ Resume project`;
}

export class Awareness {
  constructor(private roster: Roster) {}

  when(floor: TeamFloor, at: number): string {
    return whenIn(at, this.roster.data(floor.id).settings.schedule.timeZone);
  }

  /** "Sophie (Lead Developer)", or a plain worker's name. */
  private label(floor: TeamFloor, w: WorkerInfo): string {
    const role = this.roster.roleOf(floor, w.id);
    return role ? `${w.name} (${ROLE_BY_ID.get(role)!.title})` : w.name;
  }

  private agents(floor: TeamFloor): WorkerInfo[] {
    return floor.workers().filter((w) => w.kind === 'agent');
  }

  /** The worker that covers Management now, if it's at work. */
  manager(floor: TeamFloor): WorkerInfo | undefined {
    const d = this.roster.data(floor.id);
    const m = d.members[managerRole(d)];
    return m.phase === 'active' ? this.roster.workerOf(floor, m) : undefined;
  }

  // ---- The once-only note ----------------------------------------------------------------------

  /** The note a worker that slept through the pause is owed, if it is (and the floor isn't paused again). */
  noteFor(floor: TeamFloor, w: WorkerInfo): string | undefined {
    const m = resumeOwed(floor.id, w.id);
    return m && resumedNote(this.when(floor, m.at), this.roster.tasks.current(floor, w));
  }

  /** It went in (or the worker heard another way): never again for this resume. */
  ack(floor: TeamFloor, workerId: string) {
    ackResume(floor.id, workerId);
  }

  // ---- After a resume, to whoever covers Management --------------------------------------------

  /**
   * The note after a resume at `at`. `waking`: names being woken by it still (counted awake); `me`:
   * the worker it's for, left out of the lists.
   */
  resumeNote(floor: TeamFloor, o: { at: number; why: string; me?: string; waking?: string[] }): string {
    const waking = new Set(o.waking ?? []);
    const others = this.agents(floor).filter((w) => w.id !== o.me);
    const awake = others.filter((w) => !isAsleepStatus(w.status) || waking.has(w.name)).map((w) => this.label(floor, w));
    const asleep = others.filter((w) => isAsleepStatus(w.status) && !waking.has(w.name)).map((w) => this.label(floor, w));
    return coordinatorNote({ when: this.when(floor, o.at), why: o.why, awake, asleep });
  }

  // ---- The fact block on the Project Manager's questions ---------------------------------------

  /** How the project runs now: "Running since the resume on …", "Paused by Keith since …", "Budget-paused since …". */
  runState(floor: TeamFloor): string {
    const p = projectPause(floor.id);
    const cap = this.roster.pauseOf(this.roster.data(floor.id));
    let s: string;
    if (p) s = p.why === 'budget' ? `Budget-paused since ${this.when(floor, p.at)} (its budget is reached)` : p.why === 'restart' ? `Paused for a safe restart since ${this.when(floor, p.at)}` : `Paused by ${p.by} since ${this.when(floor, p.at)}`;
    else {
      const r = lastResume(floor.id);
      s = r ? `Running (last resumed ${this.when(floor, r.at)}, ${r.why})` : 'Running';
    }
    return cap ? `${s}; the daily spend cap is reached, so the office starts no turns of its own` : s;
  }

  /** The one-line fact block: run state, who's working, waiting, idle and asleep. `me`: marked "you". */
  facts(floor: TeamFloor, me?: string): string {
    const groups: Record<'working' | 'waiting' | 'idle' | 'asleep', string[]> = { working: [], waiting: [], idle: [], asleep: [] };
    for (const w of this.agents(floor)) {
      const name = w.id === me ? `${w.name} (you)` : this.label(floor, w);
      const g = isAsleepStatus(w.status) ? 'asleep' : w.status === 'needs_input' ? 'waiting' : w.status === 'working' || w.status === 'starting' ? 'working' : 'idle';
      groups[g].push(name);
    }
    const who = [`working: ${names(groups.working)}`, ...(groups.waiting.length ? [`waiting on a person: ${names(groups.waiting)}`] : []), `awake and idle: ${names(groups.idle)}`, `asleep: ${names(groups.asleep)}`];
    return `[Office facts, ${this.when(floor, this.roster.deps.now())}] Project: ${this.runState(floor)}. Agents ${who.join('; ')}. Answer from these facts, not from older messages.`;
  }

  /** A person's prompt to whoever covers Management, with the fact block before it; any other worker's as it is. */
  withFacts(floor: TeamFloor, w: WorkerInfo, text: string): string {
    return this.manager(floor)?.id === w.id ? `${this.facts(floor, w.id)}\n\n${text}` : text;
  }

  /**
   * A person's prompt typed straight into a worker (the console, ws/handlers/workers.ts), as it goes
   * in: the once-only note and, for whoever covers Management, the fact block. `sent` once it went in.
   */
  dress(floor: TeamFloor, w: WorkerInfo, text: string): { text: string; sent: () => void } {
    const note = this.noteFor(floor, w);
    const body = this.withFacts(floor, w, text);
    return { text: note ? `${note}\n\n${body}` : body, sent: () => note && this.ack(floor, w.id) };
  }
}
