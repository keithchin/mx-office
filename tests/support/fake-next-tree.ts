// A synthetic legacy source folder for the source-folder tests and screenshots: a fake Next.js app with
// what a real tree carries that must never be copied (node_modules, nested too; .git, .next, dist, build,
// coverage, .turbo, __pycache__; .env files, a .pem, a .key and a .pfx; a file over the size cap). Its code
// files carry CONTENT_MARKER, so a test can prove no file's contents reach the planner. Nothing real.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const CONTENT_MARKER = 'SYNTHETIC-CONTENT-MARKER-7f3a';

/** What fakeNextTree keeps (files) and how it adds up. */
export const KEPT = ['package.json', 'next.config.js', 'README.md', 'app/page.tsx', 'app/layout.tsx', 'app/orders/page.tsx', 'app/orders/[id]/page.tsx', 'lib/db.ts', 'prisma/schema.prisma', 'packages/ui/button.tsx', 'public/logo.svg'];

export function fakeNextTree(root: string, opts: { bigBytes?: number } = {}): string {
  const put = (rel: string, text: string | Buffer) => {
    const f = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, text);
  };
  put('package.json', JSON.stringify({ name: 'shop-app', private: true, dependencies: { next: '15.0.0', react: '19.0.0' } }, null, 2));
  put('next.config.js', `// ${CONTENT_MARKER}\nmodule.exports = { reactStrictMode: true };\n`);
  put('README.md', `# Shop app\n\n${CONTENT_MARKER}\n`);
  put('app/page.tsx', `export default function Home() { return <main>${CONTENT_MARKER}</main>; }\n`);
  put('app/layout.tsx', 'export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n');
  put('app/orders/page.tsx', `export default function Orders() { return <ul data-x="${CONTENT_MARKER}" />; }\n`);
  put('app/orders/[id]/page.tsx', 'export default function Order() { return null; }\n');
  put('lib/db.ts', `export const url = process.env.DATABASE_URL; // ${CONTENT_MARKER}\n`);
  put('prisma/schema.prisma', 'model Order { id Int @id\n  status String }\n');
  put('packages/ui/button.tsx', 'export const Button = () => null;\n');
  put('public/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  // Never copied: dependencies, build output, caches, version control.
  put('node_modules/react/index.js', 'module.exports = {};\n');
  put('packages/ui/node_modules/left-pad/index.js', 'module.exports = 1;\n');
  put('.git/HEAD', 'ref: refs/heads/main\n');
  put('.next/cache/webpack.pack', 'x');
  put('dist/out.js', 'x');
  put('build/out.js', 'x');
  put('coverage/lcov.info', 'x');
  put('.turbo/cache.json', '{}');
  put('scripts/__pycache__/x.pyc', 'x');
  // Never copied: secrets-like files.
  put('.env', 'DATABASE_URL=postgres://user:hunter2@db/shop\n');
  put('.env.local', 'STRIPE_KEY=sk_test_synthetic\n');
  put('certs/server.pem', '-----BEGIN CERTIFICATE-----\nsynthetic\n');
  put('certs/app.key', 'synthetic key\n');
  put('certs/client.pfx', 'synthetic pfx\n');
  // Never copied: over the size cap.
  put('public/demo-video.mp4', Buffer.alloc(opts.bigBytes ?? 5 * 1024 * 1024 + 1));
  return root;
}
