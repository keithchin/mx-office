// What the CTO does to a role from the Team tab: hire (or wake) it, bench it, rename it, change its
// model, and the floor's team settings. Hiring a role always uses its fixed name and its Playbook;
// hiring a benched one starts a fresh session primed with its latest handoff note, never a resume.

import { latestEntry } from '../../shared/roster/journal.js';
import { cleanName, ROLE_BY_ID, ROLES, type RoleId } from '../../shared/roster/roles.js';
import { dayIn } from '../../shared/roster/schedule.js';
import { isAsleepStatus, mayBench } from './bench.js';
import type { Roster } from './index.js';
import { readJournal } from './journal-io.js';
import { lessonsPathIn, writeRoleFiles, type PlaybookContext } from './playbooks.js';
import { autonomyPrompt, benchPrompt, primePrompt } from './prompts.js';
import { cleanSettings } from './store.js';
import type { TeamFloor } from './types.js';

/** Models a role can be set to: Claude Code's aliases, or a full model id. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._\-[\]]{0,63}$/;

export class Members {
  constructor(private roster: Roster) {}

  private ctxFor(floor: TeamFloor, name: string): PlaybookContext {
    const d = this.roster.data(floor.id);
    const names = Object.fromEntries(ROLES.map((r) => [r.id, d.members[r.id].name])) as PlaybookContext['names'];
    return { project: floor.name, name, level: d.settings.autonomy, lessons: lessonsPathIn(floor.dir), names };
  }

  /** The stamp a journal heading gets: the date and time in the floor's standup time zone. */
  stamp(floor: TeamFloor): string {
    const tz = this.roster.data(floor.id).settings.schedule.timeZone;
    const now = this.roster.deps.now();
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now));
    return `${dayIn(now, tz)} ${time}`;
  }

  /**
   * Hires a role with its fixed name, or wakes it when it's asleep (its session carries on). A
   * benched or never-hired role starts fresh from its Playbook and its latest handoff note.
   */
  async hire(floor: TeamFloor, role: RoleId, by: string, owner?: string, task?: string): Promise<string | undefined> {
    const d = this.roster.data(floor.id);
    const m = d.members[role];
    const def = ROLE_BY_ID.get(role)!;
    const w = this.roster.workerOf(floor, m);
    if (w) {
      if (m.phase === 'benching') return `${m.name} is writing a handoff note before being benched`;
      if (!isAsleepStatus(w.status)) return `${m.name} is already at work`;
      const err = floor.wake(w.id, task);
      if (!err) floor.toast(`${by} woke ${m.name}, the ${def.title}`);
      return err;
    }
    const paused = this.roster.pauseOf(d);
    if (paused) return paused;
    const r = await floor.hire({ name: m.name, model: m.model, prompt: primePrompt(role, m.name, d.settings.autonomy, m.handoff, task), owner, by, team: def.team });
    if (typeof r === 'string') return r;
    m.workerId = r.id;
    m.phase = 'active';
    m.benchAskedAt = undefined;
    m.benchSawBusy = undefined;
    // Its Playbook, its team's subagents and the journals, in the folder it works in, before its
    // session has booted far enough to read them.
    try {
      writeRoleFiles(floor.cwdOf(r), role, this.ctxFor(floor, m.name));
    } catch (err) {
      floor.toast(`Couldn't write ${m.name}'s Playbook: ${(err as Error).message}`, 'warn');
    }
    floor.toast(`${by} hired ${m.name}, the ${def.title}${m.handoff ? ', fresh from its handoff note' : ''}`);
    this.roster.touch(floor);
    return undefined;
  }

  /**
   * Starts benching a role: it's asked for its handoff note and lessons, and stopped once that turn
   * is over (Roster.onWorker / tick, then finishBench). An asleep one is woken just to write it.
   * Refused for one mid-task or waiting on a person.
   */
  bench(floor: TeamFloor, role: RoleId, by: string): string | undefined {
    const d = this.roster.data(floor.id);
    const m = d.members[role];
    const w = this.roster.workerOf(floor, m);
    if (m.phase === 'benching') return `${m.name} is already writing its handoff note`;
    if (!w) return `${m.name} isn't hired`;
    const ok = mayBench({ status: w.status, viewers: w.viewers.length });
    if (ok !== true) return `Can't bench ${m.name}: ${ok}`;
    const text = benchPrompt(role, lessonsPathIn(floor.dir), this.stamp(floor));
    const err = isAsleepStatus(w.status) ? floor.wake(w.id, text) : floor.prompt(w.id, text);
    if (err) return err;
    m.phase = 'benching';
    m.benchAskedAt = this.roster.deps.now();
    m.benchSawBusy = false;
    floor.toast(by === 'idle' ? `🪑 ${m.name} has been idle ${d.settings.idleMinutes} min: writing a handoff note, then benched` : `🪑 ${by} is benching ${m.name}: handoff note first`);
    this.roster.touch(floor);
    return undefined;
  }

  /** The handoff is written (or it stopped): keep the note, stop the worker, clear its session. */
  async finishBench(floor: TeamFloor, role: RoleId): Promise<void> {
    const d = this.roster.data(floor.id);
    const m = d.members[role];
    if (m.phase !== 'benching') return;
    const w = this.roster.workerOf(floor, m);
    const note = latestEntry(readJournal(floor, w, ROLE_BY_ID.get(role)!.team), 'handoff');
    const now = this.roster.deps.now();
    const fresh = note && m.benchAskedAt !== undefined && note.date >= dayIn(m.benchAskedAt - 86_400_000, d.settings.schedule.timeZone);
    if (note && fresh) m.handoff = { at: now, text: `${note.heading}\n\n${note.body}` };
    m.phase = 'benched';
    m.benchedAt = now;
    m.workerId = undefined;
    m.benchAskedAt = undefined;
    m.benchSawBusy = undefined;
    this.roster.touch(floor);
    floor.toast(fresh ? `🪑 ${m.name} is benched: handoff note kept, session cleared` : `🪑 ${m.name} is benched, but wrote no handoff note: the next hire starts from the Playbook and journal only`, fresh ? 'info' : 'warn');
    if (w) await floor.stop(w.id);
  }

  rename(floor: TeamFloor, role: RoleId, raw: unknown): string | undefined {
    const name = cleanName(raw);
    if (!name) return 'Give it a name (up to 24 characters)';
    const d = this.roster.data(floor.id);
    if (ROLES.some((r) => r.id !== role && d.members[r.id].name.toLowerCase() === name.toLowerCase())) return `${name} is already on the team`;
    const m = d.members[role];
    m.name = name;
    const w = this.roster.workerOf(floor, m);
    if (w) floor.rename(w.id, name);
    this.roster.touch(floor);
    return undefined;
  }

  /** A new model for a role: from its next hire (a running session keeps the one it started on). */
  setModel(floor: TeamFloor, role: RoleId, raw: unknown): string | undefined {
    if (typeof raw !== 'string' || !MODEL.test(raw.trim())) return 'Pick a model (an alias like sonnet, or a model id)';
    this.roster.data(floor.id).members[role].model = raw.trim();
    this.roster.touch(floor);
    return undefined;
  }

  /** New team settings. A new autonomy level is written into every hired Lead's Playbook and told to the ones at work. */
  settings(floor: TeamFloor, raw: unknown): string | undefined {
    const d = this.roster.data(floor.id);
    const before = d.settings.autonomy;
    d.settings = cleanSettings(raw, d.settings);
    this.roster.recheckPause(floor);
    if (d.settings.autonomy !== before) {
      for (const r of ROLES) {
        const m = d.members[r.id];
        const w = this.roster.workerOf(floor, m);
        if (!w || m.phase !== 'active') continue;
        try {
          writeRoleFiles(floor.cwdOf(w), r.id, this.ctxFor(floor, m.name));
        } catch {
          // its Playbook will be right at its next hire
        }
        // Asleep ones read it when they wake; one asking a person isn't interrupted.
        if (!isAsleepStatus(w.status) && w.status !== 'needs_input') floor.prompt(w.id, autonomyPrompt(d.settings.autonomy));
      }
    }
    this.roster.touch(floor);
    return undefined;
  }
}
