// Makes the desktop app's icons in desktop/assets/ from the office's own mark, src/client/public/favicon.svg
// (the Portal's "Mx" tile, also the browser tab's and the phone version's icon). The output is committed, so
// packing and running the app never need this script: run it again only when the mark changes, from the
// office's folder (it uses the office's own playwright-core and its Chromium, nothing new to install):
//   node desktop/scripts/make-icons.mjs [--chrome <path to a Chromium chrome.exe, e.g. one in %LOCALAPPDATA%/ms-playwright>]
// It writes:
//   icon.ico      Windows: exe, taskbar and window (16, 24, 32, 48, 64, 128 as 32-bit bitmaps, 256 as PNG)
//   icon.png      512 px, for notifications, macOS/Linux and a future installer
//   tray.png      16 px tray icon, and tray@2x.png (32 px) that Electron picks on a 200% display
// Each size is drawn from the SVG at that size (not scaled down from a big one), so small ones stay sharp.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(path.join(desktop, '..', 'src', 'client', 'public', 'favicon.svg'), 'utf8');
const assets = path.join(desktop, 'assets');
const i = process.argv.indexOf('--chrome');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const browser = await chromium.launch({ headless: true, ...(i > 0 ? { executablePath: process.argv[i + 1] } : {}) });
const page = await browser.newPage();
await page.setContent('<!doctype html><body></body>');
/** RGBA pixels and a PNG of the mark drawn at size x size. */
async function render(size) {
  const r = await page.evaluate(
    async ({ svg, size }) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, size, size);
      return { rgba: Array.from(g.getImageData(0, 0, size, size).data), png: c.toDataURL('image/png').split(',')[1] };
    },
    { svg, size },
  );
  return { size, rgba: Buffer.from(r.rgba), png: Buffer.from(r.png, 'base64') };
}

/** A 32-bit BMP icon image: BITMAPINFOHEADER (height doubled for the mask), BGRA rows bottom-up, an all-clear AND mask. */
function dib({ size, rgba }) {
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(size, 4);
  head.writeInt32LE(size * 2, 8);
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(32, 14);
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = ((size - 1 - y) * size + x) * 4;
      px[d] = rgba[s + 2];
      px[d + 1] = rgba[s + 1];
      px[d + 2] = rgba[s];
      px[d + 3] = rgba[s + 3];
    }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  head.writeUInt32LE(px.length + mask.length, 20);
  return Buffer.concat([head, px, mask]);
}

function ico(images) {
  const dir = Buffer.alloc(6 + 16 * images.length);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(images.length, 4);
  const datas = images.map((im) => (im.size >= 256 ? im.png : dib(im)));
  let offset = dir.length;
  images.forEach((im, k) => {
    const e = 6 + 16 * k;
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, e);
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, e + 1);
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(datas[k].length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += datas[k].length;
  });
  return Buffer.concat([dir, ...datas]);
}

const images = [];
for (const s of ICO_SIZES) images.push(await render(s));
writeFileSync(path.join(assets, 'icon.ico'), ico(images));
writeFileSync(path.join(assets, 'icon.png'), (await render(512)).png);
writeFileSync(path.join(assets, 'tray.png'), images.find((im) => im.size === 16).png);
writeFileSync(path.join(assets, 'tray@2x.png'), images.find((im) => im.size === 32).png);
await browser.close();
console.log(`Wrote icon.ico (${ICO_SIZES.join(', ')}), icon.png (512), tray.png (16), tray@2x.png (32) in ${assets}`);
