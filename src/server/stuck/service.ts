// Stuck detection's service: every few minutes, for each floor, one look (the detectors in detect.ts over
// what the office already has, read off the event loop), its findings reconciled with the floor's book
// (book.ts: raised once, updated in place, resolved by itself), every change audited as stuck.* (which
// also tells the pages to fetch again, through {t:'audit.new'}), and the book saved. The Project
// Manager's buttons come here too: a message to the team lead through the team's own tell (after their
// turn unless they say now), a snooze, a dismissal, or the workaround accepted. The office never writes
// to GitHub and never makes a gh call of its own: the PR list is the board's existing poll.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuditInput } from '../../shared/audit.js';
import { ACCEPT_QUIET_MS, SNOOZE_MS, stuckActions, leadMessage, stuckTitle, type StuckAction, type StuckDraft, type StuckFloorView, type StuckSettings, type StuckView } from '../../shared/stuck.js';
import { StuckBook, reviveBook, type BookEvent, type StuckRecord } from './book.js';
import { detectStuck, failingStreaks, type PullFacts, type RunLike } from './detect.js';
import { currentStage, planRows } from './parse.js';
import type { RepoRead } from './repo.js';
import { settledCheck, sourcedDrafts } from './sources.js';

/** How often each floor is looked at. */
export const LOOK_MS = 5 * 60_000;

export interface StuckFloor {
  id: string;
  name: string;
  dir: string;
  pulls(): readonly PullFacts[];
  /** Whether any agent on it is working right now. */
  working(): boolean;
}

export interface StuckDeps {
  dataDir: string;
  floors(): Iterable<StuckFloor>;
  now(): number;
  settings(): StuckSettings;
  readRepo(dir: string): Promise<RepoRead | undefined>;
  runs(floorId: string): Promise<readonly RunLike[]>;
  /** What the budget ledger booked since `at` (whole days), in its currency. */
  spendSince(floor: StuckFloor, at: number): { spend: number; currency: string } | undefined;
  /** Whoever covers Management on the floor's team. */
  lead(floor: StuckFloor): { name: string; working: boolean; since?: number } | undefined;
  /** The team's tell to that lead, as the Project Manager: an error, or undefined when it went (or was held for after its turn). */
  tell(floor: StuckFloor, text: string, by: string, when: 'now' | 'after', owner?: string, decision?: string): string | undefined | Promise<string | undefined>;
  /** The floor's open escalations (kept for callers; an escalation about the same thing now groups with the item on its decision card, it no longer hides it). */
  openEscalations?(floor: StuckFloor): readonly { title: string; details: string }[];
  record(e: AuditInput): void;
}

const ACTOR = { kind: 'office' as const, name: 'Stuck detection' };
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

/**
 * Whether an open escalation already says the same: it names the PR, the decision or the test. No longer
 * used to hide an item (decision cards group on explicit ids instead, shared/decisions/); kept for its tests.
 */
export function coveredBy(d: StuckDraft, escs: readonly { title: string; details: string }[]): boolean {
  const key = d.pr ? new RegExp(`#${d.pr.number}(?!\\d)`) : d.decision ? new RegExp(`(?:^|[^\\w-])${d.decision.id}(?![\\w-]*\\d)`) : d.failing?.[0] ? new RegExp(`(?:^|[^\\w-])${d.failing[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d.])`) : undefined;
  return !!key && escs.some((e) => key.test(`${e.title}\n${e.details}`));
}

export class StuckService {
  private books = new Map<string, Promise<StuckBook>>();
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  /** Stopped (the office closing): no more looks, and nothing more written. */
  private stopped = false;
  private looking = false;

  constructor(private readonly deps: StuckDeps) {}

  start() {
    this.stopped = false;
    const first = (this.first = setTimeout(() => void this.lookAll(), 30_000));
    first.unref?.();
    this.timer = setInterval(() => void this.lookAll(), LOOK_MS);
    this.timer.unref?.();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  private file(floorId: string) {
    return path.join(this.deps.dataDir, 'stuck', `${floorId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }

  /** The floor's book, read from disk the first time (asynchronously). */
  book(floorId: string): Promise<StuckBook> {
    let p = this.books.get(floorId);
    if (!p) {
      p = readFile(this.file(floorId), 'utf8').then(
        (t) => new StuckBook(reviveBook(JSON.parse(t))),
        () => new StuckBook(),
      );
      this.books.set(floorId, p);
    }
    return p;
  }

  private async save(floorId: string, book: StuckBook) {
    if (this.stopped) return;
    const f = this.file(floorId);
    try {
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(`${f}.tmp`, JSON.stringify(book.data));
      await rename(`${f}.tmp`, f);
    } catch (err) {
      console.error(`agent-office: stuck: couldn't save ${floorId}: ${(err as Error).message}`);
    }
  }

  /** Every floor, one after another; never overlaps, never throws. */
  async lookAll(): Promise<void> {
    if (this.looking || this.stopped) return;
    this.looking = true;
    try {
      for (const f of this.deps.floors()) {
        try {
          await this.look(f);
        } catch (err) {
          console.error(`agent-office: stuck: couldn't look at ${f.id}: ${(err as Error).message}`);
        }
      }
    } finally {
      this.looking = false;
    }
  }

  /** One look at a floor. With detection off nothing is raised (and nothing resolved: the items just don't show). */
  async look(floor: StuckFloor): Promise<BookEvent[]> {
    const settings = this.deps.settings();
    if (!settings.on) return [];
    const now = this.deps.now();
    const book = await this.book(floor.id);
    let runsFailed = false;
    const [files, runs] = await Promise.all([
      this.deps.readRepo(floor.dir).catch(() => undefined),
      this.deps.runs(floor.id).catch(() => {
        runsFailed = true;
        return [] as RunLike[];
      }),
    ]);
    const pulls = floor.pulls();

    // What progress is measured by: the newest merge, the build plan's row states, the current stage.
    const merged = pulls.filter((p) => p.state === 'MERGED' && p.mergedAt).sort((a, b) => Date.parse(b.mergedAt!) - Date.parse(a.mergedAt!))[0];
    const rows = files?.plan ? hash([...planRows(files.plan.text).values()].map((r) => `${r.n}:${r.state.split(/\s+-\s+/)[0]}`).join('|')) : undefined;
    const stage = files?.project ? hash(currentStage(files.project.text)) : undefined;
    const firsts = [merged ? { at: Date.parse(merged.mergedAt!), what: `PR #${merged.number} merged` } : undefined, files?.planChangedAt ? { at: Date.parse(files.planChangedAt), what: 'the build plan changed' } : undefined].filter((x): x is { at: number; what: string } => !!x && Number.isFinite(x.at));
    const first = firsts.sort((a, b) => b.at - a.at)[0];
    const a = book.track(now, floor.working(), { merged: merged ? `${merged.number}@${merged.mergedAt}` : undefined, rows, stage }, { merged: merged ? `PR #${merged.number} merged` : undefined }, 2 * LOOK_MS, first);
    const spent = a.lastProgressAt !== undefined ? this.deps.spendSince(floor, a.lastProgressAt) : undefined;

    // Decisions answered with an answer revision settle only when recorded as given and merged (server/followthrough/).
    const settled = await settledCheck(floor);
    const drafts = detectStuck({
      now,
      settings,
      ...(settled ? { settled } : {}),
      pulls,
      ...(files ? { files } : {}),
      failing: failingStreaks(runs),
      ...(a.lastProgressAt !== undefined ? { activity: { lastProgressAt: a.lastProgressAt, ...(a.lastProgress ? { lastProgress: a.lastProgress } : {}), activeMs: a.activeMs, ...(spent ? { spend: spent.spend, currency: spent.currency } : {}) } } : {}),
      firstSeen: (id) => book.firstSeen(id, now),
    });
    // What other features found waiting on the PM (sources.ts): the Questions page's blocking client questions.
    const sourced = await sourcedDrafts(floor, now);
    drafts.push(...sourced.drafts);
    // A read that failed keeps what it found before as it was (marked unreadAt), never resolves it (decision cards, D02).
    const repoFailed = !files;
    const unread = (r: { draft: StuckDraft }) => {
      const d = r.draft;
      if (d.kind === 'decision') return d.decision?.brd ? sourced.status === 'failed' : repoFailed;
      if (d.kind === 'blocked-row') return repoFailed;
      if (d.kind === 'failing') return runsFailed || (repoFailed && d.waitsOn !== undefined);
      return false;
    };
    const events = book.reconcile(drafts, now, unread);
    for (const e of events) this.audit(floor, e, now);
    await this.save(floor.id, book);
    return events;
  }

  private audit(floor: StuckFloor, e: BookEvent, now: number) {
    const d = e.record.draft;
    const title = stuckTitle(d, now);
    this.deps.record({
      floor: floor.id,
      actor: ACTOR,
      action: `stuck.${e.action}`,
      target: { kind: 'stuck', id: d.id, label: d.pr ? `PR #${d.pr.number}` : (d.decision?.id ?? d.failing?.[0]?.name ?? 'The team') },
      summary: e.action === 'raised' ? `Raised in Needs you: ${title}` : e.action === 'resolved' ? `Resolved by itself (the condition cleared): ${title}` : `Updated: ${title}`,
      details: { kind: d.kind, since: d.since, blocks: d.blocks, evidence: d.evidence.map((x) => x.label) },
      severity: e.action === 'raised' ? 'notice' : 'info',
    });
  }

  /**
   * What Needs you shows: the visible items (an open escalation about the same thing no longer hides one:
   * they group on one decision card), and the dismissed ones apart, still open ("hidden (N)").
   */
  async view(floor: StuckFloor, admin: boolean): Promise<StuckFloorView> {
    const settings = this.deps.settings();
    const now = this.deps.now();
    const book = await this.book(floor.id);
    const lead = this.deps.lead(floor);
    const open = settings.on ? book.open() : [];
    const shown = settings.on ? book.visible(now) : [];
    const asView = (r: StuckRecord): StuckView => ({ ...r.draft, raisedAt: r.raisedAt, ...(lead ? { lead: lead.name } : {}), ...(r.unreadAt ? { unreadAt: r.unreadAt } : {}), ...(r.dismissedAt ? { dismissedAt: r.dismissedAt } : {}) });
    const dismissed = settings.on ? book.dismissed().map(asView) : [];
    return { floor: floor.id, on: settings.on, items: shown.map(asView), hidden: open.length - shown.length, ...(dismissed.length ? { dismissed } : {}), ...(lead ? { lead } : {}), admin };
  }

  /** One line per visible item, for the standup page's "Blocked on you". */
  async blockedLines(floor: StuckFloor): Promise<string[]> {
    const now = this.deps.now();
    return (await this.view(floor, true)).items.map((d) => stuckTitle(d, now));
  }

  /** A button on an item: the error, or undefined when it's done. */
  async act(floor: StuckFloor, id: string, action: StuckAction, o: { by: string; owner?: string; text?: string; when?: 'now' | 'after' }): Promise<string | undefined> {
    const now = this.deps.now();
    const book = await this.book(floor.id);
    const r = book.data.items[id];
    if (!r || r.status !== 'open') return 'That item is no longer open';
    if (!stuckActions(r.draft).includes(action)) return `"${action}" isn't an action of this item`;
    const d = r.draft;
    const base = { floor: floor.id, actor: { kind: 'human' as const, name: o.by, ...(o.owner ? { id: o.owner } : {}) }, target: { kind: 'stuck', id, label: d.pr ? `PR #${d.pr.number}` : (d.decision?.id ?? d.failing?.[0]?.name ?? 'The team') } };
    if (action === 'snooze') {
      book.snooze(id, now + SNOOZE_MS);
      this.deps.record({ ...base, action: 'stuck.snoozed', summary: `Snoozed for a day: ${stuckTitle(d, now)}`, details: { until: now + SNOOZE_MS } });
    } else if (action === 'dismiss') {
      book.dismiss(id, now);
      this.deps.record({ ...base, action: 'stuck.dismissed', summary: `Dismissed (hidden, not resolved): ${stuckTitle(d, now)}` });
    } else {
      if (action === 'answer' && !o.text?.trim()) return 'Write the answer first';
      const msg = leadMessage(action, d, now, o.text ?? '');
      if (!msg) return 'Nothing to send';
      const lead = this.deps.lead(floor);
      if (!lead) return 'This project has no team lead to ask';
      const when = o.when ?? 'after';
      // A durable dispatch (roster/dispatch-send.ts): the answer revision of stuck:<id>, its intent on disk before typing.
      const err = await this.deps.tell(floor, msg, o.by, when, o.owner, `stuck:${id}`);
      if (err) return err;
      if (action === 'accept') book.accept(id, now + ACCEPT_QUIET_MS);
      const verb = action === 'answer' ? 'Answered' : action === 'accept' ? 'Accepted the workaround for now' : 'Asked the team lead';
      this.deps.record({ ...base, action: `stuck.${action}`, summary: `${verb} (${lead.name}, ${when === 'after' ? 'after their turn' : 'now'}): ${stuckTitle(d, now)}`, details: { when, lead: lead.name, ...(action === 'answer' ? { answer: (o.text ?? '').slice(0, 500) } : {}) } });
    }
    await this.save(floor.id, book);
    return undefined;
  }
}
