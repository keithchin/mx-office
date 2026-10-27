// The project's test users for an agent's app instance (shared/agent-app-identity.ts says the order): the
// journey-runner config at the commit (walkthroughs/identity.ts, sandboxed), the personas the project's own
// journeys name at that commit, and the seed password constant the instance booted with (mxcli's
// .mxcli/run-local.json beside the runtime log). Read off the event loop; passwords stay in memory.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { personasIn, projectIdentities, seedPasswordIn, type ProjectIdentities } from '../../shared/agent-app-identity.js';
import type { RunnerConfig } from '../../shared/walkthroughs/identity.js';
import { listFiles, readFiles } from '../testing/repo.js';
import { runnerConfigAt } from '../walkthroughs/identity.js';

export const JOURNEY_FILE = /\.journey\.(json|js|cjs)$/i;

/** The personas the project's journeys name at `commit`, most named first. */
export async function journeyPersonas(floorDir: string, commit: string): Promise<string[]> {
  const files = (await listFiles(floorDir, commit, ['tests']).catch(() => [] as string[])).filter((f) => JOURNEY_FILE.test(f)).slice(0, 200);
  const texts = await readFiles(floorDir, commit, files, 256 * 1024).catch(() => new Map<string, string>());
  const count = new Map<string, number>();
  for (const f of files) for (const p of personasIn(texts.get(f) ?? '')) count.set(p, (count.get(p) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

/** The seed password constant an instance booted with (its runtime log's folder holds run-local.json). */
export async function seedPassword(runtimeLog: string | undefined): Promise<{ constant: string; value: string } | undefined> {
  if (!runtimeLog) return undefined;
  const text = await readFile(path.join(path.dirname(runtimeLog), 'run-local.json'), 'utf8').catch(() => '');
  try {
    return text ? seedPasswordIn(JSON.parse(text)) : undefined;
  } catch {
    return undefined;
  }
}

export interface IdentityDeps {
  runnerConfig?: (dir: string, commit: string) => Promise<RunnerConfig | undefined>;
  personas?: (dir: string, commit: string) => Promise<string[]>;
  seed?: (runtimeLog: string | undefined) => Promise<{ constant: string; value: string } | undefined>;
}

/** The project's test users at `commit` for the instance whose runtime log is `runtimeLog`. */
export async function identitiesFor(floorDir: string, commit: string, runtimeLog: string | undefined, d: IdentityDeps = {}): Promise<ProjectIdentities> {
  const [cfg, personas, seed] = await Promise.all([
    (d.runnerConfig ?? runnerConfigAt)(floorDir, commit).catch(() => undefined),
    (d.personas ?? journeyPersonas)(floorDir, commit).catch(() => [] as string[]),
    (d.seed ?? seedPassword)(runtimeLog).catch(() => undefined),
  ]);
  return projectIdentities(cfg, personas, seed);
}
