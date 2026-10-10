// Deliverables → Documents: the word a person reads everywhere (the 1D view, the settings, the progress
// bar, the acceptance record, the Playbooks' name for the page), like the Workers → Agents rename; the
// ids (?tab=deliverables still works, the deliverables settings section), the API (/api/deliverables),
// the data keys and the file names stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SETTINGS_SECTIONS } from '../src/shared/settings-sections.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

/** The string literals in `file` that name deliverables in words a person reads (not a path, an id or a class). */
function deliverableWords(file: string): string[] {
  const s = read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const out: string[] = [];
  const re = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}\n]*</g;
  for (const m of s.matchAll(re)) {
    const lit = m[0];
    if (!/\b[Dd]eliverables?\b/.test(lit)) continue;
    const inner = lit.slice(1, -1);
    if (/^\.{0,2}\//.test(inner) || /^\s*import\b|\bfrom\s*$/.test(s.slice(Math.max(0, m.index! - 8), m.index))) continue;
    // An id, a key or a class: one word, lower case.
    if (!/\s/.test(inner) && !/^D/.test(inner)) continue;
    out.push(`${file}: ${lit.slice(0, 100)}`);
  }
  return out;
}

test('Documents, not Deliverables, where a person reads it; the ids, the API and the data keys stay', () => {
  const client = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src/client'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((f) => /\.(ts|html)$/.test(f));
  const shown = [...client, 'src/shared/settings-sections.ts', 'src/shared/progress.ts', 'src/shared/roster/roles.ts', 'src/shared/deliverables.ts', 'src/server/acceptance/evidence.ts'];
  const left = shown.flatMap(deliverableWords);
  assert.deepEqual(left, []);
  assert.equal(SETTINGS_SECTIONS.find((s) => s.id === 'deliverables')?.label, 'Documents', 'the section keeps its id');
  assert.match(read('src/client/ui/deliverables/store.ts'), /\/api\/deliverables\?/, 'the API route is unchanged');
});
