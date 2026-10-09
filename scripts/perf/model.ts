// The Model tab's timings on a real app, for docs/site/…/performance-budgets.md:
//
//   npx tsx scripts/perf/model.ts <repo> [--from <sha>] [--to <sha>] [--impl <path to server/model/index.ts>]
//
// <repo> is a copy (never the floor itself) of a Mendix app's git history. The service is asked what
// the page asks for (the tree, a microflow, the domain model) cold on --from (an empty data folder),
// again warm, then for documents never opened on it, then with main moved to --to (by default its
// newest commit; --from defaults to the newest commit before it that changed the model): a document the
// move left alone, one it changed, the tree. It prints each time and the longest the event loop was
// held. --impl runs another version of the service (e.g. an older office's, taken out with git archive)
// for a before/after; it must take the same constructor and methods.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const repo = path.resolve(args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? '.');
const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const modelCommits = git('log', '--format=%H', '--', '*.mpr', 'mprcontents', '*/mprcontents').split('\n').filter(Boolean);
const to = opt('to') ?? modelCommits[0];
const from = opt('from') ?? modelCommits[modelCommits.indexOf(to) + 1] ?? to;
const impl = path.resolve(opt('impl') ?? path.join(import.meta.dirname, '..', '..', 'src', 'server', 'model', 'index.ts'));

type Svc = {
  tree(f: unknown, ref: string): Promise<{ nodes: unknown[] }>;
  doc(f: unknown, ref: string, type: string, qn: string): Promise<{ doc: { kind: string; mdlLater?: boolean } }>;
  mdl?(f: unknown, ref: string, type: string, qn: string): Promise<unknown>;
};
const { ModelService } = (await import(pathToFileURL(impl).href)) as { ModelService: new (dir: string, deps: object) => Svc };
const { ModelUnits } = await import(pathToFileURL(path.join(import.meta.dirname, '..', '..', 'src', 'server', 'model', 'units.ts')).href);

// Which documents to open: from the units of both commits, a microflow the move left alone and one it changed.
const scratch = mkdtempSync(path.join(tmpdir(), 'ao-model-perf-'));
const units = new ModelUnits(path.join(scratch, 'pick'));
const [a, b] = [await units.commit(repo, from), await units.commit(repo, to)];
units.close();
const flows = [...b.ix.byName.keys()].filter((k: string) => k.startsWith('microflow:') && a.ix.byName.has(k));
const same = flows.filter((k: string) => a.hashOf(k) === b.hashOf(k));
const changed = flows.filter((k: string) => a.hashOf(k) !== b.hashOf(k));
const mf = (same.find((k: string) => /ACT_/.test(k)) ?? same[0] ?? flows[0]).slice('microflow:'.length);
const module = mf.slice(0, mf.indexOf('.'));
const sibling = (same.find((k: string) => k !== `microflow:${mf}` && k.startsWith(`microflow:${module}.`)) ?? flows[1]).slice('microflow:'.length);
const elsewhere = (same.find((k: string) => !k.startsWith(`microflow:${module}.`)) ?? flows[2]).slice('microflow:'.length);
const added = [...b.ix.byName.keys()].filter((k: string) => k.startsWith('microflow:') && !a.ix.byName.has(k));
const moved = (changed[0] ?? added[0] ?? flows[3]).slice('microflow:'.length);

let main = from;
const graph = async () => ({ floor: 'f', defaultBranch: 'main', defaultRef: 'main', history: [{ sha: main, parents: [], subject: '', author: '', date: '' }], branches: [], hidden: { merged: 0, more: 0 }, at: Date.now() });
const floor = { id: 'f', dir: repo, workers: { list: () => [] }, github: { pulls: { items: [] } } };
const svc = new ModelService(path.join(scratch, 'data'), { graph });

const loop = monitorEventLoopDelay({ resolution: 5 });
loop.enable();
const rows: [string, number][] = [];
async function time(label: string, fn: () => Promise<unknown>) {
  const t = performance.now();
  await fn();
  const ms = performance.now() - t;
  rows.push([label, ms]);
  console.log(`${label.padEnd(58)} ${ms.toFixed(0).padStart(6)} ms`);
}
const settle = () => new Promise((r) => setTimeout(r, 1500));

console.log(`repo ${repo}\nfrom ${from.slice(0, 10)} → to ${to.slice(0, 10)}  (${same.length} microflows unchanged, ${changed.length} changed, ${added.length} added)\nimpl ${impl}\n`);
await time(`cold: tree (${from.slice(0, 7)})`, () => svc.tree(floor, 'main'));
await time(`cold: microflow ${mf}`, () => svc.doc(floor, 'main', 'microflow', mf));
await time(`cold: domain model ${module}`, () => svc.doc(floor, 'main', 'domainmodel', module));
if (svc.mdl) await time(`cold: MDL of ${mf} (after the diagram)`, () => svc.mdl!(floor, 'main', 'microflow', mf));
await time(`warm: tree`, () => svc.tree(floor, 'main'));
await time(`warm: microflow ${mf}`, () => svc.doc(floor, 'main', 'microflow', mf));
await time(`warm: domain model ${module}`, () => svc.doc(floor, 'main', 'domainmodel', module));
await time(`never opened, other module: ${elsewhere}`, () => svc.doc(floor, 'main', 'microflow', elsewhere));
await settle();
await time(`never opened, same module (read ahead): ${sibling}`, () => svc.doc(floor, 'main', 'microflow', sibling));
main = to;
await time(`main moved: tree (${to.slice(0, 7)}; the last one if not ready)`, () => svc.tree(floor, 'main'));
await time(`main moved: tree, fresh`, () => (svc.tree as (f: unknown, r: string, fresh: boolean) => Promise<unknown>)(floor, 'main', true));
await time(`main moved: unchanged microflow ${mf}`, () => svc.doc(floor, 'main', 'microflow', mf));
await time(`main moved: domain model ${module}`, () => svc.doc(floor, 'main', 'domainmodel', module));
await time(`main moved: ${changed.length ? 'changed' : 'added'} microflow ${moved}`, () => svc.doc(floor, 'main', 'microflow', moved));
loop.disable();
console.log(`\nlongest event-loop delay: ${(loop.max / 1e6).toFixed(0)} ms (p99 ${(loop.percentile(99) / 1e6).toFixed(0)} ms)`);
(svc as unknown as { units?: { close(): void } }).units?.close();
const { stopExecWorker } = await import(pathToFileURL(path.join(import.meta.dirname, '..', '..', 'src', 'server', 'offloop', 'exec.ts')).href);
await stopExecWorker();
if (!args.includes('--keep')) rmSync(scratch, { recursive: true, force: true });
