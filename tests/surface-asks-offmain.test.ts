// Nothing waits on the PM unseen, S6: work that never reached main. Commits each agent branch has that
// main hasn't, and those that change journals, standups or handoffs, read with local git; a Needs-you info
// row once such a change is older than a day, with "Ask the lead to open a docs PR"; and the lead's newer
// standup on its branch, its Blocked on you labelled as not on main yet. A throwaway repo, no remote.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aheadBranches, isDocsPath, leadStandup } from '../src/server/asks/main.js';
import { actMessage, blockedOnYouOf, offMain, OFFMAIN_MS } from '../src/server/asks/detect.js';
import { AsksService, type AsksDeps, type AsksFloor } from '../src/server/asks/service.js';
import { askNeeds, branchLabel } from '../src/shared/asks.js';
import { collectNeeds, hereCount } from '../src/shared/needsyou.js';
import type { Place } from '../src/server/asks/sources.js';

const H = 3_600_000;
const NOW = Date.parse('2026-10-13T12:00:00Z');

function repo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'asks-git-'));
  const g = (args: string[], at = NOW - 72 * H) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: new Date(at).toISOString(), GIT_COMMITTER_DATE: new Date(at).toISOString(), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim();
  const put = (f: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), text);
  };
  g(['init', '-q', '-b', 'main']);
  g(['config', 'core.autocrlf', 'false']);
  put('README.md', 'x\n');
  put('docs/standups/2026-10-06.md', '# Standup 2026-10-06\n');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'init']);
  const main = g(['rev-parse', 'HEAD']);
  // Ada (the Coordinator): a journal entry two days ago, a standup page, and a code change.
  g(['checkout', '-q', '-b', 'office/ada']);
  put('docs/team/management.md', '# Management\n\n## 2026-10-11 09:00 — Standup\n');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'journal'], NOW - 48 * H);
  put('docs/standups/2026-10-13.md', '# Standup 2026-10-13\n\n**Summary** fine.\n\n## Blocked on you\n\n- Merge PR #51 (escalated)\n- OW-1 SMTP owner\n\n## Needs the Project Manager\n\n- nothing\n');
  put('src/x.ts', 'x\n');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'standup'], NOW - 3 * H);
  // Dylan: one journal entry an hour ago.
  g(['checkout', '-q', 'main']);
  g(['checkout', '-q', '-b', 'office/dylan']);
  put('docs/team/development.md', '# Development\n');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'dev journal'], NOW - 1 * H);
  g(['checkout', '-q', 'main']);
  const sha = (b: string) => g(['rev-parse', b]);
  return { dir, main, sha };
}

test('docs-type paths are journals, standups and handoffs', () => {
  assert.ok(isDocsPath('docs/team/management.md'));
  assert.ok(isDocsPath('docs/standups/2026-10-13.md'));
  assert.ok(isDocsPath('docs/handoffs/ada.md'));
  assert.ok(!isDocsPath('src/x.ts'));
});

test('commits ahead of main per agent branch, and only docs older than a day make the row', async () => {
  const r = repo();
  const places: Place[] = [
    { kind: 'branch', who: 'Ada', role: 'pm', branch: 'office/ada', sha: r.sha('office/ada') },
    { kind: 'branch', who: 'Dylan', branch: 'office/dylan', sha: r.sha('office/dylan') },
  ];
  const ahead = await aheadBranches(r.dir, r.main, places);
  assert.deepEqual(ahead.map((b) => [b.who, b.commits, b.docs]), [['Ada', 2, 2], ['Dylan', 1, 1]]);
  assert.equal(ahead[0].oldestDocsAt, NOW - 48 * H);
  const row = offMain(ahead, NOW, 'Ada');
  assert.ok(row);
  // Dylan's hour-old entry is under the threshold: only Ada's branch counts.
  assert.equal(row.text, "2 agent updates aren't on main (standups, journals, handoffs) · Ada: 2 commits");
  assert.equal(row.level, 'info');
  assert.deepEqual(row.acts.map((a) => a.act), ['docs-pr', 'seen']);
  assert.equal(row.acts[0].label, 'Ask Ada to open a docs PR');
  // A day later Dylan's counts too; nothing older than a day, no row.
  assert.match(offMain(ahead, NOW + OFFMAIN_MS, 'Ada')!.text, /^3 agent updates .* · Ada: 2 commits · Dylan: 1 commit$/);
  assert.equal(offMain(ahead.filter((b) => b.who === 'Dylan'), NOW, 'Ada'), undefined);
  assert.match(actMessage('docs-pr', row, 'Keith', NOW) ?? '', /Open a docs-only pull request/);
  // In Needs you: an info row, shown but not counted.
  const needs = collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], asks: { floor: 'f1', items: [row] } });
  assert.deepEqual(needs.map((n) => [n.kind, n.level, n.action]), [['offmain', 'info', 'Ask Ada to open a docs PR']]);
  assert.equal(hereCount(needs), 0);
  assert.deepEqual(askNeeds({ floor: 'f1', items: [row] }, 'f1')[0].target, { to: 'ask', id: row.id, act: 'docs-pr' });
});

test("the lead's newer standup on its branch: its Blocked on you, labelled as not on main yet", async () => {
  const r = repo();
  const lead: Place = { kind: 'branch', who: 'Ada', role: 'pm', branch: 'office/ada', sha: r.sha('office/ada') };
  const s = await leadStandup(r.dir, r.main, lead);
  assert.deepEqual(s, { who: 'Ada', branch: 'office/ada', file: 'docs/standups/2026-10-13.md', date: '2026-10-13', blocked: ['Merge PR #51 (escalated)', 'OW-1 SMTP owner'] });
  assert.equal(branchLabel('Ada'), "from Ada's branch, not on main yet");
  // Not newer than main's: nothing.
  assert.equal(await leadStandup(r.dir, r.sha('office/ada'), lead), undefined);
  assert.deepEqual(blockedOnYouOf('**Blocked on you**: nothing.\n'), []);
  assert.deepEqual(blockedOnYouOf('- **Blocked on you**\n  - OW-1 owner\n- **Next** x'), ['OW-1 owner']);
  // The standup page's "Blocked on you" gets the lines, labelled.
  const floor: AsksFloor = { id: 'f1', name: 'p', dir: r.dir, people: () => [] };
  const deps: AsksDeps = { dataDir: mkdtempSync(path.join(os.tmpdir(), 'asks-d-')), floors: () => [floor], now: () => NOW, writerOf: () => undefined, escalations: () => [], raise: () => {}, settle: () => {}, detectInput: async () => ({ standup: s! }), lead: () => ({ name: 'Ada' }), tell: () => undefined, record: () => {} };
  const svc = new AsksService(deps);
  await svc.look(floor, 'test');
  assert.deepEqual(await svc.blockedLines(floor), ["Merge PR #51 (escalated) (from Ada's branch, not on main yet)", "OW-1 SMTP owner (from Ada's branch, not on main yet)"]);
});
