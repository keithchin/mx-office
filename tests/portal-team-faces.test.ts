// The Portal Overview's Team and Technical contact cards show each agent's own icon, its 2D character from the
// waist up as the office, the team chatter and the escalation cards draw it (ui/portal/face.ts), not coloured
// initials; the initials stay underneath until it's drawn and for the "+N". scripts/check-alignment.mjs checks
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

test('the Team card and the Technical contact use it, the initials under it, the dot and the +N kept', () => {
  const ov = read('src/client/ui/portal/overview.ts');
  assert.match(ov, /h\('span\.pt-face-i', \{ 'aria-hidden': 'true' \}, initials\(f\.name\)\), agentFace\(f, members\), h\('span\.pt-face-dot'/);
  assert.match(ov, /h\('span\.pt-face-i', \{\}, initials\(m\.name\)\), agentFace\(w, currentRoster\(\)\?\.members\)/);
  assert.match(ov, /h\('button\.pt-face\.pt-face-more'/);
  const css = read('src/client/ui/portal/overview.css');
  assert.match(css, /\.pt-face-px \{ display: none; width: 100%; height: 100%; border-radius: 50%; image-rendering: pixelated; \}/);
  assert.match(css, /\.pt-has-px \.pt-face-px \{ display: block; \}/);
  assert.match(css, /\.pt-has-px \.pt-face-i \{ display: none; \}/);
});
