// One batch of workflow recordings, played by its plan (shared/walkthroughs/plan.ts): group after group,
// each on a fresh database of the office's own copy of the app (the first group boots it; each later one
// restarts the same build on a new database when the instance can, else boots a new one), one session per
// account per group (./signin.ts), signed out when the group is done. Journeys played only to set up a later
// one's start state are played unfilmed, and the later one's card says so. A group whose journey must not
// run now (its time window) moves to the end of the batch once, and is skipped with the reason if the window
// still holds then. When a journey in a group doesn't pass, the ones after it in its chain aren't played:
// their start state isn't there, and their cards say why. A journey whose own steps fail stays an honest
// failed recording.

import { mkdir } from 'node:fs/promises';
import type { BootPhase, BootTiming } from '../../shared/app-instance.js';
import { ulid } from '../../shared/evidence/ids.js';
import { resolveIdentity, type RunnerConfig } from '../../shared/walkthroughs/identity.js';
import { chainAbove, type PlanGroup } from '../../shared/walkthroughs/plan.js';
import { windowNow, windowWords } from '../../shared/walkthroughs/start-state.js';
import { RECORDING_CAP_MS, type WalkBatch, type WalkManifest, type WalkScript, type WalkSettings } from '../../shared/walkthroughs/types.js';
import { record, AppSessions, type Browser } from './recorder.js';
import { runRecording } from './run.js';
import type { WalkStore } from './store.js';
import type { Tool } from './media.js';
import type { Voice } from './tts.js';

/** The office's own copy of the app a batch records against (app-instance/). */
export interface RecordingApp {
  url: string;
  commit: string;
  /** Its Mendix runtime log, when there is one (a refused session shows there). */
  runtimeLog?: string;
  alive(): boolean;
  /** What its last start (or fresh database) took, phase by phase, and whether it was tried once more. */
  timing?: BootTiming;
  /** The same build on a new, fresh database (app-instance/: no new copy, same ports), when the instance can. */
  freshDatabase?(signal: AbortSignal, progress: (line: string) => void, onPhase?: (phase: BootPhase, at: number) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface BatchRun extends WalkBatch {
  ctl: AbortController;
  /** While the recording app starts: its phase and when that phase and the start began (the page gets the elapsed times). */
  booting?: { phase: BootPhase; phaseAt: number; at: number };
}

/** What a batch needs of the Walkthroughs service. */
export interface BatchHost {
  store: WalkStore;
  tool: Tool;
  voice(): Voice | null | undefined;
  voiceReady(): Promise<void>;
  boot(signal: AbortSignal, progress: (line: string) => void, onPhase?: (phase: BootPhase, at: number) => void): Promise<RecordingApp>;
  runnerConfig(): Promise<RunnerConfig | undefined>;
  say(line: string): void;
  changed(m?: WalkManifest): void;
  launch?(): Promise<Browser>;
  cardMs?: number;
  stepMs?: number;
  /** The clock (tests set it). */
  now?(): Date;
}

const secs = (ms: number) => `${Math.round(ms / 1000)} s`;

/** A fresh manifest for one journey of the batch (status "recording"). */
export function manifestOf(b: BatchRun, sc: WalkScript, origin: string, user: string | undefined, from?: WalkManifest['app']['userFrom']): WalkManifest {
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

/** A journey the batch didn't play (the app didn't start, cancelled, its start state isn't there, skipped): said on its card. */
export async function writeUnrun(h: BatchHost, b: BatchRun, sc: WalkScript, status: 'error' | 'cancelled' | 'skipped', why: string, start?: WalkManifest['start']) {
  const m = manifestOf(b, sc, '', undefined);
  Object.assign(m, { status, failure: { why }, finishedAt: Date.now(), ...(start ? { start } : {}) });
  await h.store.write(m).catch(() => undefined);
  h.changed(m);
}

/** Plays the batch's plan. `scripts`: every journey of the commit, by id. */
export async function runPlan(h: BatchHost, b: BatchRun, scripts: Map<string, WalkScript>, s: WalkSettings, narrate: boolean): Promise<void> {
  const plan = b.plan!;
  const sig = b.ctl.signal;
  const now = () => h.now?.() ?? new Date();
  // What the plan already won't play (an order that can't hold): said on the cards, never recorded.
  for (const k of plan.skipped) {
    const sc = scripts.get(k.id);
    if (sc && k.kind !== 'template') await writeUnrun(h, b, sc, 'skipped', `not recorded: ${k.why}`);
  }
  const queue: PlanGroup[] = [...plan.groups];
  const moved = new Set<PlanGroup>();
  let app: RecordingApp | undefined;
  let sessions: AppSessions | undefined;
  let done = 0;
  const filmedOf = (g: PlanGroup) => g.steps.filter((x) => !x.setup).map((x) => scripts.get(x.id)!).filter(Boolean);
  try {
    if (narrate && h.voice() === undefined) await h.voiceReady();
    const cfg = await h.runnerConfig();
    for (let gi = 0; gi < queue.length; gi++) {
      if (sig.aborted) break;
      const g = queue[gi];
      const ofN = queue.length;
      // A journey that must not run now: the group goes to the end once, then is skipped with the reason.
      const hit = g.steps.map((x) => ({ x, w: windowNow(x.windows, now()) })).find((y) => y.w);
      if (hit?.w) {
        const words = `${scripts.get(hit.x.id)?.title ?? hit.x.id} must not run between ${windowWords(hit.w.w)} (it is ${hit.w.clock} there${hit.w.zoneUnknown ? `; “${hit.w.w.zone}” is no time zone this machine knows, so the office’s own clock was used` : ''})`;
        if (!moved.has(g) && gi < queue.length - 1) {
          moved.add(g);
          queue.splice(gi, 1);
          queue.push(g);
          gi--;
          h.say(`Group ${done + 1} of ${ofN} moved to the end of the batch: ${words}`);
          continue;
        }
        for (const sc of filmedOf(g)) await writeUnrun(h, b, sc, 'skipped', `skipped: ${words}; record it again after the window`, { group: done + 1, groups: ofN });
        done++;
        continue;
      }
      done++;
      b.group = { n: done, of: ofN };
      // A fresh database for the group: the first boots the app; the next ones restart the same build on a new one.
      const t0 = Date.now();
      let how: 'boot' | 'fresh-db' | 'new-instance' = 'boot';
      b.phase = 'booting';
      // Each boot phase as it starts: the page shows it with the time it has taken.
      const onPhase = (phase: BootPhase, at: number) => {
        b.booting = { phase, phaseAt: at, at: b.booting?.at ?? t0 };
        h.changed();
      };
      try {
        if (!app) {
          h.say(`Group ${done} of ${ofN} · starting the recording app at @${b.commit.slice(0, 7)} on a fresh database…`);
          app = await h.boot(sig, (l) => h.say(`Group ${done} of ${ofN} · ${l}`), onPhase);
        } else if (app.freshDatabase) {
          how = 'fresh-db';
          h.say(`Group ${done} of ${ofN} · starting a fresh database…`);
          await app.freshDatabase(sig, (l) => h.say(`Group ${done} of ${ofN} · ${l}`), onPhase);
        } else {
          how = 'new-instance';
          h.say(`Group ${done} of ${ofN} · starting a fresh database (a new copy of the app)…`);
          await app.stop().catch(() => undefined);
          app = undefined;
          app = await h.boot(sig, (l) => h.say(`Group ${done} of ${ofN} · ${l}`), onPhase);
        }
      } catch (err) {
        app = undefined;
        b.booting = undefined;
        const why = sig.aborted ? 'cancelled before the recording app was up' : `the recording app didn’t start: ${(err as Error).message.slice(0, 700)}`;
        // Nothing after this would start either: every journey left says so.
        for (const rest of queue.slice(gi)) for (const sc of filmedOf(rest)) await writeUnrun(h, b, sc, sig.aborted ? 'cancelled' : 'error', why);
        return;
      }
      const dbMs = Date.now() - t0;
      const boot = app.timing;
      b.booting = undefined;
      if (boot) console.log(`agent-office: walkthroughs: group ${done} of ${ofN}: the recording app came up in ${secs(boot.ms)} (${how}${boot.workspace ? `, workspace ${boot.workspace}` : ''}${boot.bundleMs !== undefined ? `, bundle ${secs(boot.bundleMs)}` : ''}${boot.retried ? `, retried once: ${boot.retried}` : ''})`);
      b.phase = 'recording';
      // One session per account for the group (an unlicensed app keeps only 6 open), signed out at its end.
      sessions = new AppSessions({ url: app.url, ...(app.runtimeLog ? { runtimeLog: app.runtimeLog } : {}), ...(h.launch ? { launch: h.launch } : {}) });
      const failed = new Map<string, string>();
      for (const step of g.steps) {
        if (sig.aborted) break;
        const sc = scripts.get(step.id);
        if (!sc) continue;
        const above = chainAbove(g, step.id);
        const setupTitles = above.filter((id) => g.steps.find((x) => x.id === id)?.setup).reverse().map((id) => scripts.get(id)?.title ?? id);
        const start: WalkManifest['start'] = { group: done, groups: ofN, ...(setupTitles.length ? { setup: setupTitles } : {}), db: how, dbMs, ...(boot ? { boot } : {}) };
        const broke = above.find((id) => failed.has(id));
        if (broke) {
          failed.set(step.id, 'its start state isn’t there');
          if (!step.setup) await writeUnrun(h, b, sc, 'error', `not recorded: “${scripts.get(broke)?.title ?? broke}”, which sets up its start state, didn’t pass (${failed.get(broke)})`, start);
          continue;
        }
        if (step.setup) {
          h.say(`Group ${done} of ${ofN} · setting up: playing ${sc.title} first (not filmed)…`);
          const why = await playSetup(h, b, sc, app, sessions, s, cfg);
          if (why) failed.set(step.id, why);
          continue;
        }
        const k = b.journeys.findIndex((x) => x.id === sc.journey);
        b.n = k + 1;
        h.say(`Recording ${k + 1} of ${b.journeys.length}: ${sc.title}`);
        const m = await recordOne(h, b, sc, app, sessions, s, cfg, narrate, start);
        if (m.status !== 'passed') failed.set(step.id, m.status === 'failed' ? `failed at step ${m.failure?.step ?? '?'}` : (m.failure?.why ?? m.status));
        h.changed(m);
      }
      h.say(`Group ${done} of ${ofN} · signing out…`);
      await sessions.close().catch(() => undefined);
      sessions = undefined;
      if (how !== 'boot') console.log(`agent-office: walkthroughs: group ${done} of ${ofN} got its fresh database in ${secs(dbMs)} (${how})`);
    }
  } finally {
    b.phase = 'finishing';
    if (sessions) h.say('Signing out…');
    await sessions?.close().catch(() => undefined);
    h.say('Stopping the recording app…');
    await app?.stop().catch(() => undefined);
  }
}

/** Plays a journey unfilmed to set up a later one's start state; undefined when it passed, else why not. */
async function playSetup(h: BatchHost, b: BatchRun, sc: WalkScript, app: RecordingApp, sessions: AppSessions, s: WalkSettings, cfg: RunnerConfig | undefined): Promise<string | undefined> {
  const who = resolveIdentity(sc.identity ?? { names: [] }, cfg, { user: s.demoUser, password: s.demoPassword });
  const one = new AbortController();
  const cap = setTimeout(() => one.abort(`stopped after ${RECORDING_CAP_MS / 60_000} minutes`), RECORDING_CAP_MS);
  const follow = () => one.abort('cancelled');
  b.ctl.signal.addEventListener('abort', follow, { once: true });
  try {
    const res = await record({ url: app.url, script: sc, outDir: '', login: { user: who.user, password: who.password }, sessions, signal: one.signal, film: false, progress: (l) => h.say(`Setting up: ${sc.title} · ${l}`), ...(h.launch ? { launch: h.launch } : {}) });
    if (res.status === 'passed') return undefined;
    return res.status === 'failed' ? `failed at step ${res.failure?.step ?? '?'}: ${res.failure?.why ?? ''}` : (res.failure?.why ?? res.status);
  } finally {
    clearTimeout(cap);
    b.ctl.signal.removeEventListener('abort', follow);
  }
}

async function recordOne(h: BatchHost, b: BatchRun, sc: WalkScript, app: RecordingApp, sessions: AppSessions, s: WalkSettings, cfg: RunnerConfig | undefined, narrate: boolean, start: WalkManifest['start']): Promise<WalkManifest> {
  const who = resolveIdentity(sc.identity ?? { names: [] }, cfg, { user: s.demoUser, password: s.demoPassword });
  const m = manifestOf(b, sc, new URL(app.url).origin, who.user, who.from);
  if (start) m.start = start;
  if (who.note) m.outputs.notes.push(`Sign-in: ${who.note}.`);
  if (start?.boot?.retried) m.outputs.notes.push(`The recording app failed to start once (${start.boot.retried}); retried.`);
  if (start?.setup?.length) m.outputs.notes.push(`Played ${start.setup.map((t) => `“${t}”`).join(', then ')} first (not filmed) to set up its start state.`);
  const dir = h.store.recDir(b.floor, m.id);
  // Each recording has its own time limit inside the batch; Cancel stops the batch.
  const one = new AbortController();
  const cap = setTimeout(() => one.abort(`stopped after ${RECORDING_CAP_MS / 60_000 + 2} minutes`), RECORDING_CAP_MS + 2 * 60_000);
  const follow = () => one.abort(typeof b.ctl.signal.reason === 'string' ? b.ctl.signal.reason : 'cancelled');
  b.ctl.signal.addEventListener('abort', follow, { once: true });
  try {
    await mkdir(dir, { recursive: true });
    await h.store.write(m);
    const voice = h.voice();
    return await runRecording(
      { tool: h.tool, ...(voice ? { voice } : {}), commitNow: () => (app.alive() ? b.commit : undefined), ...(h.launch ? { launch: h.launch } : {}), ...(h.cardMs !== undefined ? { cardMs: h.cardMs } : {}), ...(h.stepMs !== undefined ? { stepMs: h.stepMs } : {}) },
      { m, dir, url: app.url, script: sc, login: { user: who.user, password: who.password }, sessions, narrate, signal: one.signal, progress: (l) => h.say(`Recording ${b.n} of ${b.journeys.length}: ${l}`), save: (x) => h.store.write(x) },
    );
  } catch (err) {
    Object.assign(m, { status: one.signal.aborted ? 'cancelled' : 'error', failure: { why: (err as Error).message.slice(0, 300) }, finishedAt: Date.now() });
    await h.store.write(m).catch(() => undefined);
    return m;
  } finally {
    clearTimeout(cap);
    b.ctl.signal.removeEventListener('abort', follow);
  }
}
