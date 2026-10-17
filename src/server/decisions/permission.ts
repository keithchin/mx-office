// A permission card's two buttons (roster/escalation-fold.ts): the agent's tool call was denied by Claude
// Code's permission layer, which an Approve in the office never changes. "Allow this command for <role> on
// this project" writes the allow rule for exactly that command into the role's folder's
// .claude/settings.local.json (where the office already writes Claude Code permission rules for a project:
// a benched subagent's deny, roster/subagent-files.ts), leaving everything else in it, tells the agent to
// retry, and keeps the card open until the office sees the command run. "Keep blocked" answers it as
// rejected. Nothing is ever allowed without that press; a wildcard or a broken settings file is refused
// with what to change by hand.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Escalation } from '../../shared/roster/escalation.js';
import type { Roster } from '../roster/index.js';
import type { TeamFloor } from '../roster/types.js';
import { answerGroup } from '../roster/escalation-answer.js';
import type { AnswerResult } from '../dispatch/service.js';
import { audit, human } from '../audit/index.js';

export const SETTINGS_FILE = '.claude/settings.local.json';

/**
 * The settings file's text (`raw`, undefined when there's none) with `rule` in permissions.allow, the rest
 * kept: the new text, `same` when it's there already, or an error for a file that isn't a JSON object.
 */
export function withAllowRule(raw: string | undefined, rule: string): { text: string } | 'same' | { error: string } {
  let cfg: Record<string, unknown> = {};
  if (raw !== undefined && raw.trim()) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'it is not a JSON object' };
      cfg = v as Record<string, unknown>;
    } catch (err) {
      return { error: `it is not valid JSON (${(err as Error).message})` };
    }
  }
  const perms = (cfg.permissions && typeof cfg.permissions === 'object' && !Array.isArray(cfg.permissions) ? cfg.permissions : {}) as Record<string, unknown>;
  const allow = Array.isArray(perms.allow) ? (perms.allow as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  if (allow.includes(rule)) return 'same';
  perms.allow = [...allow, rule];
  cfg.permissions = perms;
  return { text: `${JSON.stringify(cfg, null, 2)}\n` };
}

/** Writes `rule` into `dir`'s settings file: the file, or why not (with what to do by hand). */
export function allowInFolder(dir: string, rule: string): { file: string; already?: true } | { error: string } {
  const file = path.join(dir, SETTINGS_FILE);
  let raw: string | undefined;
  try {
    raw = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  } catch (err) {
    return { error: `couldn't read ${file} (${(err as Error).message})` };
  }
  const next = withAllowRule(raw, rule);
  if (next === 'same') return { file, already: true };
  if ('error' in next) return { error: `${file} was left alone: ${next.error}. Add ${rule} to its permissions.allow yourself` };
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, next.text);
  } catch (err) {
    return { error: `couldn't write ${file} (${(err as Error).message}). Add ${rule} to its permissions.allow yourself` };
  }
  return { file };
}

/** The worker of the role that asked (or the one that raised it), when it's at work. */
function askerOf(roster: Roster, floor: TeamFloor, e: Escalation) {
  const m = e.role ? roster.data(floor.id).members[e.role] : undefined;
  const w = (m ? roster.workerOf(floor, m) : undefined) ?? floor.worker(e.workerId);
  return w && w.kind === 'agent' ? w : undefined;
}

/** Allow this command: the rule written for the asking role, the agent told to retry; the card stays open. The error, or undefined. */
export async function allowCommand(roster: Roster, floor: TeamFloor, e: Escalation, by: string, owner?: string): Promise<string | undefined> {
  const p = e.permission;
  if (!p) return 'Only for a permission card';
  if (p.allowed) return `Already allowed by ${p.allowed.by}: the card closes once the office sees the command run`;
  // A `*` is a wildcard in Claude Code's rules: allowing "this command" must not allow others.
  if (p.rule.includes('*')) return `The command has a * in it, which Claude Code reads as a wildcard, so the office won't write it. If you mean it, add ${p.rule} to ${SETTINGS_FILE} in ${e.by}'s folder yourself.`;
  const w = askerOf(roster, floor, e);
  if (!w) return `${e.by} isn't at work, so the office doesn't know which folder it will work in. Allow it once ${e.by} is back, or add ${p.rule} to ${SETTINGS_FILE} in its folder yourself.`;
  const dir = floor.cwdOf(w);
  const r = allowInFolder(dir, p.rule);
  if ('error' in r) return r.error;
  const now = roster.deps.now();
  p.allowed = { at: now, by, file: r.file };
  audit.record({ floor: floor.id, actor: human(by, owner), action: 'escalation.permission-allowed', target: { kind: 'escalation', id: e.id, label: e.title }, summary: `Allowed ${p.rule} for ${e.by} in ${r.file}${r.already ? ' (it was there already)' : ''}: open until the office sees it run`, details: { rule: p.rule, file: r.file, already: !!r.already } });
  roster.touch(floor);
  // Told after its turn; the card stays open either way (a tell isn't an answer).
  const told = await roster.escalations.tell(floor, e.id, 'allowed', `${by} allowed \`${p.command}\` for you on this project: ${p.rule} is now in ${r.file}. Run the command again. If Claude Code still denies it, say so (the session may need a restart to read the rule); don't route around it.`, by);
  return told ? `Allowed (${p.rule} is in ${r.file}), but ${e.by} couldn't be told: ${told}` : undefined;
}

/** Keep blocked: answered as rejected, with what that means for the agent. */
export async function keepBlocked(roster: Roster, floor: TeamFloor, e: Escalation, by: string, text: string, expectedRev?: number): Promise<AnswerResult> {
  const p = e.permission!;
  const words = `Keep blocked: don't run \`${p.command}\`, and don't route around the denial. Carry on without it, or propose another way.${text ? ` ${text}` : ''}`;
  const r = await answerGroup(roster, floor, { id: e.id, by, verdict: 'reject', raw: words, expectedRev }, []);
  if (r.ok) {
    p.kept = { at: roster.deps.now(), by };
    roster.touch(floor);
  }
  return r;
}
