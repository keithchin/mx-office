// Walkthrough videos of each project's workflows: made on demand (Record on the 🌐 Live app tab's
// Walkthroughs section) and by themselves when the live app says a milestone is ready (only the journeys
// that passed against that build, behind a per-project switch). One recording at a time per office, queued,
// cancellable; the browser, ffmpeg and the voice are child processes, so the office only coordinates.
// Working copies live in <data>/walkthroughs/ (./store.ts); their home is the project's private repo
// (Save to repo, a pull request: ./save.ts). Nothing here calls a model.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from '../../shared/evidence/ids.js';
import { parseJourney } from '../../shared/liveapp/plan.js';
import type { LiveReadiness, ReadinessNews } from '../../shared/liveapp/readiness.js';
import { autoJourneys } from '../../shared/walkthroughs/auto.js';
import { scriptOf } from '../../shared/walkthroughs/script.js';
import { RECORDING_CAP_MS, type RecordingTrigger, type WalkAvailability, type WalkJob, type WalkManifest, type WalkScript, type WalkSettings, type WalkView } from '../../shared/walkthroughs/types.js';
import { listFiles, readFiles } from '../testing/repo.js';
import { findFfmpeg, type Tool } from './media.js';
import type { Browser } from './recorder.js';
import { runRecording } from './run.js';
import { saveToRepo, type Gh } from './save.js';
import { WalkStore } from './store.js';
import { makeGuidedTour, tourParts } from './tour.js';
import { findKokoro, kokoroVoice, type Voice } from './tts.js';

/** What the service needs to know about a project and its live app. */
export interface WalkDeps {
  dataDir: string;
  /** The project's folder (its git repository), or undefined for no such project. */
  floorDir(floor: string): string | undefined;
  /** The live app now: running, its commit, and its recording proxy's URL. */
  live(floor: string): { running: boolean; commit?: string; url?: string; title?: string } | undefined;
  gh: Gh;
  /** Something changed (a job moved, a recording finished): for toasts and the page. */
  changed?(floor: string, m?: WalkManifest): void;
  tool?: Tool;
  /** The voice, or a promise of it (looked for once). null: no voice. */
  voice?: Voice | null;
  launch?(): Promise<Browser>;
  quota?: number;
  cardMs?: number;
  stepMs?: number;
}

interface Job extends WalkJob {
  ctl: AbortController;
  run(job: Job): Promise<WalkManifest | undefined>;
}

export class Walkthroughs {
  readonly store: WalkStore;
  readonly tool: Tool;
  private voice: Voice | null | undefined;
  private voiceLook?: Promise<void>;
  private jobs: Job[] = [];
  private running?: Job;
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
    if (!this.tool.ffmpeg) notes.push('ffmpeg isn’t installed here: videos are WebM, without voice.');
    if (this.voice === undefined) notes.push('Looking for a local voice (Kokoro)…');
    else if (!this.voice) notes.push('No local voice (Kokoro) here: captions only. Set AGENT_OFFICE_KOKORO_PYTHON to a Python with kokoro installed.');
    else if (!this.tool.ffmpeg) notes.push('The voice needs ffmpeg to be put into the video.');
    return { recorder: true, ffmpeg: !!this.tool.ffmpeg, narration: this.voice && this.tool.ffmpeg ? this.voice.engine : 'none', notes };
  }

  /** Resolves once the voice has been looked for (tests, the first view). */
  async ready() {
    await this.voiceLook;
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
    const live = this.d.live(floor);
    const commit = live?.running ? live.commit : undefined;
    const journeys = commit ? (await this.scriptsAt(floor, commit).catch(() => [])).map((j) => ({ id: j.journey, title: j.title, file: j.file, requirement: j.requirement })) : [];
    const list = await this.store.list(floor);
    // One left "recording" by an office that stopped mid-way never finishes: it says so.
    for (const m of list) {
      if (m.status !== 'recording' || this.jobs.some((j) => j.id === m.id)) continue;
      Object.assign(m, { status: 'error', failure: { why: 'the office stopped during the recording' } });
      await this.store.write(m).catch(() => undefined);
    }
    const recordings = list.slice(0, 60).map(({ schema: _s, floor: _f, finishedAt: _x, ...r }) => r);
    return {
      floor,
      settings: { autoRecord: s.autoRecord, narrate: s.narrate, demoUser: s.demoUser },
      available: this.availability(),
      ...(live?.commit ? { live: { commit: live.commit, running: live.running && !!live.url } } : {}),
      journeys,
      jobs: this.jobs.filter((j) => j.floor === floor).map(({ ctl: _c, run: _r, ...j }) => j),
      recordings,
      disk: { bytes: await this.store.used(), quota: this.store.quota },
      admin,
    };
  }

  /** Queues a recording of one journey of the running build. Returns the job id, or why not. */
  async record(floor: string, journey: string, o: { by: string; trigger?: RecordingTrigger; milestone?: { id: string; title: string }; narrate?: boolean }): Promise<string> {
    const live = this.d.live(floor);
    if (!live?.running || !live.commit || !live.url) throw new Error('the live app isn’t running through its proxy: ▶ Start it first');
    const commit = live.commit;
    const script = (await this.scriptsAt(floor, commit)).find((s) => s.journey === journey);
    if (!script) throw new Error(`no journey ${journey} in the running build (@${commit.slice(0, 7)})`);
    const settings = await this.store.settings(floor);
    const narrate = (o.narrate ?? settings.narrate) && !!this.tool.ffmpeg;
    const id = `wt_${ulid()}`;
    const job: Job = {
      id,
      floor,
      journey,
      kind: 'workflow',
      trigger: o.trigger ?? 'manual',
      status: 'queued',
      at: Date.now(),
      ctl: new AbortController(),
      // The proxy's port can move with a restart while this waits in line: its address now.
      run: (j) => this.runWorkflow(j, script, commit, this.d.live(floor)?.url ?? live.url!, settings, narrate, o),
    };
    this.enqueue(job);
    return id;
  }

  /** Queues a guided tour of the running build's newest passing workflow videos. */
  async tour(floor: string, by: string): Promise<string> {
    const live = this.d.live(floor);
    if (!live?.commit) throw new Error('the live app isn’t running');
    if (!this.tool.ffmpeg) throw new Error('a guided tour needs ffmpeg on the office’s machine');
    const commit = live.commit;
    const order = (await this.scriptsAt(floor, commit).catch(() => [])).map((s) => s.journey);
    if (!tourParts(await this.store.list(floor), commit, order).length) throw new Error(`no passing workflow video of the running build (@${commit.slice(0, 7)}) yet: record one first`);
    const id = `wt_${ulid()}`;
    const job: Job = {
      id,
      floor,
      journey: 'guided-tour',
      kind: 'tour',
      trigger: 'manual',
      status: 'queued',
      at: Date.now(),
      ctl: new AbortController(),
      run: async (j) => {
        const parts = tourParts(await this.store.list(floor), commit, order);
        const dir = this.store.recDir(floor, id);
        await mkdir(dir, { recursive: true });
        const m = await makeGuidedTour({ floor, id, dir, title: live.title ?? 'the app', commit, parts, partDir: (p) => this.store.recDir(floor, p.id), by, tool: this.tool, signal: j.ctl.signal, progress: (l) => this.say(j, l), ...(this.d.launch ? { launch: this.d.launch } : {}) });
        await this.store.write(m);
        return m;
      },
    };
    this.enqueue(job);
    return id;
  }

  private enqueue(job: Job) {
    this.jobs.push(job);
    this.d.changed?.(job.floor);
    void this.pump();
  }

  private say(job: Job, line: string) {
    job.line = line;
    this.d.changed?.(job.floor);
  }

  private async runWorkflow(job: Job, script: WalkScript, commit: string, url: string, s: WalkSettings, narrate: boolean, o: { by: string; milestone?: { id: string; title: string } }): Promise<WalkManifest> {
    const dir = this.store.recDir(job.floor, job.id);
    await mkdir(dir, { recursive: true });
    const m: WalkManifest = {
      schema: 1,
      id: job.id,
      floor: job.floor,
      kind: 'workflow',
      journey: { id: script.journey, title: script.title, file: script.file, requirement: script.requirement },
      ...(o.milestone ? { milestone: o.milestone } : {}),
      trigger: job.trigger,
      by: o.by,
      app: { commit, origin: new URL(url).origin, user: s.demoUser },
      startedAt: Date.now(),
      status: 'recording',
      steps: script.steps.map((x) => ({ n: x.n, caption: x.caption, status: 'not-run' as const })),
      outputs: { narration: 'none', notes: [] },
    };
    await this.store.write(m);
    if (narrate && this.voice === undefined) await this.voiceLook;
    return runRecording(
      { tool: this.tool, ...(this.voice ? { voice: this.voice } : {}), commitNow: () => this.d.live(job.floor)?.commit, ...(this.d.launch ? { launch: this.d.launch } : {}), ...(this.d.cardMs !== undefined ? { cardMs: this.d.cardMs } : {}), ...(this.d.stepMs !== undefined ? { stepMs: this.d.stepMs } : {}) },
      { m, dir, url, script, login: { user: s.demoUser, password: s.demoPassword }, narrate, signal: job.ctl.signal, progress: (l) => this.say(job, l), save: (x) => this.store.write(x) },
    );
  }

  /** Runs the queue, one job at a time. */
  private async pump() {
    if (this.running) return;
    const job = this.jobs.find((j) => j.status === 'queued');
    if (!job) return;
    this.running = job;
    job.status = 'running';
    this.d.changed?.(job.floor);
    const cap = setTimeout(() => job.ctl.abort(`stopped after ${RECORDING_CAP_MS / 60_000} minutes`), RECORDING_CAP_MS + 2 * 60_000);
    let m: WalkManifest | undefined;
    try {
      m = await job.run(job);
    } catch (err) {
      const had = await this.store.read(job.floor, job.id);
      if (had) {
        m = { ...had, status: job.ctl.signal.aborted ? 'cancelled' : 'error', failure: { why: (err as Error).message.slice(0, 300) }, finishedAt: Date.now() };
        await this.store.write(m).catch(() => undefined);
      } else console.error('agent-office: walkthrough failed', err);
    } finally {
      clearTimeout(cap);
      this.jobs = this.jobs.filter((j) => j !== job);
      this.running = undefined;
      await this.store.cleanup().catch(() => []);
      this.d.changed?.(job.floor, m);
      void this.pump();
    }
  }

  /** Cancels a queued or running job. */
  cancel(floor: string, id: string): boolean {
    const job = this.jobs.find((j) => j.id === id && j.floor === floor);
    if (!job) return false;
    if (job.status === 'queued') {
      this.jobs = this.jobs.filter((j) => j !== job);
      this.d.changed?.(floor);
    } else job.ctl.abort('cancelled');
    return true;
  }

  /** Resolves when nothing is queued or running (tests). */
  async idle(): Promise<void> {
    while (this.running || this.jobs.length) await new Promise((r) => setTimeout(r, 50));
  }

  /** The live app said a milestone is ready: record its passing journeys, when the project's switch is on. */
  async onReady(floor: string, news: ReadinessNews, readiness: LiveReadiness): Promise<string[]> {
    if (news.kind !== 'ready') return [];
    const s = await this.store.settings(floor);
    const done = new Set([...(await this.store.list(floor)).filter((m) => m.trigger === 'auto' && m.app.commit === news.sha).map((m) => m.journey.id), ...this.jobs.filter((j) => j.floor === floor && j.trigger === 'auto').map((j) => j.journey)]);
    const ids = autoJourneys({ readiness, milestone: news.milestone, sha: news.sha, autoRecord: s.autoRecord, done });
    if (!ids.length) return [];
    await this.store.cleanup().catch(() => []);
    if ((await this.store.used()) > this.store.quota) {
      console.error('agent-office: walkthroughs are over their disk quota: no auto-recording');
      return [];
    }
    const out: string[] = [];
    for (const j of ids) out.push(await this.record(floor, j, { by: 'Mx Office (milestone ready)', trigger: 'auto', milestone: { id: news.milestone, title: news.title } }).catch(() => ''));
    return out.filter(Boolean);
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
    if (this.jobs.some((j) => j.id === id)) return false;
    await this.store.remove(floor, id);
    this.d.changed?.(floor);
    return true;
  }

  shutdown() {
    for (const j of this.jobs) j.ctl.abort('the office is closing');
    this.jobs = this.jobs.filter((j) => j.status === 'running');
  }
}
