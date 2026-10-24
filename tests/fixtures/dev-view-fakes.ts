// The Developer view's fake server for the DOM tests (app-explorer-dom, docked-chat-dom): main's newest commit, the
// business tree at two revisions, the files, the documents and the Model tab's documents, as a script for the page.
// Neutral example data only.

export const A = '7d3f0b1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const B = '9e1c2d3bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// The fake server: main's newest commit, the business tree at A and B, the files, the documents, the Model tab's documents.
export const FAKES = `
  const P = (qn, url, title) => ({ id: 'page:' + qn, label: title || qn.split('.')[1].replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase()), kind: 'page', type: 'page', qn, key: 'page:' + qn, detail: qn + ' · ' + qn.split('.')[0], hint: 'A page of the app: ' + qn + (url ? ' · in the running app at ' + url : ' · opens from another page'), ...(url ? { url } : {}) });
  const tree = (rev, at) => {
    const big = window.__big;
    const L = {
      '': [
        { id: 'pages', label: 'Pages', kind: 'group', folder: true, count: big ? 402 : rev === '${B}' ? 3 : 2, addonCount: 1, hint: 'The screens of the app. 2 pages in the app’s own modules; Marketplace modules add 1 more (3 in all).' },
        { id: 'data', label: 'Data', kind: 'group', folder: true, count: 2, hint: 'What the app keeps' },
        { id: 'logic', label: 'Logic', kind: 'group', folder: true, count: 1, hint: 'What the app does' },
      ],
      pages: [{ id: 'pages/VisitorDesk', label: 'Visitor desk', kind: 'module', folder: true, count: 2 }, ...(big ? [{ id: 'pages/Big', label: 'Big part', kind: 'module', folder: true, count: 400 }] : []), { id: 'pages/@marketplace', label: 'Marketplace modules', kind: 'module', folder: true, count: 1, addon: true }],
      'pages/@marketplace': [{ id: 'pages/Atlas_Core', label: 'Atlas core', kind: 'module', folder: true, count: 1, addon: true }],
      'pages/VisitorDesk': [...(rev === '${B}' ? [P('VisitorDesk.Host_Dashboard', '/p/host', 'Host dashboard')] : []), P('VisitorDesk.Visitor_NewEdit', undefined, 'New visitor'), P('VisitorDesk.Visitor_Overview', '/p/visitors', 'Today’s visitors')],
      'pages/Big': Array.from({ length: 400 }, (_, i) => P('Big.Screen_' + String(i).padStart(3, '0'), '/p/s' + i)),
      'pages/Atlas_Core': [P('Atlas_Core.Atlas_Default')],
      data: [{ id: 'data/VisitorDesk', label: 'Visitor desk', kind: 'module', folder: true, count: 2, type: 'domainmodel', qn: 'VisitorDesk', key: 'domainmodel:VisitorDesk' }],
      'data/VisitorDesk': [{ id: 'entity:VisitorDesk.HostApproval', label: 'Host approval', kind: 'entity', type: 'entity', qn: 'VisitorDesk.HostApproval', key: 'domainmodel:VisitorDesk', hint: 'A kind of record the app keeps' }, { id: 'entity:VisitorDesk.Visitor', label: 'Visitor', kind: 'entity', type: 'entity', qn: 'VisitorDesk.Visitor', key: 'domainmodel:VisitorDesk', hint: 'A kind of record the app keeps' }],
      logic: [{ id: 'logic/VisitorDesk', label: 'Visitor desk', kind: 'module', folder: true, count: 1 }],
      'logic/VisitorDesk': [{ id: 'microflow:VisitorDesk.ACT_Visitor_Save', label: 'Visitor save', kind: 'flow', type: 'microflow', qn: 'VisitorDesk.ACT_Visitor_Save', key: 'microflow:VisitorDesk.ACT_Visitor_Save', hint: 'Logic that runs on the server' }],
    };
    if (window.__broken === rev) return at === '' ? { rev, at, nodes: [], problem: 'Couldn’t read the model at ' + rev.slice(0, 7) + ': no Mendix project (.mpr) in this commit' } : { rev, at, nodes: [] };
    if (at === '*') return L;
    if (!(at in L)) throw new Error('No such part of the tree');
    return { rev, at, nodes: L[at] };
  };
  const files = (rev, p, cursor) => {
    if (window.__big && p === '') {
      const all = Array.from({ length: 3000 }, (_, i) => ({ id: 'f:file' + i + '.txt', label: 'file' + i + '.txt', kind: 'file', path: 'file' + i + '.txt', key: 'file' + i + '.txt', size: 10 }));
      return { rev, at: p, nodes: all.slice(cursor, cursor + 300), total: 3000, next: cursor + 300 < 3000 ? cursor + 300 : undefined };
    }
    const L = {
      '': [{ id: 'f:docs/', label: 'docs', kind: 'folder', folder: true, path: 'docs', count: 1 }, { id: 'f:javasource/', label: 'javasource', kind: 'folder', folder: true, path: 'javasource', count: 1 }, { id: 'f:App.mpr', label: 'App.mpr', kind: 'file', path: 'App.mpr', key: 'App.mpr' }, { id: 'f:merge-notes.md', label: 'merge-notes.md', kind: 'file', path: 'merge-notes.md', key: 'merge-notes.md' }, { id: 'f:README.md', label: 'README.md', kind: 'file', path: 'README.md', key: 'README.md' }],
      docs: [{ id: 'f:docs/brd.md', label: 'brd.md', kind: 'file', path: 'docs/brd.md', key: 'docs/brd.md' }],
      javasource: [{ id: 'f:javasource/GitHelper.java', label: 'GitHelper.java', kind: 'file', path: 'javasource/GitHelper.java', key: 'javasource/GitHelper.java' }],
    };
    return { rev, at: p, nodes: L[p] ?? [], total: (L[p] ?? []).length };
  };
  const C = (sha, day, author) => ({ sha, at: Date.UTC(2026, 9, day), author, subject: 'work' });
  const F = (path, last, extra) => ({ path, kind: path.endsWith('.md') ? 'md' : path.endsWith('.png') ? 'image' : path.endsWith('.css') ? 'text' : path.endsWith('.json') ? 'json' : 'html', size: 10, last, ...(extra || {}) });
  const DOCS = (rev) => ({ rev, counts: { version: 2, alternative: 3, supporting: 2, related: 2, run: 0, unknown: 2, files: 11, entries: 9 }, entries: [
    { id: 'd:docs/brd.md', title: 'Business requirements', group: 'documents', section: 'Requirements', shape: 'single', files: [F('docs/brd.md', C('${A}', 16, 'Ada'))], relations: ['unknown'], links: [] },
    { id: 'd:analysis/brd-report.html', title: 'BRD report', group: 'documents', section: 'Requirements', shape: 'single', role: 'BRD report', files: [F('analysis/brd-report.html', C('${A}', 17, 'Ada'))], relations: ['related'], links: [{ relation: 'related', to: 'd:analysis/f001.brd.json', label: 'BRD source data' }] },
    { id: 'd:analysis/f001.brd.json', title: 'BRDs', group: 'documents', section: 'Requirements', shape: 'single', role: 'BRD source data', files: [F('analysis/F001.brd.json', C('${A}', 15, 'Ada'))], relations: ['related'], links: [{ relation: 'related', to: 'd:analysis/brd-report.html', label: 'BRD report' }] },
    { id: 'd:docs/process.html', title: 'Visitor process', group: 'processmap', section: 'Design', shape: 'single', files: [F('docs/process.html', C('${A}', 16, 'Bo'))], relations: ['unknown'], links: [] },
    { id: 'd:design/look.md', title: 'Look and feel', group: 'design', section: 'Design', shape: 'versions', files: [F('design/look-v2.md', C('${A}', 18, 'Bo'), { marker: 'v2', status: { value: 'draft', text: 'Stage 3 draft for review', source: 'Status line' } }), F('design/look-v1.md', C('${A}', 14, 'Cy'), { marker: 'v1' })], relations: ['version'], links: [] },
    { id: 'd:design/wireframes/visitor_list.html', title: 'Visitor list', group: 'design', section: 'Design', set: 'Wireframes (one per screen)', shape: 'single', role: 'Wireframe', files: [F('design/wireframes/Visitor_List.html', C('${A}', 16, 'Bo'), { status: { value: 'current', text: 'mapped to page Visitor_List', source: 'PAGE-MAP.tsv' } })], relations: ['alternative', 'supporting'], links: [{ relation: 'alternative', to: 'd:design/storyboard/01-visitor_list.png', label: 'Storyboard frame of Visitor list' }, { relation: 'alternative', to: 'd:design/prototype.html', label: 'Prototype of Visitor list (#/visitors)', route: '#/visitors' }, { relation: 'supporting', to: 'd:design/ds.css', label: 'Uses ds.css' }] },
    { id: 'd:design/storyboard/01-visitor_list.png', title: 'Visitor list', group: 'design', section: 'Design', set: 'Storyboard', shape: 'single', role: 'Storyboard frame', files: [F('design/storyboard/01-Visitor_List.png', C('${A}', 15, 'Bo'))], relations: ['alternative'], links: [{ relation: 'alternative', to: 'd:design/wireframes/visitor_list.html', label: 'Wireframe of Visitor list' }] },
    { id: 'd:design/prototype.html', title: 'Prototype', group: 'design', section: 'Design', shape: 'single', role: 'Prototype', files: [F('design/prototype.html', C('${A}', 18, 'Cy'))], relations: ['alternative'], links: [{ relation: 'alternative', to: 'd:design/wireframes/visitor_list.html', label: 'Wireframe of Visitor list' }] },
    { id: 'd:design/ds.css', title: 'Design tokens (ds.css)', group: 'design', section: 'Design', shape: 'single', role: 'Design tokens', files: [F('design/ds.css', C('${A}', 16, 'Bo'))], relations: ['supporting'], links: [{ relation: 'supporting', to: 'd:design/wireframes/visitor_list.html', label: 'Used by Visitor list' }] },
  ] });
  window.__main = '${A}';
  window.__calls = [];
  window.__asked = [];
  window.__changeThis = [];
  const api = {
    level: async (f, rev, at) => (window.__calls.push('level ' + rev.slice(0, 2) + ' ' + at), tree(rev, at)),
    folder: async (f, rev, p, c) => (window.__calls.push('folder ' + rev.slice(0, 2) + ' ' + p), files(rev, p, c || 0)),
    file: async (f, rev, p) => (p.endsWith('.png') ? { path: p, size: 12, kind: 'image', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' } : { path: p, size: 12, kind: 'text', text: 'The text of ' + p }),
    changes: async (f, a, b) => (window.__calls.push('changes ' + a.slice(0, 2) + ' ' + b.slice(0, 2)), { from: a, to: b, docs: ['page:VisitorDesk.Visitor_Overview', 'page:VisitorDesk.Host_Dashboard'], files: ['docs/brd.md'] }),
    head: async (f, served) => (window.__calls.push('head ' + (served || '').slice(0, 2)), { rev: window.__main, branch: 'main', subject: 'Host approval', ...(served ? { served: { sha: served, behind: served === window.__main ? 0 : 2, ahead: 0 } } : {}) }),
    index: async (f, rev) => (window.__calls.push('index ' + rev.slice(0, 2)), { rev, levels: tree(rev, '*') }),
    search: async (f, rev, q) => {
      window.__calls.push('search ' + q);
      const hits = ['README.md', 'merge-notes.md', 'docs/brd.md', 'javasource/GitHelper.java', 'deep/a/b/c/merge-plan.txt'].filter((p) => p.includes(q));
      return { rev, q, total: hits.length, nodes: hits.map((p) => ({ id: 'f:' + p, label: p.split('/').pop(), kind: 'file', path: p, key: p, detail: p, hint: p })) };
    },
    documents: async (f, rev) => (window.__calls.push('documents ' + rev.slice(0, 2)), DOCS(rev)),
    facts: async (f, rev, qn) => (window.__calls.push('facts ' + rev.slice(0, 2) + ' ' + qn), { rev, qn, widgets: { [qn]: { btnSave: ['Forms$ActionButton', 'id-save'] } }, usedOn: {}, theme: { css: '.mx-dataview{outline:0}', from: [] } }),
  };
  const PAGE_MDL = "create or modify page VisitorDesk.Visitor_NewEdit (\\n  Title: 'Visitor',\\n  Layout: Atlas_Core.Atlas_Default\\n) {\\n  dataview dv (DataSource: $Visitor) {\\n    textbox tbName (Label: 'Name', Attribute: Name)\\n    actionbutton btnSave (Caption: 'Save', ButtonStyle: Primary)\\n  }\\n}";
  const model = { doc: async (f, rev, type, qn) => {
    window.__calls.push('doc ' + rev.slice(0, 2) + ' ' + type + ' ' + qn);
    if (type === 'domainmodel') return { sha: rev, doc: { kind: 'domainmodel', module: qn, source: 'units', associations: [], annotations: [], entities: [{ id: 'e1', name: 'Visitor', kind: 'persistent', x: 20, y: 20, attrs: [{ name: 'Name', type: 'String' }] }, { id: 'e2', name: 'HostApproval', kind: 'persistent', x: 260, y: 20, attrs: [{ name: 'ApprovedAt', type: 'Date and time' }] }] } };
    if (type === 'microflow') return { sha: rev, doc: { kind: 'microflow', name: qn, nodes: [], edges: [], mdl: '', source: 'units' } };
    if (type === 'page') return { sha: rev, doc: { kind: 'text', type: 'page', name: qn, mdl: PAGE_MDL.replace('VisitorDesk.Visitor_NewEdit', qn) } };
    return { sha: rev, doc: { kind: 'text', type, name: qn, mdl: '' } };
  } };
  window.__explorer = { api, changeThis: (o) => window.__changeThis.push(o.kind + ' ' + o.qn + ' ' + o.ref + ' ' + o.sha.slice(0, 2)), model };
`;

export const APP_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px system-ui;color:#2f3646}header{background:#264ae5;color:#fff;padding:12px 16px;font-weight:600}main{padding:16px}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}</style></head><body><header>Visitor Registration</header><main><h2>Today's visitors</h2><table><tr><th>Visitor</th><th>Host</th></tr><tr><td>Sam Doe</td><td>Alex Lee</td></tr><tr><td>Kim Park</td><td>Jo Smith</td></tr></table></main></body></html>`;
