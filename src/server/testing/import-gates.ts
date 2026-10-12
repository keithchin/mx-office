// The office's own gate-check runs as test-run records. The setup panel runs the toolkit's gate-check
// on origin/<default> in a temporary worktree whenever main moves (wizard/gate-source.ts) and keeps the
// dashboard it rendered; gate-check reads the files at exactly that commit, so the commit is both the
// tested and the definition revision. The evidence is the office's own store (the render is not
// committed anywhere): its locator names the commit and when it was rendered. One record per render.

import { stageVerdicts } from '../summary/project.js';
import { IMPORTER_VERSION, statusOf, type TestRunDraft } from '../../shared/testing/record.js';
import type { StageVerdict } from '../../shared/summary.js';

/** gate-check's verdict words as results: PASS passed, FAIL failed, the rest (PENDING, MANUAL, WAIVED) skipped with the verdict kept. */
function resultOf(v: StageVerdict) {
  const s = v.status.toUpperCase();
  const status = s === 'PASS' ? 'passed' : s === 'FAIL' ? 'failed' : (statusOf(s) ?? 'skipped');
  const name = /^[P0-9]$/.test(v.id) ? `Stage ${v.id} · ${v.title}` : v.title;
  return { name, status: status as 'passed' | 'failed' | 'skipped', detail: `${s}${v.detail ? `: ${v.detail}` : ''}`.slice(0, 300), links: [] };
}

/** A gate-check render of `sha` (made at `at`, ms) as a record; undefined when it has no verdict rows. */
export function draftFromGates(sha: string, html: string, at: number, branch?: string): TestRunDraft | undefined {
  const stages = stageVerdicts(html);
  if (!stages.length) return undefined;
  const iso = new Date(at).toISOString();
  return {
    source: 'gate-check',
    sourceKey: `gate-check:${sha}:${at}`,
    suite: 'gate-check',
    testedRevision: sha,
    definitionRevision: sha,
    evidence: { kind: 'office', revision: `office@${iso}`, locator: `office:gate-check:${sha}:${iso}` },
    ...(branch ? { branch } : {}),
    finishedAt: iso,
    results: stages.map(resultOf),
    links: [],
    actor: { kind: 'office', name: 'gate-check (the office)' },
    importer: IMPORTER_VERSION,
  };
}

/** Stage 6's verdict in a gate-check dashboard. */
export function stage6(html: string): StageVerdict | undefined {
  return stageVerdicts(html).find((s) => s.id === '6');
}
