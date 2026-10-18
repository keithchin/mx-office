// Walkthrough videos of each project's workflows, made by the office by itself: when a commit on main has
// journeys that passed against it (a build on main passed, a milestone became ready in the live app), each
// of those journeys is recorded once per commit, behind a per-project switch (on by default); admins can
// also Record one journey, or Re-record all, of main's newest commit. A batch is the journeys of one commit,
// played one after another against the office's own throwaway copy of the app at that commit (app-instance/:
// its own folder, ports and fresh database, never the person's live app), which is stopped when the batch
// is done. One batch at a time per office, queued, cancellable; the app, the browser, ffmpeg and the voice
// are child processes, so the office only coordinates. Each journey signs in as the identity the toolkit's
// journey runner uses for it (./identity.ts). Working copies live in <data>/walkthroughs/ (./store.ts);
// their home is the project's private repo (Save to repo, a pull request: ./save.ts). Nothing calls a model.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from '../../shared/evidence/ids.js';
import { parseJourney } from '../../shared/liveapp/plan.js';
import type { LiveReadiness, ReadinessNews } from '../../shared/liveapp/readiness.js';
import { autoJourneys } from '../../shared/walkthroughs/auto.js';
import { resolveIdentity, type RunnerConfig } from '../../shared/walkthroughs/identity.js';
import { scriptOf } from '../../shared/walkthroughs/script.js';
import { RECORDING_CAP_MS, type RecordingTrigger, type WalkAvailability, type WalkBatch, type WalkManifest, type WalkScript, type WalkSettings, type WalkView } from '../../shared/walkthroughs/types.js';
import { listFiles, mainOf, readFiles } from '../testing/repo.js';
import { runnerConfigAt } from './identity.js';
import { findFfmpeg, type Tool } from './media.js';
import { AppSessions, type Browser } from './recorder.js';
import { runRecording } from './run.js';
import { saveToRepo, type Gh } from './save.js';
import { WalkStore } from './store.js';
import { makeGuidedTour, tourParts } from './tour.js';
import { findKokoro, kokoroVoice, type Voice } from './tts.js';

/** The office's own copy of the app a batch records against (app-instance/). */
export interface RecordingApp {
  url: string;
  commit: string;
  /** Its Mendix runtime log, when there is one (a refused session shows there). */
  runtimeLog?: string;
  alive(): boolean;
  stop(): Promise<void>;
}

/** What the service needs to know about a project. */
export interface WalkDeps {
  dataDir: string;
  /** The project's folder (its git repository), or undefined for no such project. */
  floorDir(floor: string): string | undefined;
  /** Main's newest commit in the project's folder (default: testing/repo.ts mainOf). */
  mainCommit?(floor: string): Promise<string | undefined>;
  /** Starts the office's own copy of the app at `commit`, on a fresh database; resolves once it answers. */
  boot(floor: string, commit: string, signal: AbortSignal, progress: (line: string) => void): Promise<RecordingApp>;
  /** Why recordings can't start the app on this machine (no mxcli), or undefined. */
  bootBlocked?(): string | undefined;
  /** Why nothing is recorded by itself for this project (a test office), or undefined. */
  autoBlocked?(floor: string): string | undefined;
  /** Of `ids`, the journeys whose newest result against exactly `sha` passed (the test-run store). */
  passedAt?(floor: string, sha: string, ids: readonly string[]): Promise<string[]>;
  /** The project's journey-runner config at a commit (default: ./identity.ts). */
  runnerConfig?(dir: string, commit: string): Promise<RunnerConfig | undefined>;
  /** The app's name, for the guided tour's cards. */
  title?(floor: string): string;
  gh: Gh;
  /** Something changed (a batch moved, a recording finished): for toasts and the page. */
  changed?(floor: string, m?: WalkManifest): void;
  tool?: Tool;
  /** The voice, or a promise of it (looked for once). null: no voice. */
  voice?: Voice | null;
  launch?(): Promise<Browser>;
  quota?: number;
  cardMs?: number;
  stepMs?: number;
}

interface Batch extends WalkBatch {
  ctl: AbortController;
  run(b: Batch): Promise<void>;
}

const strip = ({ ctl: _c, run: _r, ...b }: Batch): WalkBatch => ({ ...b, journeys: b.journeys.map((j) => ({ ...j })) });

export class Walkthroughs {
  readonly store: WalkStore;
  readonly tool: Tool;
  private voice: Voice | null | undefined;
  private voiceLook?: Promise<void>;
  private batches: Batch[] = [];
  private running?: Batch;
  private scripts = new Map<string, Promise<WalkScript[]>>();

  constructor(private d: WalkDeps) {
    this.store = new WalkStore(path.join(d.dataDir, 'walkthroughs'), d.quota);
    this.tool = d.tool ?? findFfmpeg();
    this.voice = d.voice;
    if (this.voice === undefined) {
      this.voiceLook = findKokoro().then(
        (py) => void (this.voice = py ? kokoroVoice(py) : null),
        () => void (this.voice = null),
      );
    }
  }

  availability(): WalkAvailability {
    const notes: string[] = [];
    const blocked = this.d.bootBlocked?.();
    if (blocked) notes.push(`Recordings can’t start the app here: ${blocked}.`);
    if (!this.tool.ffmpeg) notes.push('ffmpeg isn’t installed here: videos are WebM, without voice.');
    if (this.voice === undefined) notes.push('Looking for a local voice (Kokoro)…');
    else if (!this.voice) notes.push('No local voice (Kokoro) here: captions only. Set AGENT_OFFICE_KOKORO_PYTHON to a Python with kokoro installed.');
    else if (!this.tool.ffmpeg) notes.push('The voice needs ffmpeg to be put into the video.');
    return { recorder: !blocked, ffmpeg: !!this.tool.ffmpeg, narration: this.voice && this.tool.ffmpeg ? this.voice.engine : 'none', notes };
  }

  /** Resolves once the voice has been looked for (tests, the first view). */
  async ready() {
    await this.voiceLook;
  }

  private mainOf(floor: string): Promise<string | undefined> {
    if (this.d.mainCommit) return this.d.mainCommit(floor);
    const dir = this.d.floorDir(floor);
    return dir ? mainOf(dir).then((m) => m?.sha, () => undefined) : Promise.resolve(undefined);
  }

  private runnerConfig(floor: string, commit: string): Promise<RunnerConfig | undefined> {
    const dir = this.d.floorDir(floor);
    if (!dir) return Promise.resolve(undefined);
    return (this.d.runnerConfig ?? runnerConfigAt)(dir, commit).catch(() => undefined);
  }

  /** The journeys of a commit of the project, as walkthrough scripts (broken controls left out). */
  scriptsAt(floor: string, commit: string): Promise<WalkScript[]> {
    const dir = this.d.floorDir(floor);
    if (!dir) return Promise.resolve([]);
    const key = `${dir}|${commit}`;
    let p = this.scripts.get(key);
    if (!p) {
      p = (async () => {
        const files = (await listFiles(dir, commit, ['tests'])).filter((f) => /\.journey\.json$/i.test(f)).slice(0, 200);
        const texts = await readFiles(dir, commit, files, 512 * 1024);
        return files.flatMap((f) => {
          const t = texts.get(f) ?? '';
          if (!parseJourney(f, t)) return [];
          const s = scriptOf(f, t);
          return typeof s === 'string' ? [] : [s];
        });
      })();
      this.scripts.set(key, p);
      if (this.scripts.size > 30) this.scripts.delete(this.scripts.keys().next().value!);
      p.catch(() => this.scripts.delete(key));
    }
    return p;
  }

  async view(floor: string, admin: boolean): Promise<WalkView> {
    const s = await this.store.settings(floor);
    const commit = await this.mainOf(floor);
    const scripts = commit ? await this.scriptsAt(floor, commit).catch(() => []) : [];
    const journeys = scripts.map((j) => ({ id: j.journey, title: j.title, file: j.file, requirement: j.requirement }));
    const cfg = commit ? await this.runnerConfig(floor, commit) : undefined;
    const who = resolveIdentity({ names: [] }, cfg, { user: s.demoUser, password: s.demoPassword });
    const list = await this.store.list(floor);
    // One left "recording" by an office that stopped mid-way never finishes: it says so.
    const busy = new Set(this.batches.flatMap((b) => b.journeys.map((j) => j.rec).filter(Boolean)));
    for (const m of list) {
      if (m.status !== 'recording' || busy.has(m.id)) continue;
      Object.assign(m, { status: 'error', failure: { why: 'the office stopped during the recording' } });
      await this.store.write(m).catch(() => undefined);
    }
    const recordings = list.slice(0, 60).map(({ schema: _s, floor: _f, finishedAt: _x, ...r }) => r);
    const mine = this.batches.filter((b) => b.floor === floor);
    const first = this.batches.findIndex((b) => b.floor === floor);
    return {
      floor,
      settings: { autoRecord: s.autoRecord, narrate: s.narrate, demoUser: s.demoUser },
      available: ((a) => {
        const why = this.d.autoBlocked?.(floor);
        return why ? { ...a, notes: [...a.notes, `Nothing is recorded automatically here: ${why}.`] } : a;
      })(this.availability()),
      ...(commit ? { main: { commit } } : {}),
      journeys,
      identity: { user: who.user, from: who.from },
      batches: mine.map(strip),
      ahead: first < 0 ? this.batches.length : first,
      recordings,
      disk: { bytes: await this.store.used(), quota: this.store.quota },
      admin,
    };
  }

  /**
   * Queues a batch: `journeys` (default: every journey) of `commit` (default: main's newest), each recorded
   * against the office's own copy of the app. Returns the batch id, or throws why not.
   */
  async record(floor: string, o: { by: string; journeys?: string[]; commit?: string; trigger?: RecordingTrigger; milestone?: { id: string; title: string }; narrate?: boolean }): Promise<string> {
    const blocked = this.d.bootBlocked?.();
    if (blocked) throw new Error(`recordings can’t start the app here: ${blocked}`);
    const commit = o.commit ?? (await this.mainOf(floor));
    if (!commit) throw new Error('the project has no main branch to record yet');
    const scripts = await this.scriptsAt(floor, commit);
    if (o.journeys) for (const j of o.journeys) if (!scripts.some((s) => s.journey === j)) throw new Error(`no journey ${j} at @${commit.slice(0, 7)}`);
    const queued = new Set(this.batches.filter((b) => b.floor === floor && b.kind === 'workflows' && b.commit === commit).flatMap((b) => b.journeys.map((j) => j.id)));
    const want = scripts.filter((s) => (!o.journeys || o.journeys.includes(s.journey)) && !queued.has(s.journey));
    if (!want.length) throw new Error(scripts.length ? `already queued for @${commit.slice(0, 7)}` : `no test journeys (tests/e2e/*.journey.json) at @${commit.slice(0, 7)}`);
    const settings = await this.store.settings(floor);
    const narrate = (o.narrate ?? settings.narrate) && !!this.tool.ffmpeg;
    const b: Batch = {
      id: `wb_${ulid()}`,
      floor,
      kind: 'workflows',
      commit,
      trigger: o.trigger ?? 'manual',
      ...(o.milestone ? { milestone: o.milestone } : {}),
      by: o.by,
      journeys: want.map((s) => ({ id: s.journey, title: s.title })),
      phase: 'queued',
      n: 0,
      at: Date.now(),
      ctl: new AbortController(),
      run: (x) => this.runWorkflows(x, want, settings, narrate),
    };
    this.enqueue(b);
    return b.id;
  }

  /** Queues a guided tour of the newest commit that has passing workflow videos (main's first). */
  async tour(floor: string, by: string): Promise<string> {
    if (!this.tool.ffmpeg) throw new Error('a guided tour needs ffmpeg on the office’s machine');
    const list = await this.store.list(floor);
    const main = await this.mainOf(floor);
    const passing = list.filter((m) => m.kind === 'workflow' && m.status === 'passed');
    const commit = passing.some((m) => m.app.commit === main) ? main! : passing[0]?.app.commit;
    if (!commit) throw new Error('no passing workflow video yet: record one first');
    const order = (await this.scriptsAt(floor, commit).catch(() => [])).map((s) => s.journey);
    if (!tourParts(list, commit, order).length) throw new Error(`no passing workflow video of @${commit.slice(0, 7)} yet`);
    const id = `wt_${ulid()}`;
    const b: Batch = {
      id: `wb_${ulid()}`,
      floor,
      kind: 'tour',
      commit,
      trigger: 'manual',
      by,
      journeys: [{ id: 'guided-tour', title: 'Guided tour', rec: id }],
      phase: 'queued',
      n: 0,
      at: Date.now(),
      ctl: new AbortController(),
      run: async (x) => {
        x.phase = 'finishing';
        x.n = 1;
        const parts = tourParts(await this.store.list(floor), commit, order);
        const dir = this.store.recDir(floor, id);
        await mkdir(dir, { recursive: true });
        const title = this.d.title?.(floor) ?? 'the app';
        const m = await makeGuidedTour({ floor, id, dir, title, commit, parts, partDir: (p) => this.store.recDir(floor, p.id), by, tool: this.tool, signal: x.ctl.signal, progress: (l) => this.say(x, l), ...(this.d.launch ? { launch: this.d.launch } : {}) });
        await this.store.write(m);
        this.d.changed?.(floor, m);
      },
    };
    this.enqueue(b);
    return b.id;
  }

  private enqueue(b: Batch) {
    this.batches.push(b);
    this.d.changed?.(b.floor);
    void this.pump();
  }

  private say(b: Batch, line: string) {
    b.line = line;
    this.d.changed?.(b.floor);
  }

  /** One batch: the app at its commit, each journey recorded against it in turn, the app stopped. */
  private async runWorkflows(b: Batch, scripts: WalkScript[], s: WalkSettings, narrate: boolean): Promise<void> {
    let app: RecordingApp | undefined;
    let sessions: AppSessions | undefined;
    try {
      b.phase = 'booting';
      this.say(b, `Starting the recording app at @${b.commit.slice(0, 7)} on a fresh database…`);
      try {
        app = await this.d.boot(b.floor, b.commit, b.ctl.signal, (l) => this.say(b, l));
      } catch (err) {
        const why = b.ctl.signal.aborted ? 'cancelled before the recording app was up' : `the recording app didn’t start: ${(err as Error).message.slice(0, 260)}`;
        for (const sc of scripts) await this.writeUnrun(b, sc, b.ctl.signal.aborted ? 'cancelled' : 'error', why);
        return;
      }
      b.phase = 'recording';
      // One session per account for the whole batch (an unlicensed app keeps only 6 open), signed out at the end.
      sessions = new AppSessions({ url: app.url, ...(app.runtimeLog ? { runtimeLog: app.runtimeLog } : {}), ...(this.d.launch ? { launch: this.d.launch } : {}) });
      const cfg = await this.runnerConfig(b.floor, b.commit);
      if (narrate && this.voice === undefined) await this.voiceLook;
      for (const [k, sc] of scripts.entries()) {
        if (b.ctl.signal.aborted) break;
        b.n = k + 1;
        this.say(b, `Recording ${k + 1} of ${scripts.length}: ${sc.title}`);
        const m = await this.recordOne(b, sc, app, sessions, s, cfg, narrate);
        this.d.changed?.(b.floor, m);
      }
    } finally {
      b.phase = 'finishing';
      if (sessions) this.say(b, 'Signing out…');
      await sessions?.close().catch(() => undefined);
      this.say(b, 'Stopping the recording app…');
      await app?.stop().catch(() => undefined);
    }
  }

  private manifestOf(b: Batch, sc: WalkScript, origin: string, user: string | undefined, from?: WalkManifest['app']['userFrom']): WalkManifest {
    const id = `wt_${ulid()}`;
    const j = b.journeys.find((x) => x.id === sc.journey);
    if (j) j.rec = id;
    return {
      schema: 1,
      id,
      floor: b.floor,
      kind: 'workflow',
      journey: { id: sc.journey, title: sc.title, file: sc.file, requirement: sc.requirement, ...(sc.notes?.length ? { notes: sc.notes } : {}) },
      batch: b.id,
      ...(b.milestone ? { milestone: b.milestone } : {}),
      trigger: b.trigger,
      by: b.by,
      app: { commit: b.commit, origin, ...(user ? { user } : {}), ...(from ? { userFrom: from } : {}), instance: true },
      startedAt: Date.now(),
      status: 'recording',
      steps: sc.steps.map((x) => ({ n: x.n, caption: x.caption, status: 'not-run' as const })),
      outputs: { narration: 'none', notes: [] },
    };
  }

  /** A journey the batch never got to play (the app didn't start, or it was cancelled first): said on its card. */
  private async writeUnrun(b: Batch, sc: WalkScript, status: 'error' | 'cancelled', why: string) {
    const m = this.manifestOf(b, sc, '', undefined);
    Object.assign(m, { status, failure: { why }, finishedAt: Date.now() });
    await this.store.write(m).catch(() => undefined);
    this.d.changed?.(b.floor, m);
  }

  private async recordOne(b: Batch, sc: WalkScript, app: RecordingApp, sessions: AppSessions, s: WalkSettings, cfg: RunnerConfig | undefined, narrate: boolean): Promise<WalkManifest> {
    const who = resolveIdentity(sc.identity ?? { names: [] }, cfg, { user: s.demoUser, password: s.demoPassword });
    const m = this.manifestOf(b, sc, new URL(app.url).origin, who.user, who.from);
    if (who.note) m.outputs.notes.push(`Sign-in: ${who.note}.`);
    const dir = this.store.recDir(b.floor, m.id);
    // Each recording has its own time limit inside the batch; Cancel stops the batch.
    const one = new AbortController();
    const cap = setTimeout(() => one.abort(`stopped after ${RECORDING_CAP_MS / 60_000 + 2} minutes`), RECORDING_CAP_MS + 2 * 60_000);
    const follow = () => one.abort(typeof b.ctl.signal.reason === 'string' ? b.ctl.signal.reason : 'cancelled');
    b.ctl.signal.addEventListener('abort', follow, { once: true });
    try {
      await mkdir(dir, { recursive: true });
      await this.store.write(m);
      return await runRecording(
        { tool: this.tool, ...(this.voice ? { voice: this.voice } : {}), commitNow: () => (app.alive() ? b.commit : undefined), ...(this.d.launch ? { launch: this.d.launch } : {}), ...(this.d.cardMs !== undefined ? { cardMs: this.d.cardMs } : {}), ...(this.d.stepMs !== undefined ? { stepMs: this.d.stepMs } : {}) },
        { m, dir, url: app.url, script: sc, login: { user: who.user, password: who.password }, sessions, narrate, signal: one.signal, progress: (l) => this.say(b, `Recording ${b.n} of ${b.journeys.length}: ${l}`), save: (x) => this.store.write(x) },
      );
    } catch (err) {
      Object.assign(m, { status: one.signal.aborted ? 'cancelled' : 'error', failure: { why: (err as Error).message.slice(0, 300) }, finishedAt: Date.now() });
      await this.store.write(m).catch(() => undefined);
      return m;
    } finally {
      clearTimeout(cap);
      b.ctl.signal.removeEventListener('abort', follow);
    }
  }

  /** Runs the queue, one batch at a time. */
  private async pump() {
    if (this.running) return;
    const b = this.batches.find((x) => x.phase === 'queued');
    if (!b) return;
    this.running = b;
    this.d.changed?.(b.floor);
    try {
      await b.run(b);
    } catch (err) {
      if (!b.ctl.signal.aborted) console.error('agent-office: walkthrough batch failed', err);
    } finally {
      this.batches = this.batches.filter((x) => x !== b);
      this.running = undefined;
      await this.store.cleanup().catch(() => []);
      this.d.changed?.(b.floor);
      void this.pump();
    }
  }

  /** Cancels a queued or running batch. */
  cancel(floor: string, id: string): boolean {
    const b = this.batches.find((x) => x.id === id && x.floor === floor);
    if (!b) return false;
    if (b.phase === 'queued') {
      this.batches = this.batches.filter((x) => x !== b);
      this.d.changed?.(floor);
    } else b.ctl.abort('cancelled');
    return true;
  }

  /** Resolves when nothing is queued or running (tests). */
  async idle(): Promise<void> {
    while (this.running || this.batches.length) await new Promise((r) => setTimeout(r, 50));
  }

  /** Journey ids recorded automatically at `commit` already, or queued for it. */
  private async autoDone(floor: string, commit: string): Promise<Set<string>> {
    return new Set([...(await this.store.list(floor)).filter((m) => m.kind === 'workflow' && m.trigger === 'auto' && m.app.commit === commit).map((m) => m.journey.id), ...this.batches.filter((b) => b.floor === floor && b.kind === 'workflows' && b.commit === commit).flatMap((b) => b.journeys.map((j) => j.id))]);
  }

  /** Whether an automatic batch may start: the switch, the machine, the disk. */
  private async mayAuto(floor: string): Promise<boolean> {
    if (!(await this.store.settings(floor)).autoRecord || this.d.bootBlocked?.() || this.d.autoBlocked?.(floor)) return false;
    await this.store.cleanup().catch(() => []);
    if ((await this.store.used()) > this.store.quota) {
      console.error('agent-office: walkthroughs are over their disk quota: no auto-recording');
      return false;
    }
    return true;
  }

  /** The live app said a milestone is ready: record its journeys that passed against that build. */
  async onReady(floor: string, news: ReadinessNews, readiness: LiveReadiness): Promise<string[]> {
    if (news.kind !== 'ready') return [];
    const s = await this.store.settings(floor);
    const ids = autoJourneys({ readiness, milestone: news.milestone, sha: news.sha, autoRecord: s.autoRecord, done: await this.autoDone(floor, news.sha) });
    if (!ids.length || !(await this.mayAuto(floor))) return [];
    const id = await this.record(floor, { by: 'Mx Office (milestone ready)', journeys: ids, commit: news.sha, trigger: 'auto', milestone: { id: news.milestone, title: news.title } }).catch(() => '');
    return id ? [id] : [];
  }

  /** New test evidence landed: record the journeys that passed against main's newest commit, once per commit. */
  async onTestRuns(floor: string): Promise<string[]> {
    if (!this.d.passedAt || !(await this.store.settings(floor)).autoRecord || this.d.bootBlocked?.() || this.d.autoBlocked?.(floor)) return [];
    const commit = await this.mainOf(floor);
    if (!commit) return [];
    const scripts = await this.scriptsAt(floor, commit).catch(() => []);
    if (!scripts.length) return [];
    const done = await this.autoDone(floor, commit);
    const passed = (await this.d.passedAt(floor, commit, scripts.map((s) => s.journey)).catch(() => [])).filter((j) => !done.has(j));
    if (!passed.length || !(await this.mayAuto(floor))) return [];
    const id = await this.record(floor, { by: 'Mx Office (build on main passed)', journeys: passed, commit, trigger: 'auto' }).catch(() => '');
    return id ? [id] : [];
  }

  async setSettings(floor: string, patch: Partial<WalkSettings>): Promise<WalkSettings> {
    const s = { ...(await this.store.settings(floor)) };
    if (typeof patch.autoRecord === 'boolean') s.autoRecord = patch.autoRecord;
    if (typeof patch.narrate === 'boolean') s.narrate = patch.narrate;
    if (typeof patch.demoUser === 'string' && patch.demoUser.trim()) s.demoUser = patch.demoUser.trim().slice(0, 80);
    if (typeof patch.demoPassword === 'string' && patch.demoPassword) s.demoPassword = patch.demoPassword.slice(0, 200);
    await this.store.setSettings(floor, s);
    return s;
  }

  /** Opens the pull request that puts a recording in the project's repo. */
  async save(floor: string, id: string, by: string): Promise<WalkManifest> {
    const m = await this.store.read(floor, id);
    const repo = this.d.floorDir(floor);
    if (!m || !repo) throw new Error('no such recording');
    if (m.saved) throw new Error(`already saved: ${m.saved.url ?? m.saved.branch}`);
    m.saved = await saveToRepo({ repo, m, from: this.store.recDir(floor, id), by, gh: this.d.gh });
    await this.store.write(m);
    this.d.changed?.(floor, m);
    return m;
  }

  async remove(floor: string, id: string): Promise<boolean> {
    if (this.running?.journeys.some((j) => j.rec === id)) return false;
    await this.store.remove(floor, id);
    this.d.changed?.(floor);
    return true;
  }

  /** The office is closing: the running batch stops (its app with it), nothing queued starts. */
  shutdown() {
    for (const b of this.batches) b.ctl.abort('the office is closing');
    this.batches = this.batches.filter((b) => b === this.running);
  }
}
