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
import { renderBoard, type KanbanActions } from './ui/kanban';
import { renderAnalysis } from './ui/analysis';
import { renderSetup } from './ui/setup-panel';
import { renderSummary } from './ui/summary';
import { teamTab } from './ui/roster';
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
import { rememberView, switchView } from './graphics';
// The tab title counts the workers waiting on someone, on every floor, as the 3D office's does.
import { renderTitle } from './shared/title';
import { flatSession } from './shared/session';
import { workerActions } from './shared/workers';
import { floorPicker } from './shared/floors';
import { askedTab, followFloor, leaveForHome, setAddress } from './shared/address';
import { colorThemes } from './ui/colortheme';

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
floorPicker(net);

// ---- Workers ------------------------------------------------------------------------------------
function renderWorkers() {
  const list = byUrgency(store.workers.values());
  const ul = $('workers');
  ul.replaceChildren(...list.map(workerCard));
  if (!list.length) ul.append(h('li.lite-empty', {}, store.project ? 'Nobody is working on this floor. ✨ New task hires someone.' : 'No workers here.'));
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
          ? w.task?.summary && `✅ ${w.task.summary}`
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
// Sub-boards (ui/teams/): team tags and a team filter on the board, and a page per team on 🧩 Teams.
const teams = subBoards(
  net,
  { kanban, openWorker, openPull: kanban.openPull, liveChip: (el) => live.mountChip(el), openApprovals: () => (team.showPane('approvals'), showTab('team')) },
  () => renderKanban(),
);
net.onMessage((msg) => teams.route(msg));
// A new key since the Command Center became the first tab, so everyone starts there once rather than on the board they last had.
const TAB_KEY = 'agent-office.lite-tab2';
type Tab = 'command' | 'board' | 'workers' | 'analysis' | 'live' | 'team' | 'teams';
const isTab = (t: unknown): t is Tab => t === 'command' || t === 'board' || t === 'workers' || t === 'analysis' || t === 'live' || t === 'team' || t === 'teams';
let tab: Tab = 'command';
try {
  const saved = localStorage.getItem(TAB_KEY);
  if (isTab(saved)) tab = saved;
} catch {
  // No storage: the Command Center, as usual.
}
// A link that names the tab (?tab=team) opens on it, whatever this browser had last.
if (isTab(askedTab)) tab = askedTab;
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
  $('tab-team').classList.toggle('on', t === 'team');
  $('board').classList.toggle('hidden', t !== 'board');
  $('summary').classList.toggle('hidden', t !== 'command');
  $('setup').classList.toggle('hidden', t !== 'command');
  $('workers-view').classList.toggle('hidden', t !== 'workers');
  $('analysis-view').classList.toggle('hidden', t !== 'analysis');
  $('team-view').classList.toggle('hidden', t !== 'team');
  // The board and the analysis tables want the whole width; the list of workers keeps its column.
  document.querySelector('.lite-main')!.classList.toggle('board', t !== 'workers');
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
  void renderSetup($('setup'), store.floor ?? undefined, { net, go: (id) => net.send({ t: 'floor.go', floor: id }) });
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
$('tab-team').addEventListener('click', () => showTab('team'));
$('tab-teams').addEventListener('click', () => showTab('teams'));
store.on('floor', renderAnalysisTab);
// The project team (ui/roster/): its approvals badge stays current whichever tab is showing.
const team = teamTab($('team-view'), $('tab-team').querySelector('.ro-tab-n')!, () => tab === 'team', openWorker);
net.onMessage((msg) => team.onMessage(msg));
store.on('floor', () => team.render(store.floor ?? undefined));
for (const k of ['workers', 'issues', 'pulls', 'queue', 'project'] as const) store.on(k, renderKanban);
setInterval(renderKanban, 30_000);

$('btn-issues').addEventListener('click', () => openBoard('issues', net, boardActions()));
$('btn-pulls').addEventListener('click', () => openBoard('pulls', net, boardActions()));
$('btn-queue').addEventListener('click', () => openQueue(net, { openTerminal: openWorker }));
$('btn-new').addEventListener('click', () => sendToWorker('✨ New task'));
$('to-2d').addEventListener('click', () => switchView('2d'));

function renderNav() {
  const count = (id: string, n: number) => ($(id).querySelector('.n')!.textContent = n ? String(n) : '');
  count('btn-issues', store.issues.items.filter((i) => i.state === 'OPEN').length);
  count('btn-pulls', store.pulls.items.filter((p) => p.state === 'OPEN').length);
  count('btn-queue', store.queue.tasks.filter((t) => t.status !== 'done').length);
}
store.on('issues', renderNav);
store.on('pulls', renderNav);
store.on('queue', renderNav);

// ---- In ----------------------------------------------------------------------------------------
session.bellBefore($('to-home'));
session.start();

renderWorkers();
renderNav();
showTab(tab);

// Debug handle for quick checks from the console / headless screenshots.
(window as any).__lite = { store, net };
