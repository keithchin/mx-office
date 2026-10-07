// The performance guard's big-data fixture: a whole test office's data, synthetic and deterministic,
// for the page and API timing tests to load. scale 1 is roughly mx-spike's size; scale 10 (the default)
// ten times that, as far as the office's own caps let a floor grow (see CAPS below).
//
//   node --import tsx scripts/perf/fixture.ts --out <dir> [--seed 42] [--scale 10] [--base <ms or ISO date>]
//
// It writes:
//   <out>/office/.agent-office/   the office's data dir: floors.json, roster/, chatter/, analysis/,
//                                 budget/, incidents/, audit/, project-run.json
//   <out>/floors/big-spike/       the big project: a git repo (one commit) whose .agent-office/ holds
//                                 workers.json and queue.json
//   <out>/floors/small-app/       a small second project, so multi-project views have two
//
// The same seed, scale and base give the same bytes. --base is the newest moment in the data (default
// 2026-10-01 UTC): pass a recent one (the harness does) so the views treat the data as current; the
// office trims what's older than its windows (30 days of budget detail, 7 days of chatter backfill).
// Live workers: saved mid-turn with a session, so an office started on it with a fake --agent wakes them
// at start (see fixture/workers.ts). The queue is saved paused (maxWorkers 0), so nothing else is hired.
// Run it only into a test office's folder (under scratch/test-offices): the office it's for has to be
// in test mode.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_BASE, Gen } from './fixture/gen.js';
import { rosterData, type RosterCounts } from './fixture/roster.js';
import { analysis, audit, chatter, incidents } from './fixture/logs.js';
import { floorBudget, officeBudget } from './fixture/budget.js';
import { makeCast, queueJson, workersJson } from './fixture/workers.js';

export interface FixtureOpts {
  out: string;
  seed?: number;
  scale?: number;
  /** The newest moment in the data (ms). */
  base?: number;
}

export interface Fixture {
  /** Where to start the office (its data dir is <officeDir>/.agent-office). */
  officeDir: string;
  dataDir: string;
  floors: { id: string; dir: string }[];
  mainFloor: string;
  /** The workers the office will wake at start (the fake agent's). */
  liveWorkerIds: string[];
  /**
   * Each worker's transcript (its saved tracker points there, read to its end): a fake agent may append
   * real-shaped lines to its own and name it in its hooks' transcript_path.
   */
  transcripts: Record<string, string>;
  /** What was written, for the report and the tests. */
  counts: Record<string, number>;
}

/**
 * The office's own caps on what a floor keeps (roster/store.ts, held.ts, relays.ts, subagent-live.ts,
 * subagents.ts, queue.ts restores any number): the fixture fills them rather than writing what the
 * office would drop on load.
 */
export const CAPS = { standups: 30, proposals: 300, escalations: 200, held: 200, outbox: 50, liveRuns: 50, runsPer: 50, actions: 100 } as const;

export const MAIN_FLOOR = 'big-spike';
export const SMALL_FLOOR = 'small-app';

const counts = (s: number): RosterCounts => ({
  standups: Math.min(CAPS.standups, 3 * s),
  proposals: Math.min(CAPS.proposals, 30 * s),
  escalations: Math.min(CAPS.escalations, 20 * s),
  subagentTypes: Math.max(1, Math.round(s)),
  runsPer: Math.min(CAPS.runsPer, 5 * s),
  liveRuns: Math.min(CAPS.liveRuns, 5 * s),
  actions: Math.min(CAPS.actions, 10 * s),
  held: Math.min(CAPS.held, 20 * s),
  outbox: Math.min(CAPS.outbox, 5 * s),
});

const write = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const json = (file: string, v: unknown) => write(file, `${JSON.stringify(v, null, 2)}\n`);

function gitInit(dir: string, name: string, at: number) {
  write(path.join(dir, 'README.md'), `# ${name}\n\nA synthetic project for the office's performance tests.\n`);
  write(path.join(dir, '.gitignore'), '.agent-office/\n');
  const date = new Date(at).toISOString();
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'Initial commit');
}

export async function generateFixture(opts: FixtureOpts): Promise<Fixture> {
  const seed = opts.seed ?? 42;
  const scale = Math.max(0.5, opts.scale ?? 10);
  const out = path.resolve(opts.out);
  const g = new Gen(seed, opts.base ?? DEFAULT_BASE);
  const officeDir = path.join(out, 'office');
  const dataDir = path.join(officeDir, '.agent-office');
  mkdirSync(dataDir, { recursive: true });
  const c: Record<string, number> = {};

  const floors = [
    { id: MAIN_FLOOR, name: 'Big Spike', dir: path.join(out, 'floors', MAIN_FLOOR), workers: Math.min(30, Math.max(8, Math.round(3 * scale))), live: 6, team: true, scale },
    { id: SMALL_FLOOR, name: 'Small App', dir: path.join(out, 'floors', SMALL_FLOOR), workers: 3, live: 0, team: false, scale: 0.5 },
  ];
  json(
    path.join(dataDir, 'floors.json'),
    floors.map((f, i) => ({ id: f.id, name: f.name, dir: f.dir, palette: i, addedBy: 'the office', addedAt: g.base - 40 * 86_400_000 + i * 3_600_000 })),
  );
  json(path.join(dataDir, 'project-run.json'), { pauses: {}, pacing: {} });
  json(path.join(dataDir, 'budget', 'office.json'), officeBudget(g));

  const liveWorkerIds: string[] = [];
  const transcripts: Record<string, string> = {};
  const allRuns: unknown[] = [];
  const allClasses: Record<string, unknown> = {};
  for (const f of floors) {
    const s = f.scale;
    const cast = makeCast(g, f.id, f.workers, f.live, f.team);
    liveWorkerIds.push(...cast.workers.filter((w) => w.live).map((w) => w.id));
    gitInit(f.dir, f.name, g.base - 40 * 86_400_000);
    const fdata = path.join(f.dir, '.agent-office');
    const ws = workersJson(g, cast, f.dir, (w) => Math.round((w.role ? 60 : 10) * s));
    json(path.join(fdata, 'workers.json'), ws.saved);
    for (const [id, t] of Object.entries(ws.transcripts)) {
      write(t.file, t.text);
      transcripts[id] = t.file;
    }
    const queue = queueJson(g, cast, Math.round(20 * s));
    json(path.join(fdata, 'queue.json'), queue);

    const roster = rosterData(g, cast, counts(s));
    json(path.join(dataDir, 'roster', `${f.id}.json`), roster);
    const chat = chatter(g, cast, roster, Math.round(3000 * s), 30);
    write(path.join(dataDir, 'chatter', `${f.id}.jsonl`), chat.jsonl);
    write(path.join(dataDir, 'chatter', `${f.id}.state.json`), chat.state);
    write(path.join(dataDir, 'audit', `${f.id}.jsonl`), audit(g, cast, f.id, Math.round(2000 * s), 30));
    const budget = floorBudget(g, cast, 60, Math.max(1, Math.round(s / 3)));
    write(path.join(dataDir, 'budget', `${f.id}.json`), JSON.stringify(budget));
    const an = analysis(g, cast, Math.round(40 * s), 60);
    allRuns.push(...an.runs);
    Object.assign(allClasses, an.classes);

    if (f.id === MAIN_FLOOR) {
      Object.assign(c, {
        workers: cast.workers.length,
        live: f.live,
        queue: queue.tasks.length,
        standups: roster.standups.length,
        proposals: roster.proposals.length,
        escalations: roster.escalations.length,
        openEscalations: roster.escalations.filter((e) => e.status === 'open').length,
        subagents: Object.keys(roster.subagents).length,
        subagentRunsTotal: Object.values(roster.subagents).reduce((n, r) => n + r.runs.length, 0),
        liveRuns: roster.subagentRuns.length,
        subagentActions: roster.subagentActions.length,
        held: roster.held.length,
        chatter: Math.round(3000 * s),
        audit: Math.round(2000 * s),
        ledgerRows: budget.ledger.rows.length,
        ledgerDays: Object.keys(budget.ledger.days).length,
        analysisRuns: an.runs.length,
      });
    }
  }
  write(path.join(dataDir, 'analysis', 'runs.jsonl'), `${allRuns.map((r) => JSON.stringify(r)).join('\n')}\n`);
  json(path.join(dataDir, 'analysis', 'classes.json'), allClasses);
  write(path.join(dataDir, 'audit', '_office.jsonl'), audit(g, undefined, undefined, Math.round(200 * scale), 30));
  const nInc = Math.round(10 * scale);
  write(path.join(dataDir, 'incidents', 'incidents.jsonl'), incidents(g, floors.map((f) => f.id), nInc, 30));
  c.incidents = nInc;
  c.officeAudit = Math.round(200 * scale);

  return { officeDir, dataDir, floors: floors.map((f) => ({ id: f.id, dir: f.dir })), mainFloor: MAIN_FLOOR, liveWorkerIds, transcripts, counts: c };
}

// The command line.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const out = arg('out');
  if (!out) {
    console.error('usage: node --import tsx scripts/perf/fixture.ts --out <dir> [--seed 42] [--scale 10] [--base <ms|ISO date>]');
    process.exit(2);
  }
  const b = arg('base');
  const base = b === undefined ? undefined : /^\d+$/.test(b) ? Number(b) : Date.parse(b);
  if (base !== undefined && !Number.isFinite(base)) {
    console.error(`--base ${b} isn't a time`);
    process.exit(2);
  }
  const t0 = performance.now();
  const f = await generateFixture({ out, seed: arg('seed') ? Number(arg('seed')) : undefined, scale: arg('scale') ? Number(arg('scale')) : undefined, base });
  console.log(JSON.stringify({ ...f, ms: Math.round(performance.now() - t0) }, null, 2));
}
