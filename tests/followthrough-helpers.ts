// What the Recorded as given tests share (tests/recorded-as-given-*.test.ts): a throwaway project in real git
// with a bare "origin" (so origin/main exists, local only), a team floor whose escalation the Project Manager
// answered through the 1B-1 dispatcher, and the follow-through service over both, fed by the asks look's own
// reads (asks/sources.ts). No office, no Claude, no GitHub.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditInput } from '../src/shared/audit.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import { placesOf, readEverywhere, type AskPerson } from '../src/server/asks/sources.js';
import { FollowThrough, type FollowDeps } from '../src/server/followthrough/service.js';
import { typeTarget } from '../src/server/roster/dispatch-send.js';
import { FakeFloor, clock, office, type Office } from './dispatch-helpers.js';

export const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', windowsHide: true }).toString();

export const JOURNAL = 'docs/team/development.md';

/** A project with PROJECT.md and a journal on main, pushed to a bare origin. */
export function project() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ft-'));
  const origin = path.join(root, 'origin.git');
  const dir = path.join(root, 'proj');
  mkdirSync(dir);
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(dir, '.gitignore'), '.agent-office/\n');
  mkdirSync(path.join(dir, 'docs', 'team'), { recursive: true });
  writeFileSync(path.join(dir, 'PROJECT.md'), '# Project\n\n## Decisions\n\n| ID | Decision | Status |\n| --- | --- | --- |\n');
  writeFileSync(path.join(dir, JOURNAL), '# Development team journal\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'start');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  return { root, dir, origin };
}

/** A worktree on branch `branch` under .agent-office/worktrees. */
export function worktree(dir: string, name: string, branch = `office/${name}`) {
  const wt = path.join(dir, '.agent-office', 'worktrees', name);
  git(dir, 'worktree', 'add', '-q', '-b', branch, wt);
  git(wt, 'config', 'user.email', 'test@example.com');
  git(wt, 'config', 'user.name', 'Test');
  return wt;
}

/** A journal entry appended (the citation line and its paragraph). */
export function journal(dir: string, entry: string) {
  writeFileSync(path.join(dir, JOURNAL), `# Development team journal\n\n## 2026-10-15 10:00 — Decision\n\n${entry}\n`);
}

export interface Team {
  floor: FakeFloor;
  o: Office;
  e: Escalation;
  ft: FollowThrough;
  audits: AuditInput[];
  repo: ReturnType<typeof project>;
  /** One asks look's reads of the project and `people`'s worktrees, scanned; the escalation's finding. */
  scan(people?: AskPerson[]): Promise<FollowRecording>;
}

type FollowRecording = Awaited<ReturnType<FollowThrough['store']['get']>>['recordings'][string] | undefined;

/** A team floor with Ada's escalation answered "Go with: Use SSO" (rev 1), and the follow-through over a fresh project. */
export async function team(title = 'Sign-in: SSO or magic links?', text = 'Go with: Use SSO'): Promise<Team> {
  const floor = new FakeFloor();
  const o = office(floor);
  const ada = floor.add('a1', 'Ada');
  const e = o.roster.escalations.raise(floor, floor.worker(ada)!, { urgency: 'important', title, details: '', options: ['Use SSO', 'Use magic links'] });
  const r = await o.roster.escalations.answer(floor, e.id, { verdict: 'reply', raw: text, by: 'Keith' });
  if (!r.ok) throw new Error(r.error);
  const audits: AuditInput[] = [];
  const deps: FollowDeps = {
    dataDir: o.dataDir,
    now: () => clock.now,
    dispatcher: o.roster.dispatch,
    escalations: (id) => o.roster.data(id).escalations,
    escTarget: (_f, x, by) => {
      const w = floor.worker(x.workerId);
      return w ? (t) => typeTarget(o.roster, floor, w, t, { origin: 'person', by, wake: true, resume: true }) : `${x.by} isn't on the project now`;
    },
    qTarget: async () => 'no questions here',
    flush: (id) => o.roster.file(id).flushCritical(),
    record: (a) => void audits.push(a),
  };
  const ft = new FollowThrough(deps);
  const repo = project();
  const decision = `esc:${e.id}`;
  return {
    floor,
    o,
    e: o.roster.data(floor.id).escalations.find((x) => x.id === e.id)!,
    ft,
    audits,
    repo,
    async scan(people = []) {
      const places = await placesOf(repo.dir, people);
      const reads = await readEverywhere(repo.dir, places, [JOURNAL, 'PROJECT.md']);
      await ft.scan({ id: floor.id, dir: repo.dir }, reads);
      return (await ft.store.get(floor.id)).recordings[decision];
    },
  };
}
