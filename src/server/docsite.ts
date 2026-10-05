// The documentation site's build: every Markdown page under docs/site/ rendered to HTML, with its
// headings, words and last-changed day, plus the sidebar, in one bundle the docs page (/docs) reads.
// Run by the client build (vite.config.ts writes the bundle to dist/public/docs/site.json and copies
// docs/site/images/ next to it) and by the tests; the office itself only serves the result.
//
// Links between pages are written as relative .md links, so the same files read well on GitHub too;
// here they become /docs/… addresses. Callouts are GitHub's `> [!NOTE]` (NOTE, TIP, IMPORTANT,
// WARNING, CAUTION), drawn like the alerts on docs.mendix.com.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Marked, type Tokens } from 'marked';
import {
  buildNav,
  docMeta,
  docUrl,
  fileToSlug,
  parseFrontMatter,
  resolveDocHref,
  resolveDocImage,
  slugify,
  type DocBundle,
  type DocHeading,
  type DocPage,
} from '../shared/docsite.js';

/** The callouts, with the words over each. */
const ALERTS: Record<string, string> = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A page's text without its tags, for the search. */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style|button)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<a class="dh-anchor"[^>]*>#<\/a>|<span class="dh-(?:lang|ext)"[^>]*>[^<]*<\/span>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What a page links to inside the docs, for the link check. */
export interface DocRefs {
  links: { href: string; slug: string; hash?: string }[];
  images: { src: string; url: string }[];
}

/** One page's Markdown (front matter already off) to HTML, its headings, and what it links to. */
export function renderDoc(file: string, body: string): { html: string; headings: DocHeading[]; refs: DocRefs } {
  const headings: DocHeading[] = [];
  const refs: DocRefs = { links: [], images: [] };
  const used = new Map<string, number>();
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        // {#custom-id} at the end of a heading names its anchor, as in Hugo.
        const custom = /\s*\{#([\w-]+)\}\s*$/.exec(inner);
        const label = custom ? inner.slice(0, custom.index) : inner;
        let id = custom?.[1] ?? (slugify(label) || 'section');
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (depth >= 2 && depth <= 3) headings.push({ id, text: plainText(label), depth });
        const anchor = depth >= 2 ? `<a class="dh-anchor" href="#${id}" aria-label="Link to this section">#</a>` : '';
        return `<h${depth} id="${id}">${label}${anchor}</h${depth}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        const t = title ? ` title="${esc(title)}"` : '';
        const inside = resolveDocHref(file, href);
        if (inside) {
          refs.links.push({ href, ...inside });
          return `<a href="${esc(docUrl(inside.slug, inside.hash))}"${t}>${inner}</a>`;
        }
        if (/^https?:/i.test(href)) return `<a href="${esc(href)}"${t} target="_blank" rel="noopener noreferrer">${inner}<span class="dh-ext" aria-hidden="true">↗</span></a>`;
        // A link to a file of the repo (README.html, a script): it isn't served, so it stays text.
        return `<a href="${esc(href)}"${t}>${inner}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        const url = resolveDocImage(file, href) ?? href;
        if (url !== href) refs.images.push({ src: href, url });
        const cap = title ? `<figcaption>${esc(title)}</figcaption>` : '';
        return `<figure class="dh-figure"><img src="${esc(url)}" alt="${esc(text)}" loading="lazy" />${cap}</figure>`;
      },
      code({ text, lang }: Tokens.Code) {
        const l = (lang ?? '').trim().split(/\s+/)[0];
        const label = l ? `<span class="dh-lang">${esc(l)}</span>` : '';
        return `<div class="dh-code">${label}<button class="dh-copy" type="button" aria-label="Copy to clipboard">Copy</button><pre><code${l ? ` class="language-${esc(l)}"` : ''}>${esc(text.replace(/\n$/, ''))}</code></pre></div>\n`;
      },
      blockquote({ tokens }: Tokens.Blockquote) {
        const inner = this.parser.parse(tokens);
        const m = /^<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i.exec(inner);
        if (!m) return `<blockquote>${inner}</blockquote>\n`;
        const kind = m[1].toUpperCase();
        const rest = `<p>${inner.slice(m[0].length)}`.replace(/^<p>\s*<\/p>\s*/, '');
        return `<div class="dh-alert dh-alert-${kind.toLowerCase()}" role="note"><p class="dh-alert-title">${ALERTS[kind]}</p>${rest}</div>\n`;
      },
      table(token: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: string, i: number) => {
          const align = token.align[i] ? ` style="text-align:${token.align[i]}"` : '';
          return `<${tag}${align}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        };
        const head = `<tr>${token.header.map((c, i) => cell(c, 'th', i)).join('')}</tr>`;
        const rows = token.rows.map((r) => `<tr>${r.map((c, i) => cell(c, 'td', i)).join('')}</tr>`).join('');
        return `<div class="dh-table"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
  });
  const html = md.parse(body, { async: false });
  return { html, headings, refs };
}

/** Every .md file under `dir`, as paths from it with forward slashes, in a stable order. */
function markdownFiles(dir: string, rel = ''): string[] {
  return readdirSync(path.join(dir, rel), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((d) => {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) return d.name === 'images' ? [] : markdownFiles(dir, r);
      return d.name.toLowerCase().endsWith('.md') ? [r] : [];
    });
}

/** The day git last saw `file` change, or its modified day when git doesn't know it. */
function lastChanged(file: string): string {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', path.basename(file)], {
      cwd: path.dirname(file),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch {
    // Not in a checkout (an unpacked package): the file's own date.
  }
  return statSync(file).mtime.toISOString().slice(0, 10);
}

/** A problem the link check found: a link to a page or section that isn't there, or a missing picture. */
export interface DocProblem {
  file: string;
  problem: string;
}

/**
 * Builds the bundle from `dir` (docs/site): every page rendered, the sidebar, and what's broken.
 * `updated` decides each page's day (the tests pass a fixed one rather than ask git).
 */
export function buildDocSite(dir: string, opts: { updated?: (file: string) => string } = {}): { bundle: DocBundle; problems: DocProblem[]; images: string[] } {
  const files = markdownFiles(dir);
  const pages: DocPage[] = [];
  const problems: DocProblem[] = [];
  const refsOf = new Map<string, DocRefs>();
  for (const file of files) {
    const abs = path.join(dir, file);
    const own = parseFrontMatter(readFileSync(abs, 'utf8'));
    const { data } = own;
    const slug = fileToSlug(file);
    const fallback = slug.split('/').pop() || 'Documentation';
    const meta = docMeta(data, fallback);
    // `source:` takes the page's text from another file of the repo (the release notes are
    // CHANGELOG.md itself), keeping one copy: its own front matter and top heading are left off.
    const source = typeof data.source === 'string' ? path.resolve(path.dirname(abs), data.source) : undefined;
    if (source && !existsSync(source)) problems.push({ file, problem: `takes its text from ${data.source}, which isn't there` });
    const body = source && existsSync(source) ? parseFrontMatter(readFileSync(source, 'utf8')).body.replace(/^\s*# .*\r?\n/, '') : own.body;
    const { html, headings, refs } = renderDoc(file, body);
    refsOf.set(slug, refs);
    const updated = typeof data.updated === 'string' ? data.updated : (opts.updated ?? lastChanged)(source && existsSync(source) ? source : abs);
    pages.push({ ...meta, slug, file, html, headings, text: plainText(html), updated });
  }
  const nav = buildNav(pages);
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  for (const p of pages) {
    const refs = refsOf.get(p.slug)!;
    for (const l of refs.links) {
      const target = bySlug.get(l.slug);
      if (!target) problems.push({ file: p.file, problem: `links to ${l.href}, a page that isn't there (/docs/${l.slug})` });
      else if (l.hash && !target.headings.some((h) => h.id === l.hash) && !target.html.includes(`id="${l.hash}"`))
        problems.push({ file: p.file, problem: `links to ${l.href}, but ${target.file} has no #${l.hash}` });
    }
    for (const img of refs.images) {
      if (!existsSync(path.join(dir, img.url.replace(/^\/docs\//, '')))) problems.push({ file: p.file, problem: `shows ${img.src}, which isn't there` });
    }
  }
  for (const p of pages) if (p.slug && !p.description) problems.push({ file: p.file, problem: 'has no description in its front matter' });
  const imgDir = path.join(dir, 'images');
  const images = existsSync(imgDir) ? readdirSync(imgDir).filter((f) => /\.(png|jpe?g|webp|gif|svg)$/i.test(f)) : [];
  return { bundle: { built: new Date().toISOString().slice(0, 10), pages, nav }, problems, images };
}
