// Checks an agent ran on its app instance that aren't a journey or smoke run, recorded against the commit in
// the test-run store (source `office-journey`) so a Developer change's receipt and the merge confirm dialog
// show them with pass/fail (the real rebuild test: the agents started instances, measured pages and took
// screenshots, and every receipt still said "no checks"):
//   * each start of its instance: "app start" passed when it answered, a run that couldn't complete (shown as
//     failed, with the reason) when it didn't;
//   * a check it ran itself and reports (`office-app check`, MCP `app_check`): its name, passed or failed, its
//     detail and up to 5 screenshots it took (copied into the office's evidence folder). These are labelled
//     "reported by <agent>" everywhere: the office records what the agent says it saw, it didn't watch it.

import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from '../../shared/evidence/ids.js';
import { IMPORTER_VERSION, UNKNOWN, type TestRunDraft } from '../../shared/testing/record.js';
import { testingStore } from '../testing/index.js';

export interface AgentCheck {
  floorId: string;
  commit: string;
  worker: string;
  workspace?: string;
  /** What was checked, as the suite's name ("app start", "check: P3 at 390 px (reported by Rhea)"). */
  suite: string;
  status: 'passed' | 'failed' | 'error';
  detail?: string;
  /** Screenshot files on this machine (absolute paths) to keep as evidence. */
  shots?: string[];
  /** It's the agent's own report, not something the office ran. */
  reported?: boolean;
  now?: () => number;
}

const SHOT = /\.(png|jpe?g|webp)$/i;
const SHOT_MAX = 5 * 1024 * 1024;

/** Records the check at its commit; the record's id and what happened to the screenshots. */
export async function recordAgentCheck(dataDir: string, c: AgentCheck): Promise<{ record?: string; kept: string[]; skipped: string[] }> {
  const now = c.now ?? Date.now;
  const runId = `oc_${ulid(now())}`;
  const dir = path.join(dataDir, 'testing', 'evidence', c.floorId);
  await mkdir(path.join(dir, runId), { recursive: true, mode: 0o700 });
  const kept: string[] = [];
  const skipped: string[] = [];
  for (const f of (c.shots ?? []).slice(0, 5)) {
    // Only images, only absolute paths, only a few MB: nothing else of the machine's goes into the evidence.
    const ok = path.isAbsolute(f) && SHOT.test(f) && (await stat(f).then((s) => s.isFile() && s.size <= SHOT_MAX, () => false));
    if (!ok) {
      skipped.push(f);
      continue;
    }
    const to = path.join(dir, runId, `${kept.length + 1}${path.extname(f).toLowerCase()}`);
    await copyFile(f, to).then(() => kept.push(path.relative(dataDir, to).replace(/\\/g, '/')), () => skipped.push(f));
  }
  const file = path.join(dir, `${runId}.json`);
  await writeFile(file, JSON.stringify({ runId, commit: c.commit, suite: c.suite, status: c.status, by: c.worker, reported: !!c.reported, detail: c.detail, shots: kept }, null, 1), { mode: 0o600 });
  const at = new Date(now()).toISOString();
  const draft: TestRunDraft = {
    source: 'office-journey',
    sourceKey: `office-journey:${c.floorId}:${runId}`,
    suite: c.suite,
    testedRevision: c.commit,
    definitionRevision: UNKNOWN,
    evidence: { kind: 'office', revision: runId, locator: `office:${path.relative(dataDir, file).replace(/\\/g, '/')}` },
    startedAt: at,
    finishedAt: at,
    results: c.status === 'error' ? [] : [{ name: c.suite, status: c.status, ...(c.detail ? { detail: c.detail.slice(0, 600) } : {}), links: [{ target: c.suite, basis: 'recorded', via: c.reported ? `reported by ${c.worker} (office-app check)` : `office-app (${c.worker})` }] }],
    links: [],
    actor: { kind: 'office', name: `${c.worker} (${c.reported ? 'reported' : 'office-app'})` },
    environment: { runner: c.reported ? `reported by ${c.worker} (its own check, not watched by the office)` : 'office app instance', mxcliVersion: 'unknown', runtime: 'local', workFolder: c.workspace ?? '' },
    ...(c.status === 'error' ? { harnessError: (c.detail ?? 'it did not complete').slice(0, 600) } : {}),
    importer: `${IMPORTER_VERSION}+office-journey/1`,
  };
  const [rec] = await testingStore(dataDir, c.floorId).ingest([draft]);
  return { record: rec?.id, kept, skipped };
}
