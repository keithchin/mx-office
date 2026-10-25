// Home's page (start.ts mounts it into #start-view): "what needs me, and how is everything going?" across
// every client and project. Top to bottom: the title with the quick actions, the office's health strip
// (quiet when all is well), then Needs you across everything and the active projects, beside the clients
// and the recent milestones. With no projects yet it is the "Create your first project" panel instead.
//
// Cheap to draw with many projects: each section has its own box and is drawn again only when what it
// shows changed (a project row only when its own facts did, through rowSig), batched to a few times a
// second however often the socket's floors move. The projects shown are the most recently active few
// (the Projects page's own "Recent activity" order), so the per-project progress asks stay bounded.

import { store } from '../state';
import { usd } from '../../shared/budget/money';
import { ACTIVE_SHOWN, ACTIVITY_SHOWN, clientIndex, healthItems, latestActivity, liveWord, type StartProject } from '../../shared/start';
import { h } from '../ui/dom';
import { batched } from '../ui/batch';
import { activityScore, visibleProjects } from '../home/portal-logic';
import { liveUrl, liveWindowName } from '../ui/liveapp/open';
import { activityBody, card, clientsBody, healthStrip, needsBody, projectRow, rowSig } from './sections';
import { startData } from './data';
import './start.css';

export interface StartDeps {
  /** Into a project: its 1D view. */
  open(floor: string): void;
  newProject(): void;
  addProject(): void;
  /** ＋ New client (admins), from `opener`, focus going back there. */
  newClient(opener: HTMLElement): void;
}

export function startView(root: HTMLElement, deps: StartDeps) {
  const src = startData((key) => (key === 'start' ? (drawNeeds(), drawActivity(), drawProjects(), drawHealth(), drawActions()) : key === 'budget' ? (drawClients(), drawHealth(), drawProjects()) : (drawClients(), drawNeeds(), drawProjects())));
  const { data } = src;
  /** The office's data has come in over the socket (welcome): before that, no projects means "not known yet". */
  let ready = false;

  // ---- The frame ---------------------------------------------------------------------------------------
  const acts = h('div.ph-head-acts.st-quick', { role: 'group', 'aria-label': 'Quick actions' });
  const head = h('div.ph-head.st-head', {}, h('h1.ph-title', {}, 'Home'), acts);
  const health = h('div.st-health', { role: 'status', 'aria-label': 'Office health' });
  const needs = card('needs', 'Needs you, across everything');
  const projects = card('projects', 'Active projects', { href: '/home', label: 'All projects' });
  const clients = card('clients', 'Clients', { href: '/clients', label: 'All clients' });
  const activity = card('activity', 'Recent activity');
  const rows = h('ul.st-rows', { 'aria-label': 'Active projects' });
  projects.body.append(rows);
  const more = h('p.st-note');
  projects.body.append(more);
  const grid = h('div.st-grid', {}, h('div.st-col', {}, needs.el, projects.el), h('div.st-col', {}, clients.el, activity.el));
  const empty = h('div.st-empty', { hidden: true });
  root.replaceChildren(head, health, grid, empty);

  const clientOf = (floor: string) => (data.portfolios ? clientIndex(data.portfolios.portfolios).get(floor) : undefined);
  const nameOf = (floor: string) => store.floors.find((f) => f.id === floor)?.name ?? floor;
  const factsOf = (floor: string): StartProject | undefined => data.start?.projects.find((p) => p.floor === floor);
  /** The Projects page's "Recent activity" order: its spend's last active day, then what's busy now. */
  const active = () =>
    visibleProjects(store.floors, { text: '', status: 'all', sort: 'recent' }, {
      paused: () => false,
      pinned: () => false,
      activity: (id) => {
        const f = store.floors.find((x) => x.id === id);
        return activityScore(data.budget?.floors.find((b) => b.id === id)?.spark, f?.busy ?? 0, f?.waiting ?? 0);
      },
    });

  // ---- Each section ------------------------------------------------------------------------------------
  function drawNeeds() {
    needs.body.replaceChildren(...needsBody({ needs: data.start?.needs, unread: data.start?.unread, failed: data.failed.start, clientOf, nameOf }));
  }

  const drawn = new Map<string, { sig: string; el: HTMLElement }>();
  function drawProjects() {
    if (!drawEmpty()) return;
    const list = active();
    const shown = list.slice(0, ACTIVE_SHOWN);
    const els = shown.map((f) => {
      const r = { f, client: clientOf(f.id), facts: factsOf(f.id), open: deps.open };
      const sig = rowSig(r);
      const was = drawn.get(f.id);
      if (was?.sig === sig) return was.el;
      const el = projectRow(r);
      drawn.set(f.id, { sig, el });
      return el;
    });
    for (const id of [...drawn.keys()]) if (!shown.some((f) => f.id === id)) drawn.delete(id);
    // Moved, not rebuilt: only rows whose place changed are touched.
    els.forEach((el, i) => rows.children[i] !== el && rows.insertBefore(el, rows.children[i] ?? null));
    while (rows.children.length > els.length) rows.lastElementChild!.remove();
    more.textContent = list.length > shown.length ? `${shown.length} most recently active of ${list.length} projects.` : '';
    more.hidden = !more.textContent;
  }

  function drawClients() {
    clients.body.replaceChildren(...clientsBody(data.portfolios?.portfolios, data.budget, data.failed.portfolios));
  }

  function drawActivity() {
    activity.body.replaceChildren(...activityBody(data.start ? latestActivity(data.start.activity, ACTIVITY_SHOWN) : undefined, nameOf, data.failed.start));
  }

  function drawHealth() {
    const working = store.floors.reduce((n, f) => n + f.busy, 0);
    const items = healthItems({ working, today: data.budget?.today, dailyBudget: data.budget?.dailyBudget, claude: data.start?.health.claude, update: data.start?.health.update, admin: store.me.admin }, usd);
    health.replaceChildren(...healthStrip(items));
    health.classList.toggle('warn', items.some((i) => !i.ok));
  }

  function drawActions() {
    const b = (label: string, title: string, run: (el: HTMLElement) => void, primary = false) => {
      const el = h(`button.btn${primary ? '.primary' : '.ph-outline'}`, { type: 'button', title }, label);
      el.addEventListener('click', () => run(el));
      return el;
    };
    const items: HTMLElement[] = [];
    // Open live app: the most recently active project's, only when its live app is ready.
    const top = active().find((f) => !f.cloning);
    const live = top ? factsOf(top.id)?.live : undefined;
    if (top && live && liveWord(live).ready) {
      const url = liveUrl(live, location.hostname);
      if (url) items.push(h('a.btn.ph-outline.st-open-live', { href: url, target: liveWindowName(top.id), rel: 'noopener', title: `${top.name}’s app, running from main, in a window of its own` }, `Open live app · ${top.name}`));
    }
    if (store.me.admin) items.push(b('New client', 'Group a company’s projects, and point their agents at its company brain', deps.newClient));
    items.push(b('New project', 'Create a new project repository and set it up with the mxcli project toolkit, a step at a time', () => deps.newProject(), true));
    acts.replaceChildren(...items);
  }

  /** No projects (once the office has said so): the first-run panel instead of empty sections. False when it shows. */
  function drawEmpty(): boolean {
    const none = ready && store.floors.length === 0;
    grid.hidden = none;
    empty.hidden = !none;
    if (none && !empty.firstChild) {
      const create = h('button.btn.primary', { type: 'button' }, 'New project');
      create.addEventListener('click', () => deps.newProject());
      const add = h('button.btn.ph-outline', { type: 'button' }, 'Add project');
      add.addEventListener('click', () => deps.addProject());
      empty.append(
        h('h2.st-h', {}, 'Create your first project'),
        h('p', {}, 'This office has no projects yet. New project creates a Mendix app’s repository and sets it up with the mxcli project toolkit, a step at a time; Add project clones one of your repositories.'),
        h('div.ph-head-acts', {}, create, add),
      );
    }
    return !none;
  }

  const onFloors = batched(() => {
    drawProjects();
    drawHealth();
    drawActions();
  });
  store.on('floors', onFloors);
  store.on('me', () => {
    drawActions();
    drawHealth();
  });

  /** How many wait on someone across every project: when it moves, Needs you is asked again. */
  let waitingWas = -1;
  store.on('floors', () => {
    const n = store.floors.reduce((s, f) => s + f.waiting, 0) + store.floors.length * 1000;
    if (waitingWas >= 0 && n !== waitingWas) src.ask('start');
    waitingWas = n;
  });

  drawNeeds();
  drawClients();
  drawActivity();
  drawHealth();
  drawActions();
  src.all();

  return {
    /** The office's data came in (welcome): the projects are known from now on. */
    welcomed() {
      ready = true;
      drawProjects();
      drawHealth();
      drawActions();
    },
    /** A team or project change somewhere: Needs you may have moved. */
    changed() {
      src.ask('start');
    },
    data,
  };
}
