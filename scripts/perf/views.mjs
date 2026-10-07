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

/** Every view, for the floor `f`. */
export function views(f) {
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
    { id: 'phone', name: 'Team phone (open)', path: lite('board'), ready: shown('#board', 10), click: '.tp-launch', readyAfter: shown('.tp-log', 1) },
    { id: 'mobile', name: 'Phone page (/m)', path: '/m', viewport: { width: 390, height: 844 }, mobile: true, ready: shown('#m-app .m-main', 5) },
  ];
}
