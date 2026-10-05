// What a subagent's standing does to the files in its Lead's folder. A warning is a dated section at the
// end of its definition (.claude/agents/<name>.md), lessons for its next runs; a model swap is the
// definition's `model:`; benched moves the definition to .claude/agents.benched/ (so a new session
// doesn't load it) and denies `Agent(<name>)` in .claude/settings.local.json (so the running session
// can't dispatch it either); reinstating undoes both and keeps the warnings.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SubagentRecord } from '../../shared/roster/subagents.js';

export const agentsDir = '.claude/agents';
export const benchedDir = '.claude/agents.benched';
const SETTINGS = '.claude/settings.local.json';
const START = '<!-- agent-office:warnings (written by Agent Office; the Project Manager or the Lead put this subagent on warning) -->';
const END = '<!-- /agent-office:warnings -->';

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `text` with the record's model in its frontmatter and its warnings as the closing section. */
export function withStanding(text: string, rec: Pick<SubagentRecord, 'model' | 'warnings'> | undefined): string {
  let out = text;
  const start = out.indexOf(START);
  if (start >= 0) {
    const end = out.indexOf(END, start);
    out = (out.slice(0, start).trimEnd() + (end >= 0 ? out.slice(end + END.length) : '')).trimEnd() + '\n';
  }
  if (rec?.model) {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(out);
    if (fm) {
      const body = /^model:.*$/m.test(fm[1]) ? fm[1].replace(/^model:.*$/m, `model: ${rec.model}`) : `${fm[1]}\nmodel: ${rec.model}`;
      out = `---\n${body}\n---${out.slice(fm[0].length)}`;
    }
  }
  if (rec?.warnings.length) {
    const notes = rec.warnings.map((w) => `## ⚠️ Warning (${day(w.at)}): ${w.reason}\nRead this before you start: don't repeat it. (Put on warning by ${w.by}.)`);
    out = `${out.trimEnd()}\n\n${START}\n${notes.join('\n\n')}\n${END}\n`;
  }
  return out;
}

/** Where a subagent's definition is in `dir`: active, benched, or nowhere (a built-in, or never written). */
export function definitionOf(dir: string, name: string): { file: string; benched: boolean } | undefined {
  for (const [rel, benched] of [[agentsDir, false], [benchedDir, true]] as const) {
    const file = path.join(dir, rel, `${name}.md`);
    if (existsSync(file)) return { file, benched };
  }
  return undefined;
}

/** Writes `text` as the definition, in the folder its standing puts it, and takes it out of the other. True when anything changed. */
export function placeDefinition(dir: string, name: string, text: string, benched: boolean): boolean {
  const want = path.join(dir, benched ? benchedDir : agentsDir, `${name}.md`);
  const other = path.join(dir, benched ? agentsDir : benchedDir, `${name}.md`);
  let changed = false;
  if (!existsSync(want) || readFileSync(want, 'utf8') !== text) {
    mkdirSync(path.dirname(want), { recursive: true });
    writeFileSync(want, text);
    changed = true;
  }
  if (existsSync(other)) {
    rmSync(other);
    changed = true;
  }
  return changed;
}

/** Denies (or allows again) dispatching `name` in the folder's .claude/settings.local.json, leaving everything else in it. */
export function denyDispatch(dir: string, name: string, deny: boolean): boolean {
  const file = path.join(dir, SETTINGS);
  let cfg: Record<string, unknown> = {};
  try {
    if (existsSync(file)) cfg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    // a broken file is left alone
    return false;
  }
  const perms = (cfg.permissions && typeof cfg.permissions === 'object' ? cfg.permissions : {}) as Record<string, unknown>;
  const list = Array.isArray(perms.deny) ? (perms.deny as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const rules = [`Agent(${name})`, `Task(${name})`];
  const next = deny ? [...new Set([...list, ...rules])] : list.filter((r) => !rules.includes(r));
  if (next.length === list.length && next.every((r, i) => r === list[i])) return false;
  if (!next.length && !deny) delete perms.deny;
  else perms.deny = next;
  cfg.permissions = perms;
  if (!Object.keys(perms).length) delete cfg.permissions;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  return true;
}

/**
 * Applies a subagent's standing in `dir` to the definition that's there (one its Lead made, or the
 * office's), and its dispatch rule. `base` is the office's text for one it defines. Says what it did.
 */
export function applyStanding(dir: string, rec: SubagentRecord, base?: string): string[] {
  const did: string[] = [];
  const benched = rec.state === 'benched';
  const found = definitionOf(dir, rec.name);
  const text = base ?? (found ? readFileSync(found.file, 'utf8') : undefined);
  if (text !== undefined && placeDefinition(dir, rec.name, withStanding(text, rec), benched)) did.push(`${benched ? benchedDir : agentsDir}/${rec.name}.md`);
  if (denyDispatch(dir, rec.name, benched)) did.push(`${SETTINGS} (${benched ? 'denies' : 'allows'} Agent(${rec.name}))`);
  return did;
}
