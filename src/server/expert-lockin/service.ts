// Lock in, per project, free of the office's context (index.ts wires the real one, the tests fakes):
//   start         step 1: what the session left uncommitted is committed first (slice 2's commit path; a commit
//                 that fails refuses with its reason), then the full checks at that exact head, live, recorded;
//                 refused while the session is working (wait, or stop the turn)
//   merge         step 2: the checked commit into main with a receipt (./merge.ts), only when the checks pass or
//                 the person accepts the failures by name (an override in the decision log), a data impact only
//                 once confirmed; main pushed to Team Server in the background; session/main carries on (./session.ts)
//   publish       a Free App: Studio Pro opens on the merged main (the existing open flow) and the person presses
//                 Publish; a licensed app is told to use Deploy
//   requestDeploy a licensed node: a deploy request to approval (Needs you), never a deploy; blocked by demo users
//   closePhase    a phased project whose current phase's rows are all done: the phase marked done after a merge
// Everything it does goes in the decision log (./book.ts) and the audit log.

import { randomUUID } from 'node:crypto';
import { SESSION_BRANCH } from '../../shared/expert-proof.js';
import { KIND_NAMES, LOCKIN_KINDS, holding, mergeRefusal, type Licence, type LockInAction, type LockInCheck, type LockInMerge, type LockInPhase, type LockInRun, type LockInView } from '../../shared/expert-lockin.js';
import type { CommitOutcome } from '../expert/commit.js';
import { gitHeld, type ProofGit } from '../expert/git.js';
import { currentBranch, headOf } from '../expert/session.js';
import type { LockInChecks, LockInFloor } from './checks.js';
import { lockInBook, saveLockIn } from './book.js';
import { mainBranchOf, mergeChecked } from './merge.js';
import { carryOn } from './session.js';

export type LFloor = LockInFloor & { name: string };
type Impact = NonNullable<LockInView['impact']>;
export type Fail = { ok: false; status: number; error: string };

export interface LockInDeps {
  git: ProofGit;
  dataDir: string;
  checks(floor: LFloor): LockInChecks;
  /** Slice 2's commit path: what the session left uncommitted on session/main. */
  commit(floor: LFloor): Promise<CommitOutcome>;
  /** Why the session can't be locked in now (it's working), or undefined. */
  busy(floor: LFloor): string | undefined;
  identity(): { name: string; email: string };
  /** The data-impact finding from `base` (main) to `sha` (local-merge/describe.ts impactAt). */
  impact(floor: LFloor, base: string, sha: string): Promise<Impact>;
  /** Pushes `branch` to Team Server (expert/push.ts): 'ok', why it's off, or a rejection. */
  push(floor: LFloor, branch: string): Promise<'ok' | { off: string }>;
  licence(floor: LFloor): Promise<Licence>;
  demoUsers(floor: LFloor): Promise<LockInView['demoUsers']>;
  /** Raises the deploy request in Needs you: its id, or why it couldn't. */
  raiseDeploy(floor: LFloor, ask: { title: string; details: string; by: string }): string | { error: string };
  /** The phase in progress and its rows, for a phased project. */
  phase(floor: LFloor): Promise<LockInPhase | undefined>;
  /** Marks the phase done: undefined, or why not. */
  closePhase(floor: LFloor, phaseId: string, by: string): Promise<string | undefined>;
  /** Opens Studio Pro on main (the existing Edit in Studio Pro flow). */
  openStudio(floor: LFloor, by: string): Promise<{ ok: true; note?: string } | { ok: false; error: string }>;
  audit(floor: LFloor, by: string, action: string, summary: string, details?: Record<string, unknown>): void;
  /** The project's Lock in changed: pages look again. */
  changed(floorId: string): void;
  /** session/main moved under the background proof: it looks at HEAD again. */
  reattach(floor: LFloor): void;
  /** Rows in PROJECT.md's ## Decisions. */
  projectDecisions(floor: LFloor): Promise<number>;
  now(): number;
}

const ok = <T extends object>(v: T) => ({ ok: true as const, ...v });
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const short = (s: string) => s.slice(0, 7);

export class LockInService {
  private running = new Map<string, LockInRun>();
  private impacts = new Map<string, Promise<Impact>>();
  private carrying = new Map<string, number>();

  constructor(readonly d: LockInDeps) {}

  private book(id: string) {
    return lockInBook(this.d.dataDir, id);
  }

  private save(id: string) {
    saveLockIn(this.d.dataDir, id, this.book(id));
  }

  /** A row in the decision log (and the audit log). */
  decide(floor: LFloor, by: string, action: LockInAction, text: string, commit?: string, details?: Record<string, unknown>) {
    const b = this.book(floor.id);
    b.decisions.push({ at: this.d.now(), by, action, text, ...(commit ? { commit } : {}) });
    this.save(floor.id);
    this.d.audit(floor, by, `expert.lockin.${action}`, text, { ...(commit ? { commit } : {}), ...details });
    this.d.changed(floor.id);
  }

  private latestRun(id: string): LockInRun | undefined {
    return this.running.get(id) ?? this.book(id).runs.at(-1);
  }

  /** Why Lock in can't start now, or undefined. */
  async busyNow(floor: LFloor): Promise<string | undefined> {
    if (this.running.has(floor.id)) return 'The checks are running';
    const b = this.d.busy(floor);
    if (b) return b;
    const held = await gitHeld(this.d.git, floor.dir);
    if (held) return `git is busy in the project folder (${held})`;
    return undefined;
  }

  /** Step 1: commit what's pending, then the full checks at that head. */
  async start(floor: LFloor, by: string): Promise<{ ok: true; run: LockInRun } | Fail> {
    const busy = await this.busyNow(floor);
    if (busy) return fail(409, `Lock in can't start now: ${busy}. Wait for the turn to end, or stop it in the session`);
    const branch = await currentBranch(this.d.git, floor.dir);
    if (branch !== SESSION_BRANCH) return fail(409, `The folder is on ${branch || 'a detached HEAD'}, not ${SESSION_BRANCH}: Lock in checks the session branch`);
    const c = await this.d.commit(floor);
    if (c.kind === 'error') return fail(409, `Lock in didn't start: the pending changes couldn't be committed (${c.error})`);
    if (c.kind === 'busy') return fail(409, `Lock in didn't start: ${c.why}`);
    if (c.kind === 'off-branch') return fail(409, `The folder is on ${c.branch}, not ${SESSION_BRANCH}`);
    const head = await headOf(this.d.git, floor.dir);
    if (!head) return fail(409, `${SESSION_BRANCH} has no commits yet`);
    const run: LockInRun = { id: randomUUID().slice(0, 12), commit: head, by, startedAt: this.d.now(), checks: LOCKIN_KINDS.map((k): LockInCheck => ({ kind: k, name: KIND_NAMES[k], status: 'waiting', summary: 'Waiting' })), ...(c.kind === 'committed' ? { committed: { sha: c.sha, files: c.files } } : {}) };
    this.running.set(floor.id, run);
    const b = this.book(floor.id);
    b.runs.push(run);
    this.save(floor.id);
    this.d.audit(floor, by, 'expert.lockin.start', `Lock in: checks started at ${short(head)}${c.kind === 'committed' ? ` (committed ${c.files} pending file${c.files === 1 ? '' : 's'} first)` : ''}`, { commit: head });
    this.d.changed(floor.id);
    void this.runChecks(floor, run);
    return { ok: true, run };
  }

  private async runChecks(floor: LFloor, run: LockInRun) {
    try {
      const out = await this.d.checks(floor).run(floor, run.commit, {
        kinds: LOCKIN_KINDS,
        by: run.by,
        onProgress: (c) => {
          run.checks = run.checks.map((x) => (x.kind === c.kind ? c : x));
          this.d.changed(floor.id);
        },
        // The runner reads HEAD itself: when the session committed while Lock in waited its turn, the checks ran (and
        // the merge takes) that commit.
        onCommit: (sha) => {
          if (sha === run.commit) return;
          run.commit = sha;
          this.save(floor.id);
          this.d.changed(floor.id);
        },
      });
      for (const c of out) run.checks = run.checks.map((x) => (x.kind === c.kind ? c : x));
      // Everything in the ledger at the exact commit (a microflow run that recorded itself isn't added twice).
      const { testingStore } = await import('../testing/index.js');
      const { ledgerDraft } = await import('./checks.js');
      const drafts = run.checks.filter((c) => !c.record).map((c) => ledgerDraft(c, run.commit, run.id, this.d.now()));
      const recs = await testingStore(this.d.dataDir, floor.id).ingest(drafts).catch(() => []);
      for (const r of recs) {
        const kind = run.checks.find((c) => r.sourceKey === `lockin:${run.id}:${c.kind}`);
        if (kind) kind.record = r.id;
      }
    } catch (err) {
      run.checks = run.checks.map((x) => (x.status === 'running' || x.status === 'waiting' ? { ...x, status: 'not-run', summary: 'Didn’t run', detail: (err as Error).message.slice(0, 200) } : x));
    } finally {
      run.finishedAt = this.d.now();
      this.running.delete(floor.id);
      this.save(floor.id);
      const held = holding(run.checks);
      const words = run.checks.map((c) => `${c.name} ${c.status}`).join(', ');
      this.decide(floor, run.by, 'checks', `Lock in checks at ${short(run.commit)}: ${words}${held.length ? `. Holding the merge: ${held.map((c) => c.name).join(', ')}` : '. All clear'}`, run.commit);
    }
  }

  private impactOf(floor: LFloor, base: string | null, sha: string): Promise<Impact> {
    if (!base) return Promise.resolve({ status: 'none', lines: [] });
    const key = `${floor.id}|${base}|${sha}`;
    let p = this.impacts.get(key);
    if (!p) {
      p = this.d.impact(floor, base, sha).catch((err: Error) => ({ status: 'unknown' as const, lines: [err.message.slice(0, 160)] }));
      this.impacts.set(key, p);
      if (this.impacts.size > 50) this.impacts.delete(this.impacts.keys().next().value!);
    }
    return p;
  }

  /** What the panel shows. */
  async view(floor: LFloor): Promise<LockInView> {
    const git = this.d.git;
    const b = this.book(floor.id);
    const [branch, mainName] = await Promise.all([currentBranch(git, floor.dir), mainBranchOf(git, floor.dir)]);
    const head = (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${SESSION_BRANCH}^{commit}`], floor.dir).catch(() => '')).trim() || null;
    const main = (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${mainName}^{commit}`], floor.dir).catch(() => '')).trim() || null;
    const ahead = head ? Number((await git(['rev-list', '--count', main ? `${main}..${head}` : head], floor.dir).catch(() => '0')).trim()) || 0 : 0;
    const run = this.latestRun(floor.id);
    const running = this.running.has(floor.id);
    const newer = run && head && run.commit !== head ? Number((await git(['rev-list', '--count', `${run.commit}..${head}`], floor.dir).catch(() => '0')).trim()) || 0 : 0;
    const merged = b.merges.at(-1);
    const thisMerge = merged && run && merged.sha === run.commit ? merged : undefined;
    if (thisMerge?.session === 'waiting') void this.retryCarry(floor, thisMerge, mainName);
    const [impact, licence, demoUsers, phase, decisions, busy] = await Promise.all([
      run?.finishedAt && !thisMerge ? this.impactOf(floor, main, run.commit) : Promise.resolve(undefined),
      this.d.licence(floor).catch(() => 'unknown' as const),
      this.d.demoUsers(floor).catch(() => ({ on: false, known: false })),
      this.d.phase(floor).catch(() => undefined),
      this.d.projectDecisions(floor).catch(() => 0),
      this.busyNow(floor),
    ]);
    const requested = thisMerge ? b.deploys.filter((x) => x.merge === thisMerge.merge).at(-1) : undefined;
    const closed = thisMerge ? b.closed.filter((x) => x.merge === thisMerge.merge).at(-1) : undefined;
    const last = merged && { at: merged.at, merge: merged.merge, commits: merged.commits };
    return {
      floor: floor.id,
      branch,
      head,
      main,
      ahead,
      ...(busy && !running ? { busy } : {}),
      ...(run ? { run } : {}),
      running,
      newer,
      ...(impact ? { impact } : {}),
      ...(thisMerge ? { merged: thisMerge } : {}),
      licence,
      demoUsers,
      deploy: this.deployState(licence, demoUsers, thisMerge, requested),
      ...(phase ? { phase } : {}),
      ...(closed ? { closed: { id: closed.id, name: closed.name } } : {}),
      ...(last ? { last } : {}),
      decisions: decisions + b.decisions.length,
    };
  }

  private deployState(licence: Licence, demo: LockInView['demoUsers'], merged: LockInMerge | undefined, requested?: { id: string; at: number; merge: string }): LockInView['deploy'] {
    const why = this.deployBlock(licence, demo, merged);
    return { allowed: !why, ...(why ? { why } : {}), ...(requested ? { requested: { id: requested.id, at: requested.at, merge: requested.merge } } : {}) };
  }

  private deployBlock(licence: Licence, demo: LockInView['demoUsers'], merged: LockInMerge | undefined): string | undefined {
    if (licence === 'free') return 'Free App: there is no deploy API. Publish from Studio Pro instead';
    if (licence === 'unknown') return 'The office couldn’t read the app’s licence (Settings › Connections › Mendix): deploy from Studio Pro or the Portal';
    if (demo.on) return `Demo users are on${demo.count ? ` (${demo.count})` : ''}: they block Deploy. Switch to seed users first (the readiness fix “Switch to seed users”)`;
    if (!demo.known) return 'The office couldn’t tell whether demo users are on: Deploy waits until it can';
    if (!merged) return 'Merge to main first: a deploy takes main';
    return undefined;
  }

  private async retryCarry(floor: LFloor, m: LockInMerge, main: string) {
    const last = this.carrying.get(floor.id) ?? 0;
    if (this.d.now() - last < 10_000 || this.d.busy(floor)) return;
    this.carrying.set(floor.id, this.d.now());
    const r = await carryOn(this.d.git, floor.dir, main, m.merge, false, this.d.identity()).catch(() => undefined);
    if (!r || r.session === 'waiting') return;
    m.session = r.session;
    if (r.note) m.sessionNote = r.note;
    else delete m.sessionNote;
    this.save(floor.id);
    this.d.reattach(floor);
    this.d.changed(floor.id);
  }

  /** Step 2: merge the checked commit into main. */
  async merge(floor: LFloor, by: string, said: { commit?: string; accept?: readonly string[]; confirmImpact?: boolean }): Promise<{ ok: true; merged: LockInMerge } | Fail> {
    const run = this.latestRun(floor.id);
    const b = this.book(floor.id);
    const mainName = await mainBranchOf(this.d.git, floor.dir);
    const main = (await this.d.git(['rev-parse', '--verify', '--quiet', `refs/heads/${mainName}^{commit}`], floor.dir).catch(() => '')).trim() || null;
    const impact = run?.finishedAt ? await this.impactOf(floor, main, run.commit) : undefined;
    const refusal = mergeRefusal({ run, running: this.running.has(floor.id), ...(impact ? { impact } : {}), merged: b.merges.at(-1) }, said);
    if (refusal) return fail(409, refusal);
    const r = run!;
    const held = holding(r.checks);
    const acceptedSet = new Set((said.accept ?? []).map((n) => n.toLowerCase()));
    const accepted = held.filter((c) => acceptedSet.has(c.name.toLowerCase())).map((c) => c.name);
    const impactLines = impact?.status === 'impact' ? impact.lines : [];
    const m = await mergeChecked(this.d.git, floor.dir, { sha: r.commit, checks: r.checks, accepted, impact: impactLines, by, identity: this.d.identity() });
    if (!m.ok) {
      this.d.audit(floor, by, 'expert.lockin.refused', m.error, { commit: r.commit });
      return m;
    }
    if (accepted.length) this.decide(floor, by, 'override', `Accepted known failures at ${short(r.commit)} to merge: ${accepted.map((n) => `${n} (${r.checks.find((c) => c.name === n)?.summary ?? ''})`).join(', ')}`, r.commit, { accepted });
    if (impactLines.length) this.decide(floor, by, 'impact', `Confirmed the data impact of ${short(r.commit)}: ${impactLines.join('; ')}`, r.commit, { impact: impactLines });
    const merged: LockInMerge = { merge: m.merge, sha: r.commit, into: m.into, by, at: this.d.now(), newer: m.newer, commits: m.commits, push: 'pending', session: 'waiting', ...(accepted.length ? { accepted } : {}), ...(impactLines.length ? { impact: impactLines } : {}) };
    b.merges.push(merged);
    this.save(floor.id);
    this.decide(floor, by, 'merge', `Merged ${SESSION_BRANCH} @${short(r.commit)} into ${m.into} as ${short(m.merge)} (${m.commits} commit${m.commits === 1 ? '' : 's'}) with the checks' receipt${m.newer ? `; ${m.newer} newer commit${m.newer === 1 ? '' : 's'} not included` : ''}`, r.commit, { merge: m.merge, into: m.into, newer: m.newer });
    const c = await carryOn(this.d.git, floor.dir, m.into, m.merge, !!this.d.busy(floor), this.d.identity()).catch((err: Error) => ({ session: 'waiting' as const, note: err.message.slice(0, 160) }));
    merged.session = c.session;
    if (c.note) merged.sessionNote = c.note;
    this.save(floor.id);
    this.d.reattach(floor);
    void this.pushMain(floor, merged);
    this.d.changed(floor.id);
    return { ok: true, merged };
  }

  /** main to Team Server in the background (never a force): its state kept on the merge. */
  async pushMain(floor: LFloor, m: LockInMerge): Promise<void> {
    try {
      const r = await this.d.push(floor, m.into);
      if (r === 'ok') {
        m.push = 'ok';
        delete m.pushError;
      } else {
        m.push = 'off';
        m.pushError = r.off;
      }
    } catch (err) {
      m.push = 'failed';
      m.pushError = (err as Error).message.slice(0, 300);
    }
    this.save(floor.id);
    this.d.changed(floor.id);
  }

  private lastMerge(id: string): LockInMerge | undefined {
    return this.book(id).merges.at(-1);
  }

  /** Publish to sandbox: a Free App's Studio Pro opens on the merged main; the person presses Publish. */
  async publish(floor: LFloor, by: string): Promise<{ ok: true; note?: string } | Fail> {
    const m = this.lastMerge(floor.id);
    if (!m) return fail(409, 'Merge to main first: Studio Pro opens on the merged revision');
    const licence = await this.d.licence(floor).catch(() => 'unknown' as const);
    if (licence === 'licensed') return fail(409, 'This is a licensed app: use Deploy (Request deploy) instead');
    const r = await this.d.openStudio(floor, by);
    if (!r.ok) return fail(409, r.error);
    this.decide(floor, by, 'publish', `Opened Studio Pro on ${m.into} @${short(m.merge)} to publish to the Free App sandbox (the person presses Publish)`, m.merge);
    return ok({ ...(r.note ? { note: r.note } : {}) });
  }

  /** Request deploy: a deploy request to approval, never a deploy. Blocked while demo users are on. */
  async requestDeploy(floor: LFloor, by: string): Promise<{ ok: true; id: string } | Fail> {
    const m = this.lastMerge(floor.id);
    const [licence, demo] = await Promise.all([this.d.licence(floor).catch(() => 'unknown' as const), this.d.demoUsers(floor).catch(() => ({ on: false, known: false }))]);
    const why = this.deployBlock(licence, demo, m);
    if (why) return fail(409, `Deploy blocked: ${why}`);
    const merged = m!;
    const run = this.book(floor.id).runs.find((r) => r.commit === merged.sha);
    const checks = run ? run.checks.map((c) => `${c.name}: ${c.status} (${c.summary})`).join('; ') : 'no checks recorded';
    const id = this.d.raiseDeploy(floor, {
      by,
      title: `Deploy ${floor.name} at ${short(merged.merge)} to a licensed node`,
      details: `Lock in merged ${SESSION_BRANCH} @${short(merged.sha)} into ${merged.into} as ${short(merged.merge)}. Checks at that commit: ${checks}.${merged.accepted?.length ? ` Accepted as known failures: ${merged.accepted.join(', ')}.` : ''} Approve, then deploy it from the Mendix Portal (or Studio Pro). The office never deploys by itself.`,
    });
    if (typeof id !== 'string') return fail(409, id.error);
    const b = this.book(floor.id);
    b.deploys.push({ id, at: this.d.now(), merge: merged.merge, by });
    this.save(floor.id);
    this.decide(floor, by, 'deploy-request', `Requested a deploy of ${merged.into} @${short(merged.merge)} (${id}): waiting for approval`, merged.merge, { request: id });
    return { ok: true, id };
  }

  /** Close phase N after a merge, when every row of the phase in progress is done. */
  async closePhase(floor: LFloor, by: string, phaseId: string): Promise<{ ok: true } | Fail> {
    const m = this.lastMerge(floor.id);
    const run = this.latestRun(floor.id);
    if (!m || !run || m.sha !== run.commit) return fail(409, 'Close a phase after a Lock in merge');
    const p = await this.d.phase(floor);
    if (!p || p.id !== phaseId) return fail(409, 'That phase isn’t the one in progress');
    if (!p.complete) return fail(409, `${p.name} has ${p.rows - p.rowsDone} row${p.rows - p.rowsDone === 1 ? '' : 's'} left`);
    const err = await this.d.closePhase(floor, phaseId, by);
    if (err) return fail(409, err);
    const b = this.book(floor.id);
    b.closed.push({ id: p.id, name: p.name, at: this.d.now(), merge: m.merge, by });
    this.save(floor.id);
    this.decide(floor, by, 'phase-close', `Closed phase ${p.order}, ${p.name}, after the Lock in merge ${short(m.merge)}`, m.merge, { phase: p.id });
    return { ok: true };
  }
}
