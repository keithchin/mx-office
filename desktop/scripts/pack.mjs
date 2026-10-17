// `npm run pack` (in desktop/, or `npm run desktop:pack` from the office's folder): an unpacked build of
// the app for this platform in desktop/out/Mx Office-<platform>-<arch>/, runnable as it is. No installer,
// no auto-update and no code signing yet (docs/site/administration/desktop-app.md says what those need).
// The app still runs the office from your checkout with the system Node: keep the folder inside the
// checkout (out/ is) or start it with --office-dir, or it asks for the folder the first time.
import { packager } from '@electron/packager';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out');
mkdirSync(out, { recursive: true });

// The Windows icon (exe, taskbar): desktop/assets/icon.ico, several sizes of the office's Mx mark, made by
// scripts/make-icons.mjs and committed, so packing needs nothing extra.
const icoFile = path.join(root, 'assets', 'icon.ico');

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
  // A network that cuts long downloads: ELECTRON_ZIP_DIR names a folder with electron-v<version>-<platform>-<arch>.zip.
  ...(process.env.ELECTRON_ZIP_DIR ? { electronZipDir: process.env.ELECTRON_ZIP_DIR } : {}),
  asar: true,
  prune: true,
  ignore: [/^\/src($|\/)/, /^\/out($|\/)/, /^\/scripts($|\/)/, /^\/tsconfig\.json$/, /^\/\.gitignore$/],
  win32metadata: { CompanyName: 'Mx Office', ProductName: 'Mx Office', FileDescription: 'Mx Office (desktop preview)' },
});
console.log(`Built: ${paths.join(', ')}`);
