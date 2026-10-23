// How fast the 🌐 Live app tab's app followed main, and the two settings that change it: "Updated in 9 s
// (hot reload)" or "Updated in 41 s (restart: domain model changed)", each phase's time on hover, the merges
// one update brought in, and "Hot reload: on (default)" with, for admins, the off switch, and Keep warm
// (server/liveapp/prefs.ts, hot-mode.ts, warm.ts). A run keeps the way it started until its next start, so
// when that differs from the setting (or memory made it restart for every change) the row says so. The
// words are shared/liveapp/speed.ts's; this only draws them.

import type { Net } from '../../net';
import type { LiveAppState } from '../../../shared/protocol';
import { phaseLine, updateLine } from '../../../shared/liveapp/speed';
import { h } from '../dom';
import './speed.css';

const short = (sha?: string) => sha?.slice(0, 7) ?? '';
const up = (s: LiveAppState) => s.status === 'starting' || s.status === 'updating' || s.status === 'running';

/** "Hot reload: on (default)", "on", "off", "off (for every project on this office)". */
export function hotWord(s: LiveAppState): string {
  const p = s.prefs;
  if (!p) return '';
  return `Hot reload: ${p.hotReload ? 'on' : 'off'}${p.hotReloadFrom === 'default' ? ' (default)' : p.hotReloadFrom === 'office' ? ' (for every project on this office)' : ''}`;
}

/** What the run under way does when it isn't what the setting says; '' when they agree (or nothing runs). */
export function hotRunWord(s: LiveAppState): string {
  const run = s.hot;
  if (!run || !up(s) || !s.prefs) return '';
  if (run.on && !s.prefs.hotReload) return 'this run keeps hot reload until its next start';
  if (!run.on && s.prefs.hotReload) return /^hot reload is off/.test(run.why ?? '') ? 'this run restarts for every change: hot reload starts with the next start' : `this run restarts for every change: ${(run.why ?? '').replace(/: this run restarts for every change$/, '')}`;
  return '';
}

/** The timing line and the settings, or null when there's nothing to say. */
export function speedRow(s: LiveAppState, net: Net, admin: boolean): HTMLElement | null {
  const u = s.lastUpdate;
  const line = updateLine(u);
  const phases = phaseLine(u);
  const brought = u?.included?.length ? `\nAlso brought in: ${u.included.map((c) => `${short(c.sha)} ${c.subject ?? ''}`.trim()).join('; ')}` : '';
  const timing = line ? h('span.ls-time', { class: `ls-time ${u!.ok ? '' : 'bad'}`, title: `${phases}${brought}` }, `⚡ ${line}`) : null;
  const built = s.served?.built ? h('span.ls-built', { title: 'The commits since change no app files (docs, journals and the like), so the running build is this commit’s app too' }, `build of ${short(s.served.built)}`) : null;
  const p = s.prefs;
  const hotTip = 'Page, microflow, nanoflow and theme changes go into the running app in place (about 10 s instead of a restart); a domain model, enumeration, security or Java change still restarts, and so does a hot reload that fails. On by default; it needs about 2 GB of free memory when the app starts, else that run restarts for every change. A change takes effect at the next start or restart.';
  const box = (key: 'hotReload' | 'keepWarm', label: string, tip: string, disabled = false) =>
    h(
      'label.ls-pref',
      { title: tip },
      h('input', { type: 'checkbox', checked: !!p?.[key], disabled, onchange: (e: Event) => net.send({ t: 'liveapp.prefs', [key]: (e.target as HTMLInputElement).checked }) }),
      ` ${label}`,
    );
  const run = hotRunWord(s);
  const runNote = run ? h('span.ls-hot-run', { title: s.hot?.why ?? '' }, run) : null;
  const prefs = p
    ? h(
        'span.ls-prefs',
        {},
        admin ? box('hotReload', hotWord(s), hotTip, p.hotReloadFrom === 'office') : h('span.ls-hot', { title: hotTip }, hotWord(s)),
        runNote,
        admin ? box('keepWarm', 'Keep warm', 'Start the live app when the office starts, so nobody waits for a cold start. It holds about 1.5–2 GB of memory while it runs; it is skipped when the computer has less free.') : null,
      )
    : null;
  if (!timing && !built && !prefs) return null;
  return h('div.ls-row', {}, timing, built, prefs);
}
