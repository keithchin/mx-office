// A hire's Playbook, subagent files and journals written off the event loop (roster/playbooks.ts
// writeRoleFilesSoon): perf-quick caught a 333 ms server stall in it under load (2026-10-12), a single
// file's sync write. It now reads and writes through node:fs/promises with a turn of the loop between
// files, and writes exactly what writeRoleFiles writes: the same files, the same bytes, only what changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeRoleFiles, writeRoleFilesSoon, type PlaybookContext } from '../src/server/roster/playbooks.js';
import { ROLES, type RoleId } from '../src/shared/roster/roles.js';
import type { SubagentRecord } from '../src/shared/roster/subagents.js';

/** The longest block the event loop may have while the files are written (the stall recorder's threshold). */
const STALL_MS = 100;

// The Enterprise roles (the Solo lead, a generalist, defines every team's subagents on a team of its own).
const TEAM = ROLES.filter((r) => !r.generalist);
const names = Object.fromEntries(ROLES.map((r) => [r.id, `${r.title} name`])) as PlaybookContext['names'];
const ctxFor = (floor: string, role: RoleId, subagents: SubagentRecord[] = []): PlaybookContext => ({
  project: floor,
  name: names[role],
  level: 2,
  lessons: '.ai-context/skills/project-lessons/SKILL.md',
  names,
  subagents: subagents.filter((s) => s.lead === role),
  earlyDrafts: true,
  maxSubagents: 3,
});

/** Every file under `dir`, relative, with its text. */
function tree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) Object.assign(out, tree(dir, r));
    else out[r] = readFileSync(path.join(dir, r), 'utf8');
  }
  return out;
}

/** The longest gap between turns of the event loop while `work` runs. */
async function longestBlock<T>(work: () => Promise<T>): Promise<{ ms: number; value: T }> {
  let last = performance.now();
  let ms = 0;
  let on = true;
  const tick = () => {
    const now = performance.now();
    ms = Math.max(ms, now - last);
    last = now;
    if (on) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  const value = await work();
  on = false;
  tick();
  return { ms, value };
}

test('writeRoleFilesSoon writes what writeRoleFiles writes, byte for byte, and only what changed', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'playbooks-offloop-'));
  try {
    const a = path.join(root, 'sync');
    const b = path.join(root, 'async');
    // A Lead's subagent on warning, one benched (its definition moves, its dispatch is denied), and a
    // settings file with rules of its own that must survive.
    const recs: SubagentRecord[] = [
      { name: 'developer', lead: 'lead-developer', state: 'warning', warnings: [{ at: Date.UTC(2026, 9, 12), reason: 'skipped mxcli check', by: 'Alex' }], runs: [] } as unknown as SubagentRecord,
      { name: 'tester', lead: 'lead-tester', state: 'benched', warnings: [], runs: [] } as unknown as SubagentRecord,
    ];
    for (const d of [a, b]) {
      mkdirSync(path.join(d, '.claude'), { recursive: true });
      writeFileSync(path.join(d, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(git status)'] } }, null, 2));
    }
    const wroteA: string[] = [];
    const wroteB: string[] = [];
    for (const r of TEAM) {
      wroteA.push(...writeRoleFiles(a, r.id, ctxFor('big-spike', r.id, recs)));
      wroteB.push(...(await writeRoleFilesSoon(b, r.id, ctxFor('big-spike', r.id, recs))));
    }
    assert.deepEqual(wroteB, wroteA, 'the same files, in the same order');
    assert.ok(wroteA.length > TEAM.length * 2, `${wroteA.length} files`);
    assert.deepEqual(tree(b), tree(a), 'the same bytes');
    assert.match(readFileSync(path.join(b, '.claude', 'settings.local.json'), 'utf8'), /Bash\(git status\)[\s\S]*Agent\(tester\)/);
    // Again: nothing changed, nothing written; a Playbook edited by hand is put back, the journal kept.
    for (const r of TEAM) assert.deepEqual(await writeRoleFilesSoon(b, r.id, ctxFor('big-spike', r.id, recs)), []);
    const pb = Object.keys(tree(b)).find((f) => f.endsWith('SKILL.md') && f.includes('team-'))!;
    const journal = Object.keys(tree(b)).find((f) => f.includes('journal'));
    writeFileSync(path.join(b, pb), 'edited');
    if (journal) writeFileSync(path.join(b, journal), 'kept');
    const again = (await Promise.all(TEAM.map((r) => writeRoleFilesSoon(b, r.id, ctxFor('big-spike', r.id, recs))))).flat();
    assert.deepEqual(again, [pb]);
    if (journal) assert.equal(readFileSync(path.join(b, journal), 'utf8'), 'kept');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(`hiring every role on many floors never blocks the event loop over ${STALL_MS} ms`, async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'playbooks-offloop-'));
  try {
    const floors = Array.from({ length: 8 }, (_, i) => `floor-${i + 1}`);
    // For comparison: the same work with sync fs, the longest single role (one turn of the loop at best).
    let syncRole = 0;
    for (const r of ROLES) {
      const t0 = performance.now();
      writeRoleFiles(path.join(root, 'sync', r.id), r.id, ctxFor('sync', r.id));
      syncRole = Math.max(syncRole, performance.now() - t0);
    }
    // Every role on every floor, a floor's hires one after another and the floors at once (a busy office).
    const t0 = performance.now();
    const { ms, value } = await longestBlock(() =>
      Promise.all(floors.map(async (f) => {
        let n = 0;
        for (const r of ROLES) n += (await writeRoleFilesSoon(path.join(root, f), r.id, ctxFor(f, r.id))).length;
        return n;
      })),
    );
    const files = value.reduce((s, n) => s + n, 0);
    t.diagnostic(`${files} files for ${floors.length} floors × ${ROLES.length} roles in ${Math.round(performance.now() - t0)} ms; longest event-loop block ${ms.toFixed(1)} ms (sync fs: up to ${syncRole.toFixed(1)} ms per role in one block)`);
    assert.ok(files > floors.length * ROLES.length * 2, `${files} files written`);
    assert.ok(ms < STALL_MS, `the event loop was blocked ${ms.toFixed(1)} ms in one go`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
