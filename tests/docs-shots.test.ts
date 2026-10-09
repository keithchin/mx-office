// The docs screenshots (scripts/docs-shots.mjs): AGENT_OFFICE_DOCS_SHOTS leaves the TEST MODE badge off
// only in test mode, the demo office reads like a real project (no test words in anything a page could
// show), and the PNG the script writes is a valid one with the pixels it was given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { docsShots, testModeAnswer, useTestMode } from '../src/server/testmode.js';
import { generateDemo, PROJECTS } from '../scripts/docs/demo.js';
// @ts-expect-error: a plain .mjs script, no types
import { encodePng, SHOTS } from '../scripts/docs-shots.mjs';

function withEnv(v: string | undefined, run: () => void) {
  const before = process.env.AGENT_OFFICE_DOCS_SHOTS;
  if (v === undefined) delete process.env.AGENT_OFFICE_DOCS_SHOTS;
  else process.env.AGENT_OFFICE_DOCS_SHOTS = v;
  try {
    run();
  } finally {
    if (before === undefined) delete process.env.AGENT_OFFICE_DOCS_SHOTS;
    else process.env.AGENT_OFFICE_DOCS_SHOTS = before;
  }
}

test('AGENT_OFFICE_DOCS_SHOTS hides the TEST MODE badge only in test mode; a real office ignores it', () => {
  const testEnv = process.env.AGENT_OFFICE_TEST_MODE;
  delete process.env.AGENT_OFFICE_TEST_MODE;
  try {
    // A real office (not in test mode): the variable changes nothing.
    useTestMode({ flag: false, officeDir: path.join(os.tmpdir(), 'an-office'), agentCmd: 'claude', agentExplicit: false });
    withEnv('1', () => {
      assert.equal(docsShots(), false);
      assert.deepEqual(testModeAnswer(), { on: false });
    });
    // A test office: on with the variable, off without it or with 0.
    useTestMode({ flag: true, officeDir: path.join(os.tmpdir(), 'an-office'), agentCmd: 'fake', agentExplicit: true });
    withEnv('1', () => {
      assert.equal(docsShots(), true);
      assert.deepEqual(testModeAnswer(), { on: true, why: 'started with --test-mode', docsShots: true });
    });
    withEnv(undefined, () => assert.deepEqual(testModeAnswer(), { on: true, why: 'started with --test-mode' }));
    withEnv('0', () => assert.equal(docsShots(), false));
  } finally {
    useTestMode(undefined);
    if (testEnv !== undefined) process.env.AGENT_OFFICE_TEST_MODE = testEnv;
  }
});

test('the client leaves the badge off only when the office says docsShots', () => {
  const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'client', 'ui', 'testmode', 'index.ts'), 'utf8');
  assert.match(src, /if \(!v\?\.on \|\| v\.docsShots \|\|/);
});

test('the demo office reads like a real project: no test words, paths or ids in what a page could show', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'test-office-docs-demo-'));
  try {
    const demo = generateDemo(dir, Date.UTC(2026, 9, 8, 14, 18));
    assert.deepEqual(
      demo.floors.map((f) => f.name),
      PROJECTS.map((p) => p.name),
    );
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = path.join(d, e);
        if (e === '.git') continue;
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(demo.officeDir);
    walk(demo.github);
    const bad = /\bfake\b|\bperf\b|spike|step-\d|test-office|lorem/i;
    for (const f of files) {
      // Paths are the test office's own (never shown: the projects show their repository); the rest is what the pages read.
      const text = readFileSync(f, 'utf8').replaceAll(dir.replaceAll('\\', '/'), '<dir>').replaceAll(JSON.stringify(dir).slice(1, -1), '<dir>').replaceAll(dir, '<dir>');
      assert.doesNotMatch(text, bad, `${path.relative(dir, f)} has a test word`);
    }
    const floors = JSON.parse(readFileSync(path.join(demo.dataDir, 'floors.json'), 'utf8'));
    assert.ok(floors.every((f: { repo?: string }) => /^example-co\//.test(f.repo ?? '')), 'every project shows a made-up repository, not its folder');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the shots table: unique names, a page and a wait for each', () => {
  const names = SHOTS.map((s: { name: string }) => s.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('command-center'));
  for (const s of SHOTS) {
    assert.match(s.name, /^[a-z0-9-]+$/);
    assert.match(s.url, /^\//);
    assert.equal(typeof s.ready, 'function');
  }
});

test('encodePng writes a valid RGB PNG holding the pixels it was given', () => {
  const w = 7;
  const h = 5;
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([(i * 37) & 255, (i * 11) & 255, (i * 5) & 255, 255], i * 4);
  const png: Buffer = encodePng(w, h, rgba);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), w);
  assert.equal(png.readUInt32BE(20), h);
  // The IDAT chunk, inflated and unfiltered, is the RGB of the input.
  let at = 8;
  let idat = Buffer.alloc(0);
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat = Buffer.concat([idat, png.subarray(at + 8, at + 8 + len)]);
    at += 12 + len;
  }
  const raw = zlib.inflateSync(idat);
  const stride = w * 3;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= 3 ? px[y * stride + i - 3] : 0;
      const b = y ? px[(y - 1) * stride + i] : 0;
      const c = i >= 3 && y ? px[(y - 1) * stride + i - 3] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][f];
      px[y * stride + i] = (x + pred) & 255;
    }
  }
  for (let i = 0; i < w * h; i++) assert.deepEqual([...px.subarray(i * 3, i * 3 + 3)], [...rgba.subarray(i * 4, i * 4 + 3)]);
});
