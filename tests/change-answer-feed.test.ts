// Change answer in the browser (client/ui/change-answer/api.ts): no card fetches anything when it's drawn;
// a decision's detail is fetched once, when its history is first expanded or its dialog opened, and kept per
// revision, so expanding again or opening the dialog afterwards fetches nothing. A change sent drops the
// copies (the revision moved on) and keeps the new detail the office answered with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const calls: string[] = [];
const g = globalThis as unknown as { fetch: (url: string, init?: { method?: string }) => Promise<unknown> };
g.fetch = async (url: string, init?: { method?: string }) => {
  calls.push(`${init?.method ?? 'GET'} ${url}`);
  if (url.startsWith('/api/answers/change')) return { ok: true, status: 200, json: async () => ({ rev: 3, detail: { floor: 'f', decision: 'esc:a', rev: 3, revs: [], links: [] } }) };
  const rev = calls.filter((c) => c.includes('detail')).length;
  return { ok: true, status: 200, json: async () => ({ floor: 'f', decision: 'esc:a', rev, revs: [], links: [] }) };
};

const { loadDetail, sendChange } = await import('../src/client/ui/change-answer/api.js');

test('change-no-per-card-fetches: the detail is fetched once on expand, then reused by the history and the dialog', async () => {
  // Drawing a card is the controls and the closed fold: neither calls the office (the only fetch is in api.ts, behind a toggle or a click).
  const root = path.join(import.meta.dirname, '..', 'src', 'client', 'ui', 'change-answer');
  const controls = readFileSync(path.join(root, 'controls.ts'), 'utf8');
  const history = readFileSync(path.join(root, 'history.ts'), 'utf8');
  assert.doesNotMatch(controls, /fetch\(|loadDetail\(/);
  assert.match(history, /addEventListener\('toggle', \(\) => \{\s*if \(!fold\.open \|\| asked\) return;/);
  assert.equal(calls.length, 0);
  const a = await loadDetail('f', 'esc:a', 2);
  await loadDetail('f', 'esc:a', 2);
  await loadDetail('f', 'esc:a', 2);
  assert.equal(calls.length, 1, 'expanded three times, opened once: one request');
  assert.ok(typeof a !== 'string');
  await loadDetail('f', 'esc:b', 1);
  assert.equal(calls.length, 2, 'another decision is its own request');
  const out = await sendChange({ floor: 'f', decision: 'esc:a', expectedRev: 2, verdict: 'approve', text: '' });
  assert.ok(out.ok);
  assert.equal(calls.length, 3);
  // The new revision's detail came with the change: opening its history fetches nothing.
  await loadDetail('f', 'esc:a', 3);
  assert.equal(calls.length, 3);
});
