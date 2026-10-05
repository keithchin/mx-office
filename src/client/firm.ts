// The Firm (/firm): the office's Reviewer Agents, an independent consultancy that audits a project
// from outside its team. Its people, the engagements under way (live), the past ones and their
// reports; "📑 Call an audit" opens the wizard (firm/wizard.ts); ?report=<id> opens a report
// (firm/report.ts). It follows the 1D view's color themes and loads no three.js.

import { isActive } from '../shared/firm/engagement';
import { $, h, toast } from './ui/dom';
import { colorThemes } from './ui/colortheme';
import { fetchFirm, fetchReport, reportUrl, type FirmView } from './firm/api';
import { renderEngagements } from './firm/engagements';
import { firmOffice } from './firm/office';
import { renderPeople } from './firm/people';
import { renderReport } from './firm/report';
import { openAuditWizard } from './firm/wizard';
import './home/home.css';
import './firm/firm.css';

colorThemes($('theme'));

const office = firmOffice();
let view: FirmView | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function hero(v: FirmView, away: Set<string>) {
  const live = v.engagements.filter((e) => isActive(e.phase)).length;
  $('firm-hero').replaceChildren(
    h('div.firm-hero-text', {},
      h('p.firm-kicker', {}, 'Est. inside Agent Office'),
      h('h2', {}, 'Independent review, no shared context, no bias.'),
      h('p', {}, 'The Firm\'s Reviewer Agents sit outside every project. Call an audit and the Firm attaches a reviewer to each project team: they interview the Leads, review what was built in their own read-only checkout, and the Engagement Partner delivers one report to you.'),
      h('p.firm-hero-stats', {}, h('span', {}, `👥 ${v.people.length} reviewers`), h('span', {}, `🧳 ${away.size} with a client`), h('span', {}, `📑 ${v.engagements.filter((e) => e.reportId).length} reports`), live ? h('span', {}, `⏳ ${live} under way`) : null),
    ),
    office.el,
  );
  office.handle.update(v.people, away);
}

async function load() {
  clearTimeout(timer);
  try {
    view = await fetchFirm();
  } catch (err) {
    toast((err as Error).message, 'error');
    timer = setTimeout(load, 15_000);
    return;
  }
  const away = new Set(view.engagements.filter((e) => isActive(e.phase)).flatMap((e) => e.reviewers.map((r) => r.id)));
  hero(view, away);
  renderEngagements($('firm-active'), $('firm-reports'), view, load);
  renderPeople($('firm-people'), view, away, load);
  ($('call-audit') as HTMLButtonElement).disabled = !view.admin;
  $('call-audit').title = view.admin ? 'Call an audit of a project' : 'Only the Project Manager (an admin) can call an audit';
  // Live while something runs; a slow look otherwise.
  timer = setTimeout(load, away.size ? 5000 : 30_000);
}

async function showReport(id: string) {
  for (const s of ['firm-hero', 'firm-active', 'firm-people', 'firm-reports']) $(s).classList.add('hidden');
  const root = $('firm-report');
  root.classList.remove('hidden');
  root.replaceChildren(h('p.firm-empty', {}, 'Opening the report…'));
  try {
    const [r, v] = await Promise.all([fetchReport(id), view ? Promise.resolve(view) : fetchFirm()]);
    view = v;
    renderReport(root, r, v.admin, () => {
      history.pushState(null, '', '/firm');
      showFirm();
    });
    document.title = `Audit: ${r.floorName} · The Firm`;
    scrollTo({ top: 0 });
  } catch (err) {
    root.replaceChildren(h('p.firm-empty', {}, `Couldn't open the report: ${(err as Error).message}`), h('a.btn', { href: '/firm' }, '← The Firm'));
  }
}

function showFirm() {
  $('firm-report').classList.add('hidden');
  for (const s of ['firm-hero', 'firm-active', 'firm-people', 'firm-reports']) $(s).classList.remove('hidden');
  document.title = 'The Firm · Agent Office';
  void load();
}

function route() {
  const q = new URLSearchParams(location.search);
  const report = q.get('report');
  if (report) void showReport(report);
  else showFirm();
}

$('call-audit').addEventListener('click', () => {
  if (!view) return;
  const q = new URLSearchParams(location.search);
  void openAuditWizard({ floors: view.floors, floor: q.get('floor') ?? undefined, admin: view.admin, onStarted: () => void load() });
});
addEventListener('popstate', route);
// Report links on the page change the address without a reload.
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest?.('a[href^="/firm?report="]') as HTMLAnchorElement | null;
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  history.pushState(null, '', a.getAttribute('href')!);
  route();
});
route();
// ?audit=<floor> opens the wizard straight away (the 1D view's button on a phone).
const askFloor = new URLSearchParams(location.search).get('audit');
if (askFloor) {
  void fetchFirm().then((v) => {
    view = v;
    void openAuditWizard({ floors: v.floors, floor: askFloor, admin: v.admin, onStarted: () => void load() });
  });
}

// Debug handle for quick checks from the console / headless screenshots.
(window as any).__firm = { load, showReport, reportUrl, openWizard: () => view && openAuditWizard({ floors: view.floors, admin: view.admin }) };
