// `npm run pack` (in desktop/, or `npm run desktop:pack` from the office's folder): an unpacked build of
// the app for this platform in desktop/out/Mx Office-<platform>-<arch>/, runnable as it is. No installer,
// no auto-update and no code signing yet (docs/site/administration/desktop-app.md says what those need).
// The app still runs the office from your checkout with the system Node: keep the folder inside the
// checkout (out/ is) or start it with --office-dir, or it asks for the folder the first time.
import { packager } from '@electron/packager';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out');
mkdirSync(out, { recursive: true });

// A Windows icon: an .ico holding the PNG as it is (Windows Vista and later read those).
const png = readFileSync(path.join(root, 'assets', 'icon.png'));
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
const side = png.readUInt32BE(16);
ico.writeUInt8(side >= 256 ? 0 : side, 6);
ico.writeUInt8(side >= 256 ? 0 : side, 7);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
const icoFile = path.join(out, 'icon.ico');
writeFileSync(icoFile, Buffer.concat([ico, png]));

const paths = await packager({
  dir: root,
  out,
  overwrite: true,
  platform: process.platform,
  arch: process.arch,
  name: 'Mx Office',
  executableName: 'mx-office',
  appBundleId: 'com.mxoffice.desktop',
  icon: process.platform === 'win32' ? icoFile : undefined,
  asar: true,
  prune: true,
  ignore: [/^\/src($|\/)/, /^\/out($|\/)/, /^\/scripts($|\/)/, /^\/tsconfig\.json$/, /^\/\.gitignore$/],
  win32metadata: { CompanyName: 'Mx Office', ProductName: 'Mx Office', FileDescription: 'Mx Office (desktop preview)' },
});
console.log(`Built: ${paths.join(', ')}`);
