// A page's facts for the Model preview (server/app-explorer/page-facts.ts, GET /api/app-explorer/page-facts), on a
// made-up project in a real git repository: the widgets of the page, its layout and the snippets they show (with
// $Type and $ID), the pages that share each snippet (directly or through their layout), and the project's own
// layout classes from its theme (Atlas skipped). Read from git at the commit: no mxcli, no runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pageFacts } from '../src/server/app-explorer/page-facts.js';
import { modelOf } from '../src/server/model/index.js';
import { stopExecWorker } from '../src/server/offloop/exec.js';
import { removeDir } from './support/cleanup.js';
import { hasSqlite, project, type MadeUnit } from './support/mendix.js';

test.after(() => stopExecWorker());

const btn = (name: string, id: string) => ({ $Type: 'Forms$ActionButton', $ID: id, Name: name });
const snipCall = (name: string, qn: string) => ({ $Type: 'Forms$SnippetCallWidget', $ID: `id-${name}`, Name: name, FormCall: { $Type: 'Forms$SnippetCall', Form: qn } });
const pageDoc = (name: string, layout: string, widgets: unknown[]) => ({ $Type: 'Forms$Page', Name: name, FormCall: { $Type: 'Forms$LayoutCall', Form: layout, Arguments: [2, { $Type: 'Forms$FormCallArgument', Widgets: [2, ...widgets] }] } });

function units(): MadeUnit[] {
  let n = 1;
  const out: MadeUnit[] = [{ n: n++, container: 1, hash: 'proj', doc: { $Type: 'Projects$Project' } }];
  const add = (container: number, doc: Record<string, unknown>) => {
    const id = n++;
    out.push({ n: id, container, hash: `h${id}`, doc: doc as MadeUnit['doc'] });
    return id;
  };
  const desk = add(1, { $Type: 'Projects$ModuleImpl', Name: 'Desk' });
  add(desk, { $Type: 'Forms$Layout', Name: 'Main', Widgets: [2, snipCall('scHeader', 'Desk.SNIP_Header')] });
  add(desk, { $Type: 'Forms$Snippet', Name: 'SNIP_Header', Widgets: [2, btn('btnHelp', 'id-help')] });
  add(desk, { $Type: 'Forms$Snippet', Name: 'SNIP_Badge', Widgets: [2, btn('btnPrint', 'id-print')] });
  add(desk, pageDoc('Visit_Overview', 'Desk.Main', [btn('btnSave', 'id-save'), snipCall('scBadge', 'Desk.SNIP_Badge')]));
  add(desk, pageDoc('Visit_Edit', 'Desk.Main', [btn('btnOk', 'id-ok')]));
  add(desk, pageDoc('Badge_Print', 'Desk.Popup', [snipCall('scBadge2', 'Desk.SNIP_Badge')]));
  add(desk, { $Type: 'Forms$Layout', Name: 'Popup', Widgets: [2] });
  return out;
}

test('a page’s facts: widgets with $Type and $ID, who shares its snippets, the theme’s layout classes', { skip: !(await hasSqlite()) && 'node:sqlite is needed to read units' }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-facts-'));
  const ctx = { cfg: { dataDir: path.join(root, 'data') } };
  try {
    const dir = path.join(root, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
    git('config', 'user.email', 'team@example.test');
    git('config', 'user.name', 'Team');
    await project(dir, units());
    for (const [p, body] of [
      ['themesource/desk/web/main.scss', 'body {\n  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gap); }\n}\n@media (max-width: 600px) { .tiles { display: block; } }\n'],
      ['themesource/atlas_core/web/main.scss', '.atlas-only { display: flex; }\n'],
      ['theme/web/custom-variables.scss', ':root { --gap: 12px; }\n'],
    ]) {
      mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
      writeFileSync(path.join(dir, p), body);
    }
    git('add', '-A');
    git('commit', '-qm', 'The app');
    const sha = git('rev-parse', 'HEAD');
    const floor = { id: 'f1', dir } as never;

    const f = await pageFacts(ctx, floor, sha, 'Desk.Visit_Overview');
    assert.ok(!('error' in f), JSON.stringify(f));
    if ('error' in f) return;
    assert.equal(f.problem, undefined);
    assert.deepEqual(f.widgets['Desk.Visit_Overview'], { btnSave: ['Forms$ActionButton', 'id-save'], scBadge: ['Forms$SnippetCallWidget', 'id-scBadge'] });
    assert.deepEqual(f.widgets['Desk.SNIP_Badge'], { btnPrint: ['Forms$ActionButton', 'id-print'] });
    assert.deepEqual(f.widgets['Desk.SNIP_Header'], { btnHelp: ['Forms$ActionButton', 'id-help'] }, 'the layout’s snippet too');
    assert.deepEqual(f.usedOn['Desk.SNIP_Badge'], ['Desk.Badge_Print', 'Desk.Visit_Overview'], 'called directly by two pages');
    assert.deepEqual(f.usedOn['Desk.SNIP_Header'], ['Desk.Visit_Edit', 'Desk.Visit_Overview'], 'through the layout both pages use');
    assert.equal(f.theme.css, '.tiles{display:grid;grid-template-columns:repeat(3, 1fr);gap:12px}', 'the app’s own module only, @media skipped, var resolved');
    assert.deepEqual(f.theme.from, ['themesource/desk/web/main.scss']);
    assert.deepEqual(await pageFacts(ctx, floor, sha, 'Desk.Nope'), { status: 404, error: 'No such page at this revision' });
    assert.deepEqual(await pageFacts(ctx, floor, sha, '../x'), { status: 400, error: 'Which page? (a qualified name)' });
  } finally {
    modelOf(ctx).units.close();
    removeDir(root);
  }
});
