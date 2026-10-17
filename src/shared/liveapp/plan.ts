// The live app's milestones, from the project's own plan: the toolkit build plan's phases
// (architecture/build-plan.md: "### Phase 3 — Save, submit and My check sheets" over a table of
// "| # | Kind | Step | Produces / Proves | Depends on | Skills | State |" rows) and the plan's goal (its
// title, "# Build plan — PackTrack Line 7 demo (Checksheet)"); and the test journeys
// (tests/e2e/*.journey.json) with the rows and use cases they say they prove. The State column is read
// by nothing here: row evidence comes from commits (./rows.ts). Pure.

import { rowsIn } from './rows.js';

export interface PlanRow {
  n: number;
  /** BUILD, PROVE, BRIEF, RUN, HARNESS (upper-cased), when the table has a Kind column. */
  kind?: string;
  step: string;
}

export interface PlanPhase {
  /** "phase-3", or the heading made into an id. */
  id: string;
  /** "Save, submit and My check sheets". */
  title: string;
  rows: PlanRow[];
}

export interface ParsedPlan {
  /** What the whole plan builds, from its title ("PackTrack Line 7 demo (Checksheet)"). */
  goal?: string;
  phases: PlanPhase[];
}

const cells = (l: string) =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/[`*]/g, '').trim());

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'rows';

/** The plan's phases with their numbered rows, in order; a table's rows go to the heading above it. */
export function parsePlan(md: string | undefined): ParsedPlan {
  const lines = (md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const phases = new Map<string, PlanPhase>();
  let goal: string | undefined;
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h1 = /^#\s+(.+)$/.exec(l);
    if (h1 && !goal) goal = h1[1].replace(/^build plan\s*[—–:-]\s*/i, '').trim() || undefined;
    if (/^#{2,4}\s/.test(l) && !/^#{4}\s+row\b/i.test(l)) heading = l.replace(/^#+\s*/, '').trim();
    if (!l.trim().startsWith('|') || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) continue;
    const head = cells(l).map((c) => c.toLowerCase());
    const nCol = head.indexOf('#');
    const stepCol = head.findIndex((c) => c === 'step');
    if (nCol < 0 || stepCol < 0) continue;
    const kindCol = head.indexOf('kind');
    const ph = /^phase\s+(\d+)\s*[—–:-]\s*(.+)$/i.exec(heading);
    const id = ph ? `phase-${ph[1]}` : slug(heading);
    const phase = phases.get(id) ?? { id, title: ph ? ph[2].trim() : heading || 'Build plan', rows: [] };
    phases.set(id, phase);
    for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
      const c = cells(lines[i]);
      if (!/^\d+$/.test(c[nCol] ?? '')) continue;
      phase.rows.push({ n: Number(c[nCol]), ...(kindCol >= 0 && c[kindCol] ? { kind: c[kindCol].toUpperCase() } : {}), step: c[stepCol] ?? '' });
    }
    i--;
  }
  return { ...(goal ? { goal } : {}), phases: [...phases.values()].filter((p) => p.rows.length) };
}

/** The rows that change what the app is: BUILD rows (every row, when the plan has no Kind column). */
export function buildRowsOf(p: PlanPhase): number[] {
  const kinded = p.rows.some((r) => r.kind);
  return p.rows.filter((r) => !kinded || /^BUILD\b/.test(r.kind ?? '')).map((r) => r.n);
}

export interface JourneyDef {
  id: string;
  title?: string;
  file: string;
  /** The build-plan rows it says it proves ("build-plan row 10"). */
  rows: number[];
  /** Everything its requirement field names (UC-01, BR-05, "build-plan row 10"). */
  requirement: string[];
}

/** A journey file, or undefined for one that isn't a journey or is a deliberately broken control ("skeleton-broken"). */
export function parseJourney(file: string, text: string): JourneyDef | undefined {
  let j: { id?: unknown; title?: unknown; requirement?: unknown };
  try {
    j = JSON.parse(text) ?? {};
  } catch {
    return undefined;
  }
  const id = typeof j.id === 'string' && j.id ? j.id : file.split('/').pop()!.replace(/\.journey\.json$/i, '');
  if (/broken/i.test(id) || /broken/i.test(file) || /(^|\/)example\.journey\.json$/i.test(file)) return undefined;
  const requirement = (Array.isArray(j.requirement) ? j.requirement : typeof j.requirement === 'string' ? [j.requirement] : []).filter((x): x is string => typeof x === 'string');
  return { id, ...(typeof j.title === 'string' ? { title: j.title } : {}), file, rows: rowsIn(requirement.join(', ')), requirement };
}
