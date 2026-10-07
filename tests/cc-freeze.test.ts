// The 1D Command Center froze on a busy floor (mx-spike, release 15): the PM console kept its live
// terminal open in a box hidden by the Chat view, and xterm's DOM renderer, which only keeps a
// character's width when it measures more than 0, forced a layout of the whole page for every character
// of every row it drew there. The terminal is parked while its box has no size (ui/pm/term-park.ts), and
// the Chat view no longer draws again for changes it doesn't show (ui/pm/chat/logic.ts sameChat).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { termPlacement } from '../src/client/ui/pm/term-park.js';
import { sameChat, type ChatShown, type Convo } from '../src/client/ui/pm/chat/logic.js';

test('the terminal opens only in a box that is laid out, and is parked when the box is hidden', () => {
  assert.equal(termPlacement(false, { width: 400, height: 220 }), 'open');
  assert.equal(termPlacement(true, { width: 400, height: 220 }), 'keep');
  // display: none (the Chat view, the escalation cards): 0 × 0.
  assert.equal(termPlacement(true, { width: 0, height: 0 }), 'park');
  assert.equal(termPlacement(false, { width: 0, height: 0 }), 'keep');
  // A box squeezed to no height (the fitted layout) is no place to measure either.
  assert.equal(termPlacement(true, { width: 400, height: 0 }), 'park');
  assert.equal(termPlacement(false, { width: 0, height: 220 }), 'keep');
});

test('the PM terminal is never opened anywhere but place(), which asks termPlacement first', () => {
  const src = readFileSync(new URL('../src/client/ui/pm/term.ts', import.meta.url), 'utf8');
  const opens = [...src.matchAll(/\.open\(this\.host\)/g)];
  assert.equal(opens.length, 1, 'term.open(host) appears once');
  const place = src.indexOf('  place() {');
  assert.ok(place > 0 && opens[0].index! > place && src.indexOf('termPlacement(', place) < opens[0].index!, 'and only inside place(), after termPlacement');
  // The console places it each time it shows or hides the box.
  const consoleSrc = readFileSync(new URL('../src/client/ui/pm/console.ts', import.meta.url), 'utf8');
  assert.ok((consoleSrc.match(/placeTerm\(\);/g) ?? []).length >= 2, 'drawChat and drawEsc place the terminal');
});

const convo = (n: number): Convo => ({ available: true, messages: Array.from({ length: n }, (_, i) => ({ kind: 'agent', id: `m${i}`, text: `hi ${i}` }) as Convo['messages'][number]) });
const shown = (o: Partial<ChatShown> = {}): ChatShown => ({ workerId: 'w1', who: { name: 'Keith', icon: '🧭', color: '#fff' }, status: 'working', activity: 'Bash: npm test', convo: c1, ...o });
const c1 = convo(3);

test('the Chat view skips a redraw when nothing it shows changed (another worker changed)', () => {
  assert.equal(sameChat(undefined, shown()), false);
  assert.equal(sameChat(shown(), shown()), true);
  assert.equal(sameChat(shown(), shown({ who: { name: 'Keith', icon: '🧭', color: '#fff' } })), true, 'a new who object with the same fields is the same');
});

test('…and draws again for anything it does show', () => {
  assert.equal(sameChat(shown(), shown({ convo: convo(3) })), false, 'a new conversation object (the slice replaces it on every update)');
  assert.equal(sameChat(shown(), shown({ workerId: 'w2' })), false);
  assert.equal(sameChat(shown(), shown({ status: 'idle' })), false);
  assert.equal(sameChat(shown(), shown({ activity: 'Read a.ts' })), false);
  assert.equal(sameChat(shown(), shown({ who: { name: 'Maya', icon: '🧭', color: '#fff' } })), false);
  assert.equal(sameChat(shown(), shown({ convo: undefined })), false);
});
