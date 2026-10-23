// How fast the 🌐 Live app tab's app followed main, and the two settings that change it: "Updated in 9 s
// (hot reload)" or "Updated in 41 s (restart: domain model changed)", each phase's time on hover, the merges
// one update brought in, and (admins) Hot reload and Keep warm (server/liveapp/prefs.ts, warm.ts). The words
// are shared/liveapp/speed.ts's; this only draws them.

import type { Net } from '../../net';
import type { LiveAppState } from '../../../shared/protocol';
import { phaseLine, updateLine } from '../../../shared/liveapp/speed';
import { h } from '../dom';
import './speed.css';

const short = (sha?: string) => sha?.slice(0, 7) ?? '';

/** The timing line and the settings, or null when there's nothing to say. */
export function speedRow(s: LiveAppState, net: Net, admin: boolean): HTMLElement | null {
  const u = s.lastUpdate;
  const line = updateLine(u);
  const phases = phaseLine(u);
  const brought = u?.included?.length ? `\nAlso brought in: ${u.included.map((c) => `${short(c.sha)} ${c.subject ?? ''}`.trim()).join('; ')}` : '';
  const timing = line ? h('span.ls-time', { class: `ls-time ${u!.ok ? '' : 'bad'}`, title: `${phases}${brought}` }, `⚡ ${line}`) : null;
  const built = s.served?.built ? h('span.ls-built', { title: 'The commits since change no app files (docs, journals and the like), so the running build is this commit’s app too' }, `build of ${short(s.served.built)}`) : null;
  const p = s.prefs;
  const box = (key: 'hotReload' | 'keepWarm', label: string, tip: string) =>
    h(
      'label.ls-pref',
      { title: tip },
      h('input', { type: 'checkbox', checked: !!p?.[key], onchange: (e: Event) => net.send({ t: 'liveapp.prefs', [key]: (e.target as HTMLInputElement).checked }) }),
      ` ${label}`,
    );
  const prefs =
    admin && p
      ? h(
          'span.ls-prefs',
          {},
          box('hotReload', 'Hot reload', 'Page, microflow, nanoflow and theme changes go into the running app in place (about 10 s instead of a restart); a domain model, enumeration, security or Java change still restarts, and so does a hot reload that fails. Takes effect at the next start or restart.'),
          box('keepWarm', 'Keep warm', 'Start the live app when the office starts, so nobody waits for a cold start. It holds about 1.5–2 GB of memory while it runs; it is skipped when the computer has less free.'),
        )
      : null;
  if (!timing && !built && !prefs) return null;
  return h('div.ls-row', {}, timing, built, prefs);
}
