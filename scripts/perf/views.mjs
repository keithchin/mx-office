// The views the page-responsiveness harness opens (scripts/perf/pages.mjs): where each lives, what this
// browser had picked before (localStorage), what to click once it's up, and when it counts as usable.
// `ready` runs in the page: true once the view has drawn its main content.

/** A view's box is showing, has content, and isn't still saying it's loading. */
const shown = (sel, min = 1) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el || el.closest('.hidden') || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
  if (el.querySelectorAll('*').length < ${min}) return false;
  return !/^\\s*Loading/.test(el.textContent.slice(0, 80));
})()`;

/** Every view, for the floor `f` (and the project switches to it from `other`, when there is one). */
export function views(f, other) {
  const q = encodeURIComponent(f);
  const lite = (tab) => `/lite?floor=${q}&tab=${tab}`;
  return [
    { id: 'cc-chat', name: 'Command Center (Chat)', path: lite('command'), storage: { 'agent-office.pmc-view': 'chat' }, ready: shown('#summary .pmc', 5) },
    { id: 'cc-terminal', name: 'Command Center (Terminal)', path: lite('command'), storage: { 'agent-office.pmc-view': 'terminal' }, ready: shown('#summary .pmc', 5) },
    { id: 'board', name: 'Board', path: lite('board'), ready: shown('#board', 10) },
    { id: 'org', name: 'Team: org chart', path: lite('org'), ready: shown('#team-view', 10) },
    { id: 'standup', name: 'Team: standup', path: lite('standup'), ready: shown('#team-view', 5) },
    { id: 'approvals', name: 'Team: approvals', path: lite('approvals'), ready: shown('#team-view', 5) },
    { id: 'teams', name: 'Team boards and Deliverables', path: lite('teams'), ready: shown('#teams-view', 10) },
    { id: 'workers', name: 'Workers', path: lite('workers'), ready: shown('#workers-view', 10) },
    { id: 'budget', name: 'Budget', path: lite('budget'), ready: shown('#budget-view', 10) },
    { id: 'audit', name: 'Audit log', path: lite('audit'), storage: { 'agent-office.audit-lite.sub': 'events' }, ready: shown('#audit-view', 10) },
    { id: 'incidents', name: 'Incidents', path: lite('audit'), storage: { 'agent-office.audit-lite.sub': 'incidents' }, ready: shown('#audit-view', 10) },
    { id: 'settings', name: 'Settings', path: lite('settings'), ready: shown('#settings-view', 10) },
    { id: 'home-projects', name: 'Home: Projects', path: '/home?tab=projects', ready: shown('#projects-view', 5) },
    { id: 'home-overview', name: 'Home: Overview', path: '/home?tab=overview', ready: shown('#overview-view', 5) },
    { id: 'home-budget', name: 'Home: Budget', path: '/home?tab=budget', ready: shown('#budget-view', 5) },
    { id: 'pixel', name: '2D view', path: `/pixel?floor=${q}`, ready: `(() => { const c = document.querySelector('canvas'); return !!c && c.width > 0 && !document.querySelector('.loading:not(.hidden)'); })()` },
    { id: 'phone', name: 'Team phone (open)', path: lite('board'), ready: shown('#board', 10), steps: [{ click: '.tp-launch', ready: shown('.tp-pane-list .tp-chans', 5) }] },
    { id: 'phone-channel', name: 'Team phone: the floor channel', path: lite('board'), ready: shown('#board', 10), steps: [{ click: '.tp-launch', ready: shown('.tp-pane-list .tp-chans', 5) }, { click: `.tp-chan[data-chan="floor:${f}"]`, ready: shown('.tp-log', 5) }] },
    ...switches(f, other),
    { id: 'mobile', name: 'Phone page (/m)', path: '/m', viewport: { width: 390, height: 844 }, mobile: true, ready: shown('#m-app .m-main', 5) },
  ];
}

/** The page is on floor `f` (its picker and its line under the top bar say so) and `then` holds. */
const onFloor = (f, then) => `(() => document.querySelector('#floor')?.value === ${JSON.stringify(f)} && (document.querySelector('#floor-meta')?.textContent ?? '').includes(${JSON.stringify(f)}) && ${then})()`;

/** Switching to the big floor `f` from `other`: the 1D view's Board and Command Center, the 2D view, and Home → a project. */
export function switches(f, other) {
  if (!other) return [];
  const q = encodeURIComponent(f);
  const from = (page, tab) => `/${page}?floor=${encodeURIComponent(other)}${tab ? `&tab=${tab}` : ''}`;
  const pick = (ready) => [{ select: '#floor', value: f, ready, switch: true }];
  return [
    { id: 'switch-1d-board', name: 'Switch project: 1D Board', path: from('lite', 'board'), soak: 3, ready: shown('#board', 5), steps: pick(onFloor(f, shown('#board', 10))) },
    { id: 'switch-1d-command', name: 'Switch project: 1D Command Center', path: from('lite', 'command'), soak: 3, ready: shown('#summary .pmc', 5), steps: pick(onFloor(f, shown('#summary .pmc', 5))) },
    { id: 'switch-2d', name: 'Switch project: 2D view', path: from('pixel'), soak: 3, ready: `(() => !!document.querySelector('canvas'))()`, steps: pick(onFloor(f, `!!document.querySelector('canvas')`)) },
    { id: 'switch-home', name: 'Home → open a project', path: '/home?tab=projects', soak: 3, ready: shown('#projects-view', 5), steps: [{ click: `#projects-view a[href="/lite?floor=${q}"]`, nav: '/lite', ready: shown('#summary .pmc', 5), switch: true }] },
  ];
}
