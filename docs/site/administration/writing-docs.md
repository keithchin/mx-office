---
title: Writing these docs
description: How the /docs site is built from Markdown in docs/site - front matter, sections, links, callouts, pictures, search - and how to add a page.
weight: 5
---

This site is Markdown in the repository, under `docs/site/`. The client build turns it into one bundle the docs page reads.

## Add a page

1. Create `docs/site/<section>/<page>.md`.
2. Start it with front matter:

```markdown
---
title: Live app
description: One sentence for the page's intro, its card and the search.
weight: 8
aliases: [/docs/old-address]
---
```

3. Write the page. Use `##` and `###` headings: they make the **On this page** list.
4. Run `npm run build`, and the tests in `tests/docs-site.test.ts`.

| Front matter | Meaning |
|---|---|
| `title` | The page title, in the sidebar and the breadcrumbs. |
| `description` | Required. The intro under the title, the section card, the search. |
| `weight` | Order among its siblings (lower first; then by title). |
| `aliases` | Old addresses that land on this page. |
| `badge` | A word next to the title in the sidebar, such as *Preview*. |
| `updated` | Overrides the last-updated day (otherwise git's date for the file). |

## Sections

A folder is a section. Its `_index.md` is the section page; the sidebar lists its pages under it, and the section page shows them as cards. `docs/site/_index.md` is the docs home.

## Links

Link to other pages with **relative `.md` links**, as GitHub follows them too: `[Settings](../using-the-office/settings.md#what-each-one-does)`. They become `/docs/…` addresses here. Heading anchors are the heading in lower case with dashes. The tests fail on a link to a page or anchor that isn't there.

## Callouts

GitHub's alert syntax, drawn like the alerts on docs.mendix.com:

```markdown
> [!NOTE]
> Something to know.
```

Kinds: `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`.

## Pictures

Put them in `docs/site/images/` (PNG or WebP, keep them small) and link them relatively, `![Alt text](../images/board.png "Optional caption")`. Click a picture on the page to see it bigger.

## How it works

- `src/server/docsite.ts` renders the pages (with `marked`), collects headings and text, and checks links and pictures.
- `src/shared/docsite.ts` has the front matter, the sidebar tree, the reading order, link resolving and the search.
- `vite.config.ts` writes the bundle to `dist/public/docs/site.json` and copies the pictures to `dist/public/docs/images/`.
- The server sends every `/docs/...` address to `docs.html` (behind the sign-in); `src/client/docs.ts` draws the page.
- The search runs in the browser over titles, headings, descriptions and text. No outside service.
