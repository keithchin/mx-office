// Testing release 1 (docs/site/insights/testing.md): revision-bound test-run records per project
// (store.ts) and the read-only view App Insights › Testing shows. Records come in three ways, none of
// which asks GitHub anything new: the board's poll of pull requests (their check rollup on the head
// commit), the board's hover asking pr-checks for a run (prshots/), and, when someone looks, the
// report files at main and the office's own gate-check render of main. The view is kept per floor
// under main's commit plus the newest record id, so a new run on an unchanged commit shows at once.

import path from 'node:path';
import type { PrChecks } from '../../shared/prshots.js';
import type { TestRunRecord } from '../../shared/testing/record.js';
import { buildTestingView, type GateVerdict, type TestingView } from '../../shared/testing/view.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { dropKeys, onForgetFloor } from '../office/forget.js';
import { wizardIfMade } from '../wizard/index.js';
import { readPlan, readRepoFacts, type RepoFacts } from './facts.js';
import { draftFromGates, stage6 } from './import-gates.js';
import { draftFromPrChecks, draftFromPull } from './import-pr.js';
import { mainOf, type MainRef } from './repo.js';
import { TestRunStore } from './store.js';

const stores = new Map<string, TestRunStore>();
const facts = new Map<string, { sha: string; p: Promise<RepoFacts> }>();
const views = new Map<string, { key: string; view: TestingView }>();
onForgetFloor((f) => {
  for (const k of [...stores.keys()]) if (path.basename(k) === f.id) stores.delete(k);
  dropKeys(facts, f);
  dropKeys(views, f);
});

/** The floor's record file (one instance per file, so its cache is shared). */
export function testingStore(dataDir: string, floorId: string): TestRunStore {
  const dir = path.join(dataDir, 'testing');
  const key = path.join(dir, floorId);
  let s = stores.get(key);
  if (!s) stores.set(key, (s = new TestRunStore(dir, floorId)));
  return s;
}

type FloorLike = Pick<Floor, 'id' | 'dir'> & { def: Pick<Floor['def'], 'repo'>; github: { pulls: { items: Floor['github']['pulls']['items'] } } };

const repoOf = (floor: FloorLike) => floor.def.repo ?? floor.id;

/** The board's pull requests came back: each decided check rollup on a head commit is a run. */
export function ingestPulls(dataDir: string, floor: FloorLike): Promise<TestRunRecord[]> {
  const drafts = floor.github.pulls.items.flatMap((p) => draftFromPull(repoOf(floor), p) ?? []);
  return testingStore(dataDir, floor.id).ingest(drafts).catch(() => []);
}

/** pr-checks answered for a pull request (or a branch): its finished run is a record. */
export function ingestPrChecks(dataDir: string, floor: FloorLike, checks: PrChecks, branch?: string): Promise<TestRunRecord[]> {
  const pull = floor.github.pulls.items.find((p) => p.number === checks.pr);
  const d = draftFromPrChecks(repoOf(floor), checks, { branch: branch ?? pull?.headRefName, title: pull?.title });
  return d ? testingStore(dataDir, floor.id).ingest([d]).catch(() => []) : Promise.resolve([]);
}

function factsAt(floor: FloorLike, main: MainRef): Promise<RepoFacts> {
  const had = facts.get(floor.id);
  if (had?.sha === main.sha) return had.p;
  const p = readRepoFacts(floor.dir, main);
  facts.set(floor.id, { sha: main.sha, p });
  p.catch(() => facts.delete(floor.id));
  return p;
}

export interface TestingDeps {
  /** gate-check's dashboard as the office rendered it from exactly `sha` (the wizard's GateSource). */
  renderedGates?: (dir: string, sha: string) => { html: string; at: number } | undefined;
}

/** The Testing tab's view for a floor. */
export async function testingView(dataDir: string, floor: FloorLike, deps: TestingDeps = {}): Promise<TestingView> {
  const store = testingStore(dataDir, floor.id);
  const main = await mainOf(floor.dir);
  let repo: RepoFacts | undefined;
  const notes: string[] = [];
  if (main) {
    try {
      repo = await factsAt(floor, main);
    } catch (err) {
      notes.push(`The files at main could not be read: ${(err as Error).message}`);
    }
  } else notes.push('This project has no commits yet, so there is no main to test');

  // Taken in now: the report files at main, the office's gate-check render of main, the board's pull requests.
  let gate6: GateVerdict | undefined;
  const rendered = main ? deps.renderedGates?.(floor.dir, main.sha) : undefined;
  const gateDraft = main && rendered ? draftFromGates(main.sha, rendered.html, rendered.at, main.branch) : undefined;
  await store.ingest([...(repo?.reports ?? []), ...(gateDraft ? [gateDraft] : []), ...floor.github.pulls.items.flatMap((p) => draftFromPull(repoOf(floor), p) ?? [])]);
  if (main && rendered) {
    const v = stage6(rendered.html);
    if (v) gate6 = { status: v.status, detail: v.detail, from: `gate-check rendered by the office at ${main.sha.slice(0, 7)}` };
  }
  if (!gate6 && main && repo?.indexHtml) {
    const v = stage6(repo.indexHtml);
    if (v) gate6 = { status: v.status, detail: v.detail, from: `index.html as committed at ${main.sha.slice(0, 7)} (may be older than main)` };
  }

  const newest = (await store.newestId()) ?? 'none';
  const key = `${main?.sha ?? 'no-main'}:${newest}`;
  const hit = views.get(floor.id);
  if (hit?.key === key) return hit.view;
  const view = buildTestingView(
    floor.id,
    {
      ...(main ? { main: { branch: main.branch, sha: main.sha } } : {}),
      brds: repo?.brds ?? [],
      acs: repo?.acs ?? [],
      tests: repo?.tests ?? [],
      ...(repo?.plan ? { plan: repo.plan } : {}),
      ...(gate6 ? { gate6 } : {}),
      notes: [...notes, ...(repo?.notes ?? [])],
    },
    await store.all(),
  );
  views.set(floor.id, { key, view });
  return view;
}

/** The test plan's markdown at main, for the panel (asked only when it opens). */
export async function testPlanText(floor: FloorLike): Promise<{ path: string; markdown: string; sha: string } | undefined> {
  const main = await mainOf(floor.dir);
  if (!main) return undefined;
  const repo = await factsAt(floor, main);
  if (!repo.plan) return undefined;
  const markdown = await readPlan(floor.dir, main, repo.plan.path);
  return markdown === undefined ? undefined : { path: repo.plan.path, markdown, sha: main.sha };
}

/** The office's deps: the wizard's gate renders. */
export const officeDeps = (ctx: Ctx): TestingDeps => ({ renderedGates: (dir, sha) => wizardIfMade(ctx)?.renderedGates(dir, sha) });
