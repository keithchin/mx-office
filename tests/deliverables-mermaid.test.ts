// Mermaid in the deliverables viewer (src/client/ui/deliverables/mermaid.ts): drawn in the office theme's
// light or dark, the source kept when Mermaid can't draw a block; and mermaid and playwright-core are
// the office's own runtime dependencies, pinned to what's installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mermaidTheme, renderBlocks, type MermaidApi, type MermaidBlock } from '../src/client/ui/deliverables/mermaid.js';

const block = (source: string, log: string[]): MermaidBlock => ({ source, done: (svg) => void log.push(`done ${svg}`), failed: (why) => void log.push(`failed ${why}`) });

test('the theme follows the office: dark for Dark, Terminal and Clean (Dark), default otherwise', () => {
  assert.equal(mermaidTheme('dark'), 'dark');
  assert.equal(mermaidTheme('terminal'), 'dark');
  assert.equal(mermaidTheme('clean-dark'), 'dark');
  assert.equal(mermaidTheme('clean-light'), 'default');
  assert.equal(mermaidTheme(undefined), 'default');
});

test('each block is drawn strict, in that theme; one Mermaid cannot parse keeps its source', async () => {
  const log: string[] = [];
  let config: Record<string, unknown> = {};
  const api: MermaidApi = {
    initialize: (c) => void (config = c),
    render: async (_id, text) => {
      if (text.includes('oops')) throw new Error('Parse error on line 1:\nmore');
      return { svg: `<svg>${text}</svg>` };
    },
  };
  const n = await renderBlocks([block('graph TD; A-->B', log), block('oops', log)], 'dark', async () => api);
  assert.equal(n, 1);
  assert.deepEqual(config, { startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
  assert.deepEqual(log, ['done <svg>graph TD; A-->B</svg>', 'failed Parse error on line 1:']);
});

test('Mermaid not loading leaves every block as source, and nothing loads without a block', async () => {
  const log: string[] = [];
  let loads = 0;
  assert.equal(await renderBlocks([], 'default', async () => (loads++, {} as MermaidApi)), 0);
  assert.equal(loads, 0);
  assert.equal(await renderBlocks([block('a', log), block('b', log)], 'default', () => Promise.reject(new Error('offline'))), 0);
  assert.deepEqual(log, ["failed Mermaid didn't load: offline", "failed Mermaid didn't load: offline"]);
});

test('mermaid and playwright-core are runtime dependencies, pinned to the installed versions', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  for (const name of ['mermaid', 'playwright-core']) {
    const installed = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version;
    assert.equal(pkg.dependencies[name], installed, name);
    assert.equal(pkg.devDependencies[name], undefined, name);
    assert.equal(lock.packages[''].dependencies[name], installed, name);
    assert.equal(lock.packages[`node_modules/${name}`].version, installed, name);
    assert.ok(!lock.packages[`node_modules/${name}`].dev, `${name} is not dev-only in the lock`);
  }
});
