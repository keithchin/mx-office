// What the expected plan is made from, read off the project: its size tier and entry mode (the wizard's
// agent-office.project.json, else the decision register in PROJECT.md), its build plan's modules
// (architecture/modules/<Module>/, else the build plan's module headings), and a Firm audit's re-forecast.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Report } from '../../shared/firm/report.js';
import type { FirmForecast } from '../../shared/budget/types.js';
import { ENTRY_MODES, type EntryMode, type SizeTier } from '../../shared/wizard.js';

const read = (f: string) => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return undefined;
  }
};

/** An entry mode from the register's words ("Requirements-driven", "Change an existing app"…). */
export function entryOf(text: string | undefined): EntryMode | undefined {
  const t = (text ?? '').toLowerCase();
  if (!t) return undefined;
  if (/assurance/.test(t)) return 'assurance';
  if (/existing|change/.test(t)) return 'existing-app-change';
  if (/migrat/.test(t)) return 'migration';
  if (/requirement/.test(t)) return 'requirements-driven';
  if (/greenfield/.test(t)) return 'greenfield';
  return (ENTRY_MODES as readonly string[]).includes(t) ? (t as EntryMode) : undefined;
}

/** The project's tier and entry mode; standard requirements-driven when nothing says. */
export function projectShape(dir: string): { tier: SizeTier; entry: EntryMode; known: boolean } {
  try {
    const j = JSON.parse(read(path.join(dir, 'agent-office.project.json')) ?? '{}');
    const entry = entryOf(j?.entryMode);
    if (entry) return { tier: j.sizeTier === 'small' ? 'small' : 'standard', entry, known: true };
  } catch {
    // not the wizard's project, or a broken file: the register, then
  }
  const reg = read(path.join(dir, 'PROJECT.md')) ?? '';
  const field = (name: string) => new RegExp(`^\\s*(?:[-*]\\s*)?\\**${name}\\**:\\s*(.+)$`, 'im').exec(reg)?.[1]?.trim();
  const entry = entryOf(field('Entry mode'));
  const tier = /small/i.test(field('Size tier') ?? '') ? 'small' : 'standard';
  return { tier, entry: entry ?? 'requirements-driven', known: !!entry };
}

/** The build plan's modules, once there's a build plan. */
export function buildModules(dir: string): string[] | undefined {
  try {
    const mods = readdirSync(path.join(dir, 'architecture', 'modules'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    if (mods.length) return mods.sort();
  } catch {
    // no modules folder yet
  }
  const plan = read(path.join(dir, 'architecture', 'build-plan.md'));
  if (!plan) return undefined;
  const heads = [...plan.matchAll(/^#{2,3}\s+(?:\d+[.)]\s*)?(?:Module[:\s]+)?([A-Z][\w-]{1,40})(?:\s*[—:-].*)?$/gm)].map((m) => m[1]).filter((m) => !/^(Overview|Order|Dependencies|Modules|Summary|Risks|Notes|Scope|Sequence|Plan)$/i.test(m));
  return heads.length ? [...new Set(heads)] : undefined;
}

const MONEY = /\$\s?([\d,]+(?:\.\d+)?)\s*(k)?/i;
const money = (s: string | undefined): number | undefined => {
  const m = s ? MONEY.exec(s) : null;
  if (!m) return undefined;
  const v = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
  return v > 0 ? v : undefined;
};

/** A Firm report's cost re-forecast and end date, when it gives them. */
export function firmForecastOf(r: Report): FirmForecast | undefined {
  const cost = r.expectations.find((e) => e.area === 'cost');
  // The re-forecast is what the audit says the project will cost: "forecast"/"at completion" wording first, then the cost line's actual.
  const said = [cost?.note, cost?.actual, r.timeline.summary].find((s) => s && /forecast|at completion|projected|expect/i.test(s) && MONEY.test(s));
  const usd = money(said) ?? money(cost?.actual);
  const dates = r.timeline.milestones.map((m) => m.forecast).filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10)).sort();
  const end = dates[dates.length - 1];
  if (usd === undefined && !end) return undefined;
  return { report: r.id, generatedAt: r.generatedAt, ...(usd !== undefined ? { usd } : {}), ...(end ? { end } : {}) };
}
