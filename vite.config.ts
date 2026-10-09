import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { buildDocSite } from './src/server/docsite.ts';

// The whiteboard's fonts (Excalidraw's hand-drawn Virgil/Excalifont and friends), served by the
// office itself rather than a CDN. Excalidraw looks for them under window.EXCALIDRAW_ASSET_PATH;
// the version in the path lets them be cached for good. Xiaolai (CJK, 12 MB) is left out: Excalidraw
// falls back to its CDN for that one, only when someone writes Chinese, Japanese or Korean.
const excalidrawDir = resolve(import.meta.dirname, 'node_modules/@excalidraw/excalidraw');
const excalidrawVersion = (JSON.parse(readFileSync(join(excalidrawDir, 'package.json'), 'utf8')) as { version: string }).version;
const EXCALIDRAW_ASSETS = `/assets/excalidraw-${excalidrawVersion}/`;

function excalidrawFonts(): Plugin {
  const fonts = join(excalidrawDir, 'dist/prod/fonts');
  const files = (dir: string, rel = ''): string[] =>
    readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((d) => {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) return d.name === 'Xiaolai' ? [] : files(dir, r);
      return d.name.endsWith('.woff2') ? [r] : [];
    });
  return {
    name: 'excalidraw-fonts',
    configureServer(server) {
      server.middlewares.use(`${EXCALIDRAW_ASSETS}fonts/`, (req, res, next) => {
        const file = join(fonts, decodeURIComponent((req.url ?? '').split('?')[0]));
        if (!file.startsWith(fonts + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('content-type', 'font/woff2');
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const f of files(fonts)) this.emitFile({ type: 'asset', fileName: `${EXCALIDRAW_ASSETS.slice(1)}fonts/${f}`, source: readFileSync(join(fonts, f)) });
    },
  };
}

// The documentation site (/docs): docs/site/*.md rendered into one bundle (server/docsite.ts), written
// to docs/site.json beside the pictures in docs/images/, for the docs page (docs.ts) to read. The dev
// server builds it on each request and hands every other /docs address to docs.html.
const docsDir = resolve(import.meta.dirname, 'docs/site');

function docsSite(): Plugin {
  const images = join(docsDir, 'images');
  return {
    name: 'docs-site',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (p === '/docs/site.json') {
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify(buildDocSite(docsDir).bundle));
        }
        if (p.startsWith('/docs/images/')) {
          const file = join(images, p.slice('/docs/images/'.length));
          if (!file.startsWith(images + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
          return createReadStream(file).pipe(res);
        }
        if (p === '/docs' || p.startsWith('/docs/')) req.url = '/docs.html';
        next();
      });
    },
    generateBundle() {
      const { bundle, problems, images: pics } = buildDocSite(docsDir);
      for (const p of problems) this.warn(`docs/site/${p.file} ${p.problem}`);
      this.emitFile({ type: 'asset', fileName: 'docs/site.json', source: JSON.stringify(bundle) });
      for (const f of pics) this.emitFile({ type: 'asset', fileName: `docs/images/${f}`, source: readFileSync(join(images, f)) });
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/client'),
  publicDir: resolve(import.meta.dirname, 'src/client/public'),
  plugins: [excalidrawFonts(), docsSite()],
  define: {
    __EXCALIDRAW_ASSETS__: JSON.stringify(EXCALIDRAW_ASSETS),
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    // PERF_SOURCEMAP=1 (the performance guard's own builds, scripts/perf/): hidden source maps beside
    // the bundles, so a long task's stack names the source file and line. Never in a normal build.
    sourcemap: process.env.PERF_SOURCEMAP === '1' ? 'hidden' : false,
    rollupOptions: {
      onwarn(warning, warn) {
        // Excalidraw's Radix UI parts start with "use client", which means nothing outside React Server Components.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
      input: {
        lite: resolve(import.meta.dirname, 'src/client/lite.html'),
        pixel: resolve(import.meta.dirname, 'src/client/pixel.html'),
        home: resolve(import.meta.dirname, 'src/client/home.html'),
        firm: resolve(import.meta.dirname, 'src/client/firm.html'),
        login: resolve(import.meta.dirname, 'src/client/login.html'),
        claim: resolve(import.meta.dirname, 'src/client/claim.html'),
        join: resolve(import.meta.dirname, 'src/client/join.html'),
        docs: resolve(import.meta.dirname, 'src/client/docs.html'),
        m: resolve(import.meta.dirname, 'src/client/m.html'),
        setup: resolve(import.meta.dirname, 'src/client/setup.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Not the string shorthand: that sets changeOrigin, so /api would see Host :4600 while /ws sees
      // Vite's port, and the session cookie (named per port, see auth.ts) would never reach the socket.
      '/api': { target: 'http://localhost:4600', changeOrigin: false },
      '/ws': { target: 'ws://localhost:4600', ws: true },
    },
  },
});
