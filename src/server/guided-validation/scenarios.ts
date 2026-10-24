// The scenarios of one version (C5, shared/guided-validation.ts), read with git in the project's folder: the
// test journeys (tests/**/*.journey.json) as they are at that very commit, read-only and off the event loop
// (testing/repo.ts), kept per commit (a commit's files never change); broken controls and examples left out
// as the live app's readiness leaves them out (shared/liveapp/plan.ts parseJourney), each journey's steps
// read by the walkthrough's script reader. Results come from the test-run store, matched to the commit
// exactly (shared/guided-validation.ts resultsAt).

import { listFiles, readFiles, git } from '../testing/repo.js';
import { testingStore } from '../testing/index.js';
import { parseJourney } from '../../shared/liveapp/plan.js';
import { scriptOf } from '../../shared/walkthroughs/script.js';
import { checksAt, resultsAt, scenarioView, startOf, stepWords, type FindingRecord, type ScenarioStart, type ValidationView } from '../../shared/guided-validation.js';

export interface ScenarioDef {
  id: string;
  title: string;
  steps: string[];
  start?: ScenarioStart;
}

const defs = new Map<string, Promise<{ list: ScenarioDef[]; readable: boolean }>>();

/** The scenarios at `sha` in `dir`, and whether the commit could be read there at all. */
export function scenarioDefs(dir: string, sha: string): Promise<{ list: ScenarioDef[]; readable: boolean }> {
  const key = `${dir}|${sha}`;
  let p = defs.get(key);
  if (!p) {
    p = (async () => {
      const ok = await git(['cat-file', '-e', `${sha}^{commit}`], dir);
      if (ok === undefined) return { list: [], readable: false };
      const files = (await listFiles(dir, sha, ['tests'])).filter((f) => /\.journey\.json$/i.test(f)).slice(0, 200);
      const texts = await readFiles(dir, sha, files, 512 * 1024);
      const list: ScenarioDef[] = [];
      for (const f of files) {
        const text = texts.get(f) ?? '';
        const j = parseJourney(f, text);
        if (!j) continue;
        const s = scriptOf(f, text);
        const steps = typeof s === 'string' ? [] : stepWords(s.steps);
        const start = typeof s === 'string' ? undefined : startOf(s.steps);
        list.push({ id: j.id, title: (typeof s === 'string' ? undefined : s.title) ?? j.title ?? j.id, steps, ...(start ? { start } : {}) });
      }
      return { list, readable: true };
    })();
    defs.set(key, p);
    // A failed read isn't kept: the next look tries again.
    p.then((v) => (v.readable ? undefined : defs.delete(key))).catch(() => defs.delete(key));
    if (defs.size > 50) defs.delete(defs.keys().next().value!);
  }
  return p;
}

/** The Review section's view of one version: its scenarios with their results there, the marks, and the corrections. */
export async function validationAt(o: { dataDir: string; floorId: string; dir: string; revision: string; marks: readonly FindingRecord[]; corrections: readonly FindingRecord[] }): Promise<ValidationView> {
  const { list, readable } = await scenarioDefs(o.dir, o.revision);
  const records = await testingStore(o.dataDir, o.floorId)
    .all()
    .catch(() => []);
  const ids = list.map((s) => s.id);
  const r = resultsAt(records, o.revision, ids);
  return {
    floor: o.floorId,
    revision: o.revision,
    scenarios: list.map((d) => scenarioView(d, r, o.marks)),
    checks: checksAt(records, o.revision, ids),
    corrections: o.corrections.map((c) => ({ id: c.correction!.id, ...(c.correction!.taskId ? { taskId: c.correction!.taskId } : {}), scenario: c.scenario, title: c.title, revision: c.revision, at: c.at })),
    ...(readable ? {} : { note: 'The office can’t read this version in the project’s folder, so it can’t list its guided checks.' }),
  };
}
