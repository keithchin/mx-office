// Clients: naming one (create, from the page, a project's settings and the wizard) and renaming one, and the
// Clients page (/clients) that replaced Home's Clients tab. Synthetic data only; no office is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { PortfolioStore } from '../src/server/portfolios/store.js';
import { portfolioRoutes } from '../src/server/http/routes/portfolios.js';
import { pageRoutes } from '../src/server/http/routes/pages.js';
import { routes } from '../src/server/http/routes/index.js';
import { clientHref, clientMatches, paletteOf, sortedClients } from '../src/client/clients/logic.js';
import { World } from './portfolio-world.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'clients-'));

// ---- The store -----------------------------------------------------------------------------------

test('create: the empty state (no portfolios.json) takes a first client, and writes the file only then', async () => {
  const dir = tmp();
  const st = new PortfolioStore(dir);
  assert.deepEqual(await st.load(), []);
  assert.equal(existsSync(st.file), false);
  const p = await st.create('  Acme\r\nTravel  ', 'Keith');
  assert.ok(typeof p !== 'string');
  if (typeof p === 'string') return;
  assert.equal(p.label, 'Acme Travel', 'trimmed, newlines folded');
  assert.equal(JSON.parse(readFileSync(st.file, 'utf8')).portfolios[0].label, 'Acme Travel');
});

test('create: empty, too long and duplicate (any case) names', async () => {
  const st = new PortfolioStore(tmp());
  assert.equal(await st.create('   ', 'k'), 'Give the client a name');
  assert.equal(existsSync(st.file), false, 'a refused name writes nothing');
  const long = await st.create('x'.repeat(200), 'k');
  assert.ok(typeof long !== 'string' && long.label.length === 80);
  await st.create('Acme', 'k');
  assert.equal(await st.create('ACME', 'k'), 'There is already a client called ACME');
});

test('create: two creates of one name sent together (a double Enter) make one client', async () => {
  const st = new PortfolioStore(tmp());
  const [a, b] = await Promise.all([st.create('Acme', 'k'), st.create('acme', 'k')]);
  assert.equal([a, b].filter((x) => typeof x !== 'string').length, 1);
  assert.equal([a, b].filter((x) => typeof x === 'string').length, 1);
  const again = new PortfolioStore(path.dirname(st.file));
  assert.equal((await again.load()).length, 1);
});

test('rename: only the label changes; same rules as create; unknown client', async () => {
  const st = new PortfolioStore(tmp());
  const a = (await st.create('Acme', 'k')) as { id: string };
  await st.create('Beta', 'k');
  await st.addProject(a.id, 'p1');
  assert.deepEqual(await st.rename(a.id, ' Acme Travel\n Group '), { before: 'Acme', after: 'Acme Travel Group' });
  const back = new PortfolioStore(path.dirname(st.file));
  await back.load();
  assert.equal(back.get(a.id)?.label, 'Acme Travel Group');
  assert.deepEqual(back.get(a.id)?.projectIds, ['p1'], 'membership stays');
  assert.equal(await st.rename(a.id, ''), 'Give the client a name');
  assert.equal(await st.rename(a.id, 'beta'), 'There is already a client called beta');
  assert.deepEqual(await st.rename(a.id, 'acme travel group'), { before: 'Acme Travel Group', after: 'acme travel group' }, 'its own name in another case is fine');
  assert.equal(await st.rename('pfl_01M500000000000000000000ZZ', 'X'), 'No such client');
});

test('rename through the service is audited as portfolio.rename with the old and new name', async () => {
  const w = new World();
  const s = w.service();
  const p = (await s.create('Acme', 'Keith')) as { id: string };
  assert.equal(await s.rename(p.id, 'Acme Group', 'Keith'), undefined);
  const e = w.audits.find((x) => x.action === 'portfolio.rename');
  assert.ok(e);
  assert.deepEqual(e?.details, { before: 'Acme', after: 'Acme Group' });
  assert.equal(e?.target?.id, p.id);
  assert.match(e?.summary ?? '', /Renamed the client Acme to Acme Group/);
  assert.equal(await s.rename(p.id, 'Acme Group', 'Keith'), undefined);
  assert.equal(w.audits.filter((x) => x.action === 'portfolio.rename').length, 1, 'no change, no audit line');
});

// ---- The route -----------------------------------------------------------------------------------

async function act(body: unknown, opts: { admin?: boolean; origin?: string; host?: string; dataDir: string }) {
  let status = 0;
  let out = '';
  const res = { writeHead: (s: number) => (status = s), end: (b: string) => (out = b) } as never;
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { headers: { 'content-type': 'application/json', host: opts.host ?? 'localhost:4600', ...(opts.origin ? { origin: opts.origin } : {}) } });
  const ctx = { cfg: { dataDir: opts.dataDir }, meOf: () => ({ admin: opts.admin ?? true }), floors: new Map() } as never;
  await portfolioRoutes.act.handle(ctx, { req, res, session: { account: { id: 'u1', name: 'Keith' } } } as never);
  return { status, out: JSON.parse(out || '{}') };
}

test('route: create and rename from the office page (same origin, localhost); errors are 400 with the words', async () => {
  const dataDir = tmp();
  const c = await act({ action: 'create', label: 'Acme' }, { dataDir, origin: 'http://localhost:4600' });
  assert.equal(c.status, 200);
  const id = c.out.portfolio.id as string;
  assert.equal(c.out.view.portfolios[0].label, 'Acme');
  assert.equal((await act({ action: 'create', label: 'acme' }, { dataDir, origin: 'http://localhost:4600' })).out.error, 'There is already a client called acme');
  assert.equal((await act({ action: 'create', label: '' }, { dataDir })).status, 400);
  await act({ action: 'create', label: 'Beta' }, { dataDir });
  const r = await act({ action: 'rename', portfolio: id, label: 'Acme Travel' }, { dataDir, origin: 'http://localhost:4600' });
  assert.equal(r.status, 200);
  assert.equal(r.out.view.portfolios.find((p: { id: string }) => p.id === id).label, 'Acme Travel');
  const dup = await act({ action: 'rename', portfolio: id, label: 'BETA' }, { dataDir });
  assert.deepEqual([dup.status, dup.out.error], [400, 'There is already a client called BETA']);
  const empty = await act({ action: 'rename', portfolio: id, label: '  ' }, { dataDir });
  assert.deepEqual([empty.status, empty.out.error], [400, 'Give the client a name']);
  assert.equal((await act({ action: 'rename', label: 'X' }, { dataDir })).status, 400, 'no client named');
  assert.equal((await act({ action: 'rename', portfolio: 'pfl_01M500000000000000000000ZZ', label: 'X' }, { dataDir })).status, 404);
});

test('route: rename (and create) are refused with 403 for a non-admin and from another origin', async () => {
  const dataDir = tmp();
  const c = await act({ action: 'create', label: 'Acme' }, { dataDir });
  const id = c.out.portfolio.id as string;
  for (const body of [{ action: 'rename', portfolio: id, label: 'Hijacked' }, { action: 'create', label: 'X' }]) {
    const no = await act(body, { dataDir, admin: false });
    assert.deepEqual([no.status, no.out.error], [403, 'Only an admin can change clients']);
    const cross = await act(body, { dataDir, origin: 'https://evil.example' });
    assert.equal(cross.status, 403);
  }
  assert.equal(JSON.parse(readFileSync(path.join(dataDir, 'portfolios.json'), 'utf8')).portfolios[0].label, 'Acme');
});

// ---- The page ------------------------------------------------------------------------------------

test('the Clients page: its own entry, served at /clients behind the sign-in, in the launcher; Home\'s old tab redirects', () => {
  assert.deepEqual(pageRoutes.clients.path, ['/clients', '/clients.html']);
  assert.equal(pageRoutes.clients.auth, 'session');
  assert.ok((routes as unknown[]).includes(pageRoutes.clients), 'registered before the bundle catch-all');
  assert.ok((routes as unknown[]).indexOf(pageRoutes.clients) < (routes as unknown[]).indexOf(pageRoutes.bundle));
  assert.match(read('vite.config.ts'), /clients: resolve\(import\.meta\.dirname, 'src\/client\/clients\.html'\)/);
  assert.match(read('src/client/ui/portal/topbar.ts'), /label: 'Clients', hint: 'Every client and its projects', href: '\/clients'/);
  const home = read('src/client/home.ts');
  assert.match(home, /if \(asked === 'portfolios'\) location\.replace\('\/clients'\)/);
  assert.doesNotMatch(read('src/client/home.html'), /tab-portfolios|portfolios-view/);
  assert.match(read('src/client/home.html'), /id="to-clients"[^>]*href="\/clients"/);
  // A client's projects are the Projects page's own cards, not a copy.
  assert.match(read('src/client/clients/view.ts'), /import \{ projectCards \} from '\.\.\/home\/project-card'/);
  assert.match(read('src/client/home/portal.ts'), /import \{ projectCards \} from '\.\/project-card'/);
});

test('the Clients page: Rename and New client dialogs, and naming a new client from a project and the wizard', () => {
  const d = read('src/client/ui/portfolios/dialogs.ts');
  assert.match(d, /export function renameClientDialog/);
  assert.match(d, /action: 'rename', portfolio: p\.id, label/);
  assert.match(d, /if \(busy\) return;/, 'sent once');
  assert.match(d, /'＋ New client'/, 'Add to client offers a new client from a project');
  assert.match(read('src/client/ui/wizard/new/portfolio-field.ts'), /'＋ New client…'/);
  assert.doesNotMatch(read('src/client/ui/settings/portfolio.ts'), /disabled: !admin \|\| !v\.portfolios\.length/, 'not a dead end with no client');
});

test('the Clients page logic: address, search, order and a colour that survives a rename', () => {
  assert.equal(clientHref(), '/clients');
  assert.equal(clientHref('pfl_X'), '/clients?client=pfl_X');
  const acme = { label: 'Acme Travel', projects: [{ id: 'a', name: 'Booking Portal' }] };
  assert.ok(clientMatches(acme, ''));
  assert.ok(clientMatches(acme, 'acme'));
  assert.ok(clientMatches(acme, 'booking'));
  assert.ok(!clientMatches(acme, 'beta'));
  assert.deepEqual(sortedClients([{ label: 'beta' }, { label: 'Acme' }, { label: 'cargo' }]).map((p) => p.label), ['Acme', 'beta', 'cargo']);
  assert.equal(paletteOf('pfl_A'), paletteOf('pfl_A'));
  assert.ok(paletteOf('pfl_A') >= 0);
});
