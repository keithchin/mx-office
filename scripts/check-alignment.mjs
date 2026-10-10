#!/usr/bin/env node
// A visual-alignment audit of the main pages: opens each surface in headless Chromium, per theme, and
// measures what's drawn. It flags:
//   ink      an icon button's or an avatar's glyph (what's actually painted: line icon, initials, emoji)
//            not centered in its box, more than 1 px off either way (badges and dots are left out)
//   row      single-line items side by side in a row whose vertical centres differ by more than 1 px
//   text     the text in such a row not on one line (its text boxes' centres more than 1 px apart)
//   height   sibling buttons, chips, fields and selects in a row of different heights (more than 1 px)
//   left     items stacked in a list (the selectors in LISTS) whose left edges differ
//   clip     text cut off without an ellipsis (overflow hidden), and a page wider than the window
//   overlap  in-flow siblings in a row drawn over each other
// Point it at a TEST office, never someone's real one: it signs in and clicks like a person would.
//
//   node scripts/check-alignment.mjs --base http://127.0.0.1:49xx --password <pw> --floor <id>
//     [--themes portal-light,portal-dark] [--viewport 1440x900] [--only topbar,nav,...]
//     [--shots <dir>] [--tag before] [--json <file>] [--chrome <chrome.exe>]
//
// It exits 1 when anything is flagged that isn't in EXCEPTIONS (each with why it's deliberate).

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const base = arg('base', 'http://127.0.0.1:4931');
const password = arg('password');
const floor = arg('floor');
if (!floor) {
  console.error('usage: node scripts/check-alignment.mjs --base <url> --password <pw> --floor <id>');
  process.exit(2);
}
const themes = arg('themes', 'portal-light,portal-dark').split(',');
const [vw, vh] = arg('viewport', '1440x900').split('x').map(Number);
const only = arg('only')?.split(',');
const shots = arg('shots');
const tag = arg('tag', 'run');
const jsonOut = arg('json');
const SCALE = 2;
const TOL = 1;
const lite = (tab) => `/lite?floor=${encodeURIComponent(floor)}&tab=${tab}`;

/** Each surface: the page, what to wait for, anything to do first, and the part of the page it audits. */
const SURFACES = [
  { name: 'topbar', url: lite('command'), scope: 'header.lite-bar' },
  { name: 'nav', url: lite('command'), scope: '#pt-nav' },
  { name: 'pagehead', url: lite('command'), scope: '#pt-head' },
  { name: 'band', url: lite('command'), scope: '.pt-band' },
  { name: 'overview', url: lite('command'), scope: '.lite-main', not: '#pt-head, .pt-band' },
  // The setup line opened: the desktop layout's rule then gave Needs you the whole width, under the Team card.
  { name: 'overview-setup', url: lite('command'), scope: '#needs-you, #setup', prepare: async (page) => {
    const b = page.locator('#setup button', { hasText: 'Show' }).first();
    if (await b.count()) await b.click();
    await page.waitForTimeout(600);
  } },
  { name: 'board', url: lite('board'), scope: '.lite-main', not: '#pt-head, .pt-band' },
  { name: 'agents', url: lite('workers'), scope: '.lite-main', not: '#pt-head, .pt-band' },
  { name: 'model', url: lite('model'), scope: '.lite-main', not: '#pt-head, .pt-band' },
  { name: 'budget', url: lite('budget'), scope: '.lite-main', not: '#pt-head, .pt-band' },
  { name: 'approvals', url: lite('approvals'), scope: '.lite-main', not: '#pt-head, .pt-band' },
  { name: 'settings', url: lite('settings'), scope: '.lite-main', not: '#pt-head, .pt-band' },
  { name: 'home', url: '/home', scope: 'body', not: 'header.lite-bar' },
  { name: 'home-topbar', url: '/home', scope: 'header.lite-bar' },
  { name: 'office2d', url: `/pixel?floor=${encodeURIComponent(floor)}`, scope: 'header.lite-bar, .px-tools, .px-toolbar, [class*="px-tool"]' },
  { name: 'phone-launcher', url: lite('command'), scope: '[class*="phone-fab"], [class*="pf-launch"], [class*="tp-launch"], [aria-label*="team phone" i]' },
  { name: 'modal', url: lite('command'), scope: '.modal:not(.hidden), [role=dialog]:not([hidden])', prepare: async (page) => {
    const b = page.locator('#pt-head button', { hasText: 'New task' }).first();
    if (await b.count()) await b.click();
    await page.waitForTimeout(600);
  } },
  { name: 'setup', url: '/setup', scope: 'body' },
  { name: 'docs', url: '/docs', scope: '.dx-bar, header' },
];

/** Lists whose items must share a left edge: container selector › item selector. */
const LISTS = [
  ['#pt-nav .pt-items', ':scope > li > :is(a, button)'],
  ['#pt-nav .pt-bottom', ':scope > li > :is(a, button)'],
  ['.pt-details', ':scope > dt'],
  ['.pt-details', ':scope > dd'],
];

/**
 * Deliberate exceptions: surface, check and a pattern over the flagged element's description, with why.
 * Kept short and specific; anything else that's flagged fails the run.
 */
const EXCEPTIONS = [
  { surface: 'overview', check: 'overlap', match: /ul.pt-face-list/, why: 'the Team card stacks its avatars, each over the last by a few px, like the portal does' },
  { surface: '*', check: 'text', match: /label.lite-floor/, why: 'Clean and Fun put the floor picker’s small label above its name (two lines); the name lines up with the buttons' },
  { surface: '*', check: 'row', match: /label.lite-floor/, why: 'the floor picker with its label above it (Fun): two lines, centred as a block' },
  { surface: '*', check: 'row', match: /a#to-home.btn.on "Home" 2px/, why: 'Fun draws the page you are on as a pressed button, 2 px down' },
  { surface: '*', check: 'text', match: /a#to-home.btn.on "Home"@2/, why: 'Fun draws the page you are on as a pressed button, 2 px down' },
  { surface: '*', check: 'ink', match: /i.pg-mark/, why: 'a ~ or ✓ mark in the progress bar sits on the text line like a character, not in the middle of its box' },
];

/** In the page: everything to check inside the surface, measured; elements to ink-check get data-al ids. */
function MEASURE({ scope, not, lists, tol }) {
  const out = { flags: [], ink: [] };
  const roots = [...document.querySelectorAll(scope)].filter((el) => el.getBoundingClientRect().height > 0);
  if (!roots.length) return { missing: true, ...out };
  const skip = not ? [...document.querySelectorAll(not)] : [];
  const inScope = (el) => roots.some((r) => r.contains(el)) && !skip.some((s) => s.contains(el));
  const visible = (el) => {
    const c = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05 && b.width > 0 && b.height > 0;
  };
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = [...el.classList].filter((c) => !c.startsWith('al-')).slice(0, 3).map((c) => `.${c}`).join('');
    const label = (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return `${el.tagName.toLowerCase()}${id}${cls}${label ? ` "${label}"` : ''}`;
  };
  const r2 = (n) => Math.round(n * 10) / 10;
  const flag = (check, el, detail) => out.flags.push({ check, el: describe(el), detail });
  const inFlow = (el) => !['absolute', 'fixed'].includes(getComputedStyle(el).position);
  const textRects = (el) => {
    const rects = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode()); ) {
      if (!n.textContent.trim()) continue;
      const p = n.parentElement;
      if (!p || !visible(p) || !inFlow(p)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0) rects.push(r);
    }
    return rects;
  };
  const all = roots.flatMap((r) => [r, ...r.querySelectorAll('*')]).filter((el) => inScope(el) && visible(el));

  // Page wider than the window.
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.flags.push({ check: 'clip', el: 'page', detail: `page ${document.documentElement.scrollWidth}px wide in a ${document.documentElement.clientWidth}px window` });

  const ROWLIKE = (c) => (c.display.includes('flex') && !c.flexDirection.startsWith('column') && c.flexWrap !== 'wrap') || c.display.includes('grid') && c.gridAutoFlow.startsWith('column');
  const CONTROL = 'button, .btn, select, input:not([type=checkbox]):not([type=radio]):not([type=range]), [role=tab], [class*="chip"], .pill, [class*="-pill"]';
  for (const row of all) {
    const c = getComputedStyle(row);
    if (!(c.display.includes('flex') && !c.flexDirection.startsWith('column'))) continue;
    if (row.matches('svg, svg *')) continue;
    const kids = [...row.children].filter((k) => visible(k) && inFlow(k) && !k.matches('svg *'));
    if (kids.length < 2) continue;
    const boxes = kids.map((k) => k.getBoundingClientRect());
    // A row pushing its items off the window (the page itself may not scroll sideways to show them).
    const winW = document.documentElement.clientWidth;
    const offWin = kids.filter((_, i) => boxes[i].right > winW + 1 && boxes[i].left < winW + 400 && getComputedStyle(row).position !== 'fixed');
    // Not inside something that scrolls sideways on purpose (the board's columns).
    const scroller = (() => { for (let e = row; e && e !== document.body; e = e.parentElement) if (/auto|scroll/.test(getComputedStyle(e).overflowX)) return true; return false; })();
    if (offWin.length && !scroller) flag('clip', row, `off the ${winW}px window: ${offWin.map((k) => `${describe(k)} at ${r2(k.getBoundingClientRect().left)}..${r2(k.getBoundingClientRect().right)}`).join('; ')}`);
    const rb = row.getBoundingClientRect();
    // Only single-line items on one line: a wrapped row or a multi-line item isn't a row of chips.
    const singles = kids.map((k, i) => ({ k, b: boxes[i] })).filter(({ k, b }) => b.height <= 44 && textRects(k).every((t, _, a) => Math.abs(t.top - a[0].top) < 4));
    if (singles.length < 2) continue;
    const lineTop = Math.min(...singles.map((s) => s.b.top));
    // The first line's items: a wrapped item starts below the shortest one's middle.
    const minH = Math.min(...singles.filter((s) => s.b.top < lineTop + 44).map((s) => s.b.height));
    const sameLine = singles.filter((s) => s.b.top < lineTop + Math.max(minH * 0.75, 4) && s.b.bottom > lineTop);
    if (sameLine.length < 2) continue;
    // Centres.
    const mids = sameLine.map((s) => s.b.top + s.b.height / 2);
    const spread = Math.max(...mids) - Math.min(...mids);
    if (spread > tol && c.alignItems !== 'baseline' && c.alignItems !== 'first baseline') {
      const ref = mids.slice().sort((a, b) => a - b)[Math.floor(mids.length / 2)];
      const off = sameLine.filter((_, i) => Math.abs(mids[i] - ref) > tol).map((s) => `${describe(s.k)} ${r2(s.b.top + s.b.height / 2 - ref)}px`);
      flag('row', row, `centres spread ${r2(spread)}px (align-items: ${c.alignItems}); off: ${off.join('; ')}`);
    }
    // Text centres across items with text, same font size only (different sizes centre on their boxes).
    const texts = sameLine
      .map((s) => ({ s, t: textRects(s.k), fs: parseFloat(getComputedStyle(s.k).fontSize) }))
      .filter((x) => x.t.length);
    const bySize = new Map();
    for (const x of texts) bySize.set(x.fs, [...(bySize.get(x.fs) ?? []), x]);
    for (const [fs, group] of bySize) {
      if (group.length < 2) continue;
      const tm = group.map((x) => x.t[0].top + x.t[0].height / 2);
      const ts = Math.max(...tm) - Math.min(...tm);
      if (ts > tol) flag('text', row, `${fs}px text off one line by ${r2(ts)}px: ${group.map((x, i) => `${describe(x.s.k)}@${r2(tm[i] - Math.min(...tm))}`).join('; ')}`);
    }
    // Heights of controls side by side.
    // A link drawn as text (no border, no fill, underlined) isn't a control box to match.
    const linkish = (el) => { const k = getComputedStyle(el); return parseFloat(k.borderTopWidth) === 0 && /rgba\(0, 0, 0, 0\)|transparent/.test(k.backgroundColor) && k.textDecorationLine.includes('underline'); };
    const ctrls = sameLine.filter((s) => s.k.matches(CONTROL) && !linkish(s.k));
    if (ctrls.length >= 2) {
      // Icon-only round buttons next to text buttons are their own family: compare like with like.
      const fam = (s) => (s.k.matches('[class*="pill"], [class*="chip"], .pill, [class*="badge"]') ? 'pill' : Math.abs(s.b.width - s.b.height) < 1 ? 'square' : 'wide');
      for (const f of ['pill', 'square', 'wide']) {
        // Side by side: neighbours less than 24 px apart (a chip at the far end of a row is on its own).
        const g = ctrls.filter((s) => fam(s) === f).filter((s, i, a) => a.some((o, j) => j !== i && Math.max(o.b.left - s.b.right, s.b.left - o.b.right) < 24));
        if (g.length < 2) continue;
        const gh = g.map((s) => s.b.height);
        if (Math.max(...gh) - Math.min(...gh) > tol) flag('height', row, `${f} controls of ${[...new Set(gh.map(r2))].join(' / ')}px: ${g.map((s) => `${describe(s.k)}=${r2(s.b.height)}`).join('; ')}`);
      }
    }
    // Overlap of in-flow siblings.
    for (let i = 1; i < sameLine.length; i++) {
      const a = sameLine[i - 1].b;
      const b = sameLine[i].b;
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 1 && y > 1 && c.flexDirection === 'row') flag('overlap', row, `${describe(sameLine[i - 1].k)} and ${describe(sameLine[i].k)} overlap ${r2(x)}×${r2(y)}px`);
    }
  }

  // Clipped text: overflow hidden, wider than its box, no ellipsis.
  for (const el of all) {
    const c = getComputedStyle(el);
    if (!/hidden|clip/.test(c.overflowX + c.overflowY) || el.matches('svg, svg *, canvas, img, video, iframe, textarea, input, select')) continue;
    if (!textRects(el).length) continue;
    const wide = el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(c.overflowX);
    const tall = el.scrollHeight > el.clientHeight + 2 && /hidden|clip/.test(c.overflowY) && el.clientHeight < 60 && c.webkitLineClamp === 'none';
    if (wide && c.textOverflow !== 'ellipsis' && ![...el.querySelectorAll('*')].some((d) => getComputedStyle(d).textOverflow === 'ellipsis')) flag('clip', el, `text ${el.scrollWidth}px in ${el.clientWidth}px, no ellipsis`);
    else if (tall) flag('clip', el, `text ${el.scrollHeight}px tall in ${el.clientHeight}px`);
  }

  // Needs you in the Portal Overview: the console's column, its right edge on the console's.
  const ny = document.querySelector('.lite-main.on-command > #needs-you');
  const pmc = document.querySelector('.lite-main.on-command #summary > .pmc');
  if (ny && pmc && inScope(ny) && visible(ny) && visible(pmc)) {
    const a = ny.getBoundingClientRect();
    const b = pmc.getBoundingClientRect();
    if (Math.abs(a.right - b.right) > tol || Math.abs(a.left - b.left) > tol) flag('left', ny, `Needs you spans ${r2(a.left)}..${r2(a.right)}px, the project console ${r2(b.left)}..${r2(b.right)}px`);
  }

  // Stacked lists' left edges.
  for (const [ls, is] of lists) {
    for (const list of document.querySelectorAll(ls)) {
      if (!inScope(list) || !visible(list)) continue;
      const items = [...list.querySelectorAll(is)].filter(visible);
      if (items.length < 2) continue;
      const lefts = items.map((i) => i.getBoundingClientRect().left);
      // Within a list, the items at its own level only (nested items are indented on purpose).
      const ref = Math.min(...lefts);
      const off = items.filter((_, i) => lefts[i] - ref > tol);
      if (off.length) flag('left', list, `left edges ${[...new Set(lefts.map(r2))].join(' / ')}px: ${off.map(describe).join('; ')}`);
    }
  }

  // Ink: icon-only buttons and avatars (round, square, small, with a glyph and no words).
  let n = 0;
  for (const el of all) {
    const b = el.getBoundingClientRect();
    if (b.width > 64 || b.height > 64 || b.width < 12) continue;
    const c = getComputedStyle(el);
    const round = parseFloat(c.borderTopLeftRadius) >= Math.min(b.width, b.height) / 2 - 1 || c.borderTopLeftRadius.endsWith('%') && parseFloat(c.borderTopLeftRadius) >= 50;
    const square = Math.abs(b.width - b.height) <= 1;
    const words = (el.textContent || '').trim();
    const isBtn = el.matches('button, a, [role=button], .btn');
    const avatar = round && square && words.length > 0 && words.length <= 3 && !isBtn ? true : round && square && el.matches('#menu.pt-avatar');
    const iconBtn = isBtn && square && (words.length === 0 || [...words].length <= 2 || el.matches('#menu.pt-avatar')) && (el.querySelector('svg') || words.length || getComputedStyle(el, '::before').content !== 'none');
    if (!avatar && !iconBtn) continue;
    if (el.closest('[data-al]') && el.closest('[data-al]') !== el) continue;
    const id = `al${n++}`;
    el.dataset.al = id;
    const bt = parseFloat(c.borderTopWidth) || 0;
    const bl = parseFloat(c.borderLeftWidth) || 0;
    // A letter that hangs below the line (J, Q, g, j, p, q, y) isn't centred by its ink up and down.
    const glyph = (el.matches('#menu.pt-avatar') ? el.dataset.ptInitials : words) || '';
    out.ink.push({ id, el: describe(el), round, descender: /[JQgjpqy]/.test(glyph), box: { x: b.left + bl, y: b.top + bt, w: b.width - bl - (parseFloat(c.borderRightWidth) || 0), h: b.height - bt - (parseFloat(c.borderBottomWidth) || 0) } });
  }
  return out;
}

/** Ink centre of each element in a screenshot: the painted glyph's bounding box against its box's centre. */
async function inkCentres(decoder, png, items, scrollY = 0) {
  return decoder.evaluate(
    async ({ b64, items, scale }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const cv = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
      const x = cv.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      return items.map((it) => {
        const X = Math.round(it.box.x * scale);
        const Y = Math.round(it.box.y * scale);
        const W = Math.round(it.box.w * scale);
        const H = Math.round(it.box.h * scale);
        if (W < 4 || H < 4 || X < 0 || Y < 0 || X + W > cv.width || Y + H > cv.height) return { id: it.id, skipped: 'off screen' };
        const d = x.getImageData(X, Y, W, H).data;
        const cx = W / 2;
        const cy = H / 2;
        // A round one: inside its circle, clear of its ring and of a neighbour stacked over its edge.
        const rad = Math.min(W, H) / 2 - 3 * scale;
        const inside = (i, j) => !it.round || (i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= rad * rad;
        // The background: the commonest colour inside.
        const count = new Map();
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
          if (!inside(i, j)) continue;
          const k = (j * W + i) * 4;
          const key = (d[k] >> 3) << 10 | (d[k + 1] >> 3) << 5 | (d[k + 2] >> 3);
          count.set(key, (count.get(key) ?? 0) + 1);
        }
        let bg = 0;
        let best = -1;
        for (const [k, v] of count) if (v > best) [bg, best] = [k, v];
        const br = (bg >> 10 & 31) << 3, bgc = (bg >> 5 & 31) << 3, bb = (bg & 31) << 3;
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
          if (!inside(i, j)) continue;
          const k = (j * W + i) * 4;
          const diff = Math.abs(d[k] - br) + Math.abs(d[k + 1] - bgc) + Math.abs(d[k + 2] - bb);
          if (diff < 120) continue;
          x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j);
        }
        if (x1 < 0) return { id: it.id, skipped: 'no ink' };
        return { id: it.id, dx: ((x0 + x1 + 1) / 2 - cx) / scale, dy: ((y0 + y1 + 1) / 2 - cy) / scale, ink: [(x1 - x0 + 1) / scale, (y1 - y0 + 1) / scale] };
      });
    },
    { b64: png.toString('base64'), items, scale: SCALE },
  );
}

const browser = await chromium.launch({ headless: true, executablePath: arg('chrome') });
const decoder = await browser.newPage();
const report = [];
try {
  for (const theme of themes) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: SCALE, reducedMotion: 'reduce' });
    await ctx.addInitScript((t) => {
      localStorage.setItem('agent-office.color-theme', t);
      localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex', color: '#0b6bcb', skin: 0, hair: 0, style: 0 }));
    }, theme);
    if (password) await ctx.request.post(`${base}/api/login`, { data: { password } });
    const page = await ctx.newPage();
    // Badges and status dots sit over a corner on purpose: hidden while the glyphs are measured.
    const HIDE = '.al-hide-abs [data-al] *:is([class*="count"], [class*="badge"], [class*="dot"], [class*="-n"]) { visibility: hidden !important; } * { caret-color: transparent !important; }';
    let lastUrl = '';
    for (const s of SURFACES) {
      if (only && !only.includes(s.name)) continue;
      if (s.url !== lastUrl || s.prepare) {
        await page.goto(base + s.url, { waitUntil: 'load' });
        await page.waitForFunction(() => !window.__aoBoot?.shown?.(), null, { timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(2500);
        lastUrl = s.prepare ? '' : s.url;
        if (s.prepare) await s.prepare(page);
      }
      await page.mouse.move(vw - 2, vh - 2);
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await page.evaluate(() => document.querySelectorAll('[data-al]').forEach((e) => delete e.dataset.al));
      const m = await page.evaluate(MEASURE, { scope: s.scope, not: s.not, lists: LISTS, tol: TOL });
      const entry = { surface: s.name, theme, flags: m.flags, missing: !!m.missing };
      if (!m.missing && m.ink.length) {
        await page.addStyleTag({ content: HIDE });
        await page.evaluate(() => document.documentElement.classList.add('al-hide-abs'));
        await page.waitForTimeout(50);
        const png = await page.screenshot({ type: 'png' });
        const res = await inkCentres(decoder, png, m.ink);
        await page.evaluate(() => document.documentElement.classList.remove('al-hide-abs'));
        for (const r of res) {
          if (r.skipped) continue;
          const it = m.ink.find((i) => i.id === r.id);
          if (Math.abs(r.dx) > TOL || (!it.descender && Math.abs(r.dy) > TOL)) entry.flags.push({ check: 'ink', el: it.el, detail: `glyph ${r.ink.map((v) => v.toFixed(1)).join('×')} off centre by x ${r.dx.toFixed(1)}, y ${r.dy.toFixed(1)}px` });
        }
        entry.inkChecked = res.filter((r) => !r.skipped).length;
      }
      for (const f of entry.flags) {
        const ex = EXCEPTIONS.find((e) => (e.surface === '*' || e.surface === s.name) && e.check === f.check && e.match.test(`${f.el} ${f.detail}`));
        if (ex) f.exception = ex.why;
      }
      if (shots) {
        fs.mkdirSync(shots, { recursive: true });
        const el = s.scope === 'body' ? null : await page.$(s.scope.split(',')[0]);
        const file = path.join(shots, `${tag}-${s.name}-${theme}.png`);
        if (el && (await el.boundingBox())) await el.screenshot({ path: file }).catch(() => page.screenshot({ path: file }));
        else await page.screenshot({ path: file });
      }
      report.push(entry);
      const open = entry.flags.filter((f) => !f.exception);
      console.log(`${s.name.padEnd(15)} ${theme.padEnd(13)} ${entry.missing ? 'not on the page' : `${open.length} flagged${entry.flags.length - open.length ? ` (+${entry.flags.length - open.length} excepted)` : ''}${entry.inkChecked ? `, ${entry.inkChecked} glyphs` : ''}`}`);
      for (const f of entry.flags) console.log(`    ${f.exception ? '·' : '✖'} ${f.check.padEnd(7)} ${f.el}: ${f.detail}${f.exception ? `  [ok: ${f.exception}]` : ''}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
const open = report.flatMap((r) => r.flags.filter((f) => !f.exception));
console.log(`check-alignment: ${report.length} surface×theme audited, ${open.length} flagged`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1));
if (open.length) process.exit(1);
