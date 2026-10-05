// The documentation site (/docs): the rules it's built by (shared/docsite.ts, server/docsite.ts), and
// the real pages in docs/site/ held to them: every link and picture there, the reference pages in step
// with the code, and the pages promised for features still being built.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildNav,
  docMeta,
  fileToSlug,
  findPage,
  parseFrontMatter,
  readingOrder,
  resolveDocHref,
  resolveDocImage,
  searchDocs,
  slugFromPath,
  slugify,
  trail,
  type DocPage,
} from '../src/shared/docsite.js';
import { buildDocSite, plainText, renderDoc } from '../src/server/docsite.js';

const root = path.join(import.meta.dirname, '..');
const site = path.join(root, 'docs/site');
const fixed = { updated: () => '2026-10-05' };

test('front matter: strings, numbers, both kinds of list, and a body without any', () => {
  const { data, body } = parseFrontMatter('---\ntitle: "Live app"\nweight: 8\naliases: [/docs/a, b]\ntags:\n  - one\n  - "two"\n---\n\n# Hi\n');
  assert.deepEqual(data, { title: 'Live app', weight: 8, aliases: ['/docs/a', 'b'], tags: ['one', 'two'] });
  assert.equal(body, '\n# Hi\n');
  assert.deepEqual(parseFrontMatter('# No front matter\n'), { data: {}, body: '# No front matter\n' });
  assert.deepEqual(parseFrontMatter('﻿---\r\ntitle: x\r\n---\r\nbody').data, { title: 'x' });
  const meta = docMeta({ weight: 3, aliases: '/docs/old' }, 'fallback');
  assert.deepEqual(meta, { title: 'fallback', description: undefined, weight: 3, aliases: ['/docs/old'], badge: undefined });
});

test('addresses: files to slugs, /docs paths to slugs, and heading anchors as GitHub makes them', () => {
  assert.equal(fileToSlug('_index.md'), '');
  assert.equal(fileToSlug('get-started/_index.md'), 'get-started');
  assert.equal(fileToSlug('get-started/quick-start.md'), 'get-started/quick-start');
  assert.equal(fileToSlug('a\\b.md'), 'a/b');
  assert.equal(slugFromPath('/docs'), '');
  assert.equal(slugFromPath('/docs/'), '');
  assert.equal(slugFromPath('/docs/a/b'), 'a/b');
  assert.equal(slugFromPath('/docs/a/b/'), 'a/b');
  assert.equal(slugFromPath('/docsx'), undefined);
  assert.equal(slugFromPath('/home'), undefined);
  assert.equal(slugify('Step 1: Start the office'), 'step-1-start-the-office');
  assert.equal(slugify('Top bar & menu'), 'top-bar--menu');
  assert.equal(slugify('<code>office-workers</code> CLI'), 'office-workers-cli');
});

test('links: relative .md links and /docs links stay in the docs, the rest leave', () => {
  assert.deepEqual(resolveDocHref('get-started/quick-start.md', '../teams-and-agents/autonomy.md#levels'), { slug: 'teams-and-agents/autonomy', hash: 'levels' });
  assert.deepEqual(resolveDocHref('get-started/quick-start.md', 'tour.md'), { slug: 'get-started/tour', hash: undefined });
  assert.deepEqual(resolveDocHref('_index.md', 'get-started/_index.md'), { slug: 'get-started', hash: undefined });
  assert.deepEqual(resolveDocHref('faq.md', '#getting-in'), { slug: 'faq', hash: 'getting-in' });
  assert.deepEqual(resolveDocHref('faq.md', '/docs/reference/glossary'), { slug: 'reference/glossary', hash: undefined });
  for (const away of ['https://docs.mendix.com/', 'mailto:x@y', '/home', '../../README.html', '//evil.example']) assert.equal(resolveDocHref('faq.md', away), undefined, away);
  assert.equal(resolveDocImage('using-the-office/board.md', '../images/board.png'), '/docs/images/board.png');
  assert.equal(resolveDocImage('_index.md', 'images/board.png'), '/docs/images/board.png');
  assert.equal(resolveDocImage('using-the-office/board.md', 'images/board.png'), undefined);
  assert.equal(resolveDocImage('faq.md', 'https://example.com/x.png'), undefined);
});

test('rendering: anchored headings, callouts, code with a copy button, tables in their own scroller', () => {
  const md = [
    '# Title',
    '## Step one',
    '### Step one',
    '## Custom {#my-id}',
    '> [!WARNING]',
    '> Restarting stops agents.',
    '',
    '> Just a quote.',
    '',
    '```bash',
    'npm run build <x>',
    '```',
    '',
    '| a | b |',
    '|:--|--:|',
    '| 1 | 2 |',
    '',
    '[out](https://example.com) [in](../faq.md#q) ![pic](../images/board.png "Cap")',
  ].join('\n');
  const { html, headings, refs } = renderDoc('using-the-office/x.md', md);
  assert.deepEqual(headings, [
    { id: 'step-one', text: 'Step one', depth: 2 },
    { id: 'step-one-1', text: 'Step one', depth: 3 },
    { id: 'my-id', text: 'Custom', depth: 2 },
  ]);
  assert.match(html, /<div class="dh-alert dh-alert-warning" role="note"><p class="dh-alert-title">Warning<\/p><p>Restarting stops agents\.<\/p>/);
  assert.match(html, /<blockquote><p>Just a quote\.<\/p>/);
  assert.match(html, /<span class="dh-lang">bash<\/span><button class="dh-copy"[^>]*>Copy<\/button><pre><code class="language-bash">npm run build &lt;x&gt;<\/code><\/pre>/);
  assert.match(html, /<div class="dh-table"><table><thead><tr><th style="text-align:left">a<\/th><th style="text-align:right">b<\/th>/);
  assert.match(html, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">out/);
  assert.match(html, /<a href="\/docs\/faq#q">in<\/a>/);
  assert.match(html, /<figure class="dh-figure"><img src="\/docs\/images\/board.png" alt="pic" loading="lazy" \/><figcaption>Cap<\/figcaption><\/figure>/);
  assert.deepEqual(refs.links, [{ href: '../faq.md#q', slug: 'faq', hash: 'q' }]);
  assert.deepEqual(refs.images, [{ src: '../images/board.png', url: '/docs/images/board.png' }]);
  assert.equal(plainText(html).includes('Copy'), false, 'the copy button is not words of the page');
  assert.equal(plainText(html).includes('#'), false, 'nor are the heading anchors');
});

test('the sidebar: sections hold their pages, in weight order, then by title; and the reading order follows it', () => {
  const p = (slug: string, title: string, weight?: number) => ({ slug, title, weight });
  const nav = buildNav([p('', 'Home'), p('b', 'B section', 2), p('b/z', 'Zed'), p('b/a', 'Alpha'), p('b/first', 'First', 1), p('a', 'A section', 1), p('a/x', 'X'), p('faq', 'FAQ', 9)]);
  assert.deepEqual(
    nav.map((n) => [n.slug, n.children.map((c) => c.slug)]),
    [['a', ['a/x']], ['b', ['b/first', 'b/a', 'b/z']], ['faq', []]],
  );
  assert.deepEqual(readingOrder(nav), ['', 'a', 'a/x', 'b', 'b/first', 'b/a', 'b/z', 'faq']);
  assert.deepEqual(trail(nav, 'b/a').map((n) => n.slug), ['b', 'b/a']);
  assert.deepEqual(trail(nav, 'nope'), []);
});

test('search: every word must match, the title counts most, and the best heading is where it jumps', () => {
  const page = (slug: string, title: string, text: string, headings: DocPage['headings'] = [], description?: string): DocPage => ({ slug, title, text, headings, description, file: `${slug}.md`, html: '', updated: '2026-10-05' });
  const pages = [
    page('live', 'Live app', 'Run the app from main with mxcli run. Ports 8110 to 8199.', [{ id: 'ports', text: 'Ports', depth: 2 }]),
    page('faq', 'FAQ', 'Why is the live app not running? Live apps do not start by themselves.', [{ id: 'live-app', text: 'The live app', depth: 2 }]),
    page('jeff', 'Jeff · Router', 'The quick judge.', [], 'Jev and Haiku'),
  ];
  const hits = searchDocs(pages, 'live app');
  assert.deepEqual(hits.map((x) => x.slug), ['live', 'faq']);
  assert.equal(hits[1].heading?.id, 'live-app');
  assert.match(hits[0].snippet, /app/i);
  assert.deepEqual(searchDocs(pages, 'ports 8110').map((x) => x.slug), ['live']);
  assert.deepEqual(searchDocs(pages, 'haiku').map((x) => x.slug), ['jeff']);
  assert.deepEqual(searchDocs(pages, 'live zebra'), []);
  assert.deepEqual(searchDocs(pages, '  '), []);
});

test('a small site: built, checked, and its broken links and missing pictures reported', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'docsite-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (f: string, s: string) => (mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }), writeFileSync(path.join(dir, f), s));
  put('_index.md', '---\ntitle: Home\ndescription: d\n---\n[a](sec/a.md) [gone](sec/gone.md) [bad anchor](sec/a.md#nope)\n');
  put('sec/_index.md', '---\ntitle: Section\ndescription: d\nweight: 1\n---\n');
  put('sec/a.md', '---\ntitle: A\ndescription: d\naliases: [/docs/old-a]\n---\n## Here\n![x](../images/x.png) ![y](../images/missing.png)\n');
  put('sec/b.md', '---\ntitle: B\n---\n');
  put('images/x.png', 'png');
  const { bundle, problems, images } = buildDocSite(dir, fixed);
  assert.deepEqual(bundle.pages.map((p) => p.slug).sort(), ['', 'sec', 'sec/a', 'sec/b']);
  assert.deepEqual(images, ['x.png']);
  assert.equal(findPage(bundle, 'old-a')?.slug, 'sec/a');
  assert.equal(findPage(bundle, '/sec/a/')?.slug, 'sec/a');
  assert.deepEqual(
    problems.map((p) => `${p.file}: ${p.problem}`).sort(),
    [
      "_index.md: links to sec/a.md#nope, but sec/a.md has no #nope",
      "_index.md: links to sec/gone.md, a page that isn't there (/docs/sec/gone)",
      'sec/a.md: shows ../images/missing.png, which isn\'t there',
      'sec/b.md: has no description in its front matter',
    ].sort(),
  );
});

// ---- The real pages ---------------------------------------------------------------------------------

const built = buildDocSite(site, fixed);
const { bundle } = built;
const pageText = (slug: string) => {
  const p = bundle.pages.find((x) => x.slug === slug);
  assert.ok(p, `docs/site has a page /docs/${slug}`);
  return readFileSync(path.join(site, p.file), 'utf8');
};

test('docs/site: every link goes to a page and heading that are there, every picture is there, every page has a description', () => {
  assert.deepEqual(built.problems, []);
});

test('docs/site: the sections the docs promise, in order, each with pages', () => {
  assert.deepEqual(
    bundle.nav.map((n) => n.title),
    ['Get Started', 'Concepts', 'Using the Office', 'Teams & Agents', 'Automation', 'Integrations', 'Administration', 'Reference', 'Coming soon', 'Troubleshooting', 'FAQ', 'Release notes'],
  );
  for (const n of bundle.nav.slice(0, 10)) assert.ok(n.children.length >= 2, `${n.title} has pages`);
  assert.ok(bundle.pages.length >= 60, `${bundle.pages.length} pages`);
});

test('docs/site: no address is used twice, by a page or an alias', () => {
  const seen = new Map<string, string>();
  for (const p of bundle.pages) {
    for (const a of [p.slug, ...(p.aliases ?? []).map((x) => slugFromPath(x) ?? x)]) {
      assert.ok(!seen.has(a), `/docs/${a} is both ${seen.get(a)} and ${p.file}`);
      seen.set(a, p.file);
    }
  }
});

test('docs/site: no stray HTML tags: a <placeholder> outside code is written &lt;placeholder&gt;', () => {
  for (const p of bundle.pages) {
    const body = readFileSync(path.join(site, p.file), 'utf8').replace(/^---[\s\S]*?\n---/, '').replace(/```[\s\S]*?```/g, '').replace(/<!--[\s\S]*?-->/g, '');
    for (const line of body.split('\n')) {
      const outside = line.replace(/`[^`]*`/g, '');
      assert.doesNotMatch(outside, /<[A-Za-z][^<>]*>/, `${p.file}: ${line.trim()}`);
    }
  }
});

test('docs/site: the FAQ answers at least 25 questions', () => {
  const faq = bundle.pages.find((p) => p.slug === 'faq')!;
  const questions = faq.headings.filter((h) => h.depth === 3 && h.text.endsWith('?'));
  assert.ok(questions.length >= 25, `${questions.length} questions`);
});

test('docs/site: the pictures it shows are all in docs/site/images, and none is left unused', () => {
  const used = new Set(bundle.pages.flatMap((p) => [...p.html.matchAll(/src="\/docs\/images\/([^"]+)"/g)].map((m) => m[1])));
  const there = readdirSync(path.join(site, 'images'));
  for (const f of used) assert.ok(there.includes(f), `docs/site/images/${f}`);
  for (const f of there) assert.ok(used.has(f) || f.startsWith('readme-'), `docs/site/images/${f} isn't shown on any page`);
});

test('docs/site: the reference pages are in step with the code', () => {
  // Every office-workers command and subcommand in its usage text.
  const cli = pageText('reference/office-workers-cli');
  const usage = ['office-workers.js', 'office-escalate.js', 'office-subagent.js'].map((f) => readFileSync(path.join(root, 'bin', f), 'utf8')).join('\n');
  const commands = new Set([...usage.matchAll(/^\s+office-workers (\w[\w-]*)(?: (\w[\w-]*))?/gm)].map((m) => (m[1] === 'subagent' && m[2] ? `subagent ${m[2]}` : m[1])));
  assert.ok(commands.size >= 10, `found ${commands.size} commands`);
  for (const c of commands) assert.ok(cli.includes(`office-workers ${c}`), `the CLI page has office-workers ${c}`);

  // Every route's path or prefix.
  const api = pageText('reference/api-endpoints');
  const routes = readdirSync(path.join(root, 'src/server/http/routes'))
    .filter((f) => f.endsWith('.ts'))
    .flatMap((f) => [...readFileSync(path.join(root, 'src/server/http/routes', f), 'utf8').matchAll(/(?:path|prefix): (?:\[([^\]]+)\]|'([^']+)')/g)])
    .flatMap((m) => (m[1] ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [m[2]]))
    .filter((p) => !p.endsWith('.html'));
  assert.ok(routes.length >= 30, `found ${routes.length} routes`);
  for (const r of routes) assert.ok(api.includes(`\`${r}`) || api.includes(r), `the API page has ${r}`);

  // Every team setting, and the standup's and Jeff's.
  const settings = pageText('reference/settings-reference');
  const types = readFileSync(path.join(root, 'src/shared/roster/types.ts'), 'utf8');
  const block = /export interface RosterSettings \{([\s\S]*?)\n\}/.exec(types)?.[1] ?? '';
  const fields = [...block.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
  assert.ok(fields.length >= 8, `found ${fields.length} settings`);
  for (const f of [...fields, 'enabled', 'time', 'timeZone', 'days', 'waiting', 'triage']) assert.ok(settings.includes(`\`${f}\``), `the settings page has ${f}`);
});

test('docs/site: the features still being built have their pages, marked as coming soon', () => {
  for (const slug of ['preview/audit-log', 'preview/the-firm']) {
    const page = bundle.pages.find((p) => p.slug === slug)!;
    assert.equal(page.badge, 'Preview', slug);
    assert.match(page.html, /Coming soon, in preview/, slug);
  }
});
