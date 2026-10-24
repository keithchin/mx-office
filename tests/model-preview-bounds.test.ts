// The bounded Model preview (client/ui/model/page-preview.ts, preview-parts.ts) and what Select element and a
// request from an element are built on (preview-pick.ts, app-workspace/explorer/element-ref.ts,
// server/app-explorer/theme.ts and page-facts.ts). Pure: no browser (element-pick-dom.test.ts drives one).
//
//   - nested lists: 3 sample rows at the top, 2 inside a list, 1 deeper, the rest said; a widget budget per
//     page, the cut said; a big nested page renders under its time budget
//   - layout: Atlas classes and the project's own layout classes (from its theme) go into the document
//   - conditions: "Shown when …" tags, cases of one value drawn once and named, empty states labelled
//   - placeholders: widgets it can't draw are labelled boxes with their type, and listed in the report
//   - marks: each named widget of the page and its snippets carries its document, name and plain label
//   - postMessage: only this frame, an opaque origin, the shape, an element this drawing made
//   - the request's context: page + widget name, $Type/$ID from the facts, shared-snippet impact, gone → the page
//   - a request from an element makes a DC-n with that reference (the queue of part 1), with no live app
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pageModel, type PageModel } from '../src/client/ui/model/page-model.js';
import { previewDocument, previewRender } from '../src/client/ui/model/page-preview.js';
import { conditionSubject, conditionWords, elementLabel, groupCases, isEmptyState, moreRows, nameWords, sampleRows } from '../src/client/ui/model/preview-parts.js';
import { acceptPick } from '../src/client/ui/model/preview-pick.js';
import { reportWords } from '../src/client/ui/model/page-frame.js';
import { elementContext } from '../src/client/ui/app-workspace/explorer/element-ref.js';
import { customProps, layoutRules, themeCss } from '../src/server/app-explorer/theme.js';
import { callsOf, widgetsOf } from '../src/server/app-explorer/page-facts.js';
import { sharedWords, type PageFacts } from '../src/shared/page-facts.js';
import { ChangeStore } from '../src/server/dev-changes/store.js';
import { DevChanges } from '../src/server/dev-changes/service.js';
import { removeDir } from './support/cleanup.js';

const NOW = new Date(2026, 9, 24);
const page = (mdl: string) => pageModel(mdl) as PageModel;

/** A list of `depth` nested list views, each row with a few widgets. */
function nested(depth: number, perLevel = 3): string {
  let body = `dynamictext txtLeaf (Content: '{1}', ContentParams: ({1} = Name))`;
  for (let d = depth; d >= 1; d--) {
    const own = Array.from({ length: perLevel }, (_, i) => `dynamictext txtL${d}_${i} (Content: '{1}', ContentParams: ({1} = Title))`).join('\n');
    body = `listview lv${d} (DataSource: microflow Desk.DS_${d}) {\n${own}\n${body}\n}`;
  }
  return `create or modify page Desk.Visit_Edit (Title: 'Visit', Layout: Atlas_Core.Atlas_Default) {\n${body}\n}`;
}

test('nested lists: 3 sample rows at the top, 2 inside a list, 1 deeper, and the rest said as "… N more rows (sample)"', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(sampleRows), [3, 2, 1, 1, 1]);
  assert.equal(moreRows(1), '… 1 more row (sample)');
  const { html, report } = previewRender(page(nested(4)), { docs: new Map(), now: NOW });
  // Rows drawn: 3, then 3×2, then 6×1, then 6×1 = 21 list items (plus the "more" notes).
  assert.equal(html.match(/class="mx-listview-item"/g)?.length, 3 + 6 + 6 + 6);
  assert.equal(html.match(/… 1 more row \(sample\)/g)?.length, 3, 'depth 1 draws 2 of 3: said once per list');
  assert.equal(html.match(/… 2 more rows \(sample\)/g)?.length, 12, 'depth 2 and 3 draw 1 of 3');
  assert.equal(report.rowsNotDrawn, 3 * 1 + 6 * 2 + 6 * 2);
  assert.match(reportWords(report), /nested lists show fewer sample rows/);
});

test('a big nested page stays bounded: the widget budget cuts it, says how much, and it renders in time', () => {
  const big = page(nested(7, 40));
  const t = performance.now();
  const { html, report } = previewRender(big, { docs: new Map(), now: NOW, marks: true });
  const ms = performance.now() - t;
  assert.ok(ms < 400, `rendered in ${ms.toFixed(0)} ms`);
  assert.ok(html.length < 900_000, `HTML ${Math.round(html.length / 1024)} KB`);
  assert.ok((html.match(/mx-listview-item/g)?.length ?? 0) <= 3 + 6 + 6 * 5, 'rows stay linear in depth, not exponential');
  // A small budget: the rest is one labelled box with its count, never dropped silently.
  const cut = previewRender(big, { docs: new Map(), now: NOW, budget: 50 });
  assert.ok(cut.report.cut > 0);
  assert.match(cut.html, /class="mx-cut">… \d+ more widgets not drawn \(preview limit\)/);
  assert.match(reportWords(cut.report), /widgets past the preview limit not drawn/);
});

test('conditions are read, never worked out: tagged, cases of one value drawn once and named, empty states labelled', () => {
  assert.equal(conditionWords('$currentObject/Status = Desk.VisitStatus.Arrived'), 'Status is Arrived');
  assert.equal(conditionWords('$currentObject/Host != empty'), 'Host is set');
  assert.equal(conditionWords('$currentObject/IsBlocked = false'), 'not IsBlocked');
  assert.equal(conditionSubject('$currentObject/Status = Desk.VisitStatus.Arrived'), '$currentObject/Status');
  assert.equal(conditionSubject('$currentObject/A = 1 or $currentObject/B = 2'), undefined, 'a compound condition picks no single value');
  const m = page(`create or modify page Desk.Visit_List (Title: 'Today’s visitors') {
    container ctnEmpty (Visible: $currentObject/CountAll = 0) { dynamictext txtEmpty (Content: 'No visitors yet.') }
    dynamictext chipExpected (Content: 'Expected', Visible: $currentObject/Status = Desk.VisitStatus.Expected)
    dynamictext chipArrived (Content: 'Arrived', Visible: $currentObject/Status = Desk.VisitStatus.Arrived)
    dynamictext chipLeft (Content: 'Left', Visible: $currentObject/Status = Desk.VisitStatus.Left)
    container ctnHost (Visible: $currentObject/Host != empty) { dynamictext txtHost (Content: 'Host') }
  }`);
  assert.equal(isEmptyState(m.widgets[0]), true);
  assert.equal(groupCases(m.widgets).length, 3, 'the three chips are one run of cases');
  const { html, report } = previewRender(m, { docs: new Map(), now: NOW });
  assert.match(html, /mx-cond mx-cond-empty"[^>]*><span class="mx-cond-tag">Empty state · shown when CountAll is 0<\/span>/);
  assert.match(html, /<span class="mx-cond-tag">Shown when Status is Expected · \+2 other cases<\/span>/);
  assert.match(html, /title="Shown when Status is Expected\. Not drawn: chipArrived \(when Status is Arrived\); chipLeft \(when Status is Left\)"/);
  assert.doesNotMatch(html, />Arrived</, 'the other cases are named, not drawn on top of each other');
  assert.match(html, /Shown when Host is set/);
  assert.equal(report.conditions, 3);
  assert.equal(report.casesNotDrawn, 2);
  assert.match(reportWords(report), /3 conditional parts tagged “Shown when…” \(not worked out\), 2 other cases named, not drawn/);
});

test('widgets it can’t draw are labelled boxes with their type (contents inside), listed once each in the report', () => {
  const m = page(`create or modify page Desk.Badge_Edit (Title: 'Badge') {
    listview lv (DataSource: microflow Desk.DS) { fileuploader fuPhoto (uploadMode: 'images') }
    signaturepad spSign
    customchart chVisits { dynamictext t (Content: 'Inside a chart') }
    pluggablewidget com.example.widget.web.rating.Rating (Attribute: Score)
  }`);
  const { html, report } = previewRender(m, { docs: new Map(), now: NOW });
  assert.match(html, /mx-unknown"><span class="mx-unknown-tag">Not drawn<\/span> fileuploader · fuPhoto/);
  assert.match(html, /mx-unsupported"><span class="mx-unknown-tag">Not drawn: customchart · chVisits, its contents:<\/span><span class="mx-text">Inside a chart/);
  assert.match(html, /mx-unknown"><span class="mx-unknown-tag">Not drawn<\/span> pluggable Rating</, 'a pluggable widget by the last part of its id');
  assert.deepEqual(report.placeholders, [{ kind: 'customchart', count: 1 }, { kind: 'fileuploader', count: 1 }, { kind: 'pluggable Rating', count: 1 }, { kind: 'signaturepad', count: 1 }], 'a widget in three sample rows counts once');
  assert.match(reportWords(report), /Not drawn, shown as labelled boxes: customchart, fileuploader, pluggable Rating, signaturepad/);

});

test('layout: grid columns, Atlas helpers, gallery columns and a pop-up as a dialog; the project’s layout classes go in after ours', () => {
  const m = page(`create or modify page Desk.Desk_Home (Title: 'Desk') {
    container ctnTiles (Class: 'tiles-row d-flex') { container t1 (Class: 'tile') container t2 (Class: 'tile') }
    gallery galVisits (DataSource: database from Desk.Visit, DesktopColumns: 3) { template { dynamictext n (Content: '{1}', ContentParams: ({1} = Name)) } }
  }`);
  const { html } = previewRender(m, { docs: new Map(), now: NOW });
  assert.match(html, /<div class="mx-container tiles-row d-flex">/);
  assert.match(html, /<ul class="mx-gallery mx-cols-3">/, 'a gallery’s desktop columns');
  assert.equal(html.match(/mx-listview-item/g)?.length, 3, 'the gallery’s template is drawn once per sample row');
  const doc = previewDocument(html, 'Desk', { theme: '.tiles-row{display:grid;grid-template-columns:repeat(3,1fr)}' });
  assert.ok(doc.indexOf('.tiles-row{display:grid') > doc.indexOf('.d-flex,.flexcontainer'), 'the theme after our sheet');
  assert.match(doc, /\.d-flex,\.flexcontainer,\.flex-row\{display:flex/);
  assert.doesNotMatch(previewDocument('', 'x', { theme: '</style><script>alert(1)</script>' }), /<script>alert/, 'the theme can’t close its style element');
  const popup = previewRender(page(`create or modify page Desk.Visit_Cancel (Title: 'Cancel visit', Layout: Atlas_Core.PopupLayout) { dynamictext t (Content: 'Sure?') }`), { docs: new Map(), now: NOW });
  assert.match(popup.html, /mx-popup-backdrop"><div class="mx-dialog" role="dialog" aria-label="Cancel visit"><div class="mx-dialog-header"><span class="mx-dialog-title">Cancel visit<\/span>/);
});

test('the project’s theme, read cheaply: layout and box properties of simple class rules only, vars resolved, colours neutral', () => {
  const scss = `@import '../x';
  @font-face { font-family: X; src: url("/f.ttf"); }
  body {
    font-family: var(--font);
    .counters { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--space-3); color: red; }
    .counter { display: flex; padding: var(--space-3); background: var(--surface); border: 1px solid var(--line); }
    .row { display: flex; gap: 4px; }
    .hidden-thing { display: none; }
    .bad { background-image: url(x.png); display: block; }
    &:hover { display: block; }
    div.card-x { display: flex; }
  }
  @media (max-width: 600px) { .counters { grid-template-columns: 1fr; } }
  .sheet-card .top, .thumbs > ul { display: flex; justify-content: space-between; }`;
  const vars = customProps(':root { --space-3: 16px; --surface: #161b22; --line: #30363d; --space-3: 99px; }');
  assert.equal(vars.get('--space-3'), '16px', 'the first declaration (light themes come first)');
  const rules = layoutRules(scss, vars);
  assert.deepEqual(rules, [
    '.counters{display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:16px}',
    '.counter{display:flex;padding:16px;border:1px solid #e2e4e8;background:#fff}',
    '.bad{display:block}',
    '.sheet-card .top,.thumbs > ul{display:flex;justify-content:space-between}',
  ]);
  assert.equal(themeCss([{ path: 'a', text: '.x{display:flex;gap:var(--g)}' }], [':root{--g:8px}']), '.x{display:flex;gap:8px}');
  assert.equal(themeCss([{ path: 'a', text: '.x{gap:var(--unknown)}' }]), '', 'an unresolved var is dropped');
});

test('marks: each named widget of the page and its snippets carries document, name and plain label; the layout’s own aren’t marked', () => {
  const snip = page(`create or modify snippet Desk.SNIP_Header { actionbutton btnHelp (Caption: 'Help') }`);
  const lay = page(`create or modify layout Atlas_Core.Atlas_Default { container ctnTop { snippetcall scHead (Snippet: Desk.SNIP_Header) } placeholder Main }`);
  const m = page(`create or modify page Desk.Visit_Overview (Title: 'Today’s visitors', Layout: Atlas_Core.Atlas_Default) {
    container ctnFilterCard (Class: 'card') { textbox tbSearch (Label: 'Search', Attribute: Keyword) }
    listview lvVisits (DataSource: microflow Desk.DS) { actionbutton btnSave (Caption: 'Save "now" <b>') dynamictext txtTitle (Content: 'Arrivals', RenderMode: H2) }
  }`);
  const docs = new Map<string, PageModel | null>([['Atlas_Core.Atlas_Default', lay], ['Desk.SNIP_Header', snip]]);
  const { html, report } = previewRender(m, { docs, now: NOW, marks: true });
  const byName = Object.fromEntries(report.elements.map((e) => [e.name, e]));
  assert.deepEqual(Object.keys(byName).sort(), ['btnHelp', 'btnSave', 'ctnFilterCard', 'lvVisits', 'tbSearch', 'txtTitle'], 'not the layout’s own container, nor grid parts');
  assert.equal(byName.btnHelp.docType, 'snippet');
  assert.equal(byName.btnHelp.docQn, 'Desk.SNIP_Header');
  assert.equal(byName.btnSave.label, 'Save "now" <b> button');
  assert.equal(byName.ctnFilterCard.label, 'Filter card');
  assert.equal(byName.tbSearch.label, 'Search field');
  assert.equal(byName.lvVisits.label, 'Visits list');
  assert.equal(byName.txtTitle.label, '“Arrivals” heading');
  assert.equal(html.match(new RegExp(`data-mx-el="${byName.btnSave.el}"`, 'g'))?.length, 3, 'the same widget in each sample row has one mark');
  assert.match(html, /<button data-mx-el="\d+" data-mx-w="btnSave" data-mx-doc="Desk.Visit_Overview" data-mx-label="Save &quot;now&quot; &lt;b&gt; button" type="button" class="btn/);
  assert.doesNotMatch(previewRender(m, { docs, now: NOW }).html, /data-mx-/, 'no marks without picking (the Model tab)');
  assert.equal(nameWords('container1'), '');
  assert.equal(elementLabel({ kind: 'container', name: 'container7', props: {}, children: [], lines: [0, 0] }), 'Container');
});

test('the frame’s document: a script only with a nonce, allowed by that nonce alone', () => {
  const none = previewDocument('<p>x</p>', 'T');
  assert.doesNotMatch(none, /<script|script-src/);
  const withPick = previewDocument('<p>x</p>', 'T', { script: 'console.log(1)</script><b>', nonce: 'abcdef0123456789abcdef0123456789' });
  assert.match(withPick, /content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'nonce-abcdef0123456789abcdef0123456789'"/);
  assert.match(withPick, /<script nonce="abcdef0123456789abcdef0123456789">console\.log\(1\)<\\\/script><b><\/script>/);
  assert.doesNotMatch(previewDocument('', 'T', { script: 'x', nonce: 'bad nonce"' }), /<script/, 'a nonce that isn’t one: no script');
});

test('postMessage from the frame is checked: this frame’s window, an opaque origin, the shape, an element this drawing made', () => {
  const frame = {} as Window;
  const other = {} as Window;
  const els = [{ el: 0, docType: 'page' as const, docQn: 'Desk.P', name: 'btnSave', kind: 'actionbutton', label: 'Save button' }];
  const ok = { source: frame, origin: 'null', data: { mx: 'pick', type: 'select', el: 0, w: 'btnSave' } };
  assert.deepEqual(acceptPick(ok, frame, els), { type: 'select', el: els[0] });
  assert.equal(acceptPick({ ...ok, source: other }, frame, els), null, 'another window');
  assert.equal(acceptPick({ ...ok, origin: 'http://localhost:4100' }, frame, els), null, 'not the sandbox’s opaque origin');
  assert.equal(acceptPick({ ...ok, data: { ...ok.data, mx: 'other' } }, frame, els), null);
  assert.equal(acceptPick({ ...ok, data: { ...ok.data, type: 'eval' } }, frame, els), null);
  assert.equal(acceptPick({ ...ok, data: { ...ok.data, el: 5 } }, frame, els), null, 'an element this drawing didn’t make');
  assert.equal(acceptPick({ ...ok, data: { ...ok.data, w: 'btnOther' } }, frame, els), null, 'index and name must agree');
  assert.equal(acceptPick({ ...ok, data: { ...ok.data, el: '0' } }, frame, els), null);
  assert.equal(acceptPick({ ...ok, data: 'select' }, frame, els), null);
  assert.deepEqual(acceptPick({ ...ok, data: { mx: 'pick', type: 'leave' } }, frame, els), { type: 'leave' });
  assert.equal(acceptPick(ok, null, els), null);
});

const FACTS: PageFacts = {
  rev: 'a'.repeat(40),
  qn: 'Desk.Visit_Overview',
  widgets: { 'Desk.Visit_Overview': { btnSave: ['Forms$ActionButton', 'id-save'] }, 'Desk.SNIP_Header': { btnHelp: ['Forms$ActionButton', 'id-help'] } },
  usedOn: { 'Desk.SNIP_Header': ['Desk.Visit_Edit', 'Desk.Visit_Overview', 'Desk.Desk_Home'] },
  theme: { css: '', from: [] },
};
const PAGE = { qn: 'Desk.Visit_Overview', title: 'Today’s visitors' };

test('the request’s context: page + widget name, $Type and $ID from the facts (a hint), the shared snippet said, a gone widget asks about the page', () => {
  const sel = { el: 0, docType: 'page' as const, docQn: 'Desk.Visit_Overview', name: 'btnSave', kind: 'actionbutton', label: 'Save button', page: PAGE.qn, pageTitle: PAGE.title };
  const c = elementContext(PAGE, sel, FACTS);
  assert.equal(c.chip, 'Today’s visitors › Save button');
  assert.deepEqual(c.ref, { docType: 'page', docQn: 'Desk.Visit_Overview', widgetName: 'btnSave', widgetType: 'Forms$ActionButton', label: 'Save button', id: 'id-save' });
  assert.equal(c.impact, undefined);
  assert.deepEqual(elementContext(PAGE, sel, null).ref, { docType: 'page', docQn: 'Desk.Visit_Overview', widgetName: 'btnSave', widgetType: 'actionbutton', label: 'Save button' }, 'no facts: the MDL kind, no $ID');
  const help = elementContext(PAGE, { ...sel, docType: 'snippet', docQn: 'Desk.SNIP_Header', name: 'btnHelp', label: 'Help button' }, FACTS);
  assert.equal(help.ref.docType, 'snippet');
  assert.equal(help.ref.docQn, 'Desk.SNIP_Header');
  assert.equal(help.impact, 'This is in snippet SNIP_Header, used on 3 pages: a change to it changes all of them.');
  assert.match(help.where, /widget btnHelp in snippet Desk\.SNIP_Header, shown on page Desk\.Visit_Overview/);
  assert.equal(sharedWords('Desk.SNIP_Other', FACTS), undefined);
  const gone = elementContext(PAGE, { ...sel, gone: true }, FACTS);
  assert.deepEqual(gone.ref, { docType: 'page', docQn: 'Desk.Visit_Overview', label: 'Today’s visitors' });
  assert.equal(gone.gone, true);
  assert.deepEqual(elementContext(PAGE, null).ref, { docType: 'page', docQn: 'Desk.Visit_Overview', label: 'Today’s visitors' });
});

test('page facts from the units: named widgets with $Type and $ID, snippet and layout calls', () => {
  const doc = {
    $Type: 'Forms$Page',
    Name: 'Visit_Overview',
    FormCall: { $Type: 'Forms$LayoutCall', Form: 'Atlas_Core.Atlas_Default', Arguments: [2, { Widgets: [2, { $Type: 'Forms$ActionButton', $ID: 'id-save', Name: 'btnSave' }, { $Type: 'Forms$SnippetCallWidget', Name: 'scHead', FormCall: { $Type: 'Forms$SnippetCall', Form: 'Desk.SNIP_Header' } }] }] },
  };
  assert.deepEqual(widgetsOf(doc), { btnSave: ['Forms$ActionButton', 'id-save'], scHead: ['Forms$SnippetCallWidget', ''] });
  assert.deepEqual(callsOf(doc), { snippets: ['Desk.SNIP_Header'], layout: 'Atlas_Core.Atlas_Default' });
});

test('a request from an element makes a DC-n with that reference and the revision viewed: queued with no lead, no live app needed', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-pick-'));
  try {
    const store = new ChangeStore(path.join(dir, 'dev-changes'));
    const svc = new DevChanges({
      store,
      now: () => Date.UTC(2026, 9, 24, 10),
      blocked: () => 'no-lead',
      mainHead: async () => 'b'.repeat(40),
      recheck: async () => undefined,
      hand: async () => 'not called',
      facts: async (_f, c) => ({ queue: c.queue }),
      record: () => undefined,
    });
    const sel = { el: 0, docType: 'page' as const, docQn: 'Desk.Visit_Overview', name: 'btnSave', kind: 'actionbutton', label: 'Save button', page: PAGE.qn, pageTitle: PAGE.title };
    const c = elementContext(PAGE, sel, FACTS);
    const r = await svc.intake('desk', { text: `Make the save button green\n\nAbout: ${c.chip} (${c.where})`, ref: c.ref, source: FACTS.rev, key: 'pick-draft-0001', by: 'Alex Lee' });
    assert.ok(typeof r !== 'string', String(r));
    assert.equal(r.change.id, 'DC-1');
    assert.equal(r.change.queue, 'queued');
    assert.deepEqual(r.change.ref, c.ref);
    assert.deepEqual(r.change.source, { sha: FACTS.rev, kind: 'viewed' }, 'the revision viewed, not main’s head');
    assert.equal(r.change.revision, undefined, 'no running version: none asked for');
  } finally {
    removeDir(dir);
  }
});
