// `npm run pack` (in desktop/, or `npm run desktop:pack` from the office's folder): an unpacked build of
// the app for this platform in desktop/out/Mx Office-<platform>-<arch>/, runnable as it is (on a Mac:
// Mx Office.app inside it, bundle id com.mxoffice.desktop). No installer, no auto-update and no code signing
// or notarization yet (docs/site/administration/desktop-app.md says what those need, and how to open the
// unsigned Mac app past Gatekeeper).
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
// The macOS one (the app bundle, the Dock): desktop/assets/icon.icns, made by the same script.
const icnsFile = path.join(root, 'assets', 'icon.icns');
const icon = process.platform === 'win32' ? icoFile : process.platform === 'darwin' ? icnsFile : undefined;

const paths = await packager({
  dir: root,
  out,
  overwrite: true,
  platform: process.platform,
  arch: process.arch,
  name: 'Mx Office',
  executableName: 'mx-office',
  appBundleId: 'com.mxoffice.desktop',
  icon,
  // macOS: the bundle's category and its light and dark appearance (Info.plist).
  appCategoryType: 'public.app-category.developer-tools',
  darwinDarkModeSupport: true,
  // A network that cuts long downloads: ELECTRON_ZIP_DIR names a folder with electron-v<version>-<platform>-<arch>.zip.
  ...(process.env.ELECTRON_ZIP_DIR ? { electronZipDir: process.env.ELECTRON_ZIP_DIR } : {}),
  asar: true,
  prune: true,
  ignore: [/^\/src($|\/)/, /^\/out($|\/)/, /^\/scripts($|\/)/, /^\/tsconfig\.json$/, /^\/\.gitignore$/],
  win32metadata: { CompanyName: 'Mx Office', ProductName: 'Mx Office', FileDescription: 'Mx Office (desktop preview)' },
});
console.log(`Built: ${paths.join(', ')}`);
