// Hiring the team runs on the creating person's own Claude sign-in, so New project checks it before Create
// (server/wizard/claude-signin.ts): Ready to create says so with the fix, and the start is refused before the
// repository, the app or anything else is made. Never for the shared password or an offline test office, nor a
// plan that hires nobody. The summary also says where the code goes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeSignInFor, claudeSignInRefusal } from '../src/server/wizard/claude-signin.js';
import { SIGN_IN_FIX, summaryRows } from '../src/client/ui/wizard/new/create-summary.js';
import type { Ctx } from '../src/server/office/context.js';
import { discoveryPlan } from './support/discovery-plans.js';

function ctxWith(ready: Record<string, boolean>, office = false) {
  const looks: { id: string; force: boolean }[] = [];
  const ctx = {
    signins: {
      look: async (id: string, force = false) => void looks.push({ id, force }),
      claudeReady: (id: string) => !!ready[id],
      why: () => 'Sign in to Claude first (☰ → 🔐 Your sign-ins): your workers run on your own Claude plan',
      state: () => ({ office }),
    },
  } as unknown as Ctx;
  return { ctx, looks };
}

test('the sign-in check: only for an account in an office that hires, looked at again before the start', async () => {
  const { ctx, looks } = ctxWith({ ada: true, bo: false }, true);
  assert.equal(await claudeSignInFor(ctx, undefined, false), undefined, 'the shared password runs on the office’s own');
  assert.equal(await claudeSignInFor(ctx, 'bo', true), undefined, 'an offline test office hires nobody');
  assert.deepEqual(await claudeSignInFor(ctx, 'ada', false), { ready: true, why: ctx.signins.why('claude'), office: true });
  assert.equal((await claudeSignInFor(ctx, 'bo', false))?.ready, false);
  assert.equal(await claudeSignInRefusal(ctx, 'ada', false, { roles: ['chief-analyst'] }), undefined);
  assert.equal(await claudeSignInRefusal(ctx, 'bo', false, { roles: [] }), undefined, 'nobody to hire');
  const why = await claudeSignInRefusal(ctx, 'bo', false, { roles: ['chief-analyst'] });
  assert.match(why!, /Sign in to Claude first/);
  assert.match(why!, /nothing was created/);
  assert.match(why!, /office’s own sign-in/, 'an admin is told about the office’s own sign-in, the sharing that exists');
  assert.ok(looks.some((l) => l.id === 'bo' && l.force), 'the start looks afresh (they may have just signed in)');
});

test('Ready to create: where the code goes, and the Claude sign-in with its fix', () => {
  const plan = { ...discoveryPlan('greenfield'), autonomy: { level: 2 as const } };
  const label = (rows: [string, string, string?][], k: string) => rows.find((r) => r[0] === k);
  assert.equal(label(summaryRows({ ...plan, teamServer: { mirror: false }, localOnly: true }, 'Alex Lee'), 'Code')?.[1], 'Mendix Team Server');
  assert.equal(label(summaryRows({ ...plan, teamServer: { mirror: true } }, 'Alex Lee'), 'Code')?.[1], 'Mendix Team Server + GitHub mirror');
  assert.equal(label(summaryRows({ ...plan, localOnly: true }, 'Alex Lee'), 'Code')?.[1], 'Local only');
  assert.equal(label(summaryRows(plan, 'Alex Lee'), 'Code')?.[1], 'GitHub only');
  assert.equal(label(summaryRows(plan, 'Alex Lee'), 'Claude sign-in'), undefined, 'no row when none is needed');
  const missing = label(summaryRows(plan, 'Alex Lee', { ready: false, why: 'x', office: false }), 'Claude sign-in');
  assert.equal(missing?.[1], SIGN_IN_FIX);
  assert.match(missing![2]!, /Create waits until you’re signed in/);
  assert.match(label(summaryRows(plan, 'Alex Lee', { ready: true, why: 'x', office: false }), 'Claude sign-in')![1], /^Ready/);
});
