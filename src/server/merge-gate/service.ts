// The merge gate's service, per office: evaluates a pull request's head against its review records
// (shared/merge-gate.ts), decides whether the office's Merge button may merge it, records a person's review
// or an admin's override, posts the `mx-office/review` status, and keeps an eye on the open pull requests
// as the board's list changes (a few per look, only the ones whose head or update time moved). Nothing here
// knows the office's floors or roster: index.ts hands it a GateFloor.

import { gateDecision, headReview, overrideFor, OVERRIDE_REASON_MIN, short, statusOf, type GateDecision, type MergeGateView, type OverrideRecord, type ProtectionView, type ReviewRecord, type Reviewer, type StatusPost } from '../../shared/merge-gate.js';
import { authorsOf, factsOf, type CollectLook, type PrFacts } from './collect.js';
import { postStatus, readProtection, viewPull, type GhRun } from './gh.js';
import { GateStore } from './store.js';

/** A project as the gate sees it. */
export interface GateFloor {
  id: string;
  dir: string;
  look: CollectLook;
  /** No other agent can review (Solo): the person reviews, and an unreviewed PR is theirs to look at. */
  personReviews: boolean;
}

/** A pull request on the board's list (what the sweep reads of it). */
export interface ListedPull {
  number: number;
  state: string;
  isDraft?: boolean;
  headRefOid?: string;
  updatedAt?: string;
}

const PROTECTION_MS = 10 * 60_000;
/** After GitHub refuses a status, the project's posts wait this long. */
const POST_BACKOFF_MS = 60 * 60_000;
/** The most pull requests one look at the list evaluates. */
export const SWEEP_MAX = 4;

export class MergeGate {
  readonly store: GateStore;
  private posted = new Map<string, StatusPost>();
  private backoff = new Map<string, number>();
  private protections = new Map<string, { at: number; p: Promise<ProtectionView> }>();
  private settled = new Map<string, ProtectionView>();
  private swept = new Map<string, string>();
  private sweeping = new Set<string>();
  /** The last evaluation of each open PR, for Needs you. */
  readonly views = new Map<string, MergeGateView>();

  constructor(
    dataDir: string,
    private readonly gh: GhRun,
    private readonly now: () => number = Date.now,
  ) {
    this.store = new GateStore(`${dataDir}/merge-gate`);
  }

  private key = (floorId: string, pr: number) => `${floorId}#${pr}`;

  /** The base branch's protection, read at most every 10 minutes. */
  protection(floor: GateFloor, branch: string): Promise<ProtectionView> {
    const k = `${floor.id}:${branch}`;
    const hit = this.protections.get(k);
    if (hit && this.now() - hit.at < PROTECTION_MS) return hit.p;
    const p = readProtection(this.gh, floor.dir, branch);
    this.protections.set(k, { at: this.now(), p });
    void p.then((v) => this.settled.set(k, v)).catch(() => undefined);
    return p;
  }

  /** The protection last read for the branch, when one has settled (no GitHub call). */
  peekProtection(floorId: string, branch: string): ProtectionView | undefined {
    return this.settled.get(`${floorId}:${branch}`);
  }

  /** Reads the PR, keeps any new review records, and works out its head's review and the gate's decision. */
  async evaluate(floor: GateFloor, pr: number, opts: { auto?: boolean; post?: boolean } = {}): Promise<MergeGateView & { facts: PrFacts }> {
    const book = await this.store.book(floor.id);
    const facts = factsOf(await viewPull(this.gh, floor.dir, pr), floor.look);
    await this.store.addReviews(floor.id, facts.records);
    const records = [...book.reviews.values()].filter((r) => r.pr === pr);
    const authors = authorsOf(facts);
    const review = headReview({ head: facts.head, commits: facts.commits, records, authors });
    const overrides = book.overrides.filter((o) => o.pr === pr);
    const decision: GateDecision =
      facts.state !== 'OPEN'
        ? { allowed: false, reason: facts.state === 'MERGED' ? 'Already merged.' : 'Closed without merging.' }
        : facts.isDraft
          ? { allowed: false, reason: 'Not merged: it is still a draft.' }
          : gateDecision(review, facts.checks, { auto: opts.auto, override: overrideFor(overrides, pr, facts.head, this.now()) });
    const protection = facts.base ? await this.protection(floor, facts.base).catch(() => undefined) : undefined;
    const view: MergeGateView & { facts: PrFacts } = {
      pr,
      state: facts.state,
      head: facts.head,
      review,
      checks: facts.checks,
      decision,
      ...(facts.state === 'OPEN' && !facts.isDraft && !decision.allowed && gateDecision(review, facts.checks, { auto: true }).allowed ? { autoAllowed: true } : {}),
      ...(protection ? { protection } : {}),
      history: records.sort((a, b) => b.at - a.at),
      overrides,
      authors,
      personReviews: floor.personReviews,
      facts,
    };
    if (facts.state === 'OPEN') {
      this.views.set(this.key(floor.id, pr), view);
      if (opts.post !== false) await this.post(floor, view);
    } else this.views.delete(this.key(floor.id, pr));
    const posted = this.posted.get(this.key(floor.id, pr));
    if (posted?.sha === facts.head) view.posted = posted;
    return view;
  }

  /** Posts the head's status when it isn't the one already posted (and GitHub hasn't refused lately). */
  private async post(floor: GateFloor, view: MergeGateView) {
    const k = this.key(floor.id, view.pr);
    const s = statusOf(view.review);
    const had = this.posted.get(k);
    if (!view.head || (had && had.sha === view.head && had.state === s.state && had.description === s.description && !had.error)) return;
    if ((this.backoff.get(floor.id) ?? 0) > this.now()) return;
    // Taken before the post, so a look at the same time (the sweep and the PR window) doesn't post it twice.
    this.posted.set(k, { sha: view.head, ...s, at: this.now() });
    const p = await postStatus(this.gh, floor.dir, view.head, s, this.now());
    this.posted.set(k, p);
    if (p.error) this.backoff.set(floor.id, this.now() + POST_BACKOFF_MS);
  }

  /** Whether the office's Merge button may merge PR `pr` now. */
  async check(floor: GateFloor, pr: number, opts: { auto?: boolean } = {}): Promise<GateDecision & { head?: string }> {
    try {
      const v = await this.evaluate(floor, pr, opts);
      return { ...v.decision, head: v.head };
    } catch (err) {
      return { allowed: false, reason: `Not merged: the office couldn’t read PR #${pr} from GitHub to check its review (${(err as Error).message}).` };
    }
  }

  /** A person's review of the head they saw (`sha`), stored and posted. Refuses a head that moved on, and an author. */
  async recordReview(floor: GateFloor, pr: number, r: { sha: string; verdict: 'approve' | 'changes'; by: Reviewer; note?: string }): Promise<{ record?: ReviewRecord; view?: MergeGateView; error?: string }> {
    const v = await this.evaluate(floor, pr, { post: false });
    if (!v.head || !r.sha || !v.head.toLowerCase().startsWith(r.sha.toLowerCase()) || r.sha.length < 7)
      return { error: `PR #${pr} moved on: you reviewed ${short(r.sha) || 'nothing'}, its head is now ${short(v.head)}. Look at the new commits and review again.` };
    if (v.authors.some((a) => a.trim().toLowerCase() === r.by.name.trim().toLowerCase())) return { error: `${r.by.name} authored commits on PR #${pr}, so that review wouldn’t be independent.` };
    const record: ReviewRecord = { id: `o:${this.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, pr, sha: v.head, shaFrom: 'office', verdict: r.verdict, reviewer: r.by, at: this.now(), source: 'office', ...(r.note ? { note: r.note.slice(0, 2000) } : {}) };
    await this.store.addReviews(floor.id, [record]);
    return { record, view: await this.evaluate(floor, pr) };
  }

  /** An admin's override for the head they saw: lets the office's Merge button through for OVERRIDE_MS. */
  async override(floor: GateFloor, pr: number, o: { sha: string; reason: string; by: { name: string; id?: string } }): Promise<{ override?: OverrideRecord; view?: MergeGateView; error?: string }> {
    const reason = o.reason.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (reason.length < OVERRIDE_REASON_MIN) return { error: `Type why (at least ${OVERRIDE_REASON_MIN} characters): it goes in the audit log.` };
    const v = await this.evaluate(floor, pr, { post: false });
    if (v.state !== 'OPEN') return { error: `PR #${pr} isn’t open.` };
    if (!v.head || !o.sha || o.sha.length < 7 || !v.head.toLowerCase().startsWith(o.sha.toLowerCase())) return { error: `PR #${pr} moved on to ${short(v.head)}: look again before overriding.` };
    const override: OverrideRecord = { pr, sha: v.head, reason, by: o.by, at: this.now() };
    await this.store.addOverride(floor.id, override);
    return { override, view: await this.evaluate(floor, pr, { post: false }) };
  }

  /**
   * A look at the board's list: the open PRs (not drafts) whose head or update time changed since the
   * last look, and the merged ones in `extra` (tasks marked unreviewed), are evaluated, a few at a time.
   */
  async sweep(floor: GateFloor, pulls: readonly ListedPull[], extra: readonly number[] = []): Promise<number> {
    if (this.sweeping.has(floor.id)) return 0;
    this.sweeping.add(floor.id);
    try {
      await this.store.book(floor.id);
      const open = new Set(pulls.filter((p) => p.state === 'OPEN').map((p) => p.number));
      for (const k of this.views.keys()) if (k.startsWith(`${floor.id}#`) && !open.has(Number(k.slice(floor.id.length + 1)))) this.views.delete(k);
      const due = pulls.filter((p) => (p.state === 'OPEN' && !p.isDraft) || (p.state === 'MERGED' && extra.includes(p.number))).filter((p) => this.swept.get(this.key(floor.id, p.number)) !== `${p.headRefOid}|${p.updatedAt}`);
      let n = 0;
      for (const p of due.slice(0, SWEEP_MAX)) {
        this.swept.set(this.key(floor.id, p.number), `${p.headRefOid}|${p.updatedAt}`);
        await this.evaluate(floor, p.number).catch(() => undefined);
        n++;
      }
      return n;
    } finally {
      this.sweeping.delete(floor.id);
    }
  }
}
