// The 1D view (/lite): the office without the 3D, for a phone or a computer the 3D office is too
// much for. The floor's board, every worker on the floor and how it's doing, the ones waiting on
// someone first; its terminal, with the keys a phone's keyboard hasn't got and a box to send it a
// prompt; and the boards and the task queue. The home page (🏠, /home) has every floor of the
// building. You're in the office as someone on the 1D view (PeerInfo.lite), not standing anywhere in it.

import { store } from './state';
import { DESK_BY_ID } from '../shared/layout';
import { isAsleep } from '../shared/status';
import type { WorkerInfo } from '../shared/protocol';
import { $, clip, closeAllModals, h, STATUS_LABEL, timeAgo, toast } from './ui/dom';
import { openBoard } from './ui/boards';
import { issuePrompt, type BoardActions } from './ui/github/prompts';
import { openIssue } from './ui/github/issue-window';
import { cards, renderBoard, type KanbanActions } from './ui/kanban';
import { renderAnalysis } from './ui/analysis';
import { workersRanking } from './ui/ranking';
import { cachedSetup, renderSetup } from './ui/setup-panel';
import { renderSummary } from './ui/summary';
import { teamTab, type Pane } from './ui/roster';
import { subBoards } from './ui/teams';
import { routePreviewMessage, usePreviewNet } from './ui/kanban-preview';
import { liveAppView } from './ui/liveapp';
import { pmConsole } from './ui/pm/console';
import { openPull } from './ui/pull';
import { openQueue } from './ui/queue';
import { openMeeting, type MeetingPreset } from './ui/meeting';
import { modelBadge, providerLabel } from './ui/provider';
import { byUrgency, waitingInOrder, waitingLabel } from './nextup';
import { waitingOnSomeone } from './notify';
import { rememberView } from './graphics';
// The tab title counts the workers waiting on someone, on every floor, as the 3D office's does.
import { renderTitle } from './shared/title';
import { flatSession } from './shared/session';
import { workerActions } from './shared/workers';
import { floorPicker } from './shared/floors';
import { askedTab, followFloor, leaveForHome, setAddress } from './shared/address';
import { colorThemes } from './ui/colortheme';
import { needsYouStrip } from './ui/needsyou';
import { firmBanner } from './ui/firm/banner';
import type { FirmFloorStatus } from '../shared/firm/engagement';
import { gitView } from './ui/git';
import type { NeedTarget } from './ui/needsyou/logic';
import { viewPicker } from './ui/viewpick';
import { flatMenu } from './shared/flatmenu';
import { tabBadges } from './ui/badge';
import { newStandup, teamAttention } from './ui/chrome-logic';
import { currentRoster, onRoster } from './ui/teams/world';

// No floor to open (or an old ?home link): the home page, where you pick one.
if (leaveForHome()) await new Promise(() => {});
// Sent here because this browser can't draw the 3D office (see noWebGL in core/scene.ts).
if (new URLSearchParams(location.search).get('why') === 'webgl') {
  history.replaceState(null, '', location.pathname);
  toast("This browser can't draw the 3D office (WebGL is off or missing), so here's the 1D view", 'warn');
}
// Here, the office opens on the 1D view next time too (see graphics.ts).
rememberView('1d');
// The 🎨 in the top bar: the Default, Dark or Terminal look (ui/colortheme.ts).
colorThemes($('theme'), $('summary'));
// The view dropdown in the top bar (ui/viewpick.ts).
$('view-pick').replaceWith(viewPicker('1d'));

const session = flatSession('/lite', (id) => openWorker(id), (m) => {
  routePreviewMessage(m);
  live.route(m);
  pm.route(m);
});
const { net } = session;
const workers = workerActions(net);
const openWorker = workers.open;
const sendToWorker = workers.send;
// The floor's app, running from main (the 🌐 Live app tab, ui/liveapp.ts).
const live = liveAppView(net, () => showTab('live'), () => tab === 'live');
// The project manager console in the middle of the project summary (ui/pm/console.ts): its live
// terminal only while the board is on screen.
const pm = pmConsole({ net, openWorker: (id) => openWorker(id), visible: () => tab === 'command' });

// ---- The floor you're on (every floor's card is on the home page, /home) -----------------------
floorPicker(net, { onGo: () => showTab('command') });

// ---- Workers ------------------------------------------------------------------------------------
// Each worker's card with its grade, the podium and the full ranking (ui/ranking/).
const ranking = workersRanking({
  root: $('workers-view'),
  list: $('workers'),
  floor: () => store.floor ?? undefined,
  card: workerCard,
  visible: () => tab === 'workers',
  emptyText: () => (store.project ? 'Nobody is working on this floor. ✨ New task hires someone.' : 'No workers here.'),
});
function renderWorkers() {
  const list = byUrgency(store.workers.values());
  ranking.render(list);
  $('waiting-now').textContent = waitingLabel(waitingInOrder(list));
  renderTitle();
}

function workerCard(w: WorkerInfo): HTMLElement {
  const desk = DESK_BY_ID.get(w.deskId);
  const waiting = waitingOnSomeone(w);
  const asleep = isAsleep(w.status);
  const badge = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort, w.usage?.model) : undefined;
  const task = w.task?.name ?? w.title ?? (w.prompt ? clip(w.prompt, 90) : undefined);
  // What it's asking, doing or did, in a line.
  const now = w.lost
    ? '🌿 Its worktree was deleted outside agent-office: open it to fix it'
    : w.status === 'needs_input'
      ? `🙋 ${w.activity ?? 'Waiting on an answer'}`
      : asleep
        ? '💤 Asleep: open it to wake it up'
        : w.status === 'done'
          ? waiting
          ? `👀 Finished, not looked at yet${w.task?.summary ? `: ${w.task.summary}` : ''}: open it to see`
          : w.task?.summary && `✅ ${w.task.summary}`
          : (w.task?.summary ?? w.activity);
  const sub = [
    w.kind === 'agent' ? `⚙️ ${providerLabel(w.provider, store.project)}${badge ? ` · ${badge}` : ''}` : '🐚 shell',
    desk && (desk.station ? `📌 ${desk.label}` : desk.label),
    w.worktree && `🌿 ${w.worktree.branch}`,
    w.pr && `🔀 PR #${w.pr.number}`,
    w.lastInput && `⌨️ ${w.lastInput.by} ${timeAgo(w.lastInput.at)}`,
  ].filter(Boolean);
  return h(
    'li.lite-worker',
    { class: `${w.status}${waiting ? ' waiting' : ''}` },
    h(
      'button.lite-card',
      { type: 'button', onclick: () => openWorker(w.id), 'aria-label': `${w.name}, ${STATUS_LABEL[w.status] ?? w.status}: open its terminal` },
      h('span.dot', { style: `background:${w.color}` }),
      h(
        'span.lite-info',
        {},
        h('span.lite-name', {}, w.name),
        task ? h('span.lite-task', {}, task) : null,
        now ? h('span.lite-now', {}, now) : null,
        h('span.lite-sub', {}, sub.join(' · ')),
      ),
      h('span.lite-state', {}, h('span.pill', { class: w.status }, STATUS_LABEL[w.status] ?? w.status), waiting && w.waitingSince ? h('small', {}, timeAgo(w.waitingSince)) : null),
    ),
    // One that's asking something is answered in its terminal, where the question is.
    asleep || w.lost || w.status === 'needs_input' ? null : h('button.btn.lite-say', { type: 'button', title: `Send ${w.name} a prompt`, 'aria-label': `Send ${w.name} a prompt`, onclick: () => workers.prompt(w.id) }, '✍️'),
  );
}

store.on('workers', renderWorkers);
store.on('project', renderWorkers);
// "3m ago" moves on by itself.
setInterval(renderWorkers, 30_000);

// ---- The boards, the queue and the meeting room -------------------------------------------------
function boardActions(): BoardActions {
  return {
    queue: (prompt, title, issue, provider, model, effort) => net.send({ t: 'queue.add', prompt, title, issue, provider, model, effort }),
    assign: (prompt, title, issue) => sendToWorker(`🤖 ${title}`, { initial: prompt }, issue),
    ask: (context, title) => sendToWorker(`✍️ ${title}`, { context }),
    // There's no desk to walk to from here: its terminal instead.
    goToDesk: (deskId) => {
      const w = store.workerAtDesk(deskId);
      if (!w) return;
      closeAllModals();
      openWorker(w.id);
    },
    meeting: (preset) => showMeeting(preset),
  };
}

function showMeeting(preset?: MeetingPreset) {
  openMeeting(
    net,
    {
      openTerminal: openWorker,
      openPr: (id) => {
        const w = store.workers.get(id);
        if (!w) return;
        const it = w.pr && store.pulls.items.find((p) => p.number === w.pr!.number);
        if (it) openPull(it, net, boardActions());
        else if (w.pr) window.open(w.pr.url, '_blank', 'noopener');
        else net.send({ t: 'worker.pr', workerId: id });
      },
    },
    preset,
  );
}

// ---- The board: the floor's pipeline from issue to merged PR (ui/kanban.ts), or the list of workers ----
const kanban: KanbanActions = {
  openWorker,
  openIssue: (it) => openIssue(it, net, boardActions()),
  openPull: (it) => openPull(it, net, boardActions()),
  start: (it) => sendToWorker(`🤖 #${it.number} ${it.title}`, { initial: issuePrompt(it) }, it.number),
  queue: (it) => {
    net.send({ t: 'queue.add', prompt: issuePrompt(it), title: it.title, issue: it.number });
    toast(`📋 #${it.number} queued: the next free agent takes it`);
  },
};
usePreviewNet(net);
// Sub-boards (ui/teams/): team tags and a team filter on the board, and a page per team on 🧩 Team boards.
const teams = subBoards(
  net,
  { kanban, openWorker, openPull: kanban.openPull, liveChip: (el) => live.mountChip(el), openApprovals: () => showTab('approvals') },
  () => renderKanban(),
);
net.onMessage((msg) => teams.route(msg));
// A new key since the Command Center became the first tab, so everyone starts there once rather than on the board they last had.
const TAB_KEY = 'agent-office.lite-tab2';
// The floor's branches as a metro map (🌳 Git, ui/git/).
const git = gitView($('git-view'), { openWorker, openPull: kanban.openPull });
type Tab = 'command' | 'board' | 'workers' | 'analysis' | 'live' | 'git' | Pane | 'teams';
// The team's four panes are tabs of their own (flattened from one Team tab); an old "team" means its org chart.
const TEAM_PANES: readonly Pane[] = ['org', 'standup', 'approvals', 'settings'];
const isPane = (t: unknown): t is Pane => TEAM_PANES.includes(t as Pane);
const isTab = (t: unknown): t is Tab => t === 'command' || t === 'board' || t === 'workers' || t === 'analysis' || t === 'live' || t === 'git' || isPane(t) || t === 'teams';
const asTab = (t: unknown): Tab | undefined => (t === 'team' ? 'org' : isTab(t) ? t : undefined);
let tab: Tab = 'command';
try {
  const saved = localStorage.getItem(TAB_KEY);
  tab = asTab(saved) ?? tab;
} catch {
  // No storage: the Command Center, as usual.
}
// A link that names the tab (?tab=team) opens on it, whatever this browser had last.
tab = asTab(askedTab) ?? tab;
followFloor();
function showTab(t: Tab) {
  tab = t;
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    // Just for this visit, then.
  }
  setAddress({ tab: t });
  teams.address(t);
  $('tab-teams').classList.toggle('on', t === 'teams');
  $('teams-view').classList.toggle('hidden', t !== 'teams');
  $('tab-command').classList.toggle('on', t === 'command');
  $('tab-board').classList.toggle('on', t === 'board');
  $('tab-workers').classList.toggle('on', t === 'workers');
  $('tab-analysis').classList.toggle('on', t === 'analysis');
  $('tab-live').classList.toggle('on', t === 'live');
  $('liveapp-view').classList.toggle('hidden', t !== 'live');
  if (t === 'live') live.render($('liveapp-view'));
  $('tab-git').classList.toggle('on', t === 'git');
  $('git-view').classList.toggle('hidden', t !== 'git');
  if (t === 'git') git.show();
  else git.hide();
  for (const p of TEAM_PANES) $(`tab-${p}`).classList.toggle('on', t === p);
  $('board').classList.toggle('hidden', t !== 'board');
  $('summary').classList.toggle('hidden', t !== 'command');
  $('setup').classList.toggle('hidden', t !== 'command');
  $('needs-you').classList.toggle('hidden', t !== 'command');
  document.querySelector('.lite-main')!.classList.toggle('on-command', t === 'command');
  $('workers-view').classList.toggle('hidden', t !== 'workers');
  $('analysis-view').classList.toggle('hidden', t !== 'analysis');
  $('team-view').classList.toggle('hidden', !isPane(t));
  if (isPane(t)) team.showPane(t);
  // Every tab takes the whole width, the workers' grid of cards too.
  document.querySelector('.lite-main')!.classList.add('board');
  if (t === 'workers') renderWorkers();
  renderKanban();
  renderAnalysisTab();
  team.render(store.floor ?? undefined);
  // Off the Command Center, the PM console lets go of its terminal.
  pm.sync();
}
/** Whatever the tab shows that follows the floor's work: the Command Center (the setup panel and the project summary with the PM console in it), the board (just the kanban), or a team's page. */
function renderKanban() {
  if (tab === 'teams') return teams.renderPage($('teams-view'));
  if (tab === 'board') return renderBoard($('board'), kanban, teams.boardView(renderKanban));
  if (tab !== 'command') return;
  void renderSummary($('summary'), store.floor ?? undefined, { middle: pm.el }).then(() => live.mountChip($('summary')));
  void renderSetup($('setup'), store.floor ?? undefined, { net, go: (id) => net.send({ t: 'floor.go', floor: id }) }).then(() => needs.refresh());
}
/** Which model does well on what (ui/analysis.ts), for this floor or every floor. */
function renderAnalysisTab() {
  if (tab === 'analysis') void renderAnalysis($('analysis-view'), store.floor ?? undefined);
}
$('tab-command').addEventListener('click', () => showTab('command'));
$('tab-board').addEventListener('click', () => showTab('board'));
$('tab-workers').addEventListener('click', () => showTab('workers'));
$('tab-analysis').addEventListener('click', () => showTab('analysis'));
$('tab-live').addEventListener('click', () => showTab('live'));
$('tab-git').addEventListener('click', () => showTab('git'));
for (const p of TEAM_PANES) $(`tab-${p}`).addEventListener('click', () => showTab(p));
$('tab-teams').addEventListener('click', () => showTab('teams'));
store.on('floor', renderAnalysisTab);
// The project team (ui/roster/): its approvals badge stays current whichever tab is showing.
const team = teamTab($('team-view'), $('tab-approvals').querySelector('.ro-tab-n')!, () => isPane(tab), openWorker, { select: (p) => showTab(p) });
net.onMessage((msg) => team.onMessage(msg));
store.on('floor', () => team.render(store.floor ?? undefined));
for (const k of ['workers', 'issues', 'pulls', 'queue', 'project'] as const) store.on(k, renderKanban);
setInterval(renderKanban, 30_000);

// ---- Needs you: what's blocked on you, at the top of the Command Center, counted on its tab ---------
/** An escalation's card on the PM console, scrolled to with its answer box focused; the Approvals tab if it isn't there. */
function toEscalation(id: string) {
  if (tab !== 'command') showTab('command');
  const find = () => document.querySelector<HTMLElement>(`#summary:not(.hidden) .esc[data-id="${CSS.escape(id)}"]`);
  // Only as far as needed, in one go: the escalations list to the card, then the page just enough to
  // show it. A smooth scroll to the middle got thrown about by the summary redrawing around it.
  const focus = (card: HTMLElement) => {
    const list = card.closest<HTMLElement>('.esc-list');
    if (list) list.scrollTop += card.getBoundingClientRect().top - list.getBoundingClientRect().top - 40;
    card.scrollIntoView({ block: 'nearest' });
    card.querySelector<HTMLTextAreaElement>('.esc-reply')?.focus({ preventScroll: true });
    card.classList.remove('esc-flash');
    void card.offsetWidth;
    card.classList.add('esc-flash');
  };
  // The summary draws after a fetch: wait for the card (and for it to stop moving), up to a second and a half.
  const started = Date.now();
  let lastTop: number | undefined;
  const look = () => {
    const card = find();
    const top = card?.getBoundingClientRect().top;
    if (card && top === lastTop) return focus(card);
    lastTop = top;
    if (Date.now() - started < 1500) return void setTimeout(look, 100);
    if (card) focus(card);
    else showTab('approvals');
  };
  look();
}
function goToNeed(t: NeedTarget) {
  if (t.to === 'worker') return openWorker(t.id);
  if (t.to === 'firm') return location.assign(t.url);
  if (t.to === 'escalation') return toEscalation(t.id);
  if (t.to === 'approvals' || t.to === 'settings' || t.to === 'live') return showTab(t.to);
  if (t.to === 'setup') {
    if (tab !== 'command') showTab('command');
    return $('setup').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  if (t.to === 'floor') {
    // Lands on that floor's Command Center, where its Needs you says who is waiting and why.
    showTab('command');
    if (t.floor !== store.floor) net.send({ t: 'floor.go', floor: t.floor });
    return;
  }
  const it = store.pulls.items.find((p) => p.number === t.number);
  if (it) openPull(it, net, boardActions());
}
// The Firm (ui/firm/banner.ts): its audit of this floor, its report, or the button to call one.
let firmStatus: FirmFloorStatus | undefined;
const needs = needsYouStrip($('needs-you'), $('tab-command').querySelector('.ny-tab-n')!, { go: goToNeed, setup: () => cachedSetup(store.floor ?? undefined), live: () => live.current(), firm: () => firmStatus });
const firm = firmBanner($('firm-banner'), (s) => ((firmStatus = s), needs.refresh()));
store.on('floor', () => firm.refresh(store.floor ?? undefined));
net.onMessage((msg) => firm.onMessage(msg));
net.onMessage((msg) => {
  needs.onMessage(msg);
  if (msg.t === 'liveapp.state' || msg.t === 'floor.enter' || msg.t === 'welcome') needs.refresh();
});

$('btn-issues').addEventListener('click', () => openBoard('issues', net, boardActions()));
$('btn-pulls').addEventListener('click', () => openBoard('pulls', net, boardActions()));
$('btn-queue').addEventListener('click', () => openQueue(net, { openTerminal: openWorker }));
$('btn-new').addEventListener('click', () => sendToWorker('✨ New task'));
// The ☰: everything the 3D office's menu has (shared/flatmenu.ts).
flatMenu($('menu'), {
  net,
  boardActions,
  openWorker,
  meeting: () => showMeeting(),
  nextWaiting: () => {
    const w = waitingInOrder(store.workers.values())[0];
    if (w) openWorker(w.id);
    else toast('Nobody is waiting on you ✨');
  },
});

function renderNav() {
  const count = (id: string, n: number) => ($(id).querySelector('.n')!.textContent = n ? String(n) : '');
  count('btn-issues', store.issues.items.filter((i) => i.state === 'OPEN').length);
  count('btn-pulls', store.pulls.items.filter((p) => p.state === 'OPEN').length);
  count('btn-queue', store.queue.tasks.filter((t) => t.status !== 'done').length);
}
store.on('issues', renderNav);
store.on('pulls', renderNav);
store.on('queue', renderNav);

// ---- Badges on the tabs: what needs you on each, whichever tab is showing (ui/badge.ts) -----------
// The Command Center's and Approvals' counts are their own (needsYouStrip, teamTab); a tab adds one with badges.add.
const STANDUP_SEEN = 'agent-office.standup-seen';
const latestStandup = () => currentRoster()?.standups[0]?.id;
const seenStandup = () => {
  try {
    return localStorage.getItem(`${STANDUP_SEEN}.${store.floor}`);
  } catch {
    return null;
  }
};
/** On the Standup tab, the newest standup is read. */
function sawStandup() {
  const id = latestStandup();
  if (tab !== 'standup' || !id || id === seenStandup()) return;
  try {
    localStorage.setItem(`${STANDUP_SEEN}.${store.floor}`, id);
  } catch {
    // Not remembered: the dot comes back next visit.
  }
}
const badges = tabBadges();
badges.add($('tab-board'), () => cards(kanban).filter((c) => c.column === 'human').length, 'Cards that need a human');
badges.add($('tab-workers'), () => waitingInOrder(store.workers.values()).length, 'Workers waiting on someone');
badges.add($('tab-standup'), () => (sawStandup(), newStandup(latestStandup(), seenStandup()) && 'dot'), 'A new standup');
badges.add($('tab-live'), () => live.current()?.status === 'failed' && '!', "The live app failed: it isn't running");
badges.add($('tab-teams'), () => teamAttention(currentRoster()), 'Approvals and escalations from the teams');
for (const k of ['workers', 'issues', 'pulls', 'queue', 'project', 'floor'] as const) store.on(k, () => badges.refresh());
onRoster(() => badges.refresh());
net.onMessage((msg) => {
  if (msg.t === 'liveapp.state' || msg.t === 'welcome' || msg.t === 'floor.enter') badges.refresh();
});
for (const t of ['tab-standup', 'tab-live', 'tab-teams'] as const) $(t).addEventListener('click', () => badges.refresh());

// ---- In ----------------------------------------------------------------------------------------
session.bellBefore($('to-home'));
session.start();

renderWorkers();
renderNav();
showTab(tab);
needs.refresh();
firm.refresh(store.floor ?? undefined);

// Debug handle for quick checks from the console / headless screenshots.
(window as any).__lite = { store, net };
