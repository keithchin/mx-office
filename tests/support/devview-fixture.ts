// A made-up project with the shape of a real one the Developer view must handle (no real names or data):
// nested folders in the model, ~20 pages of which most come from Marketplace modules (one flagged only by
// its App Store id), modules without records, page titles in two languages; and many documents: versions
// (v1/v2, dated gate checks, dated standups), review rounds in dated folders with their report, BRD source
// data next to the BRD report, a storyboard, wireframes and a prototype of the same screens with
// PAGE-MAP.tsv, design tokens linked by the wireframes, a document in two formats, a renamed document, a
// draft, and documents nothing relates to. Committed over several days by different people, with the files'
// times on disk set to something else entirely, so a test can tell git dates from file times.
import { execFileSync } from 'node:child_process';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { project, type MadeUnit } from './mendix.js';

const text = (en: string) => ({ $Type: 'Texts$Text', Items: [3, { $Type: 'Texts$Translation', LanguageCode: 'nl_NL', Text: `NL ${en}` }, { $Type: 'Texts$Translation', LanguageCode: 'en_US', Text: en }] });
const page = (name: string, title?: string, url?: string) => ({ $Type: 'Forms$Page', Name: name, ...(title ? { Title: text(title) } : {}), ...(url ? { Url: url } : {}) });
const flow = (name: string) => ({ $Type: 'Microflows$Microflow', Name: name, ObjectCollection: { $Type: 'Microflows$MicroflowObjectCollection', Objects: [3] }, Flows: [3] });
const entity = (name: string) => ({ $ID: name, $Type: 'DomainModels$EntityImpl', Name: name, Location: '10;10', Attributes: [3] });
const domain = (...names: string[]) => ({ $Type: 'DomainModels$DomainModel', Entities: [3, ...names.map(entity)], Associations: [3], Annotations: [3] });
const module = (name: string, market: Record<string, unknown> = {}) => ({ $Type: 'Projects$ModuleImpl', Name: name, ...market });
const folder = (name: string) => ({ $Type: 'Projects$Folder', Name: name });

/** The model: 5 app pages (in nested folders) and 16 Marketplace pages. */
export function fixtureUnits(extraPage = false): MadeUnit[] {
  let n = 1;
  const units: MadeUnit[] = [{ n: n++, container: 1, hash: 'proj', doc: { $Type: 'Projects$Project' } }];
  const add = (container: number, doc: Record<string, unknown>, hash?: string) => {
    const id = n++;
    units.push({ n: id, container, hash: hash ?? `h${id}`, doc: doc as MadeUnit['doc'] });
    return id;
  };
  // The app's own module: folders Inspections › Forms and Approvals.
  const app = add(1, module('FieldOps'));
  add(app, domain('Inspection', 'Step', 'Approval'));
  const insp = add(app, folder('Inspections'));
  const forms = add(insp, folder('Forms'));
  const approvals = add(app, folder('Approvals'));
  add(insp, page('Inspection_Overview', 'My inspections', 'my-inspections'));
  add(forms, page('Inspection_NewEdit', 'New inspection'));
  add(forms, page('Inspection_View', 'Inspection details'));
  add(approvals, page('Approval_Queue', 'Approvals', 'approvals'));
  add(insp, flow('ACT_Inspection_Submit'));
  add(approvals, flow('ACT_Approval_Approve'));
  if (extraPage) add(approvals, page('Approval_History', 'Approval history', 'history'), 'extra');
  // A template module: one page without a title, a domain model with no records.
  const first = add(1, module('MyFirstModule'));
  add(first, domain());
  add(first, page('Home_Web'));
  // Marketplace: flagged by FromAppStore, or only by its App Store id (never by name).
  const admin = add(1, module('Administration', { FromAppStore: true, AppStoreVersion: '4.3.2', AppStoreGuid: 'g-admin' }));
  add(admin, domain('Account'));
  const um = add(admin, folder('User Management'));
  const adm = add(um, folder('Admin'));
  for (const p of ['Account_Overview', 'Account_NewEdit', 'Account_Password', 'MyAccount', 'ActiveSessions', 'RuntimeInstances', 'Statistics', 'ScheduledEvents', 'Logins']) add(adm, page(p, p.replace(/_/g, ' ')));
  add(admin, flow('ChangePassword'));
  const fb = add(1, module('FeedbackModule', { FromAppStore: false, AppStoreGuid: 'g-feedback', AppStoreVersion: '' }));
  add(fb, domain('Feedback'));
  const use = add(fb, folder('USE_ME'));
  for (const p of ['Feedback_Form', 'Feedback_Thanks', 'Feedback_Error', 'Feedback_Popup', 'Feedback_Admin', 'Feedback_Settings']) add(use, page(p, p.replace(/_/g, ' ')));
  const atlas = add(1, module('Atlas_Core', { FromAppStore: true, AppStoreVersion: '4.1.3' }));
  add(atlas, domain());
  add(atlas, page('Atlas_Default'));
  return units;
}

export interface Fixture {
  dir: string;
  /** Commits, oldest first. */
  shas: string[];
  head: string;
  /** A commit that has documents but no Mendix project yet. */
  noModel: string;
  /** When each commit was made (s). */
  times: number[];
}

const DAY = 86_400;
const T0 = 1_760_600_000; // mid-October 2025, a fixed moment

function put(dir: string, p: string, body: string | Buffer) {
  const f = path.join(dir, p);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, body);
  // A time on disk unlike any commit's: a date must never come from it.
  utimesSync(f, new Date('2001-02-03T04:05:06Z'), new Date('2001-02-03T04:05:06Z'));
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** Builds the fixture's repository in `root/repo`. */
export async function makeFixture(root: string): Promise<Fixture> {
  const dir = path.join(root, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  git('config', 'user.email', 'team@example.test');
  git('config', 'user.name', 'Team');
  const shas: string[] = [];
  const times: number[] = [];
  const commit = (msg: string, who: string, day: number) => {
    const t = T0 + day * DAY;
    git('add', '-A');
    execFileSync('git', ['commit', '-qm', msg], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: `${who.toLowerCase()}@example.test`, GIT_AUTHOR_DATE: `${t} +0000`, GIT_COMMITTER_DATE: `${t} +0000` } });
    shas.push(git('rev-parse', 'HEAD'));
    times.push(t);
  };
  // Day 0: documents only (no Mendix project yet).
  put(dir, 'PROJECT.md', '# Project record\n');
  put(dir, 'intake.md', '# Intake\n');
  put(dir, 'analysis/F001-visit-log.brd.json', '{"id":"F001"}');
  put(dir, 'analysis/brd-report.html', '<html><body><h1>BRD report</h1></body></html>');
  put(dir, 'design/brand-v1.md', '---\nstatus: draft\n---\n# Brand\n');
  put(dir, 'architecture/build-plan-old.md', '# Build plan\n\nPhase 1.\n');
  commit('Intake and BRD', 'Ada', 0);
  const noModel = shas[0];
  // Day 1: the app, design.
  await project(dir, fixtureUnits());
  put(dir, 'design/ds.css', ':root { --brand: #264ae5; }\n');
  put(dir, 'design/design-system.html', '<link rel="stylesheet" href="ds.css"><h1>Design system</h1>');
  put(dir, 'design/storyboard.html', '<h1>Storyboard</h1><img src="storyboard/01-Inspection_Overview.png"><img src="storyboard/02-Inspection_NewEdit.png">');
  put(dir, 'design/storyboard/01-Inspection_Overview.png', PNG);
  put(dir, 'design/storyboard/02-Inspection_NewEdit.png', PNG);
  put(dir, 'design/wireframes/Inspection_Overview.html', '<link rel="stylesheet" href="../ds.css"><h1>My inspections</h1>');
  put(dir, 'design/wireframes/Inspection_NewEdit.html', '<link rel="stylesheet" href="../ds.css"><h1>New inspection</h1>');
  put(dir, 'design/wireframes/PAGE-MAP.tsv', '# Page -> wireframe\n# Columns (TAB): Page, wireframe file, wire point, prototype route\nInspection_Overview\tInspection_Overview.html\tnav (row 1)\t#/my-inspections\nInspection_NewEdit\tInspection_NewEdit.html\tbutton (row 2)\t#/inspection/new\n');
  put(dir, 'design/brand-v2.md', '# Brand\n\nStatus: Stage 3 draft for review\n');
  put(dir, 'reports/management/gate-check-main-2026-10-16.md', '# Gate check\n');
  put(dir, 'docs/standups/2026-10-21.md', '# Standup\n');
  commit('The app and the design', 'Bo', 1);
  // Day 2: the prototype, a rename, two formats, a review round.
  put(dir, 'design/prototype.html', '<h1>Prototype</h1><a href="#/my-inspections">My inspections</a>');
  git('mv', 'architecture/build-plan-old.md', 'architecture/build-plan.md');
  put(dir, 'architecture/blueprint.md', '# Blueprint\n');
  put(dir, 'architecture/blueprint.html', '<h1>Blueprint</h1>');
  put(dir, 'design/ui-reviews/ui-review-2026-10-17.html', '<h1>UI review</h1><img src="shots/2026-10-17/overview-1280.png">');
  for (const s of ['overview-1280', 'overview-390', 'approvals-1280']) put(dir, `design/ui-reviews/shots/2026-10-17/${s}.png`, PNG);
  put(dir, 'docs/standups/2026-10-22.md', '# Standup\n');
  commit('Prototype, blueprint, first review round', 'Cy', 2);
  // Day 3: more rounds, another gate check, a standup, a draft, documents nothing relates to.
  for (const r of ['2026-10-18-r2', '2026-10-18-night']) for (const s of ['overview-1280', 'approvals-1280']) put(dir, `design/ui-reviews/shots/${r}/${s}.png`, PNG);
  put(dir, 'reports/management/gate-check-main-2026-10-18.md', '# Gate check\n');
  put(dir, 'docs/standups/2026-10-23.md', '# Standup\n');
  put(dir, 'docs/requirements/handover-draft.md', '# Handover\n\nDRAFT — before Stage 3 gate\n');
  put(dir, 'tests/test-plan.md', '# Test plan\n');
  put(dir, 'architecture/fit-gap.md', '# Fit-gap\n');
  commit('Review rounds, gate check, standup', 'Ada', 3);
  return { dir, shas, head: shas[shas.length - 1], noModel, times };
}
