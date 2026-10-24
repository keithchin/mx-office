// The page Preview's frame (client/ui/model/page-frame.ts), shared by the Model tab and the Developer view's
// explorer, painted in headless Chromium, both headless modes. A sandboxed frame given a second srcdoc is
// loaded but never painted again in Chromium (it stays blank until something resizes it), which left the
// Preview blank whenever it was drawn again (the layout or snippets arriving, a width switch, showing a page
// after another). Each case's frame is screenshotted and must show the page, not an empty grey box.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';

const root = path.join(import.meta.dirname, '..');
const chrome = findChrome();
const MDL = "create or modify page VisitorDesk.Visitor_NewEdit (\n  Title: 'Visitor',\n  Layout: Atlas_Core.Atlas_Default\n) {\n  dataview dv (DataSource: $Visitor) {\n    textbox tbName (Label: 'Name', Attribute: Name)\n    actionbutton btnSave (Caption: 'Save', ButtonStyle: Primary)\n  }\n}";
const LAY = "create or modify layout Atlas_Core.Atlas_Default (\n) {\n  container header (Class: 'top') {\n    dynamictext t (Content: 'Layout header')\n  }\n  placeholder Main\n}";

const CASES = ['nothing to fetch: drawn again at once', 'drawn again later', 'the layout arrives: another document', 'shown, cleared, shown', 'another width', 'one page, then another'];

async function harness() {
  const res = await build({
    stdin: {
      contents: `
        import '../model/page.css';
        import { pageFrame } from '../model/page-frame';
        const MDL = ${JSON.stringify(MDL)};
        const LAY = ${JSON.stringify(LAY)};
        const OTHER = MDL.replace("Label: 'Name'", "Label: 'Host'");
        const mk = (i, fetch) => {
          const box = document.createElement('div');
          box.className = 'case';
          box.dataset.i = String(i);
          box.style.cssText = 'position:relative;width:700px;height:230px;margin:6px';
          document.body.append(box);
          const f = pageFrame(fetch);
          box.append(f.el);
          return f;
        };
        window.run = () => {
          mk(0, async () => null).show(MDL);
          mk(1, () => new Promise((r) => setTimeout(() => r(null), 300))).show(MDL);
          mk(2, async (t) => (t === 'layout' ? LAY : null)).show(MDL);
          const d = mk(3, async () => null); d.show(MDL); d.clear(); d.show(MDL);
          const e = mk(4, async () => null); e.show(MDL); setTimeout(() => e.el.querySelectorAll('button')[1].click(), 200);
          const f = mk(5, async () => null); f.show(MDL); setTimeout(() => f.show(OTHER), 200);
        };`,
      resolveDir: path.join(root, 'src/client/ui/app-workspace'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'iife',
    loader: { '.css': 'css' },
    logLevel: 'silent',
  });
  return { js: res.outputFiles.find((f) => f.path.endsWith('.js'))!.text, css: res.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '' };
}

/** How many pixels of a screenshot aren't the frame's empty grey (#f8f8f8) or white. */
async function inkOf(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.min(d[i], d[i + 1], d[i + 2]) < 230) n++;
    return n;
  }, png.toString('base64'));
}

for (const mode of ['headless', 'new'] as const) {
  test(`the Preview's frame paints every time it's drawn (${mode === 'new' ? 'new' : 'default'} headless)`, { skip: chrome ? false : 'no Chromium here', timeout: 60_000 }, async () => {
    const h = await harness();
    const browser = await chromium.launch({ headless: true, executablePath: chrome!, ...(mode === 'new' ? { args: ['--headless=new'] } : {}) });
    try {
      const page = await browser.newPage({ viewport: { width: 740, height: 1500 } });
      await page.setContent(`<!doctype html><html><head><style>${h.css}</style></head><body></body></html>`);
      await page.addScriptTag({ content: h.js });
      await page.evaluate(() => (window as unknown as { run(): void }).run());
      await page.waitForTimeout(900);
      for (const [i, name] of CASES.entries()) {
        const frames = page.locator(`.case[data-i="${i}"] .pgp-frame`);
        assert.equal(await frames.count(), 1, `${name}: one frame on screen`);
        const ink = await inkOf(page, await frames.screenshot());
        assert.ok(ink > 1500, `${name}: the page is painted (${ink} inked pixels)`);
      }
      // The other page really is the other page.
      const texts = await Promise.all(page.frames().filter((f) => f !== page.mainFrame()).map((f) => f.evaluate(() => document.body?.innerText ?? '').catch(() => '')));
      assert.ok(texts.some((t) => t.includes('Host')), 'the second page drawn');
    } finally {
      await browser.close();
    }
  });
}
