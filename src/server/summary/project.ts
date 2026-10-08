// What a project's own files say about it: its goal (the README's first paragraph, or for a project
// built with the mxcli project toolkit, the intake's answer to "what is this project") and, for a
// toolkit project, where it stands. The toolkit's gate-check writes its verdicts into index.html and
// the current stage into PROJECT.md on every full run, so reading those is enough: nothing is run
// here, and a file is read again only when it changed.

import { readFileSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectSummary, StageVerdict } from '../../shared/summary.js';

export type ProjectFacts = Pick<ProjectSummary, 'goal' | 'goalFrom' | 'phase'>;

const GOAL_MAX = 400;
const cache = new Map<string, { key: string; facts: ProjectFacts }>();

function stamp(file: string): string {
  try {
    const s = statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return '-';
  }
}

const read = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

const FILES = ['README.md', 'PROJECT.md', 'intake.md', 'index.html'];

export function projectFacts(dir: string): ProjectFacts {
  const key = FILES.map((f) => stamp(path.join(dir, f))).join('|');
  const hit = cache.get(dir);
  if (hit?.key === key) return hit.facts;
  const facts = factsOf((f) => read(path.join(dir, f)));
  cache.set(dir, { key, facts });
  return facts;
}

/**
 * projectFacts off the event loop, from the same cache: the stats and reads go to libuv's thread pool
 * (the ranking's background refresh, where reading every floor's checkout held the loop on a loaded
 * machine). The same answer.
 */
export async function projectFactsAsync(dir: string): Promise<ProjectFacts> {
  const stamps = await Promise.all(FILES.map((f) => stat(path.join(dir, f)).then((s) => `${s.mtimeMs}:${s.size}`, () => '-')));
  const key = stamps.join('|');
  const hit = cache.get(dir);
  if (hit?.key === key) return hit.facts;
  const texts = new Map(await Promise.all(FILES.map(async (f) => [f, await readFile(path.join(dir, f), 'utf8').catch(() => undefined)] as const)));
  const facts = factsOf((f) => texts.get(f));
  cache.set(dir, { key, facts });
  return facts;
}

function factsOf(read: (file: string) => string | undefined): ProjectFacts {
  const facts: ProjectFacts = {};
  const intake = read('intake.md');
  const fromIntake = intake ? intakeGoal(intake) : undefined;
  const readme = read('README.md');
  const fromReadme = readme ? firstParagraph(readme) : undefined;
  if (fromIntake) Object.assign(facts, { goal: fromIntake, goalFrom: 'intake.md' });
  else if (fromReadme) Object.assign(facts, { goal: fromReadme, goalFrom: 'README.md' });
  const project = read('PROJECT.md');
  if (project) {
    const html = read('index.html');
    const label = currentStage(project);
    const stages = html ? stageVerdicts(html) : [];
    if (label || stages.length) facts.phase = { label: label ?? 'Stage unknown', from: 'PROJECT.md', stages, decisions: decisions(project) };
  }
  return facts;
}

const clip = (s: string) => (s.length > GOAL_MAX ? `${s.slice(0, GOAL_MAX - 1).trimEnd()}…` : s);

/** The README's first paragraph of prose: past the title, badges, HTML and code. */
export function firstParagraph(md: string): string | undefined {
  const paras = md.replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '').split(/\n\s*\n/);
  for (const p of paras) {
    const text = p
      .split('\n')
      .filter((l) => !/^\s*(#|!\[|\[!\[|<|\||---|>\s*\[!)/.test(l))
      .join(' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 12) return clip(text);
  }
  return undefined;
}

/** The intake's answer to question 2 ("What is this project, and what is driving it?"), once it's answered. */
export function intakeGoal(md: string): string | undefined {
  const m = /^#+\s*2[.)]\s.*\n([\s\S]*?)(?=^#+\s*\d+[.)]\s|$(?![\s\S]))/m.exec(md.replace(/\r/g, ''));
  if (!m) return undefined;
  const answer = /(?:Answered \(CONFIRMED\):|Unverified[^:]*:)\s*([\s\S]+)/i.exec(m[1]);
  const text = answer?.[1].split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  return text && !/not yet asked/i.test(text) ? clip(text) : undefined;
}

/** The bold readout under "## Current stage" ("Stage P — Kickoff, needs attention — gates passed: none yet"). */
export function currentStage(md: string): string | undefined {
  const sec = /^##\s*Current stage\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(md.replace(/\r/g, ''));
  const bold = sec ? /\*\*([^*]+)\*\*([^\n(]*)/.exec(sec[1]) : null;
  if (!bold) return undefined;
  return `${bold[1].trim()}${bold[2].replace(/\s+/g, ' ').replace(/\s*—\s*gates passed.*$/, '').trimEnd()}`.replace(/,\s*$/, '');
}

/** The decision register's rows: stage, decision, status. */
export function decisions(md: string): { stage: string; decision: string; status: string }[] {
  const sec = /^##\s*Decisions\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(md.replace(/\r/g, ''));
  if (!sec) return [];
  return sec[1]
    .split('\n')
    .filter((l) => l.trim().startsWith('|') && !/^\|\s*-/.test(l.trim()))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((c) => c.length >= 3 && c[0].toLowerCase() !== 'stage')
    .map(([stage, decision, status]) => ({ stage, decision, status }));
}

const VERDICTS = ['PASS', 'PENDING', 'FAIL', 'WAIVED', 'MANUAL'];

/** gate-check's dashboard table, one row a stage: its id, title, verdict and why. */
export function stageVerdicts(html: string): StageVerdict[] {
  const out: StageVerdict[] = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => decode(c[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim());
    if (cells.length < 3) continue;
    const status = cells[2].split(' ')[0].toUpperCase();
    if (!VERDICTS.includes(status)) continue;
    out.push({ id: cells[0], title: cells[1], status, detail: cells[3]?.slice(0, 240) });
  }
  return out;
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
