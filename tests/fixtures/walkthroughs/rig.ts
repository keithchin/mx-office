// The walkthrough tests' rig (walkthroughs-record.test.ts, walkthroughs-auto.test.ts): a throwaway git repo with
// the two sample journeys (and optionally a journey-runner config), a local bare origin, the fake sample app
// (./app.ts) standing in for the office's recording copy of the app, a fake gh, and the Walkthroughs service.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Walkthroughs } from '../../../src/server/walkthroughs/index.js';
import { findFfmpeg } from '../../../src/server/walkthroughs/media.js';
import { launchChromium } from '../../../src/server/walkthroughs/recorder.js';
import { fakeVoice } from '../../../src/server/walkthroughs/tts.js';
import { removeDir } from '../../support/cleanup.js';
import { DEMO, FAILING, PASSING, fakeApp, type FakeApp, type FakeAppOptions } from './app.js';

export const g = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Whether headless Chromium starts here (the tests that film skip without it). */
export const browserCheck: Promise<boolean> = launchChromium().then(
  (b) => b.close().then(() => true),
  () => false,
);

export interface Rig {
  root: string;
  repo: string;
  origin: string;
  sha: string;
  app: FakeApp;
  gh: string[][];
  w: Walkthroughs;
  /** Each boot of the recording app: its commit; and how many were stopped. */
  boots: string[];
  stops: number;
  passed: string[];
  bootError?: string;
}

export async function rig(o: { ffmpeg?: boolean; config?: string; lateFormMs?: number; app?: FakeAppOptions } = {}): Promise<Rig> {
  const root = mkdtempSync(path.join(tmpdir(), 'walk-rec-'));
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'project');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  g(repo, 'init', '-q', '-b', 'main');
  mkdirSync(path.join(repo, 'tests', 'e2e'), { recursive: true });
  writeFileSync(path.join(repo, 'tests', 'e2e', 'new-request.journey.json'), JSON.stringify(PASSING, null, 2));
  writeFileSync(path.join(repo, 'tests', 'e2e', 'approve-request.journey.json'), JSON.stringify(FAILING, null, 2));
  writeFileSync(path.join(repo, 'README.md'), '# Sample app\n');
  if (o.config) writeFileSync(path.join(repo, 'tests', 'e2e', 'project.config.js'), o.config);
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'Sample app with two journeys');
  g(repo, 'remote', 'add', 'origin', origin);
  g(repo, 'push', '-q', '-u', 'origin', 'main');
  g(repo, 'fetch', '-q', 'origin');
  const sha = g(repo, 'rev-parse', 'HEAD');
  const app = await fakeApp({ lateFormMs: o.lateFormMs ?? 0, ...o.app });
  const gh: string[][] = [];
  const r = { root, repo, origin, sha, app, gh, boots: [] as string[], stops: 0, passed: [] as string[] } as Rig;
  r.w = new Walkthroughs({
    dataDir: path.join(root, 'data'),
    floorDir: (id) => (id === 'demo' ? repo : undefined),
    boot: async (_floor, commit) => {
      r.boots.push(commit);
      if (r.bootError) throw new Error(r.bootError);
      let up = true;
      return { url: app.url, commit, ...(o.app?.runtimeLog ? { runtimeLog: o.app.runtimeLog } : {}), alive: () => up, stop: async () => void ((up = false), r.stops++) };
    },
    passedAt: async (_f, sha, ids) => (sha === r.sha ? ids.filter((i) => r.passed.includes(i)) : []),
    gh: async (args) => {
      gh.push(args);
      return 'https://github.com/example/sample-app/pull/7\n';
    },
    tool: o.ffmpeg ? findFfmpeg() : {},
    voice: fakeVoice,
    cardMs: 300,
    stepMs: 300,
  });
  await r.w.store.setSettings('demo', { autoRecord: true, narrate: false, demoUser: DEMO.user, demoPassword: DEMO.password });
  return r;
}

/** The one recording of a journey. */
export async function only(r: Rig, journey: string): Promise<string> {
  const all = (await r.w.store.list('demo')).filter((m) => m.journey.id === journey);
  assert.equal(all.length, 1, `one recording of ${journey}`);
  return all[0].id;
}

export async function done(r: Rig) {
  await r.w.idle();
  await r.app.close();
  removeDir(r.root);
}
