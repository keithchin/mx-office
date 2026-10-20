// The issues and PR boards say "Updated …" only after a fetch that came back. A failed fetch keeps the last
// good time (fetchedAt) and stamps errorAt (server/github.ts), and the status line says it couldn't refresh,
// and why (client/ui/github/board-status.ts). No gh runs: a local-only project's folder is refused before it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitHub } from '../src/server/github.js';
import { LOCAL_ONLY_TEXT } from '../src/server/local-only.js';
import { boardStatus } from '../src/client/ui/github/board-status.js';
import type { GhIssue, GhPull, GhState } from '../src/shared/protocol.js';

const ago = (at: number) => `@${at}`;

test('the status line: refreshing, updated after a fetch that came back, couldn’t refresh with the reason after one that failed', () => {
  assert.equal(boardStatus({ loading: true, fetchedAt: 5 }, ago), 'Refreshing…');
  assert.equal(boardStatus({ loading: false, fetchedAt: 5 }, ago), 'Updated @5');
  assert.equal(boardStatus({ loading: false, fetchedAt: 0 }, ago), '');
  assert.equal(boardStatus({ loading: false, fetchedAt: 5, error: 'HTTP 502: Bad Gateway\nmore lines' }, ago), 'Couldn\'t refresh: HTTP 502: Bad Gateway (last updated @5)');
  assert.equal(boardStatus({ loading: false, fetchedAt: 0, error: 'gh: not logged in' }, ago), 'Couldn\'t refresh: gh: not logged in', 'never fetched: no "last updated"');
  assert.ok(boardStatus({ loading: false, fetchedAt: 5, error: 'x'.repeat(400) }, ago).length < 180, 'a long complaint is cut short');
});

test('the server: a failed fetch keeps the last good fetchedAt and says when it failed', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'board-status-'));
  try {
    writeFileSync(path.join(dir, 'agent-office.project.json'), JSON.stringify({ localOnly: true }));
    const pulls: GhState<GhPull>[] = [];
    const issues: GhState<GhIssue>[] = [];
    const g = new GitHub(dir, (s) => issues.push(s), (s) => pulls.push(s));
    const before = { items: [], fetchedAt: 1234, loading: false };
    Object.assign(g, { pulls: { ...before }, issues: { ...before } });
    const t0 = Date.now();
    await g.refresh();
    const p = pulls.at(-1)!;
    assert.equal(p.fetchedAt, 1234, 'the last fetch that came back, not the failed one');
    assert.equal(p.error, LOCAL_ONLY_TEXT);
    assert.ok((p.errorAt ?? 0) >= t0, 'when it failed');
    assert.equal(p.loading, false);
    const i = issues.at(-1)!;
    assert.deepEqual([i.fetchedAt, !!i.error, (i.errorAt ?? 0) >= t0], [1234, true, true]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
