// The Test Mode page's server side (/lite?tab=tests, http/routes/testlab.ts): the office's one run store
// (<data>/testlab/) and runner, made the first time a route asks. What the page draws is view().

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_SUITES, type TestLabView } from '../../shared/testlab.js';
import { audit, office as officeActor } from '../audit/index.js';
import type { Ctx } from '../office/context.js';
import { testModeOf } from '../testmode.js';
import { resolveRoot } from './logic.js';
import { TestRunner } from './runner.js';
import { RunStore } from './store.js';

/** The office's own checkout (where scripts/perf/ is). */
export function appDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
    try {
      if (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'agent-office') return dir;
    } catch {
      // keep looking
    }
  }
  return process.cwd();
}

export interface TestLab {
  store: RunStore;
  runner: TestRunner;
  root: string;
  view(): TestLabView;
}

let current: { cfg: unknown; lab: TestLab } | undefined;

export function makeTestLab(o: { dataDir: string; repoRoot: string; root: string; floorDirs: () => string[] }): TestLab {
  const store = new RunStore(path.join(o.dataDir, 'testlab'));
  const runner = new TestRunner({
    store,
    repoRoot: o.repoRoot,
    root: o.root,
    dataDir: o.dataDir,
    floorDirs: o.floorDirs,
    onEnd: (s) => audit.record({ actor: officeActor(), action: 'testlab.finished', target: { kind: 'office', id: s.id, label: `Test run ${s.id}` }, summary: `Test run ${s.suite} ${s.status}: ${s.headline ?? ''}`, details: { suite: s.suite, status: s.status, durationMs: s.durationMs }, severity: s.status === 'pass' ? 'info' : 'notice' }),
  });
  return {
    store,
    runner,
    root: o.root,
    view() {
      const history = store.list();
      const refusal = runner.refusal();
      return {
        testMode: testModeOf(),
        root: o.root,
        ...(refusal ? { refusal } : {}),
        suites: TEST_SUITES.map((suite) => ({ suite, last: history.find((r) => r.suite === suite) })),
        history,
        running: runner.running(),
      };
    },
  };
}

/** The office's test lab (one per office). */
export function testLabOf(ctx: Pick<Ctx, 'cfg' | 'floors'>): TestLab {
  if (current?.cfg === ctx.cfg) return current.lab;
  const repoRoot = appDir();
  const root = resolveRoot({ env: process.env.AGENT_OFFICE_TEST_OFFICES, repoRoot, tmp: os.tmpdir(), exists: existsSync });
  const lab = makeTestLab({ dataDir: ctx.cfg.dataDir, repoRoot, root, floorDirs: () => [...ctx.floors.values()].map((f) => f.dir) });
  current = { cfg: ctx.cfg, lab };
  return lab;
}
