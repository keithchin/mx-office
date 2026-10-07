// A floor's people (the cast every other part of the fixture refers to), its workers.json and its queue.json.
//
// A "live" worker is one saved mid-turn (midTurn: true) with a session id and no terminal in the host:
// the office restores it offline, marks it interrupted, and at start wakes it straight away
// (workers/manager.ts start → dozesOnStart false → wakeAll → resume → launch with --resume <session>
// and the carry-on prompt). In a test office started with --agent <fake>, that's the fake that starts.
// The rest are saved at rest, so they doze until prompted.

import path from 'node:path';
import type { QueueTask } from '../../../src/shared/protocol.js';
import { ROLES, type RoleId } from '../../../src/shared/roster/roles.js';
import { Gen, HOUR, MIN, PEOPLE, WORKER_NAMES } from './gen.js';

export interface CastWorker {
  id: string;
  name: string;
  model: 'opus' | 'sonnet' | 'haiku';
  /** The roster role it is, for a team member. */
  role?: RoleId;
  live: boolean;
  createdAt: number;
  deskId: string;
  sessionId: string;
}

export interface Cast {
  floor: string;
  workers: CastWorker[];
  /** Each role's member name, and its worker when hired. */
  members: Record<RoleId, { name: string; workerId?: string }>;
}

/** Desks a worker may sit at (shared/layout.ts DESK_BY_ID: the desks and beanbags, not the stations or meeting seats). */
const DESKS = [...Array.from({ length: 20 }, (_, i) => `desk-${i + 1}`), ...Array.from({ length: 12 }, (_, i) => `beanbag-${i + 1}`)];
const COLORS = ['#ff8a5b', '#5bc0eb', '#9bc53d', '#fde74c', '#c3423f', '#b388eb', '#f7aef8', '#72ddf7', '#ffb400', '#00a6a6'];
/** The roster's own names, fixed so tests can look for them. */
const MEMBER_NAMES: Record<RoleId, string> = { pm: 'Ada', 'lead-designer': 'Hedy', 'lead-developer': 'Linus', 'lead-tester': 'Grace', 'chief-analyst': 'Radia', 'solo-lead': 'Niklaus' };
/** The Enterprise team: everyone but the Solo Lead. */
const TEAM: RoleId[] = ['pm', 'lead-designer', 'lead-developer', 'lead-tester', 'chief-analyst'];

/** Makes the floor's cast: `n` workers (at most 32), `live` of them live; with `team`, the first five are the roster's members. */
export function makeCast(g: Gen, floor: string, n: number, live: number, team: boolean): Cast {
  n = Math.min(n, DESKS.length);
  const members = {} as Cast['members'];
  for (const r of ROLES) members[r.id] = { name: MEMBER_NAMES[r.id] };
  const workers: CastWorker[] = [];
  for (let i = 0; i < n; i++) {
    const role = team && i < TEAM.length ? TEAM[i] : undefined;
    const w: CastWorker = {
      id: g.workerId(),
      name: role ? MEMBER_NAMES[role] : WORKER_NAMES[i % WORKER_NAMES.length],
      model: role === 'pm' || role === 'lead-developer' ? 'opus' : g.pick(['sonnet', 'sonnet', 'haiku', 'opus'] as const),
      ...(role ? { role } : {}),
      live: i < live,
      createdAt: g.ago(20, 2 * HOUR),
      deskId: DESKS[i],
      sessionId: g.uuid(),
    };
    if (role) members[role].workerId = w.id;
    workers.push(w);
  }
  return { floor, workers, members };
}

/**
 * A worker's Claude Code transcript (its session's .jsonl): `turns` exchanges of a prompt now and then,
 * the agent's reply, a tool call and its result, shaped as convo/transcript.ts reads them.
 */
export function transcript(g: Gen, w: CastWorker, turns: number, cwd: string, model: string): string {
  const out: string[] = [];
  let parent: string | null = null;
  let at = w.createdAt;
  const line = (v: Record<string, unknown>) => {
    const uuid = g.uuid();
    out.push(JSON.stringify({ parentUuid: parent, isSidechain: false, userType: 'external', cwd, sessionId: w.sessionId, version: '2.1.0', ...v, uuid, timestamp: new Date(at).toISOString() }));
    parent = uuid;
    at += g.int(2, 90) * 1000;
  };
  for (let t = 0; t < turns; t++) {
    if (t % 6 === 0) line({ type: 'user', message: { role: 'user', content: g.paragraph(1, 14) } });
    const tool = `toolu_${g.hex(24)}`;
    const usage = { input_tokens: g.int(2, 40), output_tokens: g.int(50, 900), cache_creation_input_tokens: g.int(0, 5000), cache_read_input_tokens: g.int(1000, 90000) };
    line({ type: 'assistant', message: { id: `msg_${g.hex(24)}`, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: g.paragraph(g.int(1, 4), 14) }], stop_reason: null, usage } });
    const name = g.pick(['Bash', 'Read', 'Edit', 'Grep', 'Glob'] as const);
    const input = name === 'Bash' ? { command: `npm test -- ${g.pick(['orders', 'invoices', 'approvals'])}`, description: g.sentence(4) } : name === 'Grep' || name === 'Glob' ? { pattern: g.pick(['Order', 'Invoice', '**/*.md']) } : { file_path: `${cwd}/docs/${g.pick(['orders', 'invoices', 'team'])}.md` };
    line({ type: 'assistant', message: { id: `msg_${g.hex(24)}`, type: 'message', role: 'assistant', model, content: [{ type: 'tool_use', id: tool, name, input }], stop_reason: 'tool_use', usage } });
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tool, content: g.sentence(10), is_error: g.chance(0.05) }] } });
  }
  return out.length ? `${out.join('\n')}\n` : '';
}

/**
 * The floor's workers.json, as workers/persist.ts saveWorkers writes it, and each worker's transcript
 * (<floor>/.agent-office/transcripts/<session>.jsonl, marked read to its end so the office books none
 * of it again).
 */
export function workersJson(g: Gen, cast: Cast, floorDir: string, turns: (w: CastWorker) => number): { saved: unknown[]; transcripts: Record<string, { file: string; text: string }> } {
  const transcripts: Record<string, { file: string; text: string }> = {};
  const saved = cast.workers.map((w, i) => {
    const issue = 10 + i;
    const cost = Math.round((0.5 + g.rand() * 40) * 1e4) / 1e4;
    const calls = g.int(10, 900);
    const model = w.model === 'opus' ? 'claude-opus-5-5' : w.model === 'haiku' ? 'claude-haiku-4-5' : 'claude-sonnet-5-5';
    const at = g.base - g.int(1, 120) * MIN;
    const file = path.join(floorDir, '.agent-office', 'transcripts', `${w.sessionId}.jsonl`);
    const text = transcript(g, w, turns(w), floorDir.replaceAll('\\', '/'), model);
    transcripts[w.id] = { file, text };
    return {
      id: w.id,
      kind: 'agent',
      provider: 'claude',
      model: w.model,
      effort: g.pick(['low', 'medium', 'high']),
      deskId: w.deskId,
      name: w.name,
      color: COLORS[i % COLORS.length],
      createdBy: w.role ? 'the office (team)' : g.pick(PEOPLE),
      createdAt: w.createdAt,
      prompt: w.role ? `You are ${w.name}, the team's ${w.role}. Read your Playbook and carry on with the project.` : `Work on GitHub issue #${issue} in this repo: read it with \`gh issue view ${issue}\` and follow it exactly.`,
      title: w.role ? `${w.name} (${w.role})` : `GitHub issue #${issue}`,
      sessionId: w.sessionId,
      activity: w.live ? `Bash: npm test -- ${g.pick(['orders', 'invoices', 'approvals'])}` : g.pick(['Finished its turn', 'Read docs/team/development.md', 'Edit src/modules/orders.md']),
      task: { name: g.title(), summary: g.sentence(9) },
      ...(g.chance(0.4) ? { pr: { number: 100 + i, url: `https://github.invalid/example/${cast.floor}/pull/${100 + i}` } } : {}),
      ...(g.chance(0.3) ? { pastPrs: [50 + i, 70 + i] } : {}),
      workedMs: g.int(5, 600) * MIN,
      tracker: {
        files: { [file]: { offset: Buffer.byteLength(text) } },
        transcript: file,
        since: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 },
        base: { input: calls * 400, output: calls * 300, cacheWrite: calls * 9000, cacheRead: calls * 50000, cost, calls, at },
        at,
        model,
        parts: { [`|${model}`]: { cost, calls } },
      },
      hookToken: g.hex(32),
      midTurn: w.live,
    };
  });
  return { saved, transcripts };
}

/** The floor's queue.json (queue.ts): paused (maxWorkers 0) so nothing is seated by itself; queued, running and done tasks. */
export function queueJson(g: Gen, cast: Cast, n: number): { maxWorkers: number; tasks: QueueTask[] } {
  const tasks: QueueTask[] = [];
  const running = cast.workers.filter((w) => w.live && !w.role);
  for (let i = 0; i < n; i++) {
    const issue = 200 + i;
    const addedAt = g.ago(25, HOUR);
    const kind = i < running.length ? 'running' : g.pick(['queued', 'done', 'done', 'queued'] as const);
    const t: QueueTask = {
      id: g.hex(12),
      provider: 'claude',
      model: g.pick(['sonnet', 'haiku']),
      effort: 'medium',
      issue,
      title: `Issue #${issue}: ${g.title()}`,
      prompt: `Work on GitHub issue #${issue} in this repo: read it with \`gh issue view ${issue}\` and follow it exactly.`,
      addedBy: g.pick(PEOPLE),
      addedAt,
      status: kind,
    };
    if (kind === 'running') {
      const w = running[i];
      Object.assign(t, { attemptId: g.hex(8), workerId: w.id, workerName: w.name, branch: `feature/issue-${issue}`, startedAt: addedAt + 5 * MIN });
    } else if (kind === 'done') {
      const ok = g.chance(0.8);
      Object.assign(t, { attemptId: g.hex(8), workerId: g.workerId(), workerName: g.pick(cast.workers).name, branch: `feature/issue-${issue}`, startedAt: addedAt + 5 * MIN, finishedAt: addedAt + g.int(1, 30) * 10 * MIN, outcome: ok ? 'done' : g.pick(['exited', 'killed', 'failed'] as const) });
      if (ok && g.chance(0.6)) t.pr = { number: 300 + i, url: `https://github.invalid/example/${cast.floor}/pull/${300 + i}`, state: g.pick(['OPEN', 'MERGED']), title: t.title };
    }
    tasks.push(t);
  }
  tasks.sort((a, b) => a.addedAt - b.addedAt);
  return { maxWorkers: 0, tasks };
}

