// Import from folder on a client's Design system part, in headless Chromium with every client stylesheet, in
// Portal Light and Dark: 📁 Import from folder… (admins only) opens the dialog (✕ and Esc give focus back to
// the button), Scan shows the mapping review (swatches, sources file:line, confidence, the candidates' dropdown,
// the folder's --mxt-* passthrough and dark toggles, found-not-imported), the preview and contrast check change
// live with a choice, Save as draft sends the choices (never a token value), and ↻ Re-import shows the tokens that
// change against v1. The scan views are the real scanner's on the neutral fixtures; every call is answered here.
// DESIGN_IMPORT_SHOTS=<dir> also saves screenshots there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import { checkImportPath, scanDesignSource } from '../src/server/design/import/scan.js';
import { suggestMapping } from '../src/shared/design/import/suggest.js';
import type { ImportScanView } from '../src/shared/design/import/types.js';
import { DEFAULT_INPUT, deriveTokens } from '../src/shared/design/tokens.js';

const root = path.join(import.meta.dirname, '..');
const FIX = path.join(import.meta.dirname, 'fixtures', 'design-import');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
function sheets(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(root, dir)).sort()) {
    const p = path.join(dir, e);
    if (statSync(path.join(root, p)).isDirectory()) out.push(...sheets(p));
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}
const ACME = 'pfl_01JA0000000000000000000001';
const OFFICE = {
  dataDir: path.join(tmpdir(), 'ao-nowhere-data'),
  projectsDir: path.join(tmpdir(), 'ao-nowhere-projects'),
  codeDir: path.join(tmpdir(), 'ao-nowhere-code'),
};

async function viewOf(dir: string, display: string, baseline?: ImportScanView['baseline']): Promise<ImportScanView> {
  const c = await checkImportPath(dir, OFFICE);
  if ('error' in c) throw new Error(c.error);
  const s = await scanDesignSource(display, c);
  if ('error' in s) throw new Error(s.error);
  const { suggestion, unmapped } = suggestMapping(s);
  return {
    scanId: 'imp_test',
    source: display,
    kind: s.kind,
    files: s.files.map((f) => ({ path: f.path, format: f.format })),
    skippedCounts: s.skippedCounts,
    skipped: s.skipped,
    remote: s.remote,
    notImported: s.notImported,
    darkHow: s.darkHow,
    suggestion,
    unmapped,
    ...(baseline ? { baseline } : {}),
  };
}

test('the pieces are modules of their own; nothing in lite.ts', () => {
  assert.doesNotMatch(read('src/client/lite.ts'), /design\/import|openImport/);
  assert.match(read('src/client/clients/design.ts'), /openImport\(/);
  assert.match(read('src/server/http/routes/index.ts'), /designImportRoutes\.act/);
});

const chrome = findChrome();
let setup:
  | Promise<{
      bundle: string;
      css: string;
      first: ImportScanView;
      again: ImportScanView;
      mxt: ImportScanView;
    }>
  | undefined;
/** The bundle, the stylesheets and the scan views: made once for both themes. */
function prepare() {
  setup ??= (async () => {
    const out = await build({
      stdin: {
        contents: `import { designPart } from './design';
        document.getElementById('host').append(designPart('${ACME}', window.ADMIN));`,
        resolveDir: path.join(root, 'src/client/clients'),
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'iife',
      loader: { '.css': 'empty' },
      logLevel: 'silent',
    });
    const css = sheets('src/client')
      .filter((f) => !/login\.css$|[\\/]mobile[\\/]|[\\/]first-run[\\/]/.test(f))
      .map((f) => read(f).replace(/@import[^;]+;/g, ''))
      .join('\n');
    const first = await viewOf(path.join(FIX, 'css-vars'), 'C:\\work\\acme-brand-site');
    const v1 = deriveTokens({
      ...DEFAULT_INPUT,
      primary: '#0b5fff',
      danger: '#d93025',
      background: '#f4f6f9',
      text: '#1b2430',
    });
    const again = await viewOf(path.join(FIX, 'css-vars'), 'C:\\work\\acme-brand-site', { label: 'v1', ...v1 });
    const mxt = await viewOf(path.join(FIX, 'mxt'), 'C:\\work\\acme-mxt-tokens');
    return { bundle: out.outputFiles[0].text, css, first, again, mxt };
  })();
  return setup;
}

for (const theme of ['portal-light', 'portal-dark'])
  test(`in a browser (${theme}): Import from folder, the mapping review, live preview, Save as draft, Re-import diff`, { skip: chrome ? false : 'no Chromium here' }, async () => {
    const { bundle, css, first, again, mxt } = await prepare();
    const out = { outputFiles: [{ text: bundle }] };
    const shots = process.env.DESIGN_IMPORT_SHOTS;
    if (shots) mkdirSync(shots, { recursive: true });
    const browser = await chromium.launch({
      headless: true,
      executablePath: chrome!,
    });
    try {
      {
        const page = await browser.newPage({
          viewport: { width: 1360, height: 1000 },
        });
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        let admin = true;
        let imported: unknown = null;
        let scanView: ImportScanView = first;
        const saves: Record<string, unknown>[] = [];
        const html = () => `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${css}</style></head><body class="clients-page"><main class="home-main"><div id="host"></div></main><div id="modal-root"></div><div id="toasts"></div><script>window.ADMIN=${admin}</script></body></html>`;
        await page.route('http://office.test/**', async (r) => {
          const u = new URL(r.request().url());
          const json = (v: unknown, status = 200) =>
            r.fulfill({
              status,
              contentType: 'application/json',
              body: JSON.stringify(v),
            });
          if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html() });
          if (u.pathname === '/api/design')
            return json({
              client: ACME,
              label: 'Acme Logistics',
              versions: [],
              admin,
            });
          if (u.pathname === '/api/design/import' && r.request().method() === 'GET') return json({ imported });
          if (u.pathname === '/api/design/import') {
            const b = JSON.parse(r.request().postData() ?? '{}');
            if (b.action === 'scan')
              return b.path.includes('nowhere')
                ? json(
                    {
                      error: 'There’s nothing at C:\\nowhere on the office’s machine (or it can’t be read)',
                    },
                    400,
                  )
                : json(scanView);
            saves.push(b);
            return json({ ok: true, overrides: 1 });
          }
          return r.fulfill({
            status: 404,
            contentType: 'application/json',
            body: '{}',
          });
        });
        const T = <R>(js: string) => page.evaluate(js) as Promise<R>;
        const shot = async (name: string, sel?: string) => {
          if (!shots) return;
          if (sel)
            await page
              .locator(sel)
              .first()
              .screenshot({ path: path.join(shots, `${name}-${theme}.png`) });
          else
            await page.screenshot({
              path: path.join(shots, `${name}-${theme}.png`),
            });
        };

        // Not an admin: no import.
        admin = false;
        await page.goto('http://office.test/');
        await page.addScriptTag({ content: out.outputFiles[0].text });
        await page.waitForSelector('.ds-part h3');
        await page.waitForTimeout(200);
        assert.equal(await T<number>(`document.querySelectorAll('[data-act="import"]').length`), 0);

        admin = true;
        await page.goto('http://office.test/');
        await page.addScriptTag({ content: out.outputFiles[0].text });
        await page.waitForSelector('[data-act="import"]');
        assert.equal(await T<string>(`document.querySelector('[data-act="import"]').textContent`), '📁 Import from folder…');
        // ✕ and Esc give focus back.
        await page.click('[data-act="import"]');
        await page.waitForSelector('.di-modal');
        await page.click('.di-modal header .close');
        await page.waitForFunction(() => !document.querySelector('.di-modal'));
        assert.equal(await T<string>(`document.activeElement.dataset.act`), 'import', '✕: focus back');
        await page.click('[data-act="import"]');
        await page.waitForSelector('.di-modal');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.di-modal'));
        assert.equal(await T<string>(`document.activeElement.dataset.act`), 'import', 'Esc: focus back');

        // A path that isn't there: said in words, the dialog stays.
        await page.click('[data-act="import"]');
        await page.fill('[data-k="path"]', 'C:\\nowhere');
        await page.click('[data-act="scan"]');
        await page.waitForFunction(() => /nothing at/.test(document.querySelector('.di-msg')?.textContent ?? ''));
        await page.fill('[data-k="path"]', 'C:\\work\\acme-brand-site');
        await shot('import-dialog', '.di-modal');
        await page.click('[data-act="scan"]');
        await page.waitForSelector('.di-map');

        // The review: every field, swatches, sources, confidence, candidates.
        assert.equal(await T<number>(`document.querySelectorAll('.di-map tbody tr').length`), 12);
        assert.match(await T<string>(`document.querySelector('tr[data-field="primary"] .di-src').textContent`), /--color-primary styles\/tokens\.css:3/);
        assert.equal(await T<string>(`document.querySelector('tr[data-field="primary"] .di-conf').textContent`), 'High');
        assert.equal(await T<string>(`getComputedStyle(document.querySelector('tr[data-field="primary"] .di-swatch')).backgroundColor`), 'rgb(11, 95, 255)');
        assert.ok((await T<number>(`document.querySelector('select[data-field="primary"]').options.length`)) >= 3, 'alternatives, the default and your own');
        assert.match(await T<string>(`document.querySelector('.di-found').textContent`), /Found, not imported \(separate work\): 1 logo, 1 page layout\. Branded Atlas covers colours, type, density and shape/);
        assert.match(await T<string>(`document.querySelector('.di-skips summary').textContent`), /1 web address \(never fetched\)/);
        assert.match(await T<string>(`document.querySelector('.ds-checks').textContent`), /Text on background/);
        assert.equal(await T<number>(`document.querySelectorAll('.di-previews .ds-preview').length`), 2, 'light and dark previews');
        await shot('mapping-review', '.di-modal');
        await shot('preview-contrast', '.di-side');

        // Live: an alternative changes the preview's button colour.
        const btn = `getComputedStyle(document.querySelector('.di-previews figure:first-child .ds-pv-btn')).backgroundColor`;
        assert.equal(await T<string>(btn), 'rgb(11, 95, 255)');
        await T(`(() => { const s = document.querySelector('select[data-field="primary"]'); s.value = s.options[1].value; s.dispatchEvent(new Event('change')); })()`);
        assert.notEqual(await T<string>(btn), 'rgb(11, 95, 255)');
        await T(`(() => { const s = document.querySelector('select[data-field="primary"]'); s.value = s.options[0].value; s.dispatchEvent(new Event('change')); })()`);

        // Save as draft: choices, never a token value or path.
        await page.click('[data-act="save"]');
        await page.waitForFunction(() => !document.querySelector('.di-modal'));
        assert.equal(saves.length, 1);
        const sent = saves[0] as {
          scanId: string;
          choices: Record<string, { value: string; candidate?: string }>;
          passthrough: boolean;
        };
        assert.equal(sent.scanId, 'imp_test');
        assert.equal(sent.choices.primary.value, '#0b5fff');
        assert.ok(sent.choices.primary.candidate);
        assert.equal('path' in sent, false);

        // ↻ Re-import: the folder prefilled, the diff against v1.
        imported = {
          source: 'C:\\work\\acme-brand-site',
          kind: 'folder',
          scannedAt: '2026-10-22T09:00:00.000Z',
          files: 3,
          overrides: 1,
          notImported: {
            fonts: [],
            logos: ['index.html: img/logo.svg'],
            layouts: ['index.html'],
          },
          on: 1,
        };
        scanView = again;
        await page.goto('http://office.test/');
        await page.addScriptTag({ content: out.outputFiles[0].text });
        await page.waitForSelector('[data-act="reimport"]');
        assert.match(await T<string>(`document.querySelector('.ds-imported').textContent`), /v1 was imported from C:\\work\\acme-brand-site/);
        await page.click('[data-act="reimport"]');
        await page.waitForSelector('.di-modal');
        assert.equal(await T<string>(`document.querySelector('[data-k="path"]').value`), 'C:\\work\\acme-brand-site');
        await page.click('[data-act="scan"]');
        await page.waitForSelector('.di-diff');
        assert.match(await T<string>(`document.querySelector('.di-diff h4').textContent`), /tokens? change against v1/);
        assert.ok(await T<boolean>(`!!document.querySelector('.di-diff tr[data-token="light:line"]')`), 'the border colour taken as it was is a change');
        assert.ok(!(await T<boolean>(`!!document.querySelector('.di-diff tr[data-token="light:brand"]')`)), 'brand is the same as v1');
        await shot('reimport-diff', '.di-modal');
        await page.keyboard.press('Escape');

        // A folder with --mxt-*: the passthrough toggle and what mxcli wouldn't take.
        scanView = mxt;
        await page.click('[data-act="import"]');
        await page.fill('[data-k="path"]', 'C:\\work\\acme-mxt-tokens');
        await page.click('[data-act="scan"]');
        await page.waitForSelector('[data-k="passthrough"]');
        assert.match(await T<string>(`document.querySelector('.di-ignored').textContent`), /--mxt-secondary .*mxcli would refuse the file/);
        assert.match(await T<string>(`document.querySelector('.di-taken').textContent`), /token values? taken as the folder has/);
        await shot('mxt-passthrough', '.di-modal');
        await page.keyboard.press('Escape');
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });
