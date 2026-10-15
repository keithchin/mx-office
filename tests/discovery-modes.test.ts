// The Discovery brief per entry mode (server/wizard/brief.ts, shared/discovery-migration.ts): a migration
// runs the toolkit's migration track (Stage 0 triage with assess-migration and the source sufficiency
// inventory over the absolute legacy source path, the slice at CAC-1 when asked, Stage 1 Path A extraction)
// and keeps the gates and the stop before Stage 5; every other mode is byte-for-byte what it was before
// (tests/fixtures/discovery/*.md, written from the code before this change).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { discoveryBrief } from '../src/server/wizard/brief.js';
import { briefMarkdown } from '../src/shared/brief-map.js';
import { asksForSlice } from '../src/shared/discovery-migration.js';
import { discoveryPlan, FLOOR, SHA, TOOLKIT } from './support/discovery-plans.js';

const fixture = (mode: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', 'discovery', `${mode}.md`), 'utf8').replace(/\r\n/g, '\n');
const LEGACY = 'C:/projects/Test-Org/pack-track/sources/legacy/shop-app';
const migration = (over = {}) => discoveryBrief(discoveryPlan('migration', { sourceFolder: { path: 'D:\\work\\shop-app', name: 'shop-app', files: 12, bytes: 3000 }, ...over }), TOOLKIT, SHA, FLOOR);

for (const mode of ['greenfield', 'requirements-driven', 'existing-app-change', 'assurance'] as const) {
  test(`the ${mode} Discovery brief is unchanged (snapshot)`, () => {
    assert.equal(`${discoveryBrief(discoveryPlan(mode), TOOLKIT, SHA, FLOOR)}\n`, fixture(mode));
  });
}

test('the existing-app change keeps its own wording: Stages P → 4, no migration track', () => {
  const b = discoveryBrief(discoveryPlan('existing-app-change'), TOOLKIT, SHA, FLOOR);
  assert.match(b, /Run \*\*Stages P → 4\*\*: intake, triage\/scope, requirements/);
  assert.doesNotMatch(b, /migration track|assess-migration|Path A/);
});

test('a migration’s Discovery names the runbook’s migration track, its steps and the absolute legacy source path', () => {
  const b = migration();
  assert.doesNotMatch(b, /Run \*\*Stages P → 4\*\*: intake, triage\/scope/, 'not the generic line');
  assert.ok(b.includes("run the toolkit's migration track** from `skills/conversion-runbook.md`"));
  assert.ok(b.includes('`skills/migration-pipeline.md` and `skills/migrate-general.md`'));
  assert.ok(b.includes('**Stage 0 — Triage & Scope ✋, source sufficiency first:**'));
  assert.ok(b.includes(`\`${TOOLKIT}/bin/source-sufficiency.sh init . --sources ${LEGACY}\``), 'the inventory over the absolute legacy path');
  assert.ok(b.includes("mxcli's bundled `.ai-context/skills/assess-migration.md`"));
  assert.ok(b.includes('`assessment.md` at the project root'));
  assert.ok(b.includes('`skills/source-triage.md`'));
  assert.ok(b.includes('**Stage 1 — Analysis, Path A extraction from the legacy source:**'));
  assert.ok(b.includes('**CAC-1b** (`skills/checkpoints/checkpoint-extraction.md`)'));
  assert.ok(b.includes(`\`${TOOLKIT}/bin/source-ledger.sh check .\``));
  assert.ok(b.includes(`**The legacy source (confidential)** is in \`${LEGACY}\``));
  // The gates and the stop stay.
  assert.ok(b.includes('**Stop at every ✋ gate (0, 3, 4)**'));
  assert.ok(b.includes('**Do not start Stage 5 (build).**'));
  // The attachments' own inventory command isn't given twice.
  assert.equal(b.split('source-sufficiency.sh init').length, 2);
});

test('the slice is picked at CAC-1 when the person asked for one; otherwise CAC-1 asks', () => {
  assert.ok(migration({ description: 'Rebuild the orders area as a first slice' }).includes('**The client asked for a slice: pick it at the first scope check, CAC-1** (`skills/checkpoints/checkpoint-scope.md`)'));
  const whole = migration({ description: 'Rebuild the whole shop' });
  assert.ok(whole.includes('**Close Stage 0 with CAC-1** (`skills/checkpoints/checkpoint-scope.md`)'));
  assert.doesNotMatch(whole, /asked for a slice/);
  assert.equal(asksForSlice(['a vertical slice of orders']), true);
  assert.equal(asksForSlice(['sliced bread', 'all of it']), false);
});

test('a migration without a source folder asks for the source', () => {
  const b = discoveryBrief(discoveryPlan('migration'), TOOLKIT, SHA, FLOOR);
  assert.ok(b.includes("**The legacy source isn't in the project yet:**"));
  assert.ok(b.includes('--sources <the legacy source folder>'));
});

test('the committed project brief marks the legacy source confidential', () => {
  const pb = discoveryPlan('migration').brief!;
  const md = briefMarkdown(pb, { repo: 'Test-Org/pack-track', entry: 'Migration', source: { name: 'shop-app', files: 12, bytes: 3000 } });
  assert.match(md, /## Legacy source \(confidential\)/);
  assert.match(md, /`sources\/legacy\/shop-app\/`, git-ignored: it stays on the office's machine/);
  assert.doesNotMatch(briefMarkdown(pb, { repo: 'Test-Org/pack-track', entry: 'Migration' }), /Legacy source/);
});
