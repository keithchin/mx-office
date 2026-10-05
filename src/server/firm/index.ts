// The Firm (see docs/firm.md): the office's Reviewer Agents and their engagements. An engagement is
// called on a floor by the Project Manager, staffed (each reviewer gets its own isolated folder,
// isolation.ts, and a headless session, runner.ts), runs its fieldwork (interviews and review in
// parallel, desk.ts), is consolidated by the Engagement Partner and delivered as a report
// (report-build.ts). Its budget and time are held here: warned at 80%, wrapped up at 100%, stopped
// past a grace. One per office, made on first use (firmOf in adapter.ts), like the roster.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { budgetState, canMove, cleanConfig, defaultConfig, estimateCost, isActive, spentOf, type Engagement, type EngagementConfig, type Estimate, type FirmFloorStatus, type Phase, type ReviewerRun } from '../../shared/firm/engagement.js';
import { firmModelId, REVIEWER_BY_ID, REVIEWERS, type ReviewerId } from '../../shared/firm/roles.js';
import type { Report } from '../../shared/firm/report.js';
import { reviewerEnv, writeEvidence } from './isolation.js';
import { briefPrompt, consolidatePrompt, NUDGE_PROMPT, RESTART_PROMPT, reviewerClaudeMd, reviewerSkill, wrapUpPrompt } from './prompts.js';
import { buildReport, type Sections } from './report-build.js';
import type { RunHandle } from './runner.js';
import { FirmStore, type FirmSettings } from './store.js';
import type { FirmDeps } from './types.js';
import { FirmDesk } from './desk.js';

/** After a wrap-up, how long the reviewers get to send what they have before everything stops. */
export const WRAP_GRACE_MS = 6 * 60_000;
/** Past the budget by this much, it stops at once, wrapped up or not. */
export const HARD_OVER = 1.15;
/** Nudges for a reviewer whose turn ended with nothing sent and nothing asked, before it's stopped. */
export const MAX_NUDGES = 3;

interface Run {
  handle?: RunHandle;
  running: boolean;
  /** Stopped on purpose (a wrap-up, a cancel): its exit isn't a failure. */
  stopping: boolean;
  inbox: string[];
  token: string;
}

const isTerminal = (r: ReviewerRun) => r.status === 'done' || r.status === 'stopped' || r.status === 'failed';

export class Firm {
  readonly store: FirmStore;
  readonly desk: FirmDesk;
  private engagements = new Map<string, Engagement>();
  private runs = new Map<string, Run>();
  private sections = new Map<string, Sections>();
  private saveTimers = new Map<string, NodeJS.Timeout>();
  private timer?: NodeJS.Timeout;

  constructor(readonly deps: FirmDeps, tickMs = 15_000) {
    this.store = new FirmStore(deps.dataDir);
    this.desk = new FirmDesk(this);
    for (const e of this.store.engagements()) this.engagements.set(e.id, e);
    this.resumeAfterRestart();
    if (tickMs > 0) {
      this.timer = setInterval(() => this.tick(), tickMs);
      this.timer.unref?.();
    }
  }

  // ---- What the pages read --------------------------------------------------------------------

  list(): Engagement[] {
    return [...this.engagements.values()].sort((a, b) => b.requestedAt - a.requestedAt);
  }

  get(id: string): Engagement | undefined {
    return this.engagements.get(id);
  }

  report(id: string): Report | undefined {
    return this.store.report(id);
  }

  settings(): FirmSettings {
    return this.store.settings();
  }

  /** New models for the Firm's reviewers (an admin's change on /firm). */
  setModels(raw: unknown): string | undefined {
    if (!raw || typeof raw !== 'object') return 'Send {reviewer: model}';
    const s = this.store.settings();
    for (const [id, m] of Object.entries(raw as Record<string, unknown>)) if (REVIEWER_BY_ID.has(id as ReviewerId)) s.models[id as ReviewerId] = firmModelId(m);
    this.store.saveSettings(s);
    return undefined;
  }

  /** The wizard's starting point for a floor: the Firm's defaults with its reviewers' models. */
  defaults(floor: string): EngagementConfig {
    const s = this.store.settings();
    return { ...defaultConfig(floor, s.models), budget: s.budget, maxMinutes: s.maxMinutes };
  }

  estimate(c: EngagementConfig): Estimate {
    return estimateCost(c, this.deps.priceOf);
  }

  /** What a floor's 1D view shows: the audit running there, a report not read yet, a budget warning. */
  floorStatus(floor: string): FirmFloorStatus {
    const out: FirmFloorStatus = { floor };
    for (const e of this.list().filter((x) => x.floor === floor)) {
      if (isActive(e.phase) && !out.active) {
        out.active = { id: e.id, phase: e.phase, reviewers: e.reviewers.length, spent: spentOf(e), budget: e.config.budget, open: e.questions.filter((q) => q.status === 'open').length };
        if (e.warned80) out.budgetWarn = { engagement: e.id, spent: spentOf(e), budget: e.config.budget };
      }
      if (e.phase === 'delivered' && e.reportId && !e.readAt && !out.reportReady) out.reportReady = { engagement: e.id, report: e.reportId, at: e.endedAt ?? e.requestedAt };
    }
    return out;
  }

  markRead(reportId: string) {
    const e = this.list().find((x) => x.reportId === reportId);
    if (!e || e.readAt) return;
    e.readAt = this.deps.now();
    this.save(e, true);
  }

  sectionsOf(id: string): Sections {
    let s = this.sections.get(id);
    if (!s) {
      const file = path.join(this.store.engagementDir(id), 'sections.json');
      try {
        s = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Sections) : {};
      } catch {
        s = {};
      }
      this.sections.set(id, s);
    }
    return s;
  }

  saveSections(id: string) {
    writeFileSync(path.join(this.store.engagementDir(id), 'sections.json'), JSON.stringify(this.sectionsOf(id), null, 2), { mode: 0o600 });
  }

  // ---- The lifecycle ----------------------------------------------------------------------------

  /** The Project Manager confirmed the wizard: requested, then staffed in the background. */
  start(raw: unknown, by: string): Engagement | string {
    const floorId = raw && typeof raw === 'object' ? String((raw as Record<string, unknown>).floor ?? '') : '';
    const floor = this.deps.floor(floorId);
    if (!floor) return 'No such floor';
    if (this.list().some((e) => e.floor === floorId && isActive(e.phase))) return 'The Firm is already auditing this project: cancel that engagement first';
    const config = cleanConfig(raw, this.defaults(floorId));
    if (typeof config === 'string') return config;
    const now = this.deps.now();
    const id = `${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex')}`;
    const e: Engagement = {
      id,
      floor: floor.id,
      floorName: floor.name,
      repo: floor.repo,
      config,
      phase: 'requested',
      requestedBy: by,
      requestedAt: now,
      reviewers: config.reviewers.map((r) => ({ id: r, name: REVIEWER_BY_ID.get(r)!.name, model: config.models[r] ?? firmModelId(undefined), status: 'queued', cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, submitted: false, nudges: 0, asked: 0 })),
      questions: [],
      transcript: [],
      estimate: this.estimate(config).total,
    };
    this.engagements.set(id, e);
    this.note(e, 'The Firm', `${by} called an audit: ${e.reviewers.length} reviewers, ${config.depth}, budget $${config.budget.toFixed(2)} (estimate $${e.estimate.toFixed(2)}).`);
    this.deps.record?.({ floor: e.floor, kind: 'firm.requested', text: `${by} called an audit of ${e.floorName}`, data: { engagement: id, config } });
    this.save(e, true);
    void this.staff(e).catch((err: unknown) => this.fail(e, `Staffing failed: ${(err as Error).message}`));
    return e;
  }

  private async staff(e: Engagement) {
    const floor = this.deps.floor(e.floor);
    if (!floor) return this.fail(e, 'The floor closed');
    this.move(e, 'staffing');
    e.startedAt = this.deps.now();
    e.commit = await this.deps.pin(floor);
    const evidence = await floor.evidence().catch(() => ({}));
    for (const r of e.reviewers) {
      if (!isActive(e.phase)) return;
      r.status = 'staffing';
      this.changed(e);
      await this.deps.prepare({ engagementDir: this.store.engagementDir(e.id), reviewer: r.id, projectDir: floor.dir, commit: e.commit, claudeMd: reviewerClaudeMd(e, r.id), skill: reviewerSkill(r.id), evidence });
    }
    if (!isActive(e.phase)) return;
    this.move(e, 'fieldwork');
    this.note(e, 'The Firm', `Staffed at commit ${e.commit.slice(0, 10)}: every reviewer has its own read-only checkout.`);
    for (const r of e.reviewers) {
      r.startedAt = this.deps.now();
      this.send(e, r, briefPrompt(e, r.id));
    }
    this.deps.notify(e.floor, `📑 The Firm is auditing this project: ${e.reviewers.length} reviewers attached`, 'info');
  }

  /** The PM cancelled: everyone stops, nothing is delivered. */
  cancel(id: string, by: string): string | undefined {
    const e = this.engagements.get(id);
    if (!e) return 'No such engagement';
    if (!isActive(e.phase)) return 'It has already ended';
    e.note = `Cancelled by ${by}`;
    this.release(e);
    this.move(e, 'cancelled');
    this.note(e, 'The Firm', e.note);
    this.deps.notify(e.floor, `📑 ${by} cancelled the audit`, 'info');
    return undefined;
  }

  private fail(e: Engagement, why: string) {
    if (!isActive(e.phase)) return;
    e.note = why;
    this.release(e);
    this.move(e, 'failed');
    this.note(e, 'The Firm', why);
    this.deps.notify(e.floor, `📑 The audit failed: ${why}`, 'warn');
  }

  move(e: Engagement, to: Phase) {
    if (e.phase === to) return;
    if (!canMove(e.phase, to)) throw new Error(`An engagement can't go from ${e.phase} to ${to}`);
    e.phase = to;
    if (!isActive(to)) e.endedAt = this.deps.now();
    this.save(e, true);
  }

  note(e: Engagement, who: string, text: string) {
    e.transcript.push({ at: this.deps.now(), who, text: text.slice(0, 4000) });
    if (e.transcript.length > 2000) e.transcript.splice(0, e.transcript.length - 2000);
  }

  // ---- Runs -----------------------------------------------------------------------------------

  private key = (e: Engagement, r: ReviewerRun) => `${e.id}:${r.id}`;

  runOf(e: Engagement, r: ReviewerRun): Run {
    const k = this.key(e, r);
    let run = this.runs.get(k);
    if (!run) this.runs.set(k, (run = { running: false, stopping: false, inbox: [], token: '' }));
    return run;
  }

  /** The engagement and reviewer a reviewer's office-workers firm call is from, when its token is right. */
  authenticate(key: string, token: string): { e: Engagement; r: ReviewerRun } | undefined {
    const run = this.runs.get(key);
    if (!run?.token || !token || run.token.length !== token.length || run.token !== token) return undefined;
    const [id, rid] = key.split(':');
    const e = this.engagements.get(id);
    const r = e?.reviewers.find((x) => x.id === rid);
    return e && r ? { e, r } : undefined;
  }

  /** Gives a reviewer its next prompt: now when it's between turns, after this turn when it's mid-turn. */
  send(e: Engagement, r: ReviewerRun, text: string) {
    // A seeded sample never runs anyone (it would cost money for nothing).
    if (!isActive(e.phase) || isTerminal(r) || e.sample) return;
    const run = this.runOf(e, r);
    run.inbox.push(text);
    if (!run.running) this.kick(e, r);
  }

  private kick(e: Engagement, r: ReviewerRun) {
    const run = this.runOf(e, r);
    if (run.running || !run.inbox.length) return;
    const prompt = run.inbox.splice(0).join('\n\n---\n\n');
    const cwd = path.join(this.store.engagementDir(e.id), r.id);
    run.token = randomBytes(18).toString('hex');
    const env = reviewerEnv(this.deps.baseEnv(), cwd, { url: this.deps.hookUrl(), key: this.key(e, r), token: run.token, bin: this.deps.binDir });
    run.running = true;
    run.stopping = false;
    if (r.status === 'queued' || r.status === 'staffing' || r.status === 'waiting' || r.status === 'interviewing') r.status = r.submitted ? 'writing' : 'reviewing';
    run.handle = this.deps.runner.start(
      { cwd, env, model: r.model, prompt, sessionId: r.sessionId },
      {
        session: (sid) => (r.sessionId = sid),
        usage: (usd, t) => {
          r.cost = Math.max(0, r.cost + usd);
          r.tokens.input += t.input;
          r.tokens.output += t.output;
          r.tokens.cacheRead += t.cacheRead;
          r.tokens.cacheWrite += t.cacheWrite;
          this.deps.spend?.(usd);
          this.checkBudget(e);
          this.save(e);
        },
        activity: (text) => {
          r.activity = text;
          this.save(e);
        },
        exit: (code, error) => this.afterTurn(e, r, code, error),
      },
    );
    this.changed(e);
  }

  private afterTurn(e: Engagement, r: ReviewerRun, code: number | null, error?: string) {
    const run = this.runOf(e, r);
    const stopped = run.stopping;
    run.running = false;
    run.handle = undefined;
    run.stopping = false;
    if (!isActive(e.phase) || isTerminal(r)) return this.save(e, true);
    if (code && !stopped && !r.sessionId) {
      r.status = 'failed';
      r.endedAt = this.deps.now();
      this.note(e, r.name, `Couldn't start: ${error ?? `exit ${code}`}`);
    } else if (run.inbox.length) {
      return this.kick(e, r);
    } else if (e.questions.some((q) => q.reviewer === r.id && q.status === 'open')) {
      r.status = 'interviewing';
    } else if (r.id === 'partner' && e.phase === 'fieldwork' && !e.wrapUpAt) {
      r.status = 'waiting';
    } else if (e.wrapUpAt || r.nudges >= MAX_NUDGES) {
      r.status = 'stopped';
      r.endedAt = this.deps.now();
      this.note(e, r.name, e.wrapUpAt ? 'Stopped at the wrap-up without calling done.' : 'Stopped: its turns kept ending with nothing sent.');
    } else {
      r.nudges++;
      this.send(e, r, NUDGE_PROMPT);
      return;
    }
    this.advance(e);
    this.save(e, true);
  }

  /** Moves the engagement on once its reviewers are where the next phase needs them. */
  advance(e: Engagement) {
    if (!isActive(e.phase)) return;
    const partner = e.reviewers.find((r) => r.id === 'partner')!;
    const specialists = e.reviewers.filter((r) => r.id !== 'partner');
    if (e.phase === 'fieldwork' && specialists.every(isTerminal)) {
      this.consolidate(e);
      if (isTerminal(partner)) this.deliver(e);
      else this.send(e, partner, consolidatePrompt(specialists.map((s) => ({ id: s.id, ok: this.sectionsOf(e.id)[`reviewer:${s.id}`] !== undefined }))));
      return;
    }
    if (e.phase === 'consolidating' && isTerminal(partner)) this.deliver(e);
    else if (e.wrapUpAt && e.reviewers.every(isTerminal)) this.deliver(e);
  }

  /** The specialists' sections into the Partner's evidence, and the phase on to consolidating. */
  private consolidate(e: Engagement) {
    const s = this.sectionsOf(e.id);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) if (k.startsWith('reviewer:')) out[`sections/${k.slice('reviewer:'.length)}`] = v;
    try {
      writeEvidence(path.join(this.store.engagementDir(e.id), 'partner'), out);
    } catch {
      // the Partner can still fetch them with office-workers firm evidence sections
    }
    if (e.phase === 'fieldwork') this.move(e, 'consolidating');
  }

  /** The report goes to the Project Manager, and everyone is released. */
  deliver(e: Engagement) {
    if (!isActive(e.phase)) return;
    const floor = this.deps.floor(e.floor);
    if (e.phase === 'fieldwork') this.move(e, 'consolidating');
    const report = buildReport(e, this.sectionsOf(e.id), { stats: floor?.stats() ?? {}, grades: floor?.grades() ?? [] }, this.deps.now());
    this.store.saveReport(report);
    e.reportId = report.id;
    this.release(e);
    this.move(e, 'delivered');
    this.note(e, 'The Firm', `📑 Report delivered${report.partial ? ' (partial)' : ''}: ${report.executive.headline}`);
    this.deps.notify(e.floor, `📑 Audit report ready${report.partial ? ' (partial)' : ''}: ${report.executive.headline}`, 'info');
    this.deps.record?.({ floor: e.floor, kind: 'firm.delivered', text: `The Firm delivered its audit report on ${e.floorName}`, data: { engagement: e.id, report: report.id, partial: !!report.partial, cost: spentOf(e) } });
  }

  /** Stops every reviewer's session; the ones still at it are marked stopped. */
  private release(e: Engagement) {
    for (const r of e.reviewers) {
      const run = this.runs.get(this.key(e, r));
      if (run) {
        run.inbox = [];
        run.token = '';
        if (run.running) {
          run.stopping = true;
          run.handle?.stop();
        }
      }
      if (!isTerminal(r)) {
        r.status = r.submitted ? 'done' : 'stopped';
        r.endedAt = this.deps.now();
      }
    }
  }

  // ---- Budget and time ------------------------------------------------------------------------

  checkBudget(e: Engagement) {
    if (!isActive(e.phase)) return;
    const spent = spentOf(e);
    const state = budgetState(spent, e.config.budget);
    if (state !== 'ok' && !e.warned80) {
      e.warned80 = true;
      this.note(e, 'The Firm', `Budget at 80%: $${spent.toFixed(2)} of $${e.config.budget.toFixed(2)}.`);
      this.deps.notify(e.floor, `📑 Audit budget at 80% ($${spent.toFixed(2)} of $${e.config.budget.toFixed(2)})`, 'warn');
    }
    if (state === 'cap' && !e.wrapUpAt) this.wrapUp(e, 'budget');
    if (spent >= e.config.budget * HARD_OVER) {
      e.note = `Stopped past the budget ($${spent.toFixed(2)} of $${e.config.budget.toFixed(2)})`;
      this.deliver(e);
    }
  }

  /** Asks every reviewer still at it to send what it has now: its current turn is cut short. */
  wrapUp(e: Engagement, why: 'budget' | 'time') {
    e.wrapUpAt = this.deps.now();
    e.note = why === 'budget' ? 'Wrapped up at the budget cap' : 'Wrapped up at the time limit';
    this.note(e, 'The Firm', `⏱️ ${e.note}: every reviewer is asked to send what it has.`);
    if (e.phase === 'fieldwork') this.consolidate(e);
    for (const r of e.reviewers) {
      if (isTerminal(r)) continue;
      const run = this.runOf(e, r);
      run.inbox = [wrapUpPrompt(why, r.id === 'partner')];
      if (run.running) {
        run.stopping = true;
        run.handle?.stop();
      } else this.kick(e, r);
    }
    this.save(e, true);
  }

  tick() {
    const now = this.deps.now();
    for (const e of this.engagements.values()) {
      if (!isActive(e.phase) || e.sample) continue;
      this.desk.tick(e, now);
      if (e.wrapUpAt && now - e.wrapUpAt > WRAP_GRACE_MS) {
        e.note = `${e.note ?? 'Wrapped up'}; stopped after the grace period`;
        this.deliver(e);
      } else if (!e.wrapUpAt && e.startedAt && e.phase !== 'staffing' && now - e.startedAt > e.config.maxMinutes * 60_000) this.wrapUp(e, 'time');
    }
  }

  /** The office restarted: the runs it had are gone, so the reviewers mid-work carry on in fresh turns. */
  private resumeAfterRestart() {
    for (const e of this.engagements.values()) {
      if (!isActive(e.phase) || e.sample) continue;
      if (e.phase === 'requested' || e.phase === 'staffing') {
        this.fail(e, 'The office restarted while staffing: call the audit again');
        continue;
      }
      for (const r of e.reviewers) {
        if (isTerminal(r) || r.status === 'interviewing' || r.status === 'waiting') continue;
        this.send(e, r, r.sessionId ? RESTART_PROMPT : briefPrompt(e, r.id));
      }
    }
  }

  /** The office is shutting down: sessions stop, the engagements stay as they are for the next start. */
  stop() {
    clearInterval(this.timer);
    for (const run of this.runs.values()) {
      run.stopping = true;
      run.handle?.stop();
    }
    for (const e of this.engagements.values()) this.save(e, true);
  }

  // ---- Saving and telling the pages -----------------------------------------------------------

  save(e: Engagement, now = false) {
    clearTimeout(this.saveTimers.get(e.id));
    if (now) {
      this.saveTimers.delete(e.id);
      this.store.saveEngagement(e);
      return this.changed(e);
    }
    const t = setTimeout(() => {
      this.saveTimers.delete(e.id);
      this.store.saveEngagement(e);
      this.changed(e);
    }, 1000);
    t.unref?.();
    this.saveTimers.set(e.id, t);
  }

  changed(e: Engagement) {
    this.deps.changed(e.floor);
  }
}

/** The reviewer table with each reviewer's model, for the /firm page. */
export const firmPeople = (s: FirmSettings) => REVIEWERS.map((r) => ({ ...r, model: s.models[r.id] }));

export type { Run };
