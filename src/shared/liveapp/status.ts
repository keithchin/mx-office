// The live app as people are told it, the same words wherever it shows (the Live app tab and its chip, the
// Overview's View App and Live app row, the Needs-you rows the phone, Teams and push read): running,
// starting, building, updating, stopped (crashed at 10:27), build failed, not started; the commit it runs
// and how far behind main that is; and the Needs-you rows for a crash, a refresh that can't reach main,
// and a milestone that became ready (or stopped being ready) in the running app. Pure.

import type { NeedItem } from '../needsyou.js';
import type { LiveAppState } from '../protocol/liveapp.js';

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
      return { word: 'running', tone: 'good' };
    case 'starting':
      return { word: /^Building|building/.test(s.message ?? '') ? 'building…' : 'starting…', tone: 'busy' };
    case 'updating':
      return { word: s.sha ? `updating to ${short(s.sha)}…` : 'updating…', tone: 'busy' };
    case 'stopping':
      return { word: 'stopping…', tone: 'busy' };
    case 'failed': {
      const f = s.failure;
      if (!f) return { word: 'failed', tone: 'bad' };
      const at = stamp(f.at, now);
      return { word: f.kind === 'crash' ? `stopped (crashed at ${at})` : f.kind === 'timeout' ? `didn't come up (gave up at ${at})` : `build failed at ${at}`, tone: 'bad' };
    }
    default:
      return s.started ? { word: 'stopped', tone: 'idle' } : { word: 'not started', tone: 'idle' };
  }
}

/** "main @dd960bd from 16 Oct 23:36 · 2 commits behind main @f790bed", or "· up to date"; '' before it runs anything. */
export function commitLine(s: LiveAppState | null | undefined, now = Date.now()): string {
  if (!s?.sha) return '';
  const branch = s.branch ?? 'main';
  const head = `${branch} @${short(s.sha)}${s.commitAt ? ` from ${stamp(s.commitAt, now)}` : ''}`;
  if (!s.main) return head;
  if (s.main.behind > 0) return `${head} · ${s.main.behind} commit${s.main.behind === 1 ? '' : 's'} behind ${branch} @${short(s.main.sha)}`;
  return `${head} · up to date`;
}

/** "built 10:31": when the running build came up. */
export const builtLine = (s: LiveAppState | null | undefined, now = Date.now()) => (s?.builtAt && s.status === 'running' ? `built ${stamp(s.builtAt, now)}` : '');

/** The Needs-you rows the live app raises on its floor. */
export function liveNeeds(live: LiveAppState | null | undefined, floor: string | undefined): NeedItem[] {
  if (!live || live.floor !== floor) return [];
  const out: NeedItem[] = [];
  const f = live.failure;
  if (live.status === 'failed') {
    if (f?.kind === 'crash') {
      out.push({ key: `live-crash@${f.at}`, kind: 'live', icon: '🌐', text: `The live app stopped by itself (crashed at ${stamp(f.at)}${f.sha ? `, ${live.branch ?? 'main'} @${short(f.sha)}` : ''}): ${f.why}. Restart it on the Live app tab`, since: f.at, level: 'warn', action: 'Live app', target: { to: 'live' } });
    } else out.push({ key: 'live', kind: 'live', icon: '🌐', text: `The live app failed${live.message ? `: ${live.message}` : ''}`, since: f?.at ?? live.since, level: 'warn', action: 'Live app', target: { to: 'live' } });
  }
  if (live.refresh && !live.refresh.ok && (live.status === 'running' || live.status === 'failed')) {
    out.push({ key: 'live-refresh', kind: 'live', icon: '🌐', text: `Live app can't check for updates: ${live.refresh.error ?? 'unknown error'}${live.sha ? ` (running ${live.branch ?? 'main'} @${short(live.sha)}${live.commitAt ? ` from ${stamp(live.commitAt)}` : ''})` : ''}`, since: live.refresh.at, level: 'info', action: 'Live app', target: { to: 'live' } });
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

/** Which live-app rows reach the notification channels (Teams, phone push): a crash, and readiness news; once each, by key. */
export const liveNotifies = (key: string) => key.startsWith('live-crash@') || key.startsWith('live-ready:') || key.startsWith('live-unready:');
