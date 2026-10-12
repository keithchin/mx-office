// The Portal Overview's Team card shows each agent's own icon, its 2D character from the
// waist up as the office, the team chatter and the escalation cards draw it (ui/portal/face.ts), not coloured
// initials; the initials stay underneath until it's drawn. scripts/check-alignment.mjs checks
// on a running office that every face shows its icon, filling and centred in its circle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('the face is the agent’s character: the same look from its id, dressed for its role in its team’s colour', () => {
  const face = read('src/client/ui/portal/face.ts');
  assert.match(face, /standing\(lookFor\(w\.id, dress\.color, dress\.outfit\), 'front', false, 0\), 0, 0, 24, 24, 0, 0, 24, 24\)/);
  assert.match(face, /teamLookup\(members \?\? \[\]\)\.dressFor\(/);
  assert.match(face, /classList\.add\('pt-has-px'\)/);
});

test('the Team card’s rows use it, the initials under it, the status in words and the other agents kept', () => {
  const ov = read('src/client/ui/portal/overview.ts');
  assert.match(ov, /h\('span\.pt-face-i', \{ 'aria-hidden': 'true' \}, initials\(x\.name\)\), agentFace\(w, r\.members\)/);
  assert.match(ov, /h\('span\.pt-st', \{ class: `pt-st-\$\{x\.dot\}` \}, h\('i', \{ 'aria-hidden': 'true' \}\), x\.status\)/);
  assert.match(ov, /other agent\$\{others === 1 \? '' : 's'\} on the Agents page/);
  const css = read('src/client/ui/portal/overview.css');
  assert.match(css, /\.pt-face-px \{ display: none; width: 100%; height: 100%; border-radius: 50%; image-rendering: pixelated; \}/);
  assert.match(css, /\.pt-has-px \.pt-face-px \{ display: block; \}/);
  assert.match(css, /\.pt-has-px \.pt-face-i \{ display: none; \}/);
});
