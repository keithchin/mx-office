// The live app as people are told it, the same words wherever it shows (the Live app tab and its chip, the
// Overview's View App and Live app row, the Needs-you rows the phone, Teams and push read): running,
// starting, building, updating, stopped (crashed at 10:27), build failed, not started; the served commit
// (the one actually running and answering) against the one it's updating to, in one line ("Running
// abc1234 · updating to def5678…", "Update to def5678 failed · still running abc1234", "… · nothing
// running"), and how far behind main the served one is; and the Needs-you rows for a crash, an update that
// failed, a refresh that can't reach main, and a milestone that became ready (or stopped being ready) in
// the running app. Pure.

import type { NeedItem } from '../needsyou.js';
import type { LiveAppState } from '../protocol/liveapp.js';
import { heldFactLine } from '../data-impact.js';

export type LiveTone = 'good' | 'busy' | 'bad' | 'idle';

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "10:27" today, "16 Oct 23:36" another day (this machine's clock). */
export function stamp(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const n = new Date(now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === n.toDateString() ? hm : `${d.getDate()} ${MONTHS[d.getMonth()]} ${hm}`;
}

const short = (sha?: string) => sha?.slice(0, 7) ?? '';

/** The status in a few words, and how it should look. */
export function liveStatus(s: LiveAppState | null | undefined, now = Date.now()): { word: string; tone: LiveTone } {
  if (!s) return { word: 'checking…', tone: 'idle' };
  switch (s.status) {
    case 'running':
      return s.failure?.kind === 'update' ? { word: 'running · update failed', tone: 'bad' } : s.failure?.kind === 'held' ? { word: 'running · update held', tone: 'bad' } : { word: 'running', tone: 'good' };
    case 'starting':
      return { word: (s.phase ? s.phase === 'building' : /^Building|building/.test(s.message ?? '')) ? 'building…' : 'starting…', tone: 'busy' };
    case 'updating':
      return { word: s.target ? `updating to ${short(s.target.sha)}…` : 'updating…', tone: 'busy' };
    case 'stopping':
      return { word: 'stopping…', tone: 'busy' };
    case 'failed': {
      const f = s.failure;
      if (!f) return { word: 'failed', tone: 'bad' };
      const at = stamp(f.at, now);
      if (f.kind === 'held') return { word: 'start held (data impact)', tone: 'bad' };
      return { word: f.kind === 'crash' ? `stopped (crashed at ${at})` : f.kind === 'timeout' ? `didn't come up (gave up at ${at})` : `build failed at ${at}`, tone: 'bad' };
    }
    default:
      return s.started ? { word: 'stopped', tone: 'idle' } : { word: 'not started', tone: 'idle' };
  }
}

/** The served commit: "main @dd960bd from 16 Oct 23:36 · 2 commits behind main @f790bed", or "· up to date"; '' while nothing serves. */
export function commitLine(s: LiveAppState | null | undefined, now = Date.now()): string {
  const on = s?.served;
  if (!s || !on) return '';
  const branch = s.branch ?? 'main';
  const head = `${branch} @${short(on.sha)}${on.commitAt ? ` from ${stamp(on.commitAt, now)}` : ''}`;
  if (!s.main) return head;
  if (s.main.behind > 0) return `${head} · ${s.main.behind} commit${s.main.behind === 1 ? '' : 's'} behind ${branch} @${short(s.main.sha)}`;
  return `${head} · up to date`;
}

/** "built 10:31": when the served build came up. */
export const builtLine = (s: LiveAppState | null | undefined, now = Date.now()) => (s?.served ? `built ${stamp(s.served.builtAt, now)}` : '');

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * What runs against what it's on its way to, in one line: "Running abc1234", "Running abc1234 · updating to
 * def5678…", "Updating to def5678… · nothing running (abc1234 stopped for the build)", "Update to def5678
 * failed · still running abc1234", "Update to def5678 failed · nothing running", "Nothing running · last ran
 * abc1234 until 10:27". Only `served` is ever called running. '' when there's nothing to say.
 */
export function revisionLine(s: LiveAppState | null | undefined, now = Date.now()): string {
  if (!s) return '';
  const run = s.served ? `Running ${short(s.served.sha)}` : '';
  const t = s.target;
  switch (s.status) {
    case 'starting':
    case 'updating': {
      const verb = t?.from && t.from === t.sha ? 'restarting' : s.status === 'updating' || t?.from ? 'updating to' : s.phase === 'starting' ? 'starting' : 'building';
      const doing = t ? `${verb} ${short(t.sha)}…` : 'getting main…';
      if (run) return `${run} · ${doing}`;
      return `${cap(doing)} · nothing running${t?.from ? ` (${short(t.from)} stopped for the build)` : ''}`;
    }
    case 'running': {
      const f = s.failure;
      if (f?.kind === 'held' && f.sha) return `${cap(heldFactLine(s.branch ?? 'main', f.sha))} · ${run ? `still running ${short(s.served!.sha)}` : 'nothing running'}`;
      if (f?.kind === 'update') return `Update${f.sha ? ` to ${short(f.sha)}` : ''} failed · ${run ? `still running ${short(s.served!.sha)}` : 'nothing running'}`;
      return run;
    }
    case 'failed': {
      const f = s.failure;
      if (f?.kind === 'held' && f.sha) return `${cap(heldFactLine(s.branch ?? 'main', f.sha))} · nothing running`;
      if (f?.kind === 'crash') return `${f.sha ? short(f.sha) : 'The app'} stopped by itself · nothing running`;
      const what = f?.sha ?? t?.sha;
      return `${t?.from ? `Update${what ? ` to ${short(what)}` : ''}` : what ? `Build of ${short(what)}` : 'The build'} failed · nothing running`;
    }
    case 'stopping':
      return run ? `${run} · stopping…` : 'Stopping…';
    default:
      return s.lastServed ? `Nothing running · last ran ${short(s.lastServed.sha)} until ${stamp(s.lastServed.until, now)}` : '';
  }
}

/** The Needs-you rows the live app raises on its floor. */
export function liveNeeds(live: LiveAppState | null | undefined, floor: string | undefined): NeedItem[] {
  if (!live || live.floor !== floor) return [];
  const out: NeedItem[] = [];
  const f = live.failure;
  if (live.status === 'failed' && f?.kind !== 'held') {
    if (f?.kind === 'crash') {
      out.push({ key: `live-crash@${f.at}`, kind: 'live', icon: '🌐', text: `The live app stopped by itself (crashed at ${stamp(f.at)}${f.sha ? `, ${live.branch ?? 'main'} @${short(f.sha)}` : ''}): ${f.why}. Restart it on the Live app tab`, since: f.at, level: 'warn', action: 'Live app', target: { to: 'live' } });
    } else out.push({ key: 'live', kind: 'live', icon: '🌐', text: `The live app failed${live.message ? `: ${live.message}` : ''}${f?.sha ? `. ${revisionLine(live)}` : ''}`, since: f?.at ?? live.since, level: 'warn', action: 'Live app', target: { to: 'live' } });
  }
  // An update that failed with the old build still serving: it runs, but not what main has.
  if (live.status === 'running' && f?.kind === 'update' && live.served) {
    out.push({ key: `live-update@${f.at}`, kind: 'live', icon: '🌐', text: `Live app update${f.sha ? ` to ${live.branch ?? 'main'} @${short(f.sha)}` : ''} failed: ${f.why}. Still running ${live.branch ?? 'main'} @${short(live.served.sha)}; Restart it on the Live app tab`, since: f.at, level: 'warn', action: 'Live app', target: { to: 'live' } });
  }
  // The data-impact guard holds main's newest commit (server/data-impact/): merged, never applied; an approver decides on the Live app tab.
  if (f?.kind === 'held' && f.sha) {
    const running = live.served ? `still running ${live.branch ?? 'main'} @${short(live.served.sha)}` : 'nothing running';
    out.push({ key: `live-held:${f.sha}`, kind: 'live', icon: '✋', text: `Live app: ${heldFactLine(live.branch ?? 'main', f.sha)} (${/unknown/.test(f.why) ? 'data impact unknown' : 'possible data impact'}). Needs data-impact approval; ${running}`, since: f.at, level: 'block', action: 'Review the data impact', target: { to: 'live' } });
  }
  if (live.refresh && !live.refresh.ok && (live.status === 'running' || live.status === 'failed')) {
    out.push({ key: 'live-refresh', kind: 'live', icon: '🌐', text: `Live app can't check for updates: ${live.refresh.error ?? 'unknown error'}${live.served ? ` (running ${live.branch ?? 'main'} @${short(live.served.sha)}${live.served.commitAt ? ` from ${stamp(live.served.commitAt)}` : ''})` : ''}`, since: live.refresh.at, level: 'info', action: 'Live app', target: { to: 'live' } });
  }
  for (const n of live.readiness?.news ?? []) {
    out.push(
      n.kind === 'ready'
        ? { key: n.key, kind: 'live', icon: '✅', text: `Live app ready: ${n.title}. Try it on the Live app tab (${live.branch ?? 'main'} @${short(n.sha)})`, since: n.at, level: 'info', action: 'Live app', target: { to: 'live' } }
        : { key: n.key, kind: 'live', icon: '🌐', text: `The live app no longer has ${n.title} (now ${live.branch ?? 'main'} @${short(n.sha)})`, since: n.at, level: 'info', action: 'Live app', target: { to: 'live' } },
    );
  }
  return out;
}

/** Which live-app rows reach the notification channels (Teams, phone push): a crash, a data-impact hold, and readiness news; once each, by key. */
export const liveNotifies = (key: string) => key.startsWith('live-crash@') || key.startsWith('live-held:') || key.startsWith('live-ready:') || key.startsWith('live-unready:');
