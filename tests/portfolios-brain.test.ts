// Portfolios Phase 1 against synthetic company brains and a copy of the toolkit's wire-company-brain.sh
// (tests/portfolio-world.ts): connecting and wiring with the office's completion check, the context
// manifest (K01–K03), a correction and a withdrawal (K04), an unavailable brain, disconnecting, and the
// two-portfolio marker suite ported from the Phase 0 spike's scan.sh (S01). No network, no tokens, a fake HOME.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { primePrompt } from '../src/server/roster/prompts.js';
import { playbook } from '../src/server/roster/playbooks.js';
import { ROLES } from '../src/shared/roster/roles.js';
import { BRAIN_UNAVAILABLE_LINE, PRIME_LINE_MAX, windowsForm } from '../src/shared/portfolios.js';
import { BRAIN_BEGIN, checkWiring, removeBlock } from '../src/server/portfolios/wire.js';
import { collectDecisions } from '../src/shared/needsyou.js';
import { World, acmeAndBeta, ALL_MARKERS, M } from './portfolio-world.js';

const read = (f: string) => readFileSync(f, 'utf8');
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

async function acmeWorld(betaVersioned = true) {
  const w = new World();
  const brains = acmeAndBeta(w, betaVersioned);
  const a1 = w.project('a1');
  const a2 = w.project('a2');
  const b1 = w.project('b1');
  const s = w.service();
  const acme = (await s.create('Acme', 'Keith')) as { id: string };
  const beta = (await s.create('Beta', 'Keith')) as { id: string };
  await s.addProject(acme.id, a1.id, 'Keith');
  await s.addProject(acme.id, a2.id, 'Keith');
  await s.addProject(beta.id, b1.id, 'Keith');
  return { w, s, a1, a2, b1, acme, beta, b: brains };
}

test('connect: validates the brain, wires every member project after init with one Windows-form block per surface, and never writes into the toolkit', async () => {
  const { w, s, a1, a2, acme, b } = await acmeWorld();
  const before = w.tree(w.toolkit);
  const bad = await s.connect(acme.id, path.join(w.root, 'nope'), 'Keith');
  assert.match(bad.error ?? '', /No folder at/);
  writeFileSync(path.join(w.root, 'README.md'), '# not a brain\n');
  assert.match((await s.connect(acme.id, w.root, 'Keith')).error ?? '', /Not a company brain: ROUTING\.md is missing/);
  const r = await s.connect(acme.id, b.acme, 'Keith');
  assert.equal(r.error, undefined);
  assert.equal(r.read?.status, 'ok');
  for (const f of [a1, a2]) {
    assert.deepEqual(r.results?.[f.id], { ok: true, problems: [], surfaces: ['CLAUDE.local.md', 'CLAUDE.md', 'AGENTS.md'] }, f.id);
    for (const surface of ['CLAUDE.local.md', 'CLAUDE.md', 'AGENTS.md']) {
      const text = read(path.join(f.dir, surface));
      assert.equal(text.split(BRAIN_BEGIN).length - 1, 1, `${f.id}/${surface}: one block`);
      assert.ok(text.includes(`${windowsForm(b.acme)}/ROUTING.md`), `${f.id}/${surface}: Windows-form path`);
      if (process.platform === 'win32') assert.doesNotMatch(text, /`\/[a-z]\//, 'no Git Bash path left in the block');
    }
  }
  assert.deepEqual(w.tree(w.toolkit), before, 'the toolkit copy is untouched (no .leakguard-deny, no contrib/inbox)');
  // The brain's own registry row (the toolkit's doing) is the only write outside the projects.
  assert.match(read(path.join(b.acme, 'projects.tsv')).replace(/^/, ''), /a1\tactive/);
  assert.ok(w.audits.some((e) => e.action === 'portfolio.connect') && w.audits.filter((e) => e.action === 'portfolio.wire').length === 2);
});

test('K01/K03: a hire records what was offered: the routed files with their sha256, the HEAD snapshot, dirty, and the prime line', async () => {
  const { w, s, a1, acme, b } = await acmeWorld();
  await s.connect(acme.id, b.acme, 'Keith');
  const head = w.git(b.acme, 'rev-parse', 'HEAD');
  const ctx = (await s.hireContext(a1.id))!;
  assert.equal(ctx.line, `Company brain Acme @${head.slice(0, 7)}: before answering terminology or convention questions, read ${windowsForm(b.acme)}/ROUTING.md. Don't search other company folders.`);
  assert.ok(ctx.line.length <= PRIME_LINE_MAX);
  await ctx.record('lead-developer', 'w-1');
  const [m] = await s.manifests.all(a1.id);
  assert.equal(m.projectId, 'prj_a1');
  assert.equal(m.agentInstanceId, 'w-1');
  assert.equal(m.portfolioId, acme.id);
  assert.equal(m.brain.status, 'ok');
  assert.equal(m.brain.snapshot, head);
  assert.equal(m.brain.dirty, true, 'projects.tsv was appended by the wiring and not committed');
  const glossary = m.brain.routed.find((x) => x.path === 'skills/acme-glossary.md');
  assert.deepEqual(glossary, { path: 'skills/acme-glossary.md', sha256: sha(path.join(b.acme, 'skills', 'acme-glossary.md')), bytes: readFileSync(path.join(b.acme, 'skills', 'acme-glossary.md')).length });
  assert.deepEqual(m.brain.routed.map((x) => x.path), ['skills/acme-glossary.md', 'skills/acme-entra.md']);
  assert.equal(m.brain.routing?.rows, 4);
});

test('K02: candidates, handoffs, proposals, patches, a missing routed file and unrouted files are excluded with their reason; a Beta manifest never names an Acme path', async () => {
  const { w, s, a1, b1, acme, beta, b } = await acmeWorld();
  await s.connect(acme.id, b.acme, 'Keith');
  await s.connect(beta.id, b.beta, 'Keith');
  await (await s.hireContext(a1.id))!.record('pm', 'w-a');
  await (await s.hireContext(b1.id))!.record('pm', 'w-b');
  const [ma] = await s.manifests.all(a1.id);
  const why = Object.fromEntries(ma.brain.excluded.map((x) => [x.path, x.reason]));
  assert.equal(why['inbox/2026-10-14-a1-candidate.md'], 'inbox', 'a routed candidate is still excluded');
  assert.equal(why['skills/house-page-conventions.md'], 'missing-file');
  assert.equal(why['skills/acme-unrouted.md'], 'unrouted');
  for (const d of ['inbox', 'handoffs', 'proposals', 'patches'] as const) assert.equal(why[`${d}/`], d);
  assert.ok(!ma.brain.routed.some((x) => /inbox|handoffs/.test(x.path)));
  const mb = read(s.manifests.file(b1.id));
  assert.doesNotMatch(mb, /acme/i, 'the Beta manifest names nothing of Acme');
  assert.ok(!w.audits.some((e) => e.floor === b1.id && /acme/i.test(JSON.stringify(e))), 'nor does anything audited on Beta');
});

test('K03: a brain that is not a git repository is allowed but labelled not versioned: no snapshot, @unversioned in the line', async () => {
  const { s, b1, beta, b } = await acmeWorld(false);
  const r = await s.connect(beta.id, b.beta, 'Keith');
  assert.equal(r.read?.status, 'unversioned');
  assert.equal(r.read?.snapshot, null);
  const ctx = (await s.hireContext(b1.id))!;
  assert.match(ctx.line, /^Company brain Beta @unversioned: /);
  await ctx.record('pm', 'w-b');
  assert.equal((await s.manifests.all(b1.id))[0].brain.status, 'unversioned');
});

test('K04: a correction and a withdrawal flag the live session on each member project once (one card per project), keep the old manifest, and Rehire refreshes it', async () => {
  const { w, s, a1, a2, b1, acme, beta, b } = await acmeWorld();
  await s.connect(acme.id, b.acme, 'Keith');
  await s.connect(beta.id, b.beta, 'Keith');
  w.hired.set(a1.id, [{ role: 'lead-developer', name: 'Ada', workerId: 'w-a1' }]);
  w.hired.set(a2.id, [{ role: 'pm', name: 'Pia', workerId: 'w-a2' }]);
  w.hired.set(b1.id, [{ role: 'pm', name: 'Bo', workerId: 'w-b1' }]);
  await (await s.hireContext(a1.id))!.record('lead-developer', 'w-a1');
  await (await s.hireContext(a2.id))!.record('pm', 'w-a2');
  await (await s.hireContext(b1.id))!.record('pm', 'w-b1');
  await s.tick();
  assert.equal(s.changeView(a1.id, true).change, undefined, 'nothing changed yet');
  // Correct the glossary (V2) and withdraw the Entra page (its routing row taken out), then commit.
  writeFileSync(path.join(b.acme, 'skills', 'acme-glossary.md'), `# Acme glossary\n- A visit (V2) ${M.aV2}\n`);
  const routing = read(path.join(b.acme, 'ROUTING.md')).split(/\r?\n/).filter((l) => !l.includes('acme-entra')).join('\n');
  writeFileSync(path.join(b.acme, 'ROUTING.md'), routing);
  w.commit(b.acme, 'correct + withdraw');
  w.clock += 5 * 60_000;
  await s.tick();
  const c1 = s.changeView(a1.id, true).change!;
  assert.deepEqual(c1.diff, { corrected: ['skills/acme-glossary.md'], withdrawn: ['skills/acme-entra.md'], added: [] });
  assert.deepEqual(c1.roles.map((r) => r.name), ['Ada']);
  assert.ok(s.changeView(a2.id, true).change, 'the other Acme project is flagged too');
  assert.equal(s.changeView(b1.id, true).change, undefined, 'Beta is not affected');
  assert.equal(w.audits.filter((e) => e.action === 'portfolio.brain-changed').length, 2);
  await s.tick();
  assert.equal(w.audits.filter((e) => e.action === 'portfolio.brain-changed').length, 2, 'raised once, not on every look');
  // The Needs-you card: a decision with Rehire for a fresh session / Dismiss.
  const { cards } = collectDecisions({ floor: a1.id, workers: [], pulls: [], floors: [], brain: s.changeView(a1.id, true) });
  const card = cards.find((c) => c.sources[0].type === 'brain')!;
  assert.equal(card.question, "Company brain changed: 1 corrected, 1 withdrawn since Ada's session was prepared");
  assert.equal(card.kind, 'decision');
  assert.equal(card.need.action, 'Rehire for a fresh session');
  assert.equal(card.need.alt?.action, 'Dismiss');
  // Rehire: bench first, hired again once benched; the old manifest is kept.
  assert.equal(await s.act(a1.id, 'rehire', 'Keith'), undefined);
  assert.deepEqual(w.benched, [`${a1.id}/lead-developer`]);
  w.phases.set(`${a1.id}/lead-developer`, 'benched');
  w.hired.set(a1.id, []);
  await s.rehireBenched();
  assert.deepEqual(w.hiredAgain, [`${a1.id}/lead-developer`]);
  w.hired.set(a1.id, [{ role: 'lead-developer', name: 'Ada', workerId: 'w-a1b' }]);
  await (await s.hireContext(a1.id))!.record('lead-developer', 'w-a1b');
  assert.equal(s.changeView(a1.id, true).change, undefined, 'a fresh session settles it');
  const all = await s.manifests.all(a1.id);
  assert.equal(all.length, 2, 'old manifest kept');
  assert.ok(all[0].brain.routed.some((x) => x.path === 'skills/acme-entra.md'), 'the old one still says what was offered then');
  // Dismiss on the other project: gone until the brain changes again.
  assert.equal(await s.act(a2.id, 'dismiss', 'Keith'), undefined);
  await s.tick();
  assert.equal(s.changeView(a2.id, true).change, undefined);
});

test('the completion check catches partial wiring (a skipped surface, a duplicate block, a moved brain) and raises a Needs-you item', async () => {
  const { w, s, a1, a2, acme, b } = await acmeWorld();
  // A toolkit whose script wires only CLAUDE.local.md and exits 0 (what init-project.sh --company leaves).
  writeFileSync(path.join(w.toolkit, 'bin', 'wire-company-brain.sh'), `#!/usr/bin/env bash\nB="$(cd "$2" && pwd)"\nprintf '\\n<!-- COMPANY-BRAIN:BEGIN -->\\n## Company brain\\nA company brain is wired at \\x60%s\\x60. Read \\x60%s/ROUTING.md\\x60.\\n<!-- COMPANY-BRAIN:END -->\\n' "$B" "$B" >> "$1/CLAUDE.local.md"\nexit 0\n`);
  const r = await s.connect(acme.id, b.acme, 'Keith');
  assert.equal(r.results?.[a1.id].ok, false);
  assert.deepEqual(r.results?.[a1.id].problems, ['CLAUDE.md has no company brain block', 'AGENTS.md has no company brain block']);
  const view = s.changeView(a1.id, true);
  assert.deepEqual(view.wiring?.problems, ['CLAUDE.md has no company brain block', 'AGENTS.md has no company brain block']);
  const { cards } = collectDecisions({ floor: a1.id, workers: [], pulls: [], floors: [], brain: view });
  assert.match(cards.find((c) => c.sources[0].type === 'brain')?.question ?? '', /wiring is incomplete/i);
  assert.ok(w.audits.some((e) => e.action === 'portfolio.wire-incomplete'));
  // A duplicate block, and a brain that moved after wiring.
  const local = path.join(a2.dir, 'CLAUDE.local.md');
  writeFileSync(local, read(local) + read(local));
  assert.match((await checkWiring(a2.dir, b.acme)).problems.join(';'), /CLAUDE\.local\.md has 2 company brain blocks/);
  renameSync(b.acme, `${b.acme}-moved`);
  assert.match((await checkWiring(a2.dir, b.acme)).problems.join(';'), /ROUTING\.md does not resolve/);
});

test('an unavailable brain: the portfolio says so, hires proceed with the unavailable line and an unavailable manifest; standalone projects are unaffected', async () => {
  const { w, s, a1, acme, b } = await acmeWorld();
  const solo = w.project('solo');
  await s.connect(acme.id, b.acme, 'Keith');
  rmSync(b.acme, { recursive: true, force: true });
  s.reader.read(b.acme, true);
  const v = await s.view(true);
  assert.equal(v.portfolios.find((p) => p.id === acme.id)?.read?.status, 'unavailable');
  const ctx = (await s.hireContext(a1.id))!;
  assert.equal(ctx.line, BRAIN_UNAVAILABLE_LINE);
  await ctx.record('pm', 'w-1');
  const [m] = await s.manifests.all(a1.id);
  assert.equal(m.brain.status, 'unavailable');
  assert.deepEqual(m.brain.routed, []);
  assert.equal(await s.hireContext(solo.id), undefined);
  await s.tick();
  assert.equal(s.changeView(a1.id, true).change, undefined, 'no change card for an unreadable brain');
});

test('disconnect: the marked blocks come out (files as they were before wiring), the manifests stay', async () => {
  const { s, a1, acme, b } = await acmeWorld();
  const before = ['CLAUDE.local.md', 'CLAUDE.md', 'AGENTS.md'].map((f) => read(path.join(a1.dir, f)));
  await s.connect(acme.id, b.acme, 'Keith');
  await (await s.hireContext(a1.id))!.record('pm', 'w-1');
  const r = await s.disconnect(acme.id, 'Keith');
  assert.deepEqual(r.removed?.[a1.id], ['CLAUDE.local.md', 'CLAUDE.md', 'AGENTS.md']);
  assert.deepEqual(['CLAUDE.local.md', 'CLAUDE.md', 'AGENTS.md'].map((f) => read(path.join(a1.dir, f))), before);
  assert.equal((await s.manifests.all(a1.id)).length, 1);
  assert.equal(await s.hireContext(a1.id), undefined, 'no brain: no line');
  assert.equal(removeBlock('a\n'), 'a\n');
});

test('S01: two portfolios: prompts, Playbooks, manifests, prime lines and instruction files carry no foreign marker, and no candidate or owner note anywhere', async () => {
  const { w, s, a1, a2, b1, acme, beta, b } = await acmeWorld();
  writeFileSync(path.join(a1.dir, 'PROJECT-LESSON.md'), `- A1-only working lesson ${M.a1Lesson}\n`);
  await s.connect(acme.id, b.acme, 'Keith');
  await s.connect(beta.id, b.beta, 'Keith');
  const names = Object.fromEntries(ROLES.map((r) => [r.id, r.id])) as never;
  const surfaces = (dir: string) => ['CLAUDE.local.md', 'CLAUDE.md', 'AGENTS.md'].map((f) => read(path.join(dir, f))).join('\n');
  const bundle: Record<string, string> = {};
  for (const f of [a1, a2, b1]) {
    const ctx = (await s.hireContext(f.id))!;
    await ctx.record('lead-developer', `w-${f.id}`);
    // L0 as scan.sh had it: what loads at session start (instruction files, Playbook, prime prompt) plus the manifest and the line.
    bundle[f.id] = [surfaces(f.dir), primePrompt('lead-developer', 'Ada', 2, undefined, 'task', [], undefined, ctx.line), playbook('lead-developer', { project: f.id, name: 'Ada', level: 2, lessons: 'L.md', names }), read(s.manifests.file(f.id)), ctx.line].join('\n');
  }
  // No brain content reaches any generated artifact: only the pointer, paths and hashes.
  for (const [id, text] of Object.entries(bundle)) for (const m of ALL_MARKERS) assert.ok(!text.includes(m), `${id} carries ${m}`);
  assert.doesNotMatch(bundle[b1.id], /acme/i, 'Beta: no Acme path or name');
  assert.doesNotMatch(bundle[a1.id] + bundle[a2.id], /beta-brain|Company brain Beta/, 'Acme: no Beta path');
  assert.ok(bundle[b1.id].includes(`${windowsForm(b.beta)}/ROUTING.md`));
  // L1, what the routing offers: Acme's routed set has the shared and Acme-only facts, never the candidate or the owner note.
  const [ma] = await s.manifests.all(a1.id);
  const routedText = ma.brain.routed.map((r) => read(path.join(b.acme, r.path))).join('\n');
  assert.ok(routedText.includes(M.aShared) && routedText.includes(M.aOnly));
  assert.ok(!routedText.includes(M.candidate) && !routedText.includes(M.profileNote));
  const [mb] = await s.manifests.all(b1.id);
  assert.ok(!mb.brain.routed.map((r) => read(path.join(b.beta, r.path))).join('\n').includes(M.aOnly));
  // The project lesson stays in A1.
  assert.ok(!bundle[a2.id].includes(M.a1Lesson) && !bundle[b1.id].includes(M.a1Lesson));
  void w;
});
