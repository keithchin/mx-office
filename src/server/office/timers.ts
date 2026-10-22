import type { Ctx } from './context.js';
import { SLOW_CLIENT_BYTES } from './client.js';
import { startStudioMode } from '../studio/index.js';
import { startFloorSync } from '../floor-sync/index.js';
import { startWorktreeSweep } from '../worktree-sweep/index.js';
import { startNotifyTeams } from '../notify-teams/index.js';
import { startKeepAwake } from '../keep-awake/index.js';
import { startProjectRuns } from '../project-run/adapter.js';
import { startSafeRestart } from '../restart/office.js';
import { startPhoneAccess } from '../phone-access/index.js';
import { startWebPush } from '../webpush/index.js';
import { startWarmup } from '../warmup.js';
import { startStuckDetection } from '../stuck/index.js';
import { startAsks } from '../asks/index.js';
import { startPortfolios } from '../portfolios/index.js';
import { startProfiles } from '../profiles/index.js';
import { startDesignSystems } from '../design/index.js';
import { startQuestions } from '../questions/index.js';
import { startFollowThrough } from '../followthrough/index.js';
import { startChangeAnswer } from '../change-answer/index.js';
import { startToolkitPins } from '../toolkit-pin/office.js';
import { startWalkthroughs } from '../walkthroughs/office.js';
import { startSecurityGate } from '../security-gate/index.js';

/** The office's own clocks: terminals re-sent to viewers who fell behind, the heartbeat, Studio mode's look at the Mendix floors, Teams notifications and keep-awake. Returns what stops them. */
export function startTimers(ctx: Ctx): () => void {
  const { clients } = ctx;
  const resync = setInterval(() => {
    for (const c of clients.values()) {
      if (!c.stale.size || c.ws.bufferedAmount > SLOW_CLIENT_BYTES / 8) continue;
      for (const wid of c.stale) {
        const snap = c.attached.has(wid) ? ctx.workerFloor(wid)?.workers.attach(wid, c.id, c.peer.name) : undefined;
        if (snap) ctx.sendTo(c, { t: 'term.snapshot', workerId: wid, ...snap });
      }
      c.stale.clear();
    }
  }, 1000);

  // Drop dead connections so ghosts don't linger in the office.
  // Also signs out anyone `agent-office accounts` revoked, and passes on role changes made there.
  const heartbeat = setInterval(() => {
    let accountsMoved = false;
    for (const c of clients.values()) {
      if (!c.isAlive) {
        c.ws.terminate();
        continue;
      }
      if (!c.out && (!ctx.stillIn(c) || c.admin !== ctx.meOf(c.accountId).admin)) accountsMoved = true;
      c.isAlive = false;
      c.ws.ping();
    }
    if (accountsMoved) ctx.accountsChanged();
  }, 20_000);

  // Studio Pro open on a floor's project pauses that floor's agents' mxcli writes (studio/watch.ts).
  const stopStudio = startStudioMode(ctx);
  // Each floor's own folder kept up to date with GitHub by safe fast-forwards (floor-sync/).
  const stopFloorSync = startFloorSync(ctx);
  // Merged worktrees no worker has any more are cleaned up every hour (worktree-sweep/).
  const stopSweep = startWorktreeSweep(ctx);
  // What needs a person goes to a Teams channel (notify-teams/); the computer stays awake while agents work (keep-awake/).
  const stopTeams = startNotifyTeams(ctx);
  const stopAwake = startKeepAwake(ctx);
  // ⏸ paused floors (their pauses loaded), resume and pause runs a restart cut off, and 🔁 Restart safely (project-run/, restart/).
  const stopRuns = startProjectRuns(ctx);
  const stopRestart = startSafeRestart(ctx);
  // 📱 Phone access's tunnel back on if it was (phone-access/), and red items pushed to phones (webpush/).
  const stopTunnel = startPhoneAccess(ctx);
  const stopPush = startWebPush(ctx);
  // The ranking and each floor's setup view worked out in the background, so no first look waits on them (warmup.ts).
  const stopWarmup = startWarmup(ctx);
  // Work that stopped moving (a PR nobody touches, a decision waiting on the PM, a test red for days, no progress) raised in Needs you (stuck/).
  const stopStuck = startStuckDetection(ctx);
  // Asks that sat where the PM never looks (AWAITING-PM lines, work not on main, assumptions without consent, gate advisories, what's ready for review) surfaced in Needs you (asks/).
  const stopAsks = startAsks(ctx);
  // The analysts' open questions for the client, collected from the BRDs for the Questions page and Needs you (questions/).
  const stopQuestions = startQuestions(ctx);
  // Recorded as given: each answered decision's record found and compared, on the asks look's reads (followthrough/).
  const stopFollow = startFollowThrough(ctx);
  // Change answer: a change whose dispatch settles later moves its decision on then (change-answer/).
  const stopChange = startChangeAnswer(ctx);
  // Each portfolio's company brain looked at every five minutes, off the loop: a change under a live session is a Needs-you card (portfolios/).
  const stopPortfolios = startPortfolios(ctx);
  // Agent profiles: the existing team members given profiles once, and a move a restart left reconciled (profiles/).
  const stopProfiles = startProfiles(ctx);
  // Design systems: their files loaded, and a bound project's pointer line added under each new task (design/).
  const stopDesign = startDesignSystems(ctx);
  // Walkthrough videos recorded by themselves when a build on main passes its journeys, against the office's own copy of the app (walkthroughs/).
  const stopWalks = startWalkthroughs(ctx);
  // The security baseline: each project's policy loaded for the Playbooks (security-gate/; reads and mx checks run when asked).
  const stopSecurity = startSecurityGate(ctx);

  return () => {
    stopRuns();
    stopRestart();
    stopSweep();
    stopStudio();
    stopFloorSync();
    stopTeams();
    stopAwake();
    stopTunnel();
    stopPush();
    stopWarmup();
    stopStuck();
    stopAsks();
    stopQuestions();
    stopFollow();
    stopChange();
    stopPortfolios();
    stopProfiles();
    stopDesign();
    stopWalks();
    stopSecurity();
    clearInterval(heartbeat);
    clearInterval(resync);
  };
}
