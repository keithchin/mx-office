// Hiring the project team runs on the creating person's own Claude sign-in (signins.ts: in an office with accounts,
// each person's workers run on their own Claude plan). The setup's team step is its last, after the repository, the
// app and the commit exist, so a missing sign-in used to show up only there. This looks before Create: the New
// project page shows it on Ready to create (with the fix: ☰ → 🔐 Your sign-ins, where an admin may also pick the
// office machine's own sign-in, the one sharing the office already has), and the start refuses before anything is
// made. Only for an account (on the shared password everything runs on the office's own) and when the plan hires
// someone in an office that hires (an offline test office hires nobody).

import type { Ctx } from '../office/context.js';
import type { WizardInfo } from '../../shared/wizard.js';

/** A look at someone's sign-ins takes up to 30 s; the page waits this long, then shows what the last look knew. */
const LOOK_WAIT_MS = 3_000;

/** The account's Claude sign-in as the page shows it; undefined when none is needed (no account, offline). */
export async function claudeSignInFor(ctx: Ctx, account: string | undefined, offline: boolean, force = false): Promise<WizardInfo['claudeSignIn']> {
  if (!account || offline) return undefined;
  const look = ctx.signins.look(account, force).catch(() => undefined);
  await Promise.race([look, new Promise((done) => setTimeout(done, LOOK_WAIT_MS).unref?.())]);
  return { ready: ctx.signins.claudeReady(account), why: ctx.signins.why('claude'), office: ctx.signins.state(account).office };
}

/** Why the start is refused before anything is made (the plan hires someone and the account has no Claude sign-in), or undefined. */
export async function claudeSignInRefusal(ctx: Ctx, account: string | undefined, offline: boolean, raw: unknown): Promise<string | undefined> {
  const roles = (raw as { roles?: unknown } | undefined)?.roles;
  if (!Array.isArray(roles) || !roles.length) return undefined;
  const s = await claudeSignInFor(ctx, account, offline, true);
  if (!s || s.ready) return undefined;
  return `${s.why}. Hiring the team is the setup's last step and runs on your Claude sign-in, so nothing was created: sign in (☰ → 🔐 Your sign-ins${s.office ? ', where an admin can also use the office’s own sign-in' : ''}), then press Create project again`;
}
