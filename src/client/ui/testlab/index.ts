// 🧪 Test mode, the page (/lite?tab=tests; the ☰ and the home page link here, ⚙️ Settings › Testing
// too): what test mode is and whether this office is in it, the suites (unit tests, page
// responsiveness, the end-to-end journey, the Command Center check) with their last run, a ▶ Run for
// each that runs it against a throwaway test office (server/testlab/, never this office), the run going
// with its progress and log, the history, and a run's details (ui/testlab/details.ts). Admins only.
// It polls once a second only while a run is going, the tab is on it and the window is visible, and
// draws a part again only when what it shows changed.

import './ui.css';
import { SUITE_LABEL, type RunResult, type RunSummary, type TestLabView, type TestSuite } from '../../../shared/testlab';
import { h, toast } from '../dom';
import { runDetails } from './details';
import { profilePart } from './profile';
import { hideTip } from './charts';
import { duration, MAX_ROWS, STATUS_WORD, tailLines, viewKey } from './logic';

export interface TestLabPage {
  show(): void;
  hide(): void;
}

const POLL_MS = 1000;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}
const post = <T>(url: string, body: unknown) => json<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const when = (t: number | undefined) => (t ? new Date(t).toLocaleString() : '–');
const status = (s: RunSummary['status']) => h('span.tl-status', { class: s }, STATUS_WORD[s]);

/** What test mode is, in a few lines (the page's top and ⚙️ Settings › Testing say the same). */
export function testModeIntro(mode: { on: boolean; why?: string }): HTMLElement {
  return h(
    'div.tl-intro',
    {},
    h('p', {}, h('span.tl-mode', { class: mode.on ? 'on' : 'off' }, mode.on ? 'This office is in test mode' : 'This office is not in test mode'), mode.on && mode.why ? ` (${mode.why}).` : '.'),
    h(
      'p.tl-note',
      {},
      'In test mode no real agent CLI (claude, codex, opencode…) starts: only the fake agent the office was started with (--agent). It is on with --test-mode or AGENT_OFFICE_TEST_MODE=1, and by itself for an office under scratch/test-offices or a test-office… folder. The runs on this page never use this office: each starts a throwaway test office of its own, in test mode with a fake agent, and stops it afterwards. A run spends nothing.',
    ),
  );
}

export function testlabView(root: HTMLElement): TestLabPage {
  const intro = h('div.tl-part');
  const suites = h('div.tl-part');
  const going = h('div.tl-part');
  const history = h('div.tl-part');
  const details = h('div.tl-part.tl-details');
  root.replaceChildren(h('div.tl-page', {}, h('h2.lite-h', {}, '🧪 Test mode'), intro, suites, going, details, history));

  let shown = false;
  let view: TestLabView | undefined;
  let key = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let picked = new URLSearchParams(location.search).get('run') ?? undefined;
  let detailsKey = '';
  let log = { id: '', next: 0, text: '' };
  const logBox = h('pre.tl-log', { 'aria-live': 'off' });
  const bar = h('div.tl-progress-bar');
  const barLabel = h('span.tl-note');

  const draw = () => {
    if (!view) return;
    const v = view;
    intro.replaceChildren(...[testModeIntro(v.testMode), v.refusal && !v.running ? h('p.tl-error', { role: 'status' }, v.refusal) : null, v.root ? h('p.tl-note', {}, `Throwaway test offices go under ${v.root}`) : null].filter((n): n is HTMLElement => !!n));
    suites.replaceChildren(
      h('h3', {}, 'Suites'),
      h(
        'table.tl-table',
        {},
        h('thead', {}, h('tr', {}, ...['Suite', 'Last run', 'Result', 'Duration', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h(
          'tbody',
          {},
          ...v.suites.map(({ suite, last }) =>
            h(
              'tr',
              {},
              h('th', { scope: 'row' }, SUITE_LABEL[suite]),
              h('td', {}, last ? h('a', { href: `?tab=tests&run=${last.id}`, onclick: (e: Event) => (e.preventDefault(), pick(last.id)) }, when(last.startedAt)) : 'Never'),
              h('td', {}, last ? status(last.status) : '–', last?.headline ? h('span.tl-note', {}, ` ${last.headline}`) : null),
              h('td', {}, duration(last?.durationMs)),
              h('td', {}, h('button.btn.small', { type: 'button', disabled: !!v.running || !!v.refusal, onclick: () => void start(suite) }, '▶ Run')),
            ),
          ),
        ),
      ),
    );
    if (v.running) {
      const r = v.running;
      const p = r.progress;
      bar.style.width = p ? `${Math.round((p.done / p.of) * 100)}%` : '4%';
      barLabel.textContent = p ? `${p.done} of ${p.of}${p.label ? `: ${p.label}` : ''}` : 'Starting…';
      if (!going.firstChild || going.dataset.run !== r.id)
        going.replaceChildren(
          h('h3', {}, `Running: ${SUITE_LABEL[r.suite]}`),
          h('div.tl-progress', { role: 'progressbar', 'aria-label': 'Progress' }, bar),
          h('div.tl-going-row', {}, barLabel, h('button.btn.small', { type: 'button', onclick: () => void stop(r.id) }, '■ Stop')),
          logBox,
        );
      going.dataset.run = r.id;
    } else if (going.firstChild) {
      going.replaceChildren();
      delete going.dataset.run;
    }
    const rows = v.history.slice(0, MAX_ROWS);
    history.replaceChildren(
      h('h3', {}, `History (${v.history.length})`),
      rows.length
        ? h(
            'ul.tl-history',
            {},
            ...rows.map((r) =>
              h(
                'li',
                { class: r.id === picked ? 'on' : '' },
                h('button.tl-hist-btn', { type: 'button', onclick: () => pick(r.id) }, status(r.status), h('b', {}, SUITE_LABEL[r.suite]), h('span.tl-note', {}, when(r.startedAt)), h('span', {}, r.headline ?? ''), h('span.tl-note', {}, duration(r.durationMs))),
              ),
            ),
          )
        : h('p.tl-note', {}, 'No runs yet: ▶ Run one above.'),
    );
  };

  /** The run to show: the one picked, else the latest pages run, else the latest. */
  const shownRun = () => (view ? (view.history.find((r) => r.id === picked) ?? view.history.find((r) => r.suite === 'pages' && r.status !== 'running') ?? view.history[0]) : undefined);

  async function drawDetails(force = false) {
    const s = shownRun();
    const k = s ? `${s.id}:${s.status}:${s.finishedAt ?? 0}:${Object.keys(s.incidents ?? {}).length}` : '';
    if (!force && k === detailsKey) return;
    detailsKey = k;
    if (!s) return void details.replaceChildren();
    try {
      const r = await json<{ run: RunSummary; result?: RunResult }>(`/api/testlab/runs/${encodeURIComponent(s.id)}`);
      if (detailsKey !== k) return;
      details.replaceChildren(h('h3', {}, 'Run details'), runDetails(r.run, r.result, { incident }));
    } catch (err) {
      details.replaceChildren(h('p.tl-error', {}, `Couldn’t load that run: ${(err as Error).message}`));
    }
  }

  async function incident(run: RunSummary, what: { view?: string; step?: string }): Promise<number | undefined> {
    try {
      const r = await post<{ incident: { number: number } }>(`/api/testlab/runs/${encodeURIComponent(run.id)}/incident`, what);
      return r.incident.number;
    } catch (err) {
      toast(`Couldn’t open the incident: ${(err as Error).message}`, 'error');
      return undefined;
    }
  }

  function pick(id: string) {
    picked = id;
    const u = new URL(location.href);
    u.searchParams.set('run', id);
    history.querySelectorAll('li').forEach((li, i) => li.classList.toggle('on', view?.history[i]?.id === id));
    window.history.replaceState(null, '', u);
    void drawDetails();
  }

  async function readLog() {
    const r = view?.running;
    if (!r) return;
    if (log.id !== r.id) log = { id: r.id, next: 0, text: '' };
    try {
      const chunk = await json<{ text: string; next: number }>(`/api/testlab/runs/${encodeURIComponent(r.id)}/log?from=${log.next}`);
      if (!chunk.text) return;
      log.next = chunk.next;
      log.text = tailLines(log.text + chunk.text);
      const atEnd = logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 8;
      logBox.textContent = log.text;
      if (atEnd) logBox.scrollTop = logBox.scrollHeight;
    } catch {
      // The next poll tries again.
    }
  }

  async function refresh() {
    timer = undefined;
    if (!shown) return;
    try {
      const v = await json<TestLabView>('/api/testlab');
      const wasRunning = view?.running?.id;
      view = v;
      const k = viewKey(v);
      if (k !== key) {
        key = k;
        draw();
      }
      if (wasRunning && !v.running) picked = wasRunning;
      await readLog();
      await drawDetails();
    } catch (err) {
      key = '';
      view = undefined;
      root.querySelector('.tl-page')?.replaceChildren(h('h2.lite-h', {}, '🧪 Test mode'), h('p.tl-error', {}, (err as Error).message));
      return;
    }
    schedule();
  }

  function schedule() {
    if (timer || !shown || !view?.running || document.hidden) return;
    timer = setTimeout(() => void refresh(), POLL_MS);
  }
  document.addEventListener('visibilitychange', () => shown && !document.hidden && view?.running && !timer && void refresh());

  async function start(suite: TestSuite) {
    try {
      const r = await post<{ run: RunSummary }>('/api/testlab/runs', { suite });
      picked = r.run.id;
      toast(`Started: ${SUITE_LABEL[suite]}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    void refresh();
  }

  async function stop(id: string) {
    try {
      await post(`/api/testlab/runs/${encodeURIComponent(id)}/stop`, {});
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    void refresh();
  }

  return {
    show() {
      if (shown) return;
      shown = true;
      if (!root.querySelector('.tl-part')) root.replaceChildren(h('div.tl-page', {}, h('h2.lite-h', {}, '🧪 Test mode'), intro, suites, going, details, history));
      void refresh();
    },
    hide() {
      shown = false;
      hideTip();
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
