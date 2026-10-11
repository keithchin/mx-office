// The Model tab's page Preview (client/ui/model/page-preview.ts, page-frame.ts, doc-views.ts): a page written
// out as the running app's HTML with sample data, widget by widget; inside its layout and with its snippets
// when those are known; in a sandboxed frame with no scripts and no network; drawn only when Preview is shown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { recallMode } from '../src/client/ui/model/doc-views.js';
import { pageModel, type PageModel } from '../src/client/ui/model/page-model.js';
import { humanize, previewBody, previewDocument, sampleValue, wants } from '../src/client/ui/model/page-preview.js';
import { PREVIEW_CSS } from '../src/client/ui/model/preview-css.js';

const NOW = new Date(2026, 9, 11);
const ui = (f: string) => readFileSync(path.join(import.meta.dirname, '../src/client/ui/model', f), 'utf8');

const PAGE = `create or modify page Shop.Order_Edit (Title: 'Edit order', Layout: Shop.Main) {
  layoutgrid lg {
    row {
      column (DesktopWidth: 8) {
        dynamictext txtTitle (Content: 'Order {1}', ContentParams: ({1} = Number), RenderMode: H1)
        dataview dv (DataSource: $Order) {
          textbox tbTitle (Label: 'Trip title', Attribute: TripTitle, Class: 'field-req')
          textbox tbCost (Attribute: EstimatedCost)
          textbox tbLocked (Label: 'Origin', Attribute: Order_Origin/Name, Editable: Never)
          datepicker dpStart (Attribute: StartDate)
          combobox cbCountry (Label: 'Country', Attribute: Shop.Order_Country)
          checkbox cbUrgent (Attribute: IsUrgent)
          textarea taNote (Attribute: Justification)
          snippetcall sc (Snippet: Shop.SNIP_Lines)
          footer f {
            actionbutton btnSave (Caption: 'Save', ButtonStyle: Primary)
            actionbutton btnDelete (Caption: 'Delete', ButtonStyle: Danger)
            actionbutton btnCancel (Caption: 'Cancel')
          }
        }
      }
      column (DesktopWidth: 4) {
        image img1
        groupbox gb (Caption: 'Help') { dynamictext t (Content: 'Ask finance') }
        tabcontainer tabs { tabpage tp1 (Caption: 'First') { dynamictext a (Content: 'One') } tabpage tp2 (Caption: 'Second') { dynamictext b (Content: 'Two') } }
        unknownwidget uw
      }
    }
  }
  datagrid dg (DataSource: microflow Shop.DS_Orders) {
    column (Attribute: Number, Caption: 'Order')
    column (Attribute: Total, Caption: 'Total')
    column (Caption: 'Action', ShowContentAs: customContent) { actionbutton open (Caption: 'Open', Class: 'btn btn-sm') }
  }
  listview lv (DataSource: microflow Shop.DS_Recent) { dynamictext li (Content: '{1}', ContentParams: ({1} = Customer/Name)) }
};`;

const LAYOUT = `create or modify layout Shop.Main (layouttype: 'Responsive') {
  scrollcontainer sc {
    region top { dynamictext brand (Content: 'Shop', Class: 'wordmark') menubar mb (Profile: 'Responsive') }
    region center { placeholder Main }
  }
};`;
const SNIPPET = `create or modify snippet Shop.SNIP_Lines { dynamictext lines (Content: 'Order lines here') };`;

test('sample values and labels come from attribute names', () => {
  assert.equal(humanize('TripTitle'), 'Trip title');
  assert.equal(humanize('TravelRequest_DestinationCountry'), 'Destination country');
  assert.equal(sampleValue('EstimatedCost'), '1,250.00');
  assert.equal(sampleValue('StartDate', 0, NOW), '11 Oct 2026');
  assert.equal(sampleValue('SubmittedOn', 0, NOW), '11 Oct 2026');
  assert.equal(sampleValue('Destination'), 'Netherlands', 'not a date for ending in "on"');
  assert.equal(sampleValue('Justification').length > 20, true);
  assert.equal(sampleValue('Status'), 'Pending approval');
  assert.notEqual(sampleValue('Status', 1), sampleValue('Status', 0), 'rows differ');
});

test('each widget written as the running app would show it', () => {
  const m = pageModel(PAGE) as PageModel;
  const html = previewBody(m, { docs: new Map(), now: NOW });
  assert.match(html, /<div class="row"><div class="col-lg-8 col-12">/, 'layout grid columns');
  assert.match(html, /<h1>Order NLD-26-0042<\/h1>/, 'headings with sample values');
  assert.match(html, /<label class="control-label">Trip title <span class="mx-required">\*<\/span><\/label><div class="mx-control"><div class="form-control">Customer workshop in Rotterdam<\/div>/, 'form group: label, input, required');
  assert.match(html, /<label class="control-label">Estimated cost<\/label><div class="mx-control"><div class="form-control">1,250.00/);
  assert.match(html, /form-control-static">Netherlands/, 'read-only shows text; Order_Origin/Name means a country');
  assert.match(html, /mx-dateinput"><div class="form-control">11 Oct 2026/, 'date picker');
  assert.match(html, /mx-select"><span>Netherlands<\/span><span class="mx-caret"/, 'select');
  assert.match(html, /<input type="checkbox" disabled checked> Is urgent/, 'checkbox');
  assert.match(html, /mx-textarea/);
  assert.match(html, /<button type="button" class="btn mx-button btn-primary">Save<\/button>/);
  assert.match(html, /btn-danger">Delete/);
  assert.match(html, /btn-default">Cancel/);
  assert.match(html, /mx-dataview-controls/, 'footer as the data view controls');
  assert.match(html, /mx-image/);
  assert.match(html, /mx-groupbox-header">Help/);
  assert.match(html, /<li class="active"><span>First<\/span><\/li><li><span>Second<\/span><\/li>/);
  assert.match(html, /One/);
  assert.doesNotMatch(html, />Two</, 'only the first tab page shows');
  assert.match(html, /mx-unknown">unknownwidget uw/);
  assert.match(html, /<thead><tr><th>Order<\/th><th>Total<\/th><th>Action<\/th><\/tr><\/thead>/, 'data grid header');
  assert.equal(html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr>/g)?.length, 3, 'three sample rows');
  assert.match(html, /<td>NLD-26-0042<\/td><td>1,250.00<\/td><td><button type="button" class="btn mx-button btn-default btn-sm">Open/);
  assert.equal(html.match(/mx-listview-item/g)?.length, 3, 'list view as three cards');
  assert.match(html, /Ravi Patel/);
  assert.match(html, /mx-snippet-box">Snippet SNIP_Lines/, 'a snippet not read yet is a labelled box');
  assert.match(html, /<header class="mx-region-top"><span class="mx-brand">App<\/span>/, 'no layout read yet: a plain top bar');
});

test('with its layout and snippets read: the page sits in the layout\'s Main, snippets inlined, the menu from the navigation', () => {
  const m = pageModel(PAGE) as PageModel;
  const docs = new Map<string, PageModel | null>();
  assert.deepEqual(wants(m, { docs }), [{ type: 'layout', qn: 'Shop.Main' }, { type: 'snippet', qn: 'Shop.SNIP_Lines' }]);
  docs.set('Shop.Main', pageModel(LAYOUT));
  docs.set('Shop.SNIP_Lines', pageModel(SNIPPET));
  assert.deepEqual(wants(m, { docs }), []);
  const html = previewBody(m, { docs, menu: ['Home', 'Orders'], now: NOW });
  assert.match(html, /<header class="mx-region-top"><span class="mx-text wordmark">Shop<\/span><ul class="mx-navbar"><li class="active"><a>Home<\/a><\/li><li><a>Orders<\/a><\/li><\/ul><\/header>/);
  assert.match(html, /<main class="mx-region-center"><div class="mx-page">/, 'the page in the layout\'s placeholder');
  assert.match(html, /mx-snippet"><span class="mx-text">Order lines here/);
  // A documentation comment above the snippet (mxcli writes /** … */) is skipped.
  assert.equal(pageModel(`/**\n * The lines.\n */\n${SNIPPET.replace('Order lines here', 'With a comment')}`)?.name, 'Shop.SNIP_Lines');
  // A snippet that calls itself stops.
  docs.set('Shop.SNIP_Lines', pageModel('create or modify snippet Shop.SNIP_Lines { snippetcall again (Snippet: Shop.SNIP_Lines) };'));
  assert.doesNotThrow(() => previewBody(m, { docs }));
});

test('isolation: everything escaped, no scripts, a frame that is sandboxed and fetches nothing', () => {
  const evil = pageModel(`create or modify page Shop.X { dynamictext t (Content: '</style><script>alert(1)</script><img src=x onerror=alert(2)>', Class: '"><script>x</script>') actionbutton b (Caption: '<b>hi</b>') };`) as PageModel;
  const doc = previewDocument(previewBody(evil, { docs: new Map() }), '</title><script>');
  assert.doesNotMatch(doc, /<script/i);
  assert.doesNotMatch(doc, /<img/i);
  assert.match(doc, /&lt;\/style&gt;&lt;script&gt;/);
  assert.match(doc, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">/);
  assert.doesNotMatch(PREVIEW_CSS, /url\(|@import/, 'the stylesheet fetches nothing');
  const frame = ui('page-frame.ts');
  assert.match(frame, /h\('iframe\.pgp-frame', \{ sandbox: '',/, 'the frame is sandboxed with nothing allowed');
  assert.match(frame, /frame\.srcdoc = previewDocument\(/);
});

test('laziness: the Preview is drawn only when chosen; its snippets, layout and menu are asked for only then', () => {
  const views = ui('doc-views.ts');
  assert.match(views, /else if \(mode === 'preview'\) \{\s*if \(!preview\.show\(doc\.mdl\)\) return false;/);
  assert.match(views, /if \(!kind \|\| !doc\.mdl \|\| mode === 'mdl'\) return false;/);
  const frame = ui('page-frame.ts');
  assert.match(frame, /function draw\(mdl: string\)[\s\S]*void more\(m, mdl\)/, 'fetching starts from drawing the Preview');
  assert.match(frame, /asked\.has\(w\.qn\)/, 'each snippet or layout is asked for once');
  assert.doesNotMatch(ui('index.ts'), /previewBody|pageFrame\(/, 'opening a page draws no Preview');
  // The remembered choice: 'visual' (before Preview) is Structure.
  const store = (v: string | null) => ({ getItem: () => v });
  assert.equal(recallMode(store('visual')), 'structure');
  assert.equal(recallMode(store('preview')), 'preview');
  assert.equal(recallMode(store('mdl')), 'mdl');
  assert.equal(recallMode({ getItem: () => { throw new Error('denied'); } }), 'structure');
});

test('the Structure view has no banner any more; the Live app link sits beside the switch', () => {
  assert.doesNotMatch(ui('page-view.ts'), /Structure preview|not the running page/);
  assert.match(ui('doc-views.ts'), /'Live app ↗'/);
});
