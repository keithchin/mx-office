// The gates on the team's working branch (real-build fix, docs/mockups/product-assessment/real-build-test.md
// P1-5): the office reads the gates from origin/<default>, and a lead working on its own branch had answered the
// intake questions and recorded sign-offs there, while the Overview still said Kickoff PENDING. This reads the
// team's newest branch ahead of main that changes the register (PROJECT.md) or the intake (intake.md), and says
// per stage what it has that main hasn't: an intake fully answered there (Stage P), a sign-off or a CONFIRMED
// decision (never an artifact waiver). Shown next to main's state as "on the team's branch (not merged)", never
// instead of it. Read-only local git (`for-each-ref`, `rev-list`, `diff`, `show`), off the event loop; kept per
// (main, branch head) so a look costs nothing new until one of them moves.

import { execFileOff } from '../offloop/exec.js';
import { waiverRow } from '../../shared/gate-play.js';
import type { TeamBranchGates } from '../../shared/wizard.js';
import { setupViewOf } from './setup.js';

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
const CANDIDATES = 6;

function git(args: string[], cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => execFileOff('git', args, { cwd, maxBuffer: 8 * 1024 * 1024, timeout: 20_000, env: ENV, windowsHide: true }, (err, out) => resolve(err ? undefined : String(out))));
}

type View = ReturnType<typeof setupViewOf>;

const confirmedRows = (v: View) => (v.decisions ?? []).filter((r) => /^confirmed\b/i.test(r.status.trim()) && !waiverRow(r));
const rowKey = (r: { stage: string; decision: string }) => `${r.stage.replace(/^stage\s*/i, '').trim().toUpperCase()}|${r.decision.trim()}`;

/** What the branch's register and intake have that main's don't, per stage. Pure. */
export function branchAhead(main: View, branch: View): TeamBranchGates['stages'] {
  const out: TeamBranchGates['stages'] = [];
  const mainP = main.stages.find((s) => s.id === 'P');
  const branchP = branch.stages.find((s) => s.id === 'P');
  if (mainP && branchP && mainP.status !== 'PASS' && branchP.status === 'PASS') out.push({ id: 'P', text: 'every intake question answered' });
  const had = new Set(confirmedRows(main).map(rowKey));
  const fresh = confirmedRows(branch).filter((r) => !had.has(rowKey(r)));
  const byStage = new Map<string, string[]>();
  for (const r of fresh) {
    const id = r.stage.replace(/^stage\s*/i, '').trim().toUpperCase();
    byStage.set(id, [...(byStage.get(id) ?? []), r.decision.trim()]);
  }
  for (const [id, ds] of byStage) {
    if (out.some((x) => x.id === id)) continue;
    out.push({ id, text: ds.length === 1 ? `confirmed: ${clip(ds[0], 90)}` : `${ds.length} decisions confirmed` });
  }
  return out;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const memo = new Map<string, Promise<TeamBranchGates | undefined>>();

/**
 * The team's newest branch ahead of `def` whose register or intake differs from main's, and what it has that
 * main hasn't; undefined when there's none (or nothing new on it). `main`: main's files as the setup view read them.
 */
export async function teamBranchGates(dir: string, def: string, mainSha: string, main: { 'PROJECT.md'?: string; 'intake.md'?: string }): Promise<TeamBranchGates | undefined> {
  const refs = await git(['for-each-ref', '--sort=-committerdate', `--count=${CANDIDATES * 3}`, '--format=%(refname:short)%09%(objectname)', 'refs/heads', 'refs/remotes/origin'], dir);
  if (!refs) return undefined;
  const seen = new Set<string>();
  const list: { name: string; sha: string }[] = [];
  for (const line of refs.split('\n')) {
    const [ref, sha] = line.trim().split('\t');
    if (!ref || !sha) continue;
    const name = ref.replace(/^origin\//, '');
    if (name === def || name === 'HEAD' || ref === 'origin' || seen.has(sha) || seen.has(name)) continue;
    seen.add(sha);
    seen.add(name);
    list.push({ name, sha });
    if (list.length >= CANDIDATES) break;
  }
  for (const b of list) {
    const key = `${dir}|${mainSha}|${b.sha}`;
    let p = memo.get(key);
    if (!p) {
      p = readOne(dir, mainSha, b, main);
      memo.set(key, p);
      if (memo.size > 200) memo.delete(memo.keys().next().value!);
    }
    const r = await p;
    if (r) return r;
  }
  return undefined;
}

async function readOne(dir: string, mainSha: string, b: { name: string; sha: string }, main: { 'PROJECT.md'?: string; 'intake.md'?: string }): Promise<TeamBranchGates | undefined> {
  const ahead = Number((await git(['rev-list', '--count', `${mainSha}..${b.sha}`], dir))?.trim() ?? 0);
  if (!ahead) return undefined;
  const changed = (await git(['diff', '--name-only', mainSha, b.sha, '--', 'PROJECT.md', 'intake.md'], dir))?.trim();
  if (!changed) return undefined;
  const [project, intake] = await Promise.all([git(['show', `${b.sha}:PROJECT.md`], dir), git(['show', `${b.sha}:intake.md`], dir)]);
  if (!project) return undefined;
  const stages = branchAhead(setupViewOf(main), setupViewOf({ 'PROJECT.md': project, ...(intake ? { 'intake.md': intake } : {}) }));
  return stages.length ? { branch: b.name, sha: b.sha, ahead, stages } : undefined;
}
