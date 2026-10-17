#!/usr/bin/env node
// A stand-in for the toolkit's bin/gate-check.sh (tests/stage-derive.test.ts): the same output lines
// ("Stage 0 (Triage): FAIL — why"), the same dashboard table (index.html with the generator's sentinel)
// and the same "Current stage" rewrite in PROJECT.md, over the project folder it's given. A few file
// checks stand in for the real ones. FAKE_GC_FAIL=1: dies before writing anything. FAKE_GC_NO_HTML=1:
// prints its verdicts but writes no dashboard.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? '.');
if (process.env.FAKE_GC_FAIL) {
  console.error('Error: gate-check could not read the toolkit (fake failure)');
  process.exit(2);
}
const read = (f) => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), 'utf8').replace(/\r/g, '') : undefined);
const has = (f) => existsSync(path.join(dir, f));
const project = read('PROJECT.md') ?? '';
const rows = (/^## Decisions\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(project)?.[1] ?? '')
  .split('\n')
  .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l))
  .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
  .filter((c) => c.length >= 3 && c[0] !== 'Stage');
const confirmed = (s) => rows.some((r) => r[0] === s && /^CONFIRMED/.test(r[2]));

const TITLES = { P: 'Kickoff', 0: 'Triage', 1: 'Analysis', 2: 'Requirements', 3: 'Architecture & Design', 4: 'Build Plan', 5: 'Build', 6: 'Test', 7: 'Cutover' };
const v = {};
const intake = read('intake.md') ?? '';
const open = intake.split(/^## /m).slice(1).filter((s) => !/^(Answered|Unverified)/m.test(s)).map((s) => s.split('\n')[0].trim());
v.P = open.length ? ['FAIL', `unanswered section(s) in ${dir}/intake.md: ${open.join('; ')}`] : ['PASS', 'every intake section answered'];
const triage = read('triage.md');
v[0] = !triage ? ['PENDING', 'triage.md not found'] : /Confirmed by:\s*"?\[user\]/.test(triage) ? ['FAIL', `'Confirmed by:' still holds the shipped placeholder: "[user] on [date]" (${dir}/triage.md, ## Sign-off)`] : ['PASS', 'triage signed off'];
v[1] = has('analysis/kb') ? ['PASS', 'knowledge base present'] : ['PENDING', 'no knowledge-base directory yet'];
v[2] = has('docs/brd.json') ? ['PASS', 'BRD present'] : ['PENDING', 'no knowledge-base directory yet — Stage 1 has not produced one'];
v[3] = !has('architecture/fit-gap.md') ? ['PENDING', 'missing: architecture/fit-gap.md'] : confirmed('3') ? ['PASS', 'fit-gap present and a Stage-3 CONFIRMED decision is in PROJECT.md'] : ['FAIL', 'artifacts exist but PROJECT.md has no Stage-3 CONFIRMED decision — ✋ gate'];
v[4] = !has('architecture/build-plan.md') ? ['PENDING', 'architecture/build-plan.md not written yet'] : confirmed('4') ? ['PASS', 'build-plan.md present and a Stage-4 CONFIRMED decision is in PROJECT.md'] : ['FAIL', 'build-plan.md exists but PROJECT.md has no Stage-4 CONFIRMED decision — ✋ gate'];
v[5] = ['MANUAL', 'not file-existence-checkable — fill in status manually'];
v[6] = has('test-report.html') ? ['PASS', 'test report present'] : ['PENDING', 'no test surface yet'];
v[7] = confirmed('7') ? ['PASS', 'cutover confirmed'] : ['PENDING', 'no cutover decision row'];

const order = ['P', '0', '1', '2', '3', '4', '5', '6', '7'];
for (const s of order) console.log(`Stage ${s} (${TITLES[s]}): ${v[s][0]} — ${v[s][1]}`);
console.log('Summary: (fake)');

if (!process.env.FAKE_GC_NO_HTML) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tr = order.map((s) => `<tr>\n<td>${s}</td>\n<td>${esc(TITLES[s])}</td>\n<td>\n<span class="b ${v[s][0].toLowerCase()}">${v[s][0]}</span>\n</td>\n<td>${esc(v[s][1])}</td>\n</tr>`).join('\n');
  writeFileSync(path.join(dir, 'index.html'), `<!-- generated-by: mxcli-project-toolkit/bin/gate-check.sh -->\n<html><body><h1>Conversion Dashboard</h1><table>\n<tr><th>Stage</th><th>Gate</th><th>Status</th><th>Notes</th></tr>\n<tr><td>⟳</td><td>Protocol freshness</td><td><span>PASS</span></td><td>fake</td></tr>\n${tr}\n</table><p>Re-run bin/gate-check.sh</p></body></html>\n`);
}
// The readout, as the real one writes it (first stage neither PASS nor WAIVED).
const pos = order.find((s) => !/PASS|WAIVED/.test(v[s][0]));
if (/^## Current stage/m.test(project)) {
  const line = `**Stage ${pos} — ${TITLES[pos]}**, in progress — gates passed: ${order.filter((s) => v[s][0] === 'PASS').join(', ')} (derived by gate-check on 2026-10-16; re-run it rather than editing this line).`;
  writeFileSync(path.join(dir, 'PROJECT.md'), project.replace(/^(## Current stage\n\n)\*\*[^\n]*/m, `$1${line}`));
}
