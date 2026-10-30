// A project's own settings for the office's microflow test runs (release 82), in <data>/testing/<floor>.runner.json:
// the time limit of a run, in whole minutes (5 to 180). Without one, a run's limit is sized to the suite
// (shared/testing/test-files.ts autoLimitMinutes: 10 min plus 15 s a test, 15 to 45 min). Admins set it from
// the Testing page (POST /api/testing/runner), audited; the file is written whole, durably, one write at a time.

import path from 'node:path';
import { readJsonStore } from '../durable/read.js';
import { writeTextDurable } from '../durable/write.js';
import { audit, human } from '../audit/index.js';
import { autoLimitMinutes, cleanLimit } from '../../shared/testing/test-files.js';

const FLOOR = /^[A-Za-z0-9_-]{1,64}$/;

interface RunnerFile {
  v: 1;
  limitMinutes?: number;
  by?: string;
  at?: number;
}

const fileOf = (dataDir: string, floorId: string) => {
  if (!FLOOR.test(floorId)) throw new Error(`not a project id: ${floorId}`);
  return path.join(dataDir, 'testing', `${floorId}.runner.json`);
};

const chains = new Map<string, Promise<unknown>>();

/** The project's own time limit for its microflow test runs (minutes), or undefined: sized to the suite. */
export async function testLimitOf(dataDir: string, floorId: string): Promise<number | undefined> {
  const r = await readJsonStore(fileOf(dataDir, floorId)).catch(() => undefined);
  const v = r && r.state === 'ok' ? (r.value as RunnerFile).limitMinutes : undefined;
  const n = cleanLimit(v);
  return typeof n === 'number' ? n : undefined;
}

/** A run's limit for `tests` tests: the project's own, else sized to the suite. */
export async function limitFor(dataDir: string, floorId: string): Promise<(tests: number) => { ms: number; auto: boolean }> {
  const own = await testLimitOf(dataDir, floorId);
  return (tests) => (own ? { ms: own * 60_000, auto: false } : { ms: autoLimitMinutes(tests) * 60_000, auto: true });
}

/** Sets (or clears, with null/empty) the project's time limit; the limit now, or why not. Audited. */
export function setTestLimit(dataDir: string, floorId: string, value: unknown, who: { name: string; accountId?: string }): Promise<number | null | string> {
  const v = cleanLimit(value);
  if (typeof v === 'string') return Promise.resolve(v);
  const file = fileOf(dataDir, floorId);
  const run = async () => {
    const before = await testLimitOf(dataDir, floorId);
    const next: RunnerFile = { v: 1, ...(v ? { limitMinutes: v } : {}), by: who.name, at: Date.now() };
    await writeTextDurable(file, `${JSON.stringify(next, null, 1)}\n`);
    audit.record({ floor: floorId, actor: human(who.name, who.accountId), action: 'testing.test-limit', target: { kind: 'project', id: floorId, label: floorId }, summary: v ? `Set the microflow test runs' time limit to ${v} min` : "Cleared the microflow test runs' time limit (sized to the suite again)", details: { before: before ?? null, after: v ?? null }, severity: 'info' });
    return v ?? null;
  };
  const p = (chains.get(file) ?? Promise.resolve()).then(run, run);
  chains.set(file, p.catch(() => undefined));
  return p;
}
