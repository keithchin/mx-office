// The 1D view's tab bar sits at the same height on every tab (scripts/check-tab-alignment.mjs measures it
// in a browser). What's above it, the floor's line with the budget chip and run state, and the tab bar itself, must be laid out the same whichever tab is on: a rule for them scoped to the
// Command Center (.on-command) once took the Firm's banner out of the flow there only, so every other tab
// dropped its tab bar and content by the banner's height (about 40 px), leaving an empty band. The banner is
// on the Audit log page now, below the tabs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

function sheets(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(root, dir))) {
    const p = path.join(dir, e);
    if (statSync(path.join(root, p)).isDirectory()) out.push(...sheets(p));
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

/** Every rule's selector list in `css`, with the media query it sits in ('' at the top level). */
function rules(css: string): { sel: string; media: string; body: string }[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { sel: string; media: string; body: string }[] = [];
  const stack: string[] = [];
  let buf = '';
  let sel = '';
  for (const ch of plain) {
    if (ch === '{') {
      const head = buf.trim();
      buf = '';
      if (head.startsWith('@')) stack.push(head);
      else {
        sel = head;
        stack.push('');
      }
    } else if (ch === '}') {
      const top = stack.pop();
      if (top === '' && sel) out.push({ sel, media: stack.filter(Boolean).join(' '), body: buf.trim() });
      sel = '';
      buf = '';
    } else buf += ch;
  }
  return out;
}

/**
 * What sits above the 1D view's tab bar: the ids lite.html puts before it in .lite-main, what the page
 * adds to the floor's line (ui/budget/chips.ts's row and chip, ui/project-run/toggle.ts), and the bar.
 */
function above(): RegExp {
  const html = read('src/client/lite.html');
  const main = html.slice(html.indexOf('<main class="lite-main">'), html.indexOf('class="lite-tabs"'));
  const ids = [...main.matchAll(/\sid="([\w-]+)"/g)].map((m) => `#${m[1]}`);
  assert.ok(ids.includes('#floor-meta'), 'lite.html: the floor line sits above the tabs');
  assert.ok(!ids.includes('#firm-banner'), "lite.html: the Firm's banner is on the Audit log page, not above the tabs");
  return new RegExp([...ids, '.bud-meta-row', '#budget-chip', '.pr-toggle', '.lite-tabs'].map((s) => `${s.replace(/[.#-]/g, '\\$&')}(?![\\w-])`).join('|'));
}

test('the other floors waiting on someone show below the tab bar, not above it', () => {
  const html = read('src/client/lite.html');
  assert.ok(html.indexOf('id="elsewhere"') > html.indexOf('class="lite-tabs"'), '#elsewhere is hidden on the Command Center only, so above the tabs it moved them down on every other tab');
});

test('nothing above the 1D tab bar is laid out only on the Command Center', () => {
  const ABOVE = above();
  const bad: string[] = [];
  for (const f of sheets('src/client')) {
    for (const r of rules(read(f))) {
      for (const one of r.sel.split(',')) if (/on-command/.test(one) && ABOVE.test(one.split(/\s|>/).pop() ?? '')) bad.push(`${f}: ${one.trim()}`);
    }
  }
  assert.deepEqual(bad, [], 'these rules move what sits above the tabs on the Command Center only, so the other tabs start lower');
});

test("the Firm's banner is on the Audit log page, and nothing above the tabs keeps room for it any more", () => {
  const html = read('src/client/lite.html');
  const banner = html.indexOf('id="firm-banner"');
  assert.ok(banner > html.indexOf('class="lite-tabs"'), 'below the tabs');
  assert.ok(banner < html.indexOf('id="audit-view"'), 'just above the Audit log');
  assert.match(read('src/client/lite.ts'), /\$\('firm-banner'\)\.classList\.toggle\('hidden', t !== 'audit'\);/);
  // The room the floor's line left it at the top right is gone, on every tab alike.
  assert.doesNotMatch(read('src/client/ui/command-layout.css'), /#firm-banner|padding-right: 300px/);
  assert.doesNotMatch(read('src/client/ui/budget/budget.css'), /padding-right: 300px/);
  // In a Portal theme it's in the Audit log's page header (ui/portal/pagehead.css), with The Firm → beside Call an audit.
  const head = read('src/client/ui/portal/pagehead.css');
  assert.match(head, /\.pt-head:not\(\[data-page='audit'\]\) #firm-banner \{ display: none; \}/);
});
