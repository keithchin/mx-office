// Where a toolkit project stands, for the setup panel over its board until its build plan (Stage 4)
// is confirmed. Read from the project's files alone, as the project summary does (from its default
// branch on GitHub when it has one, gate-source.ts, else from the floor's folder): the stage verdicts
// gate-check last wrote into index.html, Stage P worked out afresh from intake.md (a cheap check of
// the same markers, so answering a question shows at once), and the register's decisions and open
// questions. Nothing is run here; a file is read again only once it has changed.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { SetupView } from '../../shared/wizard.js';
import { decisions, stageVerdicts } from '../summary/project.js';
import { unansweredQuestions } from './intake.js';
import { openQuestions, registerField } from './register.js';

const STAGES: [id: string, title: string][] = [
  ['P', 'Kickoff'],
  ['0', 'Triage & scope'],
  ['1', 'Analysis'],
  ['2', 'Requirements'],
  ['3', 'Architecture & design'],
  ['4', 'Build plan'],
];
const FILES = ['PROJECT.md', 'intake.md', 'index.html'];
const cache = new Map<string, { key: string; view: Omit<SetupView, 'job' | 'checking' | 'checkedAt'> }>();

const read = (f: string) => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return undefined;
  }
};
const stamp = (f: string) => {
  try {
    const s = statSync(f);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return '-';
  }
};

const settled = (status: string) => status === 'PASS' || status === 'WAIVED';

type Computed = Omit<SetupView, 'job' | 'checking' | 'checkedAt'>;

/** The view from the floor's folder: the fallback when the project has no remote default branch. */
export function setupView(dir: string): Computed {
  const key = FILES.map((f) => stamp(path.join(dir, f))).join('|');
  const hit = cache.get(dir);
  if (hit?.key === key) return hit.view;
  const view = compute((f) => read(path.join(dir, f)));
  cache.set(dir, { key, view });
  return view;
}

/** The view from files read elsewhere (origin/<default>, gate-source.ts). */
export function setupViewOf(files: Partial<Record<string, string>>): Computed {
  return compute((f) => files[f]);
}

function compute(read: (file: string) => string | undefined): Computed {
  const register = read('PROJECT.md');
  // Only a toolkit project has a decision register.
  if (!register || !/^##\s*Decisions/m.test(register)) return { show: false, stages: [], questions: [] };
  const entry = registerField(register, 'Entry mode');
  const tier = registerField(register, 'Size tier')?.split(/\s+[—-]\s+/)[0];
  // Assurance isn't a pipeline: no stages to walk through.
  if (/assurance/i.test(entry ?? '')) return { show: false, stages: [], questions: [] };
  const html = read('index.html');
  const verdicts = new Map((html ? stageVerdicts(html) : []).map((v) => [v.id, v]));
  const intake = read('intake.md');
  const unanswered = intake ? unansweredQuestions(intake) : undefined;
  const rows = decisions(register);

  const stages = STAGES.map(([id, title]) => {
    const v = verdicts.get(id);
    if (id === 'P' && unanswered) {
      return unanswered.length
        ? { id, title, status: 'PENDING', detail: `${unanswered.length} intake question${unanswered.length === 1 ? '' : 's'} still to ask: ${unanswered.map((q) => `Q${q.n}`).join(', ')}` }
        : { id, title, status: 'PASS', detail: 'every intake question has an answer' };
    }
    // A confirmed decision row for a ✋ stage counts, even before gate-check has run again.
    const confirmed = rows.find((r) => r.stage === id && /^confirmed/i.test(r.status));
    if (v) return { id, title, status: v.status, detail: v.detail };
    return { id, title, status: confirmed && id === '4' ? 'PASS' : 'PENDING', detail: html ? undefined : 'gate-check has not rendered the dashboard yet' };
  });
  const four = stages[stages.length - 1];
  // Done once the build plan is signed off, or (greenfield, where the entry mode waives 1–4) once every stage up to it is settled.
  const done4 = four.status === 'PASS' || rows.some((r) => r.stage === '4' && /^confirmed/i.test(r.status)) || stages.every((s) => settled(s.status));
  const next = stages.find((s) => !settled(s.status));
  const questions = [
    ...(unanswered ?? []).map((q) => `Intake Q${q.n}: ${q.title}`),
    ...openQuestions(register),
  ];
  return {
    show: !done4,
    entry,
    tier,
    stages,
    next: next ? `Stage ${next.id} — ${next.title}${next.detail ? `: ${next.detail}` : ''}` : undefined,
    questions: questions.slice(0, 12),
  };
}
