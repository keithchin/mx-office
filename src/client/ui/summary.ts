// The project summary on the 2D view: a compact panel above the board saying what's happening on the
// floor (GET /api/summary): a few plain sentences, where the project stands, how far along it is,
// who's on what, who needs a human, what's in the way, and the latest things that happened. Also the
// one line a floor's card on the home page shows (summaryLine).

import { oneLine, type ActivityItem, type ProjectSummary, type SummaryAgent } from '../../shared/summary';
import { h, timeAgo } from './dom';
import './summary.css';

/** How long a fetched summary is reused (summaryLine, and redraws close together). */
const FRESH_MS = 20_000;
const cache = new Map<string, { at: number; s: Promise<ProjectSummary> }>();

function fetchSummary(floor: string, fresh = false): Promise<ProjectSummary> {
  const hit = cache.get(floor);
  if (hit && !fresh && Date.now() - hit.at < FRESH_MS) return hit.s;
  const s = fetch(`/api/summary?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' }).then(async (res) => {
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
    return (await res.json()) as ProjectSummary;
  });
  cache.set(floor, { at: Date.now(), s });
  s.catch(() => cache.delete(floor));
  return s;
}

/** A floor card's one line on the home page: "Stage 3 · 2 agents working · 🙋 1 needs you · 3 PRs open". Empty when it can't say. */
export async function summaryLine(floor: string): Promise<string> {
  try {
    return oneLine(await fetchSummary(floor));
  } catch {
    return '';
  }
}

const mins = (ms: number) => (ms < 90 * 60_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : `${(ms / 3_600_000).toFixed(1)} h`);
const usd = (n: number) => `$${n.toFixed(2)}`;

const ICON: Record<ActivityItem['kind'], string> = {
  started: '▶️',
  finished: '🏁',
  needs: '🙋',
  'pr-opened': '🔀',
  'pr-merged': '✅',
  'pr-closed': '✖️',
  approved: '👍',
  'issue-opened': '📌',
  'issue-closed': '☑️',
  team: '👥',
};

/**
 * Draws the panel for `floor` into `root`; call it again to refresh (it reuses a summary fetched moments ago). Never throws.
 * `middle` is a column of the caller's to keep between the details and the recent activity (the 1D view's
 * project manager console, ui/pm/console.ts): it's moved, never redrawn, so what's typed in it survives.
 * `after` is kept the same way, last (the 💬 Team chatter, ui/chatter/, or the Portal Overview's right
 * column, ui/portal/overview.ts), so its scroll stays put. Resolves with the summary it drew.
 */
export async function renderSummary(root: HTMLElement, floor: string | undefined, opts: { fresh?: boolean; middle?: HTMLElement; after?: HTMLElement } = {}): Promise<ProjectSummary | undefined> {
  root.classList.add('sm');
  if (!floor) return void root.replaceChildren();
  let s: ProjectSummary;
  try {
    s = await fetchSummary(floor, opts.fresh);
  } catch (err) {
    columns(root, opts.middle, [h('p.sm-error', {}, `Couldn't load the project summary: ${(err as Error).message}`)], [], opts.after);
    return;
  }
  columns(root, opts.middle, [h('div.sm-main', {}, head(s), narrative(s), callouts(s), progress(s), agents(s.agents))], [activity(s.activity)], opts.after);
  return s;
}

/** Puts `before`, `middle`, `after` and `last` in `root`, replacing what was round `middle` and `last` without taking them out of the page (that would drop focus and scroll). */
function columns(root: HTMLElement, middle: HTMLElement | undefined, before: HTMLElement[], after: HTMLElement[], last?: HTMLElement) {
  if (!middle && !last) return root.replaceChildren(...before, ...after);
  for (const c of [...root.children]) if (c !== middle && c !== last) c.remove();
  if (middle && middle.parentElement !== root) (last?.parentElement === root ? last.before(middle) : root.append(middle));
  if (last && last.parentElement !== root) root.append(last);
  if (middle) {
    middle.before(...before);
    middle.after(...after);
  } else last!.before(...before, ...after);
}

function head(s: ProjectSummary): HTMLElement {
  return h(
    'header.sm-head',
    {},
    h('div.sm-name', {}, h('h2', {}, `📍 ${s.name}`), s.repo ? h('span.sm-repo', {}, s.repo) : null),
    s.goal ? h('p.sm-goal', { title: `From ${s.goalFrom}` }, s.goal) : null,
    s.phase ? phase(s.phase) : null,
  );
}

function phase(p: NonNullable<ProjectSummary['phase']>): HTMLElement {
  const label = p.label.replace(/\*\*/g, '');
  return h(
    'div.sm-phase',
    {},
    h('span.sm-phase-label', { title: `From ${p.from}` }, `🧭 ${label}`),
    p.stages.length
      ? h('span.sm-stages', {}, ...p.stages.filter((st) => /^[P0-9]$/.test(st.id)).map((st) => h(`span.sm-stage.${st.status.toLowerCase()}`, { title: `${st.title}: ${st.status}${st.detail ? ` — ${st.detail}` : ''}` }, st.id)))
      : null,
    p.decisions.length ? h('span.sm-decisions', { title: p.decisions.map((d) => `${d.stage}: ${d.decision} (${d.status})`).join('\n') }, `${p.decisions.length} decision${p.decisions.length === 1 ? '' : 's'}`) : null,
  );
}

function narrative(s: ProjectSummary): HTMLElement {
  const by = h('span.sm-by', { title: s.narrativeBy === 'llm' ? 'Written by the analyzer (Claude Haiku) from the facts below only' : 'From a template: the analyzer is busy or unavailable' }, s.narrativeBy === 'llm' ? 'AI' : 'auto');
  return fold('story', h('span.sm-story-h', {}, "What's happening", by), [h('p', {}, s.narrative)], 'sm-story');
}

function callouts(s: ProjectSummary): HTMLElement | null {
  const items: HTMLElement[] = [];
  if (s.needsHuman.count) items.push(h('li.sm-risk.bad', { title: `${s.needsHuman.count} agent(s) need a human` }, `🙋 ${s.needsHuman.count} agent${s.needsHuman.count === 1 ? ' needs' : 's need'} a human — longest wait ${mins(s.needsHuman.longestMs)}`));
  for (const r of s.risks) items.push(h(`li.sm-risk.${r.level}`, { title: r.text }, `${r.level === 'bad' ? '⛔' : '⚠️'} ${r.text}`));
  return items.length ? h('ul.sm-risks', { 'aria-label': 'Needs attention' }, ...items) : null;
}

function bar(label: string, done: number, total: number, text: string): HTMLElement {
  const share = total ? Math.round((done / total) * 100) : 0;
  return h(
    'div.sm-bar',
    { title: text },
    h('span.sm-bar-l', {}, label),
    h('span.sm-track', { role: 'progressbar', 'aria-valuenow': String(share), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': label }, h('span.sm-fill', { style: `width:${share}%` })),
    h('span.sm-bar-n', {}, text),
  );
}

function progress(s: ProjectSummary): HTMLElement {
  const p = s.progress;
  const closed = `${p.issuesClosed}${p.issuesClosedCapped ? '+' : ''}`;
  const merged = `${p.prsMerged}${p.prsMergedCapped ? '+' : ''}`;
  const bars = h(
    'div.sm-progress',
    {},
    bar('Issues', p.issuesClosed, p.issuesClosed + p.issuesOpen, `${closed} closed · ${p.issuesOpen} open`),
    bar('Pull requests', p.prsMerged, p.prsMerged + p.prsOpen, `${merged} merged · ${p.prsOpen} open`),
    bar('Queue', p.done, p.done + p.running + p.queued, `${p.done} done · ${p.running} running · ${p.queued} queued`),
    h('div.sm-spend', {}, `💰 ${usd(s.spend.today)} today · ${usd(s.spend.total)} all told on this floor`),
  );
  return fold('progress', h('span.sm-sub', {}, 'Progress', h('small.sm-fold-note', {}, ` · ${usd(s.spend.today)} today`)), [bars]);
}

function agents(list: SummaryAgent[]): HTMLElement {
  const order = (a: SummaryAgent) => (a.status === 'needs_input' ? 0 : a.status === 'working' ? 1 : 2);
  const sorted = [...list].sort((a, b) => order(a) - order(b));
  const shown = sorted.slice(0, 6);
  const rows = list.length
    ? h(
        'ul',
        {},
        ...shown.map((a) =>
          h(
            `li.sm-agent.${a.status}`,
            {},
            h('span.dot', { style: `background:${a.color}` }),
            h('b', {}, a.name),
            a.model ? h('small', {}, a.model) : null,
            h('span.sm-doing', {}, a.doing),
            a.waitingMs !== undefined ? h('span.sm-wait', {}, `waiting ${mins(a.waitingMs)}`) : null,
          ),
        ),
        sorted.length > shown.length ? h('li.sm-more', {}, `+ ${sorted.length - shown.length} more`) : null,
      )
    : h('p.sm-none', {}, 'No agents on this floor.');
  return fold('agents', h('span.sm-sub', {}, `Agents (${list.length})`), [rows], 'sm-agents');
}

/** Recent activity rows shown before "More". */
export const ACTIVITY_SHOWN = 8;
/** Whether "More" was pressed: every row until "Fewer" (this visit). */
let activityAll = false;

function activity(items: ActivityItem[]): HTMLElement {
  const shown = activityAll ? items : items.slice(0, ACTIVITY_SHOWN);
  const row = (a: ActivityItem) => h(`li.${a.kind}`, {}, h('span.sm-ico', { 'aria-hidden': 'true' }, ICON[a.kind]), h('span.sm-text', {}, a.text), h('time', { datetime: new Date(a.at).toISOString() }, timeAgo(a.at)));
  const list = h('ol', {}, ...shown.map(row));
  const more =
    items.length > ACTIVITY_SHOWN
      ? h(
          'button.sm-more-btn',
          {
            type: 'button',
            'aria-expanded': String(activityAll),
            onclick: (e: Event) => {
              activityAll = !activityAll;
              list.replaceChildren(...(activityAll ? items : items.slice(0, ACTIVITY_SHOWN)).map(row));
              const b = e.currentTarget as HTMLButtonElement;
              b.textContent = activityAll ? 'Fewer ▴' : `More (${items.length - ACTIVITY_SHOWN}) ▾`;
              b.setAttribute('aria-expanded', String(activityAll));
            },
          },
          activityAll ? 'Fewer ▴' : `More (${items.length - ACTIVITY_SHOWN}) ▾`,
        )
      : null;
  const body: HTMLElement[] = items.length ? (more ? [list, more] : [list]) : [h('p.sm-none', {}, 'Nothing yet.')];
  return h('aside.sm-activity', {}, fold('activity', h('span.sm-sub', {}, 'Recent activity'), body));
}

// ---- Folding: each section of the Command Center's summary opens and closes, and this browser remembers it ----
const FOLD_KEY = 'agent-office.cc-fold';

function foldState(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/**
 * A section that folds: `key` is what's remembered (folded: true). Open unless folded before. Its
 * heading is a button; its body is a frame of its own, which scrolls inside itself (subtly) when the
 * Command Center gives it less room than it needs (ui/command-layout.css), never the column round it.
 */
function fold(key: string, head: HTMLElement, body: HTMLElement[], cls = ''): HTMLElement {
  const open = !foldState()[key];
  const frame = h('div.sm-fold-body', { hidden: !open }, ...body);
  const btn = h('button.sm-fold-h', { type: 'button', 'aria-expanded': String(open) }, head);
  const el = h('section.sm-fold', { class: `${cls}${open ? '' : ' sm-folded'}`, 'data-fold': key }, btn, frame);
  btn.addEventListener('click', () => {
    const now = frame.hidden;
    frame.hidden = !now;
    btn.setAttribute('aria-expanded', String(now));
    el.classList.toggle('sm-folded', !now);
    const st = foldState();
    if (now) delete st[key];
    else st[key] = true;
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(st));
    } catch {
      // Only this visit.
    }
  });
  return el;
}
