// ⏸ Pause and ▶ Resume a project from the phone (server/project-run/ through /api/m/act). Pause is confirmed
// first. Resume shows a compact version of the desktop preview (GET /api/project-run/preview): who has
// work waiting and why, who's already awake, the cost line, and "those with work" by default (or
// everyone asleep). Both are risky (confirm.ts): a second tap, and a sign-in within the last 10 minutes.

import { chosen, estimateLine, type ResumeChoice, type ResumePreview } from '../../shared/project-run';
import type { ProjectStatus } from '../../shared/mobile';
import { h, openModal, toast } from '../ui/dom';
import { act } from './confirm';

const ACTION_WORD = { wake: 'wakes', rehire: 'hired again from its handoff', 'send-home': 'sent home', skip: 'left asleep' } as const;

export async function pauseProject(p: Pick<ProjectStatus, 'floor' | 'name' | 'working' | 'asking'>): Promise<boolean> {
  const busy = p.working + p.asking;
  const r = await act(
    { do: 'pause', floor: p.floor },
    { title: `Pause ${p.name}?`, detail: `Every agent finishes its current turn, writes a handoff note and goes to sleep${busy ? ` (${busy} at work now)` : ''}. The office sends the floor none of its own prompts until you resume it. One asking you in its terminal is left waiting on you.`, label: `⏸ Pause ${p.name}` },
  );
  return !!r;
}

async function fetchPreview(floor: string): Promise<ResumePreview> {
  const r = await fetch(`/api/project-run/preview?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin', cache: 'no-store' });
  const j = (await r.json().catch(() => ({}))) as ResumePreview & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `The office said ${r.status}`);
  return j;
}

/** The preview as a sheet; resolves true once a resume was started. */
export async function resumeProject(p: Pick<ProjectStatus, 'floor' | 'name'>): Promise<boolean> {
  let preview: ResumePreview;
  try {
    preview = await fetchPreview(p.floor);
  } catch (err) {
    toast(`Couldn't look at ${p.name}: ${(err as Error).message}`, 'warn');
    return false;
  }
  return new Promise((resolve) => {
    let choice: ResumeChoice = { mode: 'work' };
    let done = false;
    const body = h('div.body.m-resume');
    const go = h('button.btn.primary', { type: 'button' }, '▶ Resume');
    const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      modal.close();
      resolve(v);
    };
    const modal = openModal(h('div.modal.m-sheet', { role: 'dialog', 'aria-label': `Resume ${p.name}` }, h('header', {}, h('h2', {}, `▶ Resume ${p.name}`), close), body, h('footer', {}, h('button.btn', { type: 'button', onclick: () => finish(false) }, 'Cancel'), go)), {
      doing: '📱 resuming a project',
      onClose: () => !done && ((done = true), resolve(false)),
    });
    close.addEventListener('click', () => finish(false));
    const paint = () => {
      const picked = chosen(preview, choice);
      const keys = new Set(picked.map((x) => x.agent));
      go.textContent = picked.length ? `▶ Resume · ${picked.length}` : '▶ Resume';
      go.toggleAttribute('disabled', !picked.length || !!preview.blocked);
      body.replaceChildren(
        preview.blocked ? h('p.m-warn', {}, `💸 ${preview.blocked}`) : '',
        ...preview.warnings.map((w) => h('p.m-warn', {}, `⚠️ ${w}`)),
        h(
          'div.m-seg',
          { role: 'group', 'aria-label': 'Who to wake' },
          h('button.m-seg-b', { type: 'button', 'aria-pressed': String(choice.mode === 'work'), onclick: () => ((choice = { mode: 'work' }), paint()) }, 'Those with work'),
          h('button.m-seg-b', { type: 'button', 'aria-pressed': String(choice.mode === 'all'), onclick: () => ((choice = { mode: 'all' }), paint()) }, 'Everyone asleep'),
        ),
        h('p.m-cost', {}, `💸 ${estimateLine(picked.length)}${picked.length > preview.pacing.concurrent ? `, ${preview.pacing.concurrent} at a time, ${preview.pacing.gapSec}s apart` : ''}`),
        preview.agents.length
          ? h(
              'ul.m-wake',
              {},
              ...preview.agents.map((a) => {
                const action = picked.find((x) => x.agent === a)?.action ?? 'skip';
                return h(
                  'li',
                  { class: keys.has(a) ? 'm-wake-on' : 'm-wake-off' },
                  h('div.m-wake-h', {}, h('b', {}, a.name), h('small.m-dim', {}, ` ${a.title} · ${a.state}`), h('span.m-chip', { class: keys.has(a) ? 'm-chip-here' : '' }, ACTION_WORD[action])),
                  a.reasons.length ? h('ul.m-reasons', {}, ...a.reasons.slice(0, 3).map((r) => h('li', {}, r.text))) : h('p.m-dim', {}, 'No work waiting.'),
                  ...a.checks.map((c) => h('p.m-warn.m-check', {}, `⚠️ ${c.text}`)),
                );
              }),
            )
          : h('p.m-dim', {}, 'Nobody on this floor is asleep.'),
        preview.awake.length ? h('p.m-dim', {}, `Already awake, left as they are: ${preview.awake.join(', ')}.`) : '',
        h('p.m-dim', {}, 'To pick agents one by one, use the Resume preview on a computer.'),
      );
    };
    go.addEventListener('click', async () => {
      const n = chosen(preview, choice).length;
      done = true;
      modal.close();
      const r = await act({ do: 'resume', floor: p.floor, choice }, { title: `Resume ${p.name}?`, detail: `${estimateLine(n)}: they pick up their handoff notes and carry on. Their turns cost money.`, label: `▶ Resume ${n}` });
      resolve(!!r);
    });
    paint();
  });
}
