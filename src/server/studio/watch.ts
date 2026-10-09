// Studio mode: whether Studio Pro has each Mendix floor's project open right now, found by looking
// (detect.ts) rather than remembered from who pressed the button. Every few seconds, for the floors
// with an .mpr only. When it opens, the office writes the floor's marker (.agent-office/studio-open.json,
// which the agents' PreToolUse guard, bin/studio-guard.js, reads to pause their mxcli writes), and
// says so in the audit log, the Team chatter and a toast; when it closes, the marker goes, and model
// changes nobody committed become a "Needs you" item for the Project Manager until they're committed.
// A lock with no Studio Pro running is a stale lock: shown, never enforced. What changed is kept in
// the floor's data folder (.agent-office/studio-mode.json), so a restart picks up where it was.

import { dropKeys, forgetWith } from '../office/forget.js';
import { execFileOff } from '../offloop/exec.js';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AuditInput } from '../../shared/audit.js';
import { STUDIO_MARKER, hasStudioMcp, type StudioMarker, type StudioState, type StudioTransition } from '../../shared/studio.js';
import type { ChatterDraft } from '../chatter/bus.js';
import { appName, lockOf, machineDetect, sightFloor, studioMcpUrl, studioProcesses, type DetectDeps, type FloorSighting } from './detect.js';

/** How often the office looks. */
export const POLL_MS = 4000;
/** How often it looks for the floor's .mpr again (it may be added, or moved). */
const FIND_MPR_MS = 60_000;
/** How often it asks git whether the changes Studio Pro left were committed. */
const UNCOMMITTED_MS = 30_000;
/** Transitions kept per floor. */
const HISTORY = 100;

/** A floor as Studio mode sees it. */
export interface StudioFloor {
  id: string;
  dir: string;
  def: { name: string };
}

/** Where what Studio mode does goes; the office's are in startStudioMode, the tests' write it down. */
export interface StudioSink {
  state(floor: StudioFloor, s: StudioState): void;
  audit(e: AuditInput): void;
  chatter(floor: string, d: ChatterDraft): void;
  toast(floor: StudioFloor, text: string, level: 'info' | 'warn'): void;
}

export interface WatchDeps {
  now(): number;
  detect: DetectDeps;
  /** The lock file's text; undefined when there's none. */
  readLock(p: string): string | undefined;
  findMpr(dir: string): string | undefined;
  readVersion(mpr: string): string | undefined;
  /** `git status --porcelain` in the floor's checkout ('' when clean, or when it isn't a repo). */
  gitStatus(dir: string): Promise<string>;
  mcpUrl: string;
  sink: StudioSink;
}

interface Kept {
  mpr?: string;
  version?: string;
  foundAt: number;
  state: StudioState;
  history: StudioTransition[];
  checkedAt: number;
  /** The first look since the office started: put the marker right whatever it was. */
  fresh: boolean;
}

export const dataDirOf = (dir: string) => path.join(dir, '.agent-office');
export const markerPath = (dir: string) => path.join(dataDirOf(dir), STUDIO_MARKER);
export const statePath = (dir: string) => path.join(dataDirOf(dir), 'studio-mode.json');

/** The model's files in `git status --porcelain` output: the .mpr and anything under mprcontents/. */
export function modelChanges(porcelain: string): string[] {
  const out: string[] = [];
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.length < 4) continue;
    let p = line.slice(3);
    if (p.includes(' -> ')) p = p.slice(p.indexOf(' -> ') + 4);
    p = p.replace(/^"(.*)"$/, '$1').replace(/\\/g, '/');
    if (/\.mpr$/i.test(p) || /(^|\/)mprcontents(\/|$)/i.test(p)) out.push(p);
  }
  return out;
}

function load(dir: string, id: string, now: number): { state: StudioState; history: StudioTransition[] } {
  try {
    const raw = JSON.parse(readFileSync(statePath(dir), 'utf8')) as { state?: StudioState; history?: StudioTransition[] };
    if (raw.state && typeof raw.state.open === 'boolean') return { state: { ...raw.state, floor: id }, history: Array.isArray(raw.history) ? raw.history.slice(-HISTORY) : [] };
  } catch {
    // Never written, or unreadable: closed.
  }
  return { state: { floor: id, open: false, since: now }, history: [] };
}

function writeJson(file: string, data: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

const same = (a: StudioState, b: StudioState) => JSON.stringify(a) === JSON.stringify(b);

export class StudioWatch {
  private floors = new Map<string, Kept>();
  /** Lets go of a deleted project's floor (office/forget.ts). */
  private readonly forgetsFloor = forgetWith(this, (o, f) => dropKeys(o.floors, f));
  private procs = new Map<number, string>();
  private busy = false;

  constructor(private d: WatchDeps) {}

  /** Floor `id`'s Studio mode, once the office has looked. */
  stateOf(id: string): StudioState | undefined {
    return this.floors.get(id)?.state;
  }

  historyOf(id: string): readonly StudioTransition[] {
    return this.floors.get(id)?.history ?? [];
  }

  private kept(f: StudioFloor): Kept {
    let k = this.floors.get(f.id);
    if (!k) {
      const { state, history } = load(f.dir, f.id, this.d.now());
      k = { foundAt: 0, state, history, checkedAt: 0, fresh: true };
      this.floors.set(f.id, k);
    }
    if (this.d.now() - k.foundAt >= FIND_MPR_MS || !k.foundAt) {
      k.foundAt = this.d.now();
      let mpr: string | undefined;
      try {
        mpr = this.d.findMpr(f.dir);
      } catch {
        mpr = undefined;
      }
      if (mpr !== k.mpr) k.version = mpr ? this.d.readVersion(mpr) : undefined;
      k.mpr = mpr;
    }
    return k;
  }

  /** One look at every floor in `floors`. Overlapping calls are dropped. */
  async poll(floors: Iterable<StudioFloor>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const list = [...floors];
      const ids = new Set(list.map((f) => f.id));
      for (const id of [...this.floors.keys()]) if (!ids.has(id)) this.floors.delete(id);
      const mendix = list.map((f) => ({ f, k: this.kept(f) })).filter((x) => x.k.mpr);
      if (!mendix.length) return;
      const procs = await studioProcesses(this.d.detect, this.procs);
      const sights = mendix.map(({ f, k }) => ({ f, k, s: sightFloor(k.mpr!, this.d.readLock(lockOf(k.mpr!)), procs) }));
      // One question to Studio Pro's MCP server, only while something is open on a project that has one.
      const wantsMcp = sights.some(({ k, s }) => s.open && (!k.version || hasStudioMcp(k.version)));
      const mcp = wantsMcp ? await this.d.detect.answers(this.d.mcpUrl) : false;
      for (const { f, k, s } of sights) await this.apply(f, k, s, mcp);
    } finally {
      this.busy = false;
    }
  }

  private note(k: Kept, t: StudioTransition) {
    k.history.push(t);
    if (k.history.length > HISTORY) k.history.splice(0, k.history.length - HISTORY);
  }

  private async apply(f: StudioFloor, k: Kept, s: FloorSighting, mcpUp: boolean) {
    const now = this.d.now();
    const prev = k.state;
    const app = appName(k.mpr!);
    const next: StudioState = { floor: f.id, open: s.open, since: prev.since };
    if (s.open) {
      next.pid = s.pid;
      next.via = s.via;
      if (!k.version || hasStudioMcp(k.version)) next.mcp = { url: this.d.mcpUrl, available: mcpUp };
    }
    if (s.staleLock) next.staleLock = prev.staleLock ?? { since: now };
    if (prev.uncommitted) next.uncommitted = prev.uncommitted;
    const target = { kind: 'project', id: f.id, label: f.def.name };
    const audit = (action: string, summary: string, details: Record<string, unknown>, severity: AuditInput['severity'] = 'notice') =>
      this.d.sink.audit({ floor: f.id, actor: { kind: 'office', name: 'The office' }, action, target, summary, details, severity });
    const say = (text: string) => this.d.sink.chatter(f.id, { kind: 'nudge', from: { name: 'The office', kind: 'office' }, to: { group: 'team' }, text, at: now });

    if (s.open && !prev.open) {
      next.since = now;
      this.note(k, { at: now, event: 'opened', ...(s.pid ? { pid: s.pid } : {}), ...(s.via ? { via: s.via } : {}) });
      audit('studio.opened', `Studio Pro opened ${app}: mxcli writes paused`, { mpr: k.mpr, pid: s.pid, via: s.via, ...(k.version ? { version: k.version } : {}) });
      say(`Studio Pro is open on ${app} — mxcli writes paused`);
      this.d.sink.toast(f, `Studio Pro is open on ${app}: the agents' mxcli writes are paused until it closes`, 'info');
    } else if (!s.open && prev.open) {
      next.since = now;
      this.note(k, { at: now, event: 'closed' });
      const changed = modelChanges(await this.d.gitStatus(f.dir).catch(() => ''));
      k.checkedAt = now;
      if (changed.length) next.uncommitted = { since: now, files: changed.length };
      audit('studio.closed', `Studio Pro closed ${app}: mxcli writes allowed again${changed.length ? ` (${changed.length} model file${changed.length === 1 ? '' : 's'} not committed)` : ''}`, { mpr: k.mpr, openFor: now - prev.since, uncommitted: changed.length });
      say(`Studio Pro closed — mxcli writes allowed again${changed.length ? '. Project Manager: commit your Studio Pro changes so the agents build on them' : ''}`);
      this.d.sink.toast(f, changed.length ? `Studio Pro closed with model changes: commit your Studio Pro changes so the agents build on them` : 'Studio Pro closed: mxcli writes are allowed again', changed.length ? 'warn' : 'info');
    }
    if (s.staleLock && !prev.staleLock) {
      this.note(k, { at: now, event: 'stale-lock' });
      // Studio Pro leaves its lock behind when it closes, so one right after a close is just that.
      const left = prev.open && !s.open;
      audit('studio.stale-lock', left ? `Studio Pro left ${path.basename(lockOf(k.mpr!))} behind when it closed: a stale lock (writes not paused)` : `${path.basename(lockOf(k.mpr!))} is there but the Studio Pro that wrote it isn't running: a stale lock (writes not paused)`, { lock: lockOf(k.mpr!), afterClose: left }, left ? 'info' : 'warning');
    } else if (!s.staleLock && prev.staleLock && !s.open) {
      this.note(k, { at: now, event: 'lock-cleared' });
    }
    // The changes Studio Pro left: gone from the list once git says they're committed (or undone).
    if (!s.open && next.uncommitted && now - k.checkedAt >= UNCOMMITTED_MS) {
      k.checkedAt = now;
      const status = await this.d.gitStatus(f.dir).catch(() => undefined);
      if (status !== undefined && !modelChanges(status).length) delete next.uncommitted;
    }
    const changed = !same(prev, next);
    k.state = next;
    if (changed || k.fresh) this.syncMarker(f, k, app);
    k.fresh = false;
    if (!changed) return;
    try {
      writeJson(statePath(f.dir), { state: next, history: k.history });
    } catch (err) {
      console.error(`agent-office: couldn't keep ${f.id}'s Studio mode: ${(err as Error).message}`);
    }
    this.d.sink.state(f, next);
  }

  /** The guard's marker: there exactly while Studio Pro has the project open. */
  private syncMarker(f: StudioFloor, k: Kept, app: string) {
    const file = markerPath(f.dir);
    try {
      if (k.state.open) {
        const m: StudioMarker = { floor: f.id, app, mpr: k.mpr!, since: k.state.since, ...(k.state.pid ? { pid: k.state.pid } : {}), ...(k.state.mcp?.available ? { mcp: k.state.mcp.url } : {}) };
        writeJson(file, m);
      } else if (existsSync(file)) rmSync(file, { force: true });
    } catch (err) {
      console.error(`agent-office: couldn't update ${file}: ${(err as Error).message}`);
    }
  }
}

const gitStatus = (dir: string) =>
  new Promise<string>((resolve, reject) =>
    execFileOff('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: dir, windowsHide: true, timeout: 15000, maxBuffer: 8 << 20 }, (err, out) => (err ? reject(err) : resolve(out))),
  );

/** This machine's. */
export function machineWatchDeps(sink: StudioSink, over: Partial<WatchDeps> = {}): WatchDeps {
  return {
    now: Date.now,
    detect: machineDetect(),
    readLock: (p) => {
      try {
        return existsSync(p) ? readFileSync(p, 'utf8').slice(0, 4096) : undefined;
      } catch {
        return existsSync(p) ? '' : undefined;
      }
    },
    findMpr: () => undefined,
    readVersion: () => undefined,
    gitStatus,
    mcpUrl: studioMcpUrl(),
    sink,
    ...over,
  };
}
