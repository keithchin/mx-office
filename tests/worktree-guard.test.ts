// Agents' git worktrees stay in their project (bin/worktree-guard.js, server/worktree-guard.ts):
// `git worktree add` anywhere but the floor's .agent-office/worktrees/ is denied, with the path to use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { decide, resolveTarget, worktreeAdds } from '../bin/worktree-guard.js';
import { worktreeGuardHook } from '../src/server/worktree-guard.js';

const WIN = 'C:/Users/me/agent office/proj/.agent-office/worktrees';
const POSIX = '/home/me/proj/.agent-office/worktrees';
const bash = (command: string, cwd: string) => ({ tool_name: 'Bash', tool_input: { command }, cwd });

test('worktree adds are found in a command line, with -b/-B/--reason values skipped and cd / git -C followed', () => {
  assert.deepEqual(worktreeAdds('git worktree add -b feat/x ../x origin/main', '/r'), [{ target: '../x', cwd: '/r' }]);
  assert.deepEqual(worktreeAdds('git worktree add --lock --reason "busy now" -B b2 -- -odd', '/r'), [{ target: '-odd', cwd: '/r' }]);
  assert.deepEqual(worktreeAdds('cd /tmp && GIT_TRACE=0 git -c a.b=c -C sub worktree add here', '/r').map((a) => a.target), ['here']);
  assert.deepEqual(worktreeAdds('git worktree list; git status; echo worktree add', '/r'), []);
  assert.deepEqual(worktreeAdds('git.exe worktree add x && git worktree add y', '/r').map((a) => a.target), ['x', 'y']);
});

test('paths resolve with spaces, ~, relative parts, Git Bash /c/… and either separator', () => {
  assert.equal(resolveTarget('../x', 'C:/Users/me/agent office/proj', true), 'C:\\Users\\me\\agent office\\x');
  assert.equal(resolveTarget('/c/Users/me/x', 'C:/anything', true), 'C:\\Users\\me\\x');
  assert.equal(resolveTarget('.agent-office\\worktrees\\a b', 'C:\\Users\\me\\agent office\\proj', true), 'C:\\Users\\me\\agent office\\proj\\.agent-office\\worktrees\\a b');
  assert.equal(resolveTarget('~/x', '/r', false, '/home/me'), '/home/me/x');
  assert.equal(resolveTarget('$TMPDIR/x', '/r', false), undefined, 'a variable can’t be checked');
  assert.equal(resolveTarget('x', { base: '/r', rel: 'sub' } as never, false), '/r/sub/x');
});

test('inside the floor’s worktrees folder it runs; anywhere else it’s denied with the exact path to use', () => {
  const proj = 'C:/Users/me/agent office/proj';
  // Allowed: from the project root, from inside a worktree, with spaces, with Windows separators.
  assert.equal(decide(bash('git worktree add .agent-office/worktrees/leslie-brd -b leslie/brd', proj), WIN), undefined);
  assert.equal(decide(bash('git worktree add ../fran-65 -b fran/65', `${proj}/.agent-office/worktrees/alice`), WIN), undefined);
  assert.equal(decide(bash('git worktree add "C:\\Users\\me\\agent office\\proj\\.agent-office\\worktrees\\b c"', 'D:/elsewhere'), WIN), undefined);
  assert.equal(decide(bash('git worktree add "/c/users/ME/agent office/proj/.agent-office/worktrees/x"', proj), WIN), undefined, 'drive and case don’t matter on Windows');
  assert.equal(decide(bash('git status && npm test', proj), WIN), undefined);
  assert.equal(decide({ tool_name: 'Edit', tool_input: { command: 'git worktree add /tmp/x' } }, WIN), undefined);

  // Denied: next to the project, in Temp, the worktrees folder itself, via cd, via a variable.
  const sibling = decide(bash('git worktree add ../leslie-brd -b leslie/brd', proj), WIN);
  assert.ok(sibling);
  assert.match(sibling.reason, /git worktree add "C:\/Users\/me\/agent office\/proj\/\.agent-office\/worktrees\/leslie-brd"/);
  assert.ok(decide(bash('git worktree add -b x "C:\\Users\\me\\AppData\\Local\\Temp\\fran\\"', proj), WIN));
  assert.ok(decide(bash('git worktree add .agent-office/worktrees', proj), WIN), 'the folder itself isn’t a worktree in it');
  assert.ok(decide(bash('cd .. && git worktree add fran-65', proj), WIN));
  assert.ok(decide(bash('git -C .. worktree add fran-65', proj), WIN));
  assert.ok(decide(bash('git worktree add "$TEMP/x"', proj), WIN));
  assert.ok(decide(bash('git worktree add .agent-office/worktrees/ok && git worktree add ../bad', proj), WIN), 'any bad one in the line');

  // POSIX offices.
  assert.equal(decide(bash('git worktree add ../b -b b', '/home/me/proj/.agent-office/worktrees/a'), POSIX), undefined);
  const tmp = decide(bash('git worktree add /tmp/x', '/home/me/proj'), POSIX);
  assert.ok(tmp);
  assert.match(tmp.reason, /\/home\/me\/proj\/\.agent-office\/worktrees\/x/);
});

test('the hook only starts Node for a payload that mentions a worktree, and denies through Claude Code’s hook output', () => {
  const hook = worktreeGuardHook('/data/.agent-office', '/bin/worktree-guard.js', '/usr/bin/node')!;
  assert.equal(hook.matcher, 'Bash');
  assert.match(hook.hooks[0].command, /case "\$p" in \*worktree\*\)/);
  assert.ok(hook.hooks[0].command.includes("'/data/.agent-office/worktrees'"), 'the floor’s own worktrees folder is the allowed one');
  assert.equal(worktreeGuardHook('/d', null as never), undefined);

  const script = path.join(import.meta.dirname, '..', 'bin', 'worktree-guard.js');
  const run = (payload: unknown) => spawnSync(process.execPath, [script, POSIX], { input: JSON.stringify(payload), encoding: 'utf8' });
  const denied = run(bash('git worktree add /tmp/x', '/home/me/proj'));
  const out = JSON.parse(denied.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /\.agent-office\/worktrees\/x/);
  assert.equal(run(bash('git worktree add .agent-office/worktrees/x', '/home/me/proj')).stdout, '');
  assert.equal(spawnSync(process.execPath, [script, POSIX], { input: 'not json', encoding: 'utf8' }).stdout, '');
});
