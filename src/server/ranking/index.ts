// The worker ranking, as the office runs it: gathers the facts (facts.ts) from the analyzer, the floors
// and their rosters, grades and ranks everyone (shared/ranking/), and keeps two small files in the
// office's data dir: each worker's score per day (ranking/history.json, for the trend) and the small
// model's highlights (ranking/highlights.json, one ask per worker per day at most). One per office,
// made the first time something asks for it, like the analyzer.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildRanking, groupStats, type Highlight, type RankedWorker, type RankingReport } from '../../shared/ranking/report.js';
import { ROLE_BY_ID } from '../../shared/roster/roles.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import { analysisOf } from '../analysis/index.js';
import type { Haiku } from '../analysis/llm.js';
import type { Ctx } from '../office/context.js';
import { readJournal } from '../roster/journal-io.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { projectFacts } from '../summary/project.js';
import { gatherFacts, type FloorInput } from './facts.js';

const DAYS_KEPT = 60;
/** At most this many highlight asks start per look at the ranking; the rest wait for the next look. */
const ASKS_PER_LOOK = 3;

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

function readJson<T>(file: string, fallback: T): T {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, v: unknown) {
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.tmp`, JSON.stringify(v), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  } catch {
    // disk issues shouldn't take the office down
  }
}

const SYSTEM = `You write short highlights for a leaderboard of AI coding agents. Given one agent's evidence, write 2 to 4 highlights of what it achieved.
Each is one plain line under 90 characters, a concrete fact from the evidence (a PR number, a score, a time), no praise words, no guesses, no markdown. If there is nothing it achieved, return an empty list.`;
const SCHEMA = { type: 'object', properties: { highlights: { type: 'array', items: { type: 'string' } } }, required: ['highlights'], additionalProperties: false };

interface Cached {
  day: string;
  hash: string;
  items: string[];
}

export class Ranking {
  private historyFile: string;
  private highlightFile: string;
  /** key → day → score. */
  private history: Record<string, Record<string, number>>;
  private cache: Record<string, Cached>;
  private asking = new Set<string>();

  constructor(
    dataDir: string,
    private haiku: Haiku | null,
  ) {
    this.historyFile = path.join(dataDir, 'ranking', 'history.json');
    this.highlightFile = path.join(dataDir, 'ranking', 'highlights.json');
    this.history = readJson(this.historyFile, {});
    this.cache = readJson(this.highlightFile, {});
  }

  report(floors: FloorInput[], runs: Parameters<typeof gatherFacts>[1], opts: { floor?: string; names: { id: string; name: string }[]; now?: number }): RankingReport {
    const now = opts.now ?? Date.now();
    const today = day(now);
    const facts = gatherFacts(floors, runs);
    // Everyone, so each day's scores are kept whichever floor is looked at; then the floor's share.
    const r = buildRanking(facts, runs, {
      floors: opts.names,
      now,
      previous: (key) => {
        const days = Object.keys(this.history[key] ?? {}).filter((d) => d < today).sort();
        return days.length ? this.history[key][days[days.length - 1]] : undefined;
      },
      highlights: (key) => {
        const c = this.cache[key];
        return c?.items.length ? c.items.map((text) => ({ text, by: 'ai' as const })) : undefined;
      },
    });
    this.remember(r.workers, today);
    if (!opts.floor) {
      this.askForHighlights(r.workers, today);
      return r;
    }
    const workers = r.workers.filter((w) => w.floor === opts.floor);
    this.askForHighlights(workers, today);
    return { ...r, scope: 'floor', floor: opts.floor, workers, byModel: groupStats(workers, (w) => [w.modelLabel, w.modelLabel]), byRole: groupStats(workers, (w) => [w.role, w.roleLabel]) };
  }

  /** Today's score for everyone graded. */
  private remember(ws: RankedWorker[], today: string) {
    let changed = false;
    for (const w of ws) {
      if (w.score === undefined) continue;
      const h = (this.history[w.key] ??= {});
      if (h[today] === w.score) continue;
      h[today] = w.score;
      for (const d of Object.keys(h).sort().slice(0, -DAYS_KEPT)) delete h[d];
      changed = true;
    }
    if (changed) writeJson(this.historyFile, this.history);
  }

  /** The small model's highlights, in the background: a worker whose evidence changed, once a day at most. */
  private askForHighlights(ws: RankedWorker[], today: string) {
    const model = this.haiku;
    if (!model?.enabled || process.env.AGENT_OFFICE_RANKING_LLM === 'off') return;
    let started = 0;
    for (const w of ws) {
      if (started >= ASKS_PER_LOOK) break;
      if (w.score === undefined || this.asking.has(w.key)) continue;
      const evidence = evidenceText(w);
      const hash = createHash('sha256').update(evidence).digest('hex').slice(0, 16);
      const c = this.cache[w.key];
      if (c && (c.hash === hash || c.day === today)) continue;
      started++;
      this.asking.add(w.key);
      void model
        .ask(SYSTEM, evidence, SCHEMA)
        .then((v) => {
          const items = Array.isArray(v?.highlights) ? (v.highlights as unknown[]).filter((s): s is string => typeof s === 'string').map((s) => s.replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 4) : null;
          // Asked either way, so a failing model isn't asked again today; its empty answer leaves the rules' highlights showing.
          this.cache[w.key] = { day: today, hash, items: items ?? [] };
          writeJson(this.highlightFile, this.cache);
        })
        .finally(() => this.asking.delete(w.key));
    }
  }
}

/** The evidence for one worker, as the model is shown it. */
export function evidenceText(w: RankedWorker): string {
  const crit = [...w.standard, ...(w.specialist?.criteria ?? [])].filter((c) => c.evidence.length).map((c) => `${c.label}${c.score !== undefined ? ` (${Math.round(c.score)}/100)` : ''}:\n${c.evidence.map((e) => `- ${e}`).join('\n')}`);
  return [`Agent: ${w.name}, ${w.roleLabel}, ${w.modelLabel}, ${w.tasks} task(s)`, ...crit, `Rule-based highlights so far:\n${w.highlights.map((h: Highlight) => `- ${h.text}`).join('\n') || '(none)'}`].join('\n\n');
}

const offices = new WeakMap<object, Ranking>();

export function rankingOf(ctx: Pick<Ctx, 'cfg'>): Ranking {
  let r = offices.get(ctx.cfg);
  if (!r) {
    r = new Ranking(ctx.cfg.dataDir, analysisOf(ctx).haiku);
    offices.set(ctx.cfg, r);
  }
  return r;
}

/**
 * A report is reused for this long: working it out reads every floor's analysis, journals and checkout and
 * took a quarter of a second on a big floor, and the Workers tab, Home and every open browser each ask
 * (the performance guard, 2026-10-07). Grades only move as tasks finish, so a few seconds old is fine.
 */
export const RANKING_TTL_MS = 10_000;
const recent = new WeakMap<object, Map<string, { at: number; report: RankingReport }>>();

/** The ranking for the whole building (no floor) or one floor, from the real office (at most RANKING_TTL_MS old). */
export function rankingReport(ctx: Ctx, floor?: string, now = Date.now()): RankingReport {
  let byFloor = recent.get(ctx.cfg);
  if (!byFloor) recent.set(ctx.cfg, (byFloor = new Map()));
  const key = floor ?? '';
  const had = byFloor.get(key);
  if (had && now - had.at < RANKING_TTL_MS) return had.report;
  const report = freshRankingReport(ctx, floor);
  byFloor.set(key, { at: now, report });
  return report;
}

function freshRankingReport(ctx: Ctx, floor?: string): RankingReport {
  const floors = [...ctx.floors.values()];
  // The analyzer's own look first: it records the workers already at their desks the first time, and settles finished ones.
  const analysis = analysisOf(ctx).report(floors, {});
  const roster = rosterOf(ctx);
  const inputs: FloorInput[] = floors.map((f) => {
    const team = teamFloor(ctx, f);
    return {
      id: f.id,
      name: f.def.name,
      workers: f.workers.list(),
      roster: roster.data(f.id),
      pulls: f.github.pulls.items,
      journal: (role, w: WorkerInfo | undefined) => readJournal(team, w, ROLE_BY_ID.get(role)!.team),
      project: projectFacts(f.dir),
    };
  });
  return rankingOf(ctx).report(inputs, analysisOf(ctx).store.all(), { floor, names: analysis.floors });
}
