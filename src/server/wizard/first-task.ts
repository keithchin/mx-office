// The team's first task (real-build fix, docs/mockups/product-assessment/real-build-test.md P1-2). A new
// project's Discovery task is handed to the team by default now ("Hand it to the … now" ticked); when
// someone unticked it, the setup's queue step is skipped ("not asked for") and the team sat idle for minutes
// with nobody saying why. Then the setup panel's view carries `firstTask`, Needs you shows "The team is waiting
// for its first task: Start Discovery", and its button (the Nudge target, roster route) hands the Discovery
// task to whoever covers Analysis (the Solo Lead, or the Chief Analyst) through the team's own tell. Nothing
// shows once that member has any task, or the setup's queue step ran.

import type { RoleId } from '../../shared/roster/roles.js';
import type { SetupView } from '../../shared/wizard.js';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { audit, byWhom } from '../audit/index.js';
import type { JobState } from './job.js';
import { discoveryTask } from './local-only.js';
import { discoveryRole } from './steps.js';

/** The facts firstTaskOf reads: the setup, and what the Discovery member is on now. */
export interface FirstTaskLook {
  job: Pick<JobState, 'status' | 'steps' | 'plan' | 'issue' | 'discoveryFile' | 'dir'> | undefined;
  /** Whether the member who would work Discovery has a task (any), and is at work. */
  member?: { role: RoleId; name: string; atWork: boolean; hasTask: boolean };
}

/** Whether the team waits for its first task: the setup finished without handing the Discovery task on, and nobody gave the member one since. */
export function firstTaskOf(l: FirstTaskLook): SetupView['firstTask'] {
  const j = l.job;
  if (!j || j.status !== 'done' || !l.member?.atWork || l.member.hasTask) return undefined;
  const q = j.steps.queue;
  if (q?.status !== 'skipped' || !/not asked for/i.test(q.detail ?? '')) return undefined;
  if (!discoveryTask(j)) return undefined;
  return { role: l.member.role, name: l.member.name, task: 'Discovery' };
}

/** The setup view with `firstTask` when the team waits for its first task. */
export function withFirstTask(ctx: Ctx, floor: Floor, job: JobState | undefined, view: SetupView): SetupView {
  if (!job) return view;
  try {
    const role = discoveryRole(job);
    const roster = rosterOf(ctx);
    const m = roster.data(floor.id).members[role];
    if (!m) return view;
    const w = roster.workerOf(teamFloor(ctx, floor), m);
    const t = m.task;
    const ft = firstTaskOf({ job, member: { role, name: m.name, atWork: !!w && m.phase === 'active', hasTask: !!t } });
    return ft ? { ...view, firstTask: ft } : view;
  } catch {
    return view;
  }
}

/**
 * The Needs you button: hands the Discovery task to the member. `handled` false when the team isn't waiting for
 * its first task (the Nudge does what it always did); else the error, or none once it's sent.
 */
export async function startFirstTask(ctx: Ctx, floor: Floor, job: JobState | undefined, role: RoleId, by: string, owner?: string): Promise<{ handled: boolean; error?: string }> {
  if (!job) return { handled: false };
  const view = withFirstTask(ctx, floor, job, { show: false, stages: [], questions: [], checking: false });
  if (!view.firstTask || view.firstTask.role !== role) return { handled: false };
  const task = discoveryTask(job);
  if (!task) return { handled: false };
  const roster = rosterOf(ctx);
  const tf = teamFloor(ctx, floor);
  const m = roster.data(floor.id).members[role];
  const w = roster.workerOf(tf, m);
  if (!w) return { handled: true, error: `${m.name} isn't at work` };
  // Through the team's own delivery, as the PM's task: its record on disk first, then typed (held if a question is open).
  const prep = await roster.tasks.prepare(tf, w.id, task.prompt, 'queue');
  if (prep.error !== undefined) return { handled: true, error: prep.error };
  const r = roster.delivery.send(tf, w, prep.text, { origin: 'person', by, wake: true, resume: false });
  if (r.status === 'refused') return { handled: true, error: r.why };
  roster.tasks.assign(tf, w.id, prep.text, by, 'queue', prep.task?.executionId);
  audit.record({ floor: floor.id, actor: byWhom(by, owner), action: 'setup.first-task', target: { kind: 'worker', id: w.id, label: m.name }, summary: `Started Discovery: handed ${task.title} to ${m.name}`, details: { role } });
  tf.activity?.(`▶️ ${by} started Discovery: ${m.name} has its first task`);
  return { handled: true };
}
