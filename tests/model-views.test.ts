// The Model tab's views beyond diagrams (user feedback, 2026-10-10): pages drawn as a structure preview
// from their MDL (mdl-tree.ts, page-model.ts: read once per text, only when asked for), the details
// panel's size (side-panel.ts), entities' access rules per role (server domain.ts → access.ts's matrix),
// the System Overview (overview.ts → overview-draw.ts) and Navigation (nav-view.ts), what each App
// Explorer node opens (targets.ts), and the server answering the app-level nodes once and keeping them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { accessMatrix } from '../src/client/ui/model/access.js';
import { parseMdl, splitProps, unquote, walk } from '../src/client/ui/model/mdl-tree.js';
import { navProfiles } from '../src/client/ui/model/nav-view.js';
import { drawOverview, edgeId, layers, moduleId, placeModules } from '../src/client/ui/model/overview-draw.js';
import { pageModel, pageStats, sourceOf, textOf } from '../src/client/ui/model/page-model.js';
import { clampWidth, MIN_W, recallSide, rememberSide, type Store } from '../src/client/ui/model/side-panel.js';
import { opensNode, pathTo, targetOf } from '../src/client/ui/model/targets.js';
import { accessRules, parseDomain } from '../src/server/model/domain.js';
import { ModelService } from '../src/server/model/index.js';
import type { MxRun } from '../src/server/model/mxcli.js';
import { parseOverview } from '../src/server/model/overview.js';
import { stopExecWorker } from '../src/server/offloop/exec.js';
import type { DmEntity, ModelTreeNode } from '../src/shared/model.js';
import type { GitGraph } from '../src/shared/gitgraph.js';
import { removeDir } from './support/cleanup.js';
import { hasSqlite, project, type MadeUnit } from './support/mendix.js';

test.after(() => stopExecWorker());

// As `mxcli describe page` writes it (travel-approval, shortened).
const PAGE = `mdl 1;
create or modify page Shop.Order_Edit folder 'Orders/Pages' (
  Title: 'Edit order',
  Layout: Atlas_Core.Atlas_Default,
  Url: 'order/{Order/Id}',
  Params: ( $Order: Shop.Order )
) {
  layoutgrid lg1 {
    row {
      column (DesktopWidth: 8) {
        dynamictext txtTitle (Content: 'Order {1} for {2}', ContentParams: ({1} = Number, {2} = Order_Customer/Name), RenderMode: H1)
        dataview dvOrder (DataSource: $Order, FormOrientation: Vertical) {
          -- Context: $currentObject (Order)
          textbox tbNumber (Label: 'It''s the number', Attribute: Number)
          combobox cbCustomer (Label: 'Customer', Attribute: Shop.Order_Customer, DataSource: database from Shop.Customer where [Active = true] sort by Name asc)
          snippetcall scLines (Snippet: Shop.SNIP_Lines, Params: (Order = $Order))
          actionbutton btnSave (Caption: 'Save', Action: call microflow Shop.ACT_Order_Save(Order = $currentObject), ButtonStyle: Primary)
        }
      }
      column (DesktopWidth: autofill) {
        datagrid dgLines (DataSource: microflow Shop.DS_Lines, Class: 'grid') {
          column (Attribute: Product, Caption: 'Product')
          column (Caption: 'Total', ShowContentAs: customContent) {
            dynamictext txtTotal (Content: '{1}', ContentParams: ({1} = Total))
          }
        }
      }
    }
  }
};

grant view on page Shop.Order_Edit to Shop.User, Shop.Admin;`;

test('MDL widget trees: keywords, names, properties as written (nested brackets, quotes, commas), lines', () => {
  assert.equal(unquote("'It''s'"), "It's");
  assert.equal(unquote("'a' + 'b'"), "'a' + 'b'", 'two strings stay as written');
  assert.deepEqual(splitProps("Caption: 'Save, then close', Action: call microflow M.F(A = $a, B = $b), Visible: $x/Status = 'Open'"), { Caption: 'Save, then close', Action: 'call microflow M.F(A = $a, B = $b)', Visible: "$x/Status = 'Open'" });
  const st = parseMdl(PAGE).filter((s) => s.words[0] !== 'mdl');
  assert.equal(st.length, 2);
  assert.deepEqual(st[0].words, ['create', 'or', 'modify', 'page', 'Shop.Order_Edit', 'folder', 'Orders/Pages']);
  assert.equal(st[0].props.Title, 'Edit order');
  const all = [...walk(st[0].children)];
  assert.deepEqual(all.map((i) => i.kind).slice(0, 5), ['layoutgrid', 'row', 'column', 'dynamictext', 'dataview']);
  const tb = all.find((i) => i.name === 'tbNumber');
  assert.equal(tb?.props.Label, "It's the number");
  const dv = all.find((i) => i.kind === 'dataview');
  assert.deepEqual(dv?.children.map((c) => c.kind), ['textbox', 'combobox', 'snippetcall', 'actionbutton'], 'comments are skipped');
  // Lines are the text's own (0-based), from the keyword to the closing bracket.
  const lines = PAGE.split('\n');
  assert.match(lines[dv!.lines[0]], /dataview dvOrder/);
  assert.match(lines[dv!.lines[1]], /^\s*}\s*$/);
  const grid = all.find((i) => i.kind === 'datagrid');
  assert.deepEqual(grid?.children.map((c) => c.props.Caption), ['Product', 'Total']);
  // Malformed text never throws.
  for (const bad of ['', '{{{', 'create page (', "create page X { container c (Class: 'x", ')))}}};;;']) assert.doesNotThrow(() => parseMdl(bad));
});

test('a page for the Page view: header, roles, text with its parameters, data sources; read once per text', () => {
  const before = pageStats.parses;
  const m = pageModel(PAGE);
  assert.ok(m);
  assert.equal(m.kind, 'page');
  assert.equal(m.name, 'Shop.Order_Edit');
  assert.equal(m.folder, 'Orders/Pages');
  assert.equal(m.layout, 'Atlas_Core.Atlas_Default');
  assert.equal(m.url, 'order/{Order/Id}');
  assert.equal(m.params, '$Order: Shop.Order');
  assert.deepEqual(m.roles, ['Shop.User', 'Shop.Admin']);
  assert.equal(pageModel(PAGE), m, 'the same text is read once');
  assert.equal(pageStats.parses, before + 1);
  const all = [...walk(m.widgets)];
  assert.equal(textOf(all.find((i) => i.name === 'txtTitle')!), 'Order {Number} for {Name}');
  assert.equal(sourceOf(all.find((i) => i.kind === 'dataview')!), '$Order');
  assert.equal(sourceOf(all.find((i) => i.kind === 'datagrid')!), 'microflow Shop.DS_Lines');
  assert.equal(sourceOf(all.find((i) => i.kind === 'combobox')!), 'database Shop.Customer [XPath]');
  assert.equal(pageModel('mdl 1;\nnot a page;'), null);
  const layout = pageModel("create or modify layout Shop.Main (layouttype: 'Responsive') { region top { placeholder Main } };");
  assert.equal(layout?.kind, 'layout');
  assert.equal(layout?.layoutType, 'Responsive');
  assert.equal(layout?.widgets[0].children[0].kind, 'placeholder');
  assert.equal(layout?.widgets[0].children[0].name, 'Main');
});

test('the Page view is read only when it is shown: the client reads a page in doc-views.ts, never on opening it', async () => {
  const { readFileSync } = await import('node:fs');
  const views = readFileSync(path.join(import.meta.dirname, '../src/client/ui/model/doc-views.ts'), 'utf8');
  const index = readFileSync(path.join(import.meta.dirname, '../src/client/ui/model/index.ts'), 'utf8');
  assert.match(views, /if \(!kind \|\| !doc\.mdl \|\| mode === 'mdl'\) return false;[\s\S]*page\.show\(doc\.mdl\)/, 'the MDL is read only on the visual view');
  assert.doesNotMatch(index, /pageModel\(|parseMdl\(/, 'opening a document reads no MDL');
});

test('navigation profiles: home pages (per role too), login page, the menu as a tree with what each item opens', () => {
  const mdl = `-- navigation PROFILE: Responsive
create or modify navigation Responsive
  home page Shop.Home
  home page Admin.Overview for Administrator
  login page Shop.Login
{
  menu item 'Home' ( OnClick: show page Shop.Home )
  menu 'Orders' {
    menu item 'Open' ( OnClick: call microflow Shop.ACT_Open )
    menu item 'Sign out' ( OnClick: sign out )
  }
};
create or modify navigation Phone
  home page Shop.PhoneHome
;`;
  const [r, p] = navProfiles(mdl);
  assert.equal(r.name, 'Responsive');
  assert.equal(r.home, 'Shop.Home');
  assert.deepEqual(r.roleHomes, [{ role: 'Administrator', page: 'Admin.Overview' }]);
  assert.equal(r.login, 'Shop.Login');
  assert.equal(r.menu.length, 2);
  assert.deepEqual(r.menu[0].target, { type: 'page', qn: 'Shop.Home' });
  assert.equal(r.menu[1].caption, 'Orders');
  assert.deepEqual(r.menu[1].children.map((c) => [c.caption, c.target?.type ?? c.action]), [['Open', 'microflow'], ['Sign out', 'sign out']]);
  assert.equal(p.name, 'Phone');
  assert.equal(p.home, 'Shop.PhoneHome');
  assert.deepEqual(p.menu, []);
});

const rule = (roles: string[], create: boolean, del: boolean, members: [string, string, string][], xpath = '') => ({
  $Type: 'DomainModels$AccessRule',
  AllowedModuleRoles: [1, ...roles],
  AllowCreate: create,
  AllowDelete: del,
  XPathConstraint: xpath,
  MemberAccesses: [3, ...members.map(([a, s, r]) => ({ $Type: 'DomainModels$MemberAccess', Attribute: a === 'attr' ? s : '', Association: a === 'assoc' ? s : '', AccessRights: r }))],
});

test('access rules per role: read from the unit, then a matrix (several rules add up), entities without rules', () => {
  const unit = {
    Entities: [
      3,
      {
        $ID: 'e1',
        Name: 'Order',
        Location: '0;0',
        MaybeGeneralization: { $Type: 'DomainModels$NoGeneralization', Persistable: true },
        Attributes: [3, { Name: 'Number', NewType: { $Type: 'DomainModels$StringAttributeType' } }, { Name: 'Total', NewType: { $Type: 'DomainModels$DecimalAttributeType' } }],
        AccessRules: [
          3,
          rule(['Shop.User'], true, false, [['attr', 'Shop.Order.Number', 'ReadWrite'], ['attr', 'Shop.Order.Total', 'None'], ['assoc', 'Shop.Order_Customer', 'ReadOnly']], "[Shop.Order_Owner = '[%CurrentUser%]']"),
          rule(['Shop.User', 'Shop.Admin'], false, true, [['attr', 'Shop.Order.Total', 'ReadOnly'], ['attr', 'System.User.Name', 'ReadOnly']]),
        ],
      },
      { $ID: 'e2', Name: 'Secret', Location: '0;0', MaybeGeneralization: { $Type: 'DomainModels$NoGeneralization', Persistable: true }, Attributes: [3], AccessRules: [3] },
    ],
    Associations: [3],
  };
  const rules = accessRules((unit.Entities[1] as { AccessRules: never }) as never);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0], { roles: ['Shop.User'], create: true, delete: false, xpath: "[Shop.Order_Owner = '[%CurrentUser%]']", attrs: { Number: 'RW' }, assocs: { Order_Customer: 'R' } }, 'no access is left out');
  const dm = parseDomain('Shop', unit as never);
  const order = dm.entities.find((e) => e.name === 'Order') as DmEntity;
  const m = accessMatrix(order)!;
  assert.deepEqual(m.roles, ['Shop.User', 'Shop.Admin']);
  assert.deepEqual(m.create, [true, false]);
  assert.deepEqual(m.delete, [true, true], 'the second rule gives User delete too');
  assert.deepEqual(m.rows.map((r) => [r.name, r.assoc, r.cells.join('/')]), [['Number', false, 'RW/'], ['Total', false, 'R/R'], ['Name', false, 'R/R'], ['Order_Customer', true, 'R/']]);
  assert.deepEqual(m.xpaths, [{ roles: ['Shop.User'], xpath: "[Shop.Order_Owner = '[%CurrentUser%]']" }]);
  const secret = accessMatrix(dm.entities.find((e) => e.name === 'Secret') as DmEntity)!;
  assert.deepEqual(secret.roles, [], 'no rules: only System can use it');
  assert.equal(accessMatrix({ ...order, access: undefined }), null, 'not read (mxcli alone): no matrix');
  // Many roles: one column each, in the order the rules name them.
  const many = accessMatrix({ ...order, access: Array.from({ length: 12 }, (_, i) => ({ roles: [`M.R${i}`], create: false, delete: false, attrs: { Number: 'R' as const }, assocs: {} })) })!;
  assert.equal(many.roles.length, 12);
  assert.equal(many.rows[0].cells.length, 12);
});

test('the System Overview: modules and dependencies from mxcli; laid out with users above what they use', () => {
  const doc = parseOverview({
    modules: [
      { id: 'App', name: 'App', isSystem: false, entityCount: 3, microflowCount: 9, pageCount: 2 },
      { id: 'Admin', name: 'Admin', isSystem: true, entityCount: 2 },
      { id: 'System', name: 'System', isSystem: true, entityCount: 39 },
      { id: 'Lonely', name: 'Lonely' },
      { name: 42 } as never,
    ],
    edges: [
      { source: 'App', target: 'Admin', count: 2, kinds: { call: 1, retrieve: 1 } },
      { source: 'App', target: 'System', count: 61, kinds: { member: 60, xpath: 1, junk: 'x' } },
      { source: 'Admin', target: 'System', count: 64 },
      { source: 'App', target: 'Nowhere', count: 1 },
      { source: 'App', target: 'App', count: 1 },
    ],
  });
  assert.deepEqual(doc.modules.map((m) => m.name), ['App', 'Admin', 'System', 'Lonely']);
  assert.deepEqual(doc.modules[0], { name: 'App', system: false, entities: 3, microflows: 9, pages: 2 });
  assert.equal(doc.edges.length, 3, 'edges to unknown modules and to itself are dropped');
  assert.deepEqual(doc.edges[1].kinds, { member: 60, xpath: 1 });
  const l = layers(doc);
  assert.deepEqual([l.get('App'), l.get('Admin'), l.get('System')], [0, 1, 2], 'System at the bottom');
  const pos = placeModules(doc);
  assert.ok(pos.get('Lonely')!.y > pos.get('System')!.y, 'modules with no dependency go in a row below');
  // A cycle doesn't hang the layout.
  assert.doesNotThrow(() => placeModules({ kind: 'overview', modules: doc.modules, edges: [...doc.edges, { from: 'System', to: 'App', count: 1, kinds: {} }] }));
});

test('what each App Explorer node opens: documents, and the app-level nodes for what they stand for', () => {
  const nav: ModelTreeNode = { label: 'Navigation', type: 'navigation', qn: 'Navigation', children: [{ label: 'Responsive', type: 'navprofile', qn: 'Responsive', children: [{ label: 'Home: Shop.Home', type: 'navhome' }, { label: 'Menu', type: 'navmenu', children: [{ label: 'Home → Shop.Home', type: 'navmenuitem' }] }] }] };
  const shop: ModelTreeNode = { label: 'Shop', type: 'module', qn: 'Shop', children: [{ label: 'Security', type: 'security', children: [{ label: 'User', type: 'modulerole', qn: 'Shop.User' }] }, { label: 'Export', type: 'javascriptaction', qn: 'Shop.Export' }] };
  const sec: ModelTreeNode = { label: 'Project Security', type: 'projectsecurity', qn: 'ProjectSecurity', children: [{ label: 'User Roles', type: 'category', children: [] }] };
  const settings: ModelTreeNode = { label: 'Settings', type: 'settings', qn: 'Settings', children: [{ label: 'Model', type: 'settingscategory', children: [{ label: 'After Startup: X', type: 'settingsitem' }] }] };
  const so: ModelTreeNode = { label: 'System Overview', type: 'systemoverview', qn: 'SystemOverview' };
  const roots = [{ label: 'App', type: 'app', children: [so, nav, shop, sec, settings] }];
  const open = (n: ModelTreeNode) => targetOf(n, pathTo(roots, n) ?? []);
  assert.deepEqual(open(so), { type: 'systemoverview', qn: 'SystemOverview' });
  assert.deepEqual(open(nav), { type: 'navigation', qn: 'Navigation' });
  const menuItem = nav.children![0].children![1].children![0];
  assert.deepEqual(open(menuItem), { type: 'navprofile', qn: 'Responsive' });
  assert.deepEqual(open(nav.children![0].children![0]), { type: 'navprofile', qn: 'Responsive' });
  assert.deepEqual(open(shop.children![0]), { type: 'modulesecurity', qn: 'Shop' });
  assert.deepEqual(open(shop.children![0].children![0]), { type: 'modulerole', qn: 'Shop.User' });
  assert.deepEqual(open(sec.children![0]), { type: 'projectsecurity', qn: 'ProjectSecurity' });
  assert.deepEqual(open(settings.children![0].children![0]), { type: 'settings', qn: 'Settings' });
  const js = open(shop.children![1]);
  assert.equal(js?.type, 'javascriptaction');
  assert.match(js?.note ?? '', /no MDL description/);
  assert.deepEqual(open({ label: 'E', type: 'entity', qn: 'Shop.E' }), { type: 'entity', qn: 'Shop.E', pick: 'Shop.E' });
  for (const n of [so, nav, menuItem, shop.children![0], sec.children![0], settings.children![0]]) assert.ok(opensNode(n), n.type);
  assert.ok(!opensNode(shop), 'a module only opens and closes');
  assert.ok(!opensNode({ label: 'F', type: 'folder' }));
});

test('the details panel: width kept between the minimum and 60% of the tab, remembered per viewer, never throws on storage', () => {
  assert.equal(clampWidth(100, 1600), MIN_W);
  assert.equal(clampWidth(2000, 1600), 960);
  assert.equal(clampWidth(500, 1600), 500);
  assert.equal(clampWidth(500, 300), MIN_W, 'a tiny tab still gets the minimum');
  const m = new Map<string, string>();
  const store: Store = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  assert.deepEqual(recallSide(store), { closed: false, width: 0 });
  rememberSide({ closed: true, width: 640 }, store);
  assert.deepEqual(recallSide(store), { closed: true, width: 640 });
  m.set('agent-office.model.side', '{nonsense');
  assert.deepEqual(recallSide(store), { closed: false, width: 0 });
  m.set('agent-office.model.side', JSON.stringify({ closed: 'yes', width: -5 }));
  assert.deepEqual(recallSide(store), { closed: false, width: 0 });
  const broken: Store = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(recallSide(broken), { closed: false, width: 0 });
  assert.doesNotThrow(() => rememberSide({ closed: true, width: 1 }, broken));
  assert.deepEqual(recallSide(null), { closed: false, width: 0 });
});

test('the System Overview drawn: a box per module, an arrow per dependency, both clickable', () => {
  const doc = parseOverview({ modules: [{ name: 'A' }, { name: 'B' }], edges: [{ source: 'A', target: 'B', count: 3 }] });
  const d = drawOverview(doc);
  assert.ok(d.boxes.has(moduleId('A')) && d.boxes.has(moduleId('B')) && d.boxes.has(edgeId('A', 'B')));
  assert.match(d.svg, new RegExp(`data-id="${edgeId('A', 'B').replace('>', '&gt;')}" data-ends="${moduleId('A')} ${moduleId('B')}"`));
  assert.ok(d.bounds.w > 0 && d.bounds.h > 0);
});

function graphAt(sha: string): () => Promise<GitGraph> {
  return async () => ({ floor: 'f', defaultBranch: 'main', defaultRef: 'main', history: [{ sha, parents: [], subject: '', author: '', date: '' }], branches: [], hidden: { merged: 0, more: 0 }, at: Date.now() }) as unknown as GitGraph;
}

test('the server: System Overview, Navigation and a module\'s Security from mxcli once, then kept', async (t) => {
  if (!(await hasSqlite())) return t.skip('no node:sqlite here');
  const root = mkdtempSync(path.join(tmpdir(), 'ao-model-views-'));
  t.after(() => removeDir(root));
  const repo = path.join(root, 'repo');
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(path.join(repo, 'README.md'), 'x');
  const units: MadeUnit[] = [
    { n: 1, container: 1, hash: 'p', doc: { $Type: 'Projects$Project' } },
    { n: 2, container: 1, hash: 'm', doc: { $Type: 'Projects$ModuleImpl', Name: 'Shop' } },
  ];
  await project(repo, units);
  git('add', '-A');
  git('commit', '-qm', 'v0');
  const sha = git('rev-parse', 'HEAD');
  const calls: string[][] = [];
  const mx: MxRun = async (args) => {
    calls.push(args);
    if (args[0] === 'project-tree') return JSON.stringify([{ label: 'Navigation', type: 'navigation', qualifiedName: 'Navigation', children: [{ label: 'Responsive', type: 'navprofile', qualifiedName: 'Responsive' }, { label: 'Phone', type: 'navprofile', qualifiedName: 'Phone' }] }]);
    if (args.includes('systemoverview')) return JSON.stringify({ format: 'elk', modules: [{ id: 'Shop', name: 'Shop', isSystem: false, entityCount: 1 }, { id: 'System', name: 'System', isSystem: true }], edges: [{ source: 'Shop', target: 'System', count: 4, kinds: { member: 4 } }] });
    const c = args[args.indexOf('-c') + 1] ?? '';
    if (c.startsWith('describe navigation')) return "WARNING: This is a vibe-coded PoC, alpha quality, use with caution.\nmdl 1;\ncreate or modify navigation Responsive\n  home page Shop.Home\n{\n  menu item 'Home' ( OnClick: show page Shop.Home )\n};\nmdl 1;\ncreate or modify navigation Phone\n  home page Shop.PhoneHome\n;";
    if (c.startsWith('show module roles')) return '| Qualified Name | Module |\n| Shop.User | Shop |\n\nSecurity Matrix for Shop:';
    return '';
  };
  const svc = new ModelService(path.join(root, 'data'), { graph: graphAt(sha), mx });
  t.after(() => svc.units.close());
  const floor = { id: 'f', dir: repo, workers: { list: () => [] }, github: { pulls: { items: [] } } };

  const so = await svc.doc(floor, 'main', 'systemoverview', 'SystemOverview');
  assert.equal(so.doc.kind, 'overview');
  assert.ok(so.doc.kind === 'overview' && so.doc.edges[0].count === 4);
  const nav = await svc.doc(floor, 'main', 'navigation', 'Navigation');
  assert.ok(nav.doc.kind === 'text');
  const profiles = navProfiles(nav.doc.kind === 'text' ? nav.doc.mdl : '');
  assert.deepEqual(profiles.map((p) => [p.name, p.home]), [['Responsive', 'Shop.Home'], ['Phone', 'Shop.PhoneHome']]);
  const navCall = calls.find((c) => (c[c.indexOf('-c') + 1] ?? '').startsWith('describe navigation'));
  assert.equal(navCall?.[navCall.indexOf('-c') + 1], 'describe navigation Responsive; describe navigation Phone;', 'every profile in one mxcli run');
  const ms = await svc.doc(floor, 'main', 'modulesecurity', 'Shop');
  assert.ok(ms.doc.kind === 'text' && /Security Matrix for Shop/.test(ms.doc.mdl) && ms.doc.name === 'Shop › Security');
  const n = calls.length;
  await svc.doc(floor, 'main', 'systemoverview', 'SystemOverview');
  await svc.doc(floor, 'main', 'navigation', 'Navigation');
  await svc.doc(floor, 'main', 'modulesecurity', 'Shop');
  assert.equal(calls.length, n, 'asked again: kept, no mxcli');
});

test('in Portal the Model tab fills the page edge to edge under its header, down to the bottom of the window', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(path.join(import.meta.dirname, '../src/client/ui/model/model.css'), 'utf8');
  const index = readFileSync(path.join(import.meta.dirname, '../src/client/ui/model/index.ts'), 'utf8');
  assert.ok(css.includes("html[data-theme^='portal'] body.lite.pt-has-nav #model-view.mxv:not(.mx-full) { --mx-flush: 1; margin-left: -32px; margin-right: -32px; border-width: 1px 0 0; border-radius: 0 !important; }"), 'the page padding taken back, no frame');
  assert.ok(css.includes("html[data-theme^='portal'] body.lite.pt-has-nav #model-view.mxv:not(.mx-full) { margin-left: -16px; margin-right: -16px; }"), 'a phone: its 16px too');
  assert.ok(css.includes("pt-has-nav:has(> .lite-main > #model-view:not(.hidden)) .lite-main { padding-bottom: 0; }"), 'no gap under it');
  assert.ok(index.includes("getPropertyValue('--mx-flush').trim() === '1'") && index.includes('window.innerHeight - top - below)}px'), 'the rest of the window, to the bottom');
});
