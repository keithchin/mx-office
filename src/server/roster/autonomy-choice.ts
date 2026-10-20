// The autonomy step's server side (shared/roster/autonomy-step.ts): the office's organisation policy (a small
// file under <data>/governance/, off by default), each project's record of how its level was set (chosen in
// the New project flow, set by the policy, or the default for an older caller; who and when; the latest
// change made on the Team settings since), the check a plan gets at /api/wizard/start, and what the setup's
// team step does with it. A project with no record predates the step (or came in another way): its settings
// are never touched, and its budget level keeps setting autonomy by stage as it always did.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AUTONOMY, isAutonomyLevel, type AutonomyLevel } from '../../shared/roster/autonomy.js';
import {
  BY_STAGE_TO,
  NO_POLICY,
  SOURCE_LABEL,
  askProblem,
  cleanPolicy,
  olderCallerLevel,
  policyWords,
  type AutonomyAsk,
  type AutonomyChange,
  type AutonomyChoice,
  type AutonomyPolicy,
  type AutonomyRecordView,
} from '../../shared/roster/autonomy-step.js';
import type { ProjectPlan } from '../../shared/wizard.js';
import type { LevelSettings } from '../../shared/budget/levels.js';
import { audit, human } from '../audit/index.js';

// ---- Files --------------------------------------------------------------------------------------

const cache = new Map<string, unknown>();

function readJson<T>(file: string, clean: (v: unknown) => T): T {
  if (cache.has(file)) return cache.get(file) as T;
  let v: T;
  try {
    v = clean(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    v = clean(undefined);
  }
  cache.set(file, v);
  return v;
}

function writeJson(file: string, v: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(v, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  cache.set(file, v);
}

const policyFile = (dataDir: string) => path.join(dataDir, 'governance', 'autonomy-policy.json');
const recordFile = (dataDir: string, floorId: string) => path.join(dataDir, 'autonomy', `${floorId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);

// ---- The policy ----------------------------------------------------------------------------------

export const autonomyPolicy = (dataDir: string): AutonomyPolicy => readJson(policyFile(dataDir), cleanPolicy);

/** A new policy from an admin (audited as settings.change); the policy, or why not. */
export function setAutonomyPolicy(dataDir: string, raw: unknown, who: { name: string; id?: string }, now = Date.now()): AutonomyPolicy | string {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!['none', 'limit', 'fixed'].includes(r.mode as string)) return 'mode is none, limit or fixed';
  if (r.mode === 'fixed' && !isAutonomyLevel(r.level)) return 'Pick the level to fix';
  if (r.mode === 'limit' && (!Array.isArray(r.allowed) || !r.allowed.some(isAutonomyLevel))) return 'Tick at least one level to allow';
  const next = cleanPolicy({ ...r, by: who.name, at: now });
  if (r.mode === 'limit' && next.mode === 'none') return 'Allowing every level is no limit: choose None instead';
  const before = autonomyPolicy(dataDir);
  writeJson(policyFile(dataDir), next.mode === 'none' ? { ...NO_POLICY, by: who.name, at: now } : next);
  audit.record({
    actor: human(who.name, who.id),
    action: 'settings.change',
    target: { kind: 'setting', id: 'autonomy.policy', label: 'Autonomy policy for new projects' },
    summary: `Set the autonomy policy for new projects to "${policyWords(next)}" (was "${policyWords(before)}")`,
    details: { before: { mode: before.mode, allowed: before.allowed, level: before.level, name: before.name }, after: { mode: next.mode, allowed: next.allowed, level: next.level, name: next.name } },
    severity: 'warning',
  });
  return next;
}

// ---- A project's record --------------------------------------------------------------------------

interface RecordFile {
  choice?: AutonomyChoice;
  last?: AutonomyChange;
}
const cleanRecord = (v: unknown): RecordFile => (v && typeof v === 'object' ? (v as RecordFile) : {});

export const autonomyRecord = (dataDir: string, floorId: string): RecordFile => readJson(recordFile(dataDir, floorId), cleanRecord);

/** What the Team settings show about the level's origin (GET /api/roster). */
export const autonomyRecordView = (dataDir: string, floorId: string): AutonomyRecordView => ({ ...autonomyRecord(dataDir, floorId), policy: autonomyPolicy(dataDir) });

/**
 * Whether the project chose its level in the autonomy step (or had it set by the policy there): then its
 * budget level never changes autonomy (budget/index.ts applyLevelToTeam). Older projects keep the old way.
 */
export function autonomySeparate(dataDir: string, floorId: string): boolean {
  const s = autonomyRecord(dataDir, floorId).choice?.source;
  return s === 'chosen' || s === 'policy';
}

/** A level changed on the Team settings after creation: who, when, from and to (the audit log has it too, as roster.autonomy). */
export function noteAutonomyChange(dataDir: string, floorId: string, from: AutonomyLevel, to: AutonomyLevel, who: { name: string; id?: string }, now = Date.now()) {
  if (from === to) return;
  const had = autonomyRecord(dataDir, floorId);
  writeJson(recordFile(dataDir, floorId), { ...had, last: { from, to, by: who.name, ...(who.id ? { byId: who.id } : {}), at: now } });
}

// ---- At /api/wizard/start --------------------------------------------------------------------------

/** A plan from the New project flow (its brief came from a draft in the office): the step is required. */
export const fromNewFlow = (plan: Pick<ProjectPlan, 'brief'>) => !!plan.brief?.draftId;

/** The step's answer from what the page sent (anything else in it is the office's to write). */
export function cleanAsk(v: unknown): AutonomyAsk | undefined {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if (!isAutonomyLevel(r.level)) return undefined;
  return { level: r.level, ...(r.ack === true ? { ack: true } : {}), ...(r.byStage === true ? { byStage: true } : {}) };
}

/**
 * The record a plan's setup will apply: the step's choice (refused when missing, outside the policy, or
 * not acknowledged under a fixed level) for a plan from the New project flow; for an older caller (the
 * classic form, scripts, the API without a brief) level 2 Guided, or the nearest the policy allows.
 */
export function resolveAutonomy(plan: Pick<ProjectPlan, 'brief' | 'autonomy'>, policy: AutonomyPolicy, who: { name: string; id?: string }, now = Date.now()): AutonomyChoice | string {
  const by = { by: who.name, ...(who.id ? { byId: who.id } : { shared: true }), at: now };
  const named = policy.name ? { policy: policy.name } : {};
  if (fromNewFlow(plan)) {
    const ask = cleanAsk(plan.autonomy);
    const bad = askProblem(ask, policy);
    if (bad) return bad;
    const fixed = policy.mode === 'fixed';
    return { level: ask!.level, source: fixed ? 'policy' : 'chosen', ...by, ...(fixed ? { ...named, acknowledged: true } : {}), ...(ask!.byStage ? { byStage: true } : {}) };
  }
  const d = olderCallerLevel(policy);
  return { level: d.level, source: d.source, ...by, ...(d.source === 'policy' ? named : {}) };
}

// ---- At the setup's team step ----------------------------------------------------------------------

export interface ApplyDeps {
  dataDir: string;
  /** The project's current level (before anything is applied). */
  level(): AutonomyLevel;
  /** The Team settings' own change (Members.settings): audited as roster.settings / roster.autonomy, Playbooks rewritten. */
  settings(patch: Record<string, unknown>, by: string, byId?: string): string | undefined;
}

/**
 * Applies a setup's record to its project, once: the level (and autonomy by stage, off unless ticked) for
 * a choice made in the step; for an older caller's default, the level only on a project this setup made
 * (`existed`: the project was there before the setup, so it keeps its settings and gets no record).
 * Audited as autonomy.choice. Returns what happened, for the setup's log.
 */
export function applyAutonomyChoice(floorId: string, choice: AutonomyChoice, existed: boolean, deps: ApplyDeps): string {
  const had = autonomyRecord(deps.dataDir, floorId).choice;
  if (had && had.at === choice.at && had.level === choice.level) return 'autonomy: already applied';
  const stepped = choice.source === 'chosen' || (choice.source === 'policy' && choice.acknowledged === true);
  if (!stepped && existed) return `autonomy: kept at ${deps.level()} (the project was there before this setup)`;
  const patch: Record<string, unknown> = { autonomy: choice.level };
  // Chosen in the step: autonomy by stage only when ticked there (never from the budget level).
  if (stepped) patch.autonomyByStage = { enabled: choice.byStage === true, early: choice.level, build: BY_STAGE_TO };
  const err = deps.settings(patch, choice.by, choice.byId);
  if (err) return `autonomy: couldn't set level ${choice.level}: ${err}`;
  writeJson(recordFile(deps.dataDir, floorId), { choice });
  const lvl = `${choice.level} ${AUTONOMY[choice.level].name}`;
  audit.record({
    floor: floorId,
    actor: human(choice.by, choice.byId),
    action: 'autonomy.choice',
    target: { kind: 'settings', id: floorId, label: 'Autonomy level' },
    summary: `Autonomy ${lvl}: ${SOURCE_LABEL[choice.source]}${choice.policy ? ` (${choice.policy})` : ''}${choice.acknowledged ? ', acknowledged' : ''}${choice.byStage ? `, rising to ${BY_STAGE_TO} once the build plan passes` : ''}`,
    details: { level: choice.level, source: choice.source, ...(choice.shared ? { shared: true } : {}), ...(choice.policy ? { policy: choice.policy } : {}), ...(choice.acknowledged ? { acknowledged: true } : {}), ...(choice.byStage ? { byStage: true } : {}) },
    severity: 'notice',
  });
  return `autonomy: ${lvl} (${SOURCE_LABEL[choice.source]})`;
}

/** For the tests: forget what was read. */
export const forgetAutonomyFiles = () => cache.clear();

/**
 * The team settings a budget level sets (budget/index.ts applyLevelToTeam): early drafts, the subagents at
 * once, and autonomy by stage, except on a project whose autonomy is its own (`separate`, autonomySeparate).
 */
export function levelTeamPatch(s: Pick<LevelSettings, 'earlyDrafts' | 'autonomyByStage'>, maxSubagents: number, separate: boolean): Record<string, unknown> {
  return { earlyDrafts: s.earlyDrafts, ...(separate ? {} : { autonomyByStage: s.autonomyByStage }), maxSubagents };
}
