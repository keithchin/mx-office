// ⚙️ Settings' Outside, under Building: what the sky's doing, and which clock it keeps, for everyone
// (see server/sky.ts).
import type { Net } from '../net';
import { store } from '../state';
import { h } from './dom';
import { describeSky } from '../../shared/sky-words';

/**
 * The setting, made by `frame` from what goes in it: the sky now (`outside`, see describeSky), the
 * real time of day or a whole day and night every hour as buttons, and a note. Kept up to date until `off`.
 */
export function outsideSetting(net: Net, outside: { now: string; live: boolean } | undefined, frame: (body: Node[]) => HTMLElement): { section: HTMLElement; off: () => void } {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': 'The sky’s clock' });
  const now = h('p.outside-now');
  const note = h('p.setting-note');
  const paint = () => {
    const real = !!store.sky?.realTime;
    now.textContent = store.sky ? describeSky(store.sky) : (outside?.now ?? 'The office hasn’t said what the sky is doing yet.');
    const live = outside?.live ?? !!store.sky?.city;
    row.replaceChildren(
      ...[true, false].map((r) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(real === r),
            class: real === r ? 'on' : '',
            onclick: () => r !== !!store.sky?.realTime && net.send({ t: 'sky.clock', real: r }),
          },
          r ? '🕰️ Real time (24 h)' : '⏩ A day every hour',
        ),
      ),
    );
    note.textContent = `Everyone sees the same sky: ${real ? 'the real time of day' : 'a whole day and night every hour'}, and ${live ? 'the live weather where it is.' : 'weather that comes and goes. Start the office with --city to use a real city’s forecast.'}`;
  };
  paint();
  return { section: frame([now, row, note]), off: store.on('sky', paint) };
}
