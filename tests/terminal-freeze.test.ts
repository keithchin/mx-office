// The Command Center froze for one to two seconds at a time on busy projects (the "page froze (lite ›
// command)" incidents of releases 52 and 53, the terminal-freeze pass of 2026-10-16). Two xterm.js paths
// held the page: a redraw (SelectionService.refresh's frame → DomRenderer.renderRows → WidthCache._measure)
// and a write (WriteBuffer._innerWrite: the full terminal's snapshot, then its reflow and redraw in the
// write's callback). Every glyph xterm's DOM renderer measured forced a style pass of the whole page, and
// :has() rules anchored on <html> and <body> (and a universal `> *` after one) made each of those passes
// slow. Pinned here: the stylesheets keep those selectors out, terminals are fed in slices and reuse the
// widths measured before, and the performance guard opens the terminals with a long session in them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CHUNK, slices, writeInSlices } from '../src/client/ui/term-write.js';
import { fillWidths, readWidths, seedMonospace, widthKey } from '../src/client/ui/term-widths.js';
import { floodText } from '../scripts/perf/fakebin/flood.mjs';
import { views } from '../scripts/perf/views.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const cssFiles = () =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src/client'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.css'));

/** Every selector in a stylesheet (comments out), roughly: what's before each `{`. */
const selectors = (css: string) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('{')
    .slice(0, -1)
    .map((s) => s.split('}').pop()!.trim())
    .flatMap((s) => s.split(/,(?![^(]*\))/).map((x) => x.trim()))
    .filter(Boolean);

test('no stylesheet has a :has() on <html> or <body> that looks past their children, or a universal selector after a :has()', () => {
  const bad: string[] = [];
  for (const f of cssFiles()) {
    for (const sel of selectors(read(f))) {
      // html:has(body.x) and body:has(.y) are re-checked against the whole page on every change: `> ` only.
      if (/(^|[\s>~+(])(html|body)(\[[^\]]*\]|[.#:][\w-]+(?!\())*:has\((?!\s*>)/.test(sel)) bad.push(`${f}: ${sel}`);
      // X:has(…) > * restyled every element on every change (the old #summary.sm:has(> .pmc) > *).
      if (/:has\((?:[^()]|\([^()]*\))*\)\s*[>+~ ]\s*\*/.test(sel)) bad.push(`${f}: ${sel}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('big writes go to xterm.js in slices, and the callback runs once, after the last', () => {
  assert.deepEqual(slices('abc'), ['abc']);
  const big = 'x'.repeat(CHUNK * 2 + 5);
  const parts = slices(big);
  assert.equal(parts.length, 3);
  assert.equal(parts.join(''), big);
  assert.ok(parts.every((p) => p.length <= CHUNK));
  const writes: [string, unknown][] = [];
  const done = () => undefined;
  writeInSlices({ write: ((d: string, cb?: () => void) => void writes.push([d, cb])) as never }, big, done);
  assert.equal(writes.length, 3);
  assert.deepEqual(writes.map((w) => w[1]), [undefined, undefined, done]);
});

test('the three terminals feed snapshots and output in slices, and reuse and keep the widths measured', () => {
  for (const f of ['src/client/ui/pm/term.ts', 'src/client/ui/terminal.ts', 'src/client/ui/kanban-preview.ts']) {
    const src = read(f);
    assert.doesNotMatch(src, /\.write\(msg\.data/, `${f} writes msg.data in slices (writeInSlices)`);
    assert.match(src, /writeInSlices\(/, f);
    assert.match(src, /\.open\([^)]*\);\s*(\/\/.*\s*)*reuseWidths\(/, `${f} reuses the widths right after open()`);
    assert.match(src, /keepWidths\(/, f);
  }
  // The full window fits itself to the window in a task of its own, after the snapshot is parsed.
  assert.match(read('src/client/ui/terminal.ts'), /writeInSlices\(term, msg\.data, \(\) =>\s*setTimeout\(/);
});

/** A width cache shaped like xterm.js's (WidthCache.ts): measuring counts. */
function fakeCache(widths: Record<string, number>) {
  const flat = new Float32Array(256).fill(-9999);
  const holey = new Map<string, number>();
  let measured = 0;
  return {
    _flat: flat,
    _holey: holey as Map<string, number> | undefined,
    get(c: string, bold: boolean, italic: boolean) {
      measured++;
      return widths[`${c}${bold ? 'B' : ''}${italic ? 'I' : ''}`] ?? widths[c] ?? 0;
    },
    get measured() {
      return measured;
    },
  };
}

test('widths: kept ones fill only what is unmeasured; a monospace font fills ASCII from W and i', () => {
  const flat = new Float32Array(256).fill(-9999);
  const holey = new Map<string, number>();
  flat[65] = 7.5;
  const n = fillWidths(flat, holey, { flat: [[65, 9], [66, 7.125], [300, 1], [67, 0]], holey: [['●', 8], ['xB', 7.3]] });
  assert.equal(n, 3);
  assert.equal(flat[65], 7.5, 'a measured one stays');
  assert.equal(flat[66], 7.125);
  assert.equal(flat[67], -9999, 'a 0 (a box not laid out) is never kept or given');
  assert.deepEqual(readWidths(flat, holey), { flat: [[65, 7.5], [66, 7.125]], holey: [['●', 8], ['xB', 7.3]] });
  const mono = fakeCache({ W: 7.25, i: 7.25, WB: 7.25, iB: 7.25, WI: 7.25, iI: 7.25, WBI: 7.25, iBI: 7.25 });
  const filled = seedMonospace(mono);
  assert.equal(mono.measured, 8, 'W and i in each of the four variants');
  assert.equal(filled, 95 * 4);
  assert.equal(mono._flat['a'.charCodeAt(0)], 7.25);
  assert.equal(mono._holey!.get('aBI'), 7.25);
  const prop = fakeCache({ W: 9, i: 3 });
  assert.equal(seedMonospace(prop), 0, 'not monospace: nothing guessed');
  assert.notEqual(widthKey({ _font: 'a', _fontSize: 12, _weight: 'normal', _weightBold: 'bold' }, 7.25, 1), widthKey({ _font: 'a', _fontSize: 14, _weight: 'normal', _weightBold: 'bold' }, 7.25, 1));
});

test('the installed xterm.js still keeps its widths where term-widths.ts looks', () => {
  const lib = readFileSync(path.join(root, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.mjs'), 'utf8');
  for (const name of ['_renderService', '_widthCache', '_flat', '_holey', '_fontSize', '_weightBold']) assert.ok(lib.includes(name), `${name} in xterm.mjs`);
  assert.ok(lib.includes('fill(-9999)'), 'an unmeasured width is still -9999');
});

test('the performance guard opens the terminals with a long, wide session in them', () => {
  const t = floodText(64);
  assert.ok(t.length >= 64 * 1024);
  assert.equal(floodText(64), t, 'deterministic');
  assert.ok(t.split('\r\n').some((l) => l.length > 200), 'lines past 200 columns');
  assert.match(t, /\x1b\[38;2;/);
  assert.match(t, /\x1b\[3m/);
  assert.match(read('scripts/perf/run.mjs'), /FAKE_FLOOD: flood/);
  // The journey runs a copy of the fake agent from a folder of its own (journey/stubs.mjs): flood.mjs is only imported when asked.
  assert.doesNotMatch(read('scripts/perf/fakebin/fake-agent.mjs'), /^import .*flood.mjs/m);
  assert.match(read('scripts/perf/run.mjs'), /QUICK_VIEWS = \[[^\]]*'cc-terminal', 'cc-fullterm'/);
  const ids = views('f').map((v: { id: string }) => v.id);
  assert.ok(ids.includes('cc-fullterm'));
  // And no fake agent outlives a run: the busy office sweeps its whole folder after the office stops (its agent and floors are beside the office's own).
  const busy = read('scripts/perf/busy.mjs');
  const stop = busy.indexOf('await office.stop()', busy.indexOf('export async function runBusy'));
  assert.ok(stop > 0 && busy.slice(stop, stop + 900).includes('killProcessesUnder(root)'), 'busy.mjs sweeps its folder after the office stops');
  assert.ok(read('scripts/perf/run.mjs').includes('for (const dir of [officeRoot, `${officeRoot}-journey`, `${officeRoot}-busy`]) if (fs.existsSync(dir)) killProcessesUnder(dir)'), 'run.mjs sweeps every run folder');
});
