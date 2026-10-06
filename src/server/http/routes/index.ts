// Every HTTP route the office answers, in the order they're tried: a new route goes where it has to
// come in that order (see http/router.ts). The public ones are tried first, then the sign-in check,
// then the rest; the last one answers every path left with the client bundle, or a 404.
import type { Route } from '../router.js';
import { agentRoutes } from './agents.js';
import { analysisRoutes } from './analysis.js';
import { firmRoutes } from './firm.js';
import { flowRoutes } from './flows.js';
import { auditRoutes } from './audit.js';
import { chatterRoutes } from './chatter.js';
import { authRoutes } from './auth.js';
import { fileRoutes } from './files.js';
import { gitRoutes } from './git.js';
import { githubRoutes } from './github.js';
import { homeRoutes } from './home.js';
import { pageRoutes } from './pages.js';
import { prShotRoutes } from './prshots.js';
import { rankingRoutes } from './ranking.js';
import { rosterRoutes } from './roster.js';
import { searchRoutes } from './search.js';
import { teamRoutes } from './teams.js';
import { deliverableRoutes } from './deliverables.js';
import { serviceRoutes } from './services.js';
import { studioRoutes } from './studio.js';
import { wizardRoutes } from './wizard.js';
import { notifyTeamsRoutes } from './notify-teams.js';
import { keepAwakeRoutes } from './keep-awake.js';

export const routes: readonly Route[] = [
  // Anyone.
  authRoutes.login,
  authRoutes.loginOptions,
  authRoutes.join,
  authRoutes.claimable,
  authRoutes.claim,
  authRoutes.link,
  authRoutes.logout,
  pageRoutes.health,
  pageRoutes.assets,
  pageRoutes.login,
  pageRoutes.claim,
  pageRoutes.join,
  pageRoutes.favicon,
  // Signed in.
  authRoutes.whoami,
  agentRoutes.models,
  fileRoutes.image,
  fileRoutes.whiteboardFile,
  fileRoutes.termDrop,
  fileRoutes.changedFile,
  fileRoutes.docs,
  searchRoutes.search,
  serviceRoutes.forwards,
  githubRoutes.github,
  gitRoutes.graph,
  analysisRoutes.report,
  analysisRoutes.backfill,
  analysisRoutes.summary,
  analysisRoutes.judge,
  rankingRoutes.report,
  auditRoutes.page,
  auditRoutes.export,
  auditRoutes.settings,
  flowRoutes.list,
  homeRoutes.stats,
  notifyTeamsRoutes.view,
  notifyTeamsRoutes.save,
  notifyTeamsRoutes.test,
  keepAwakeRoutes.view,
  keepAwakeRoutes.save,
  homeRoutes.overview,
  firmRoutes.view,
  firmRoutes.engagement,
  firmRoutes.status,
  firmRoutes.defaults,
  firmRoutes.estimate,
  firmRoutes.report,
  firmRoutes.action,
  prShotRoutes.checks,
  prShotRoutes.file,
  rosterRoutes.view,
  rosterRoutes.standup,
  rosterRoutes.action,
  chatterRoutes.page,
  teamRoutes.page,
  teamRoutes.labels,
  deliverableRoutes.deliverables,
  wizardRoutes.wizard,
  studioRoutes.info,
  studioRoutes.open,
  pageRoutes.office,
  pageRoutes.home,
  pageRoutes.firm,
  pageRoutes.lite,
  pageRoutes.pixel,
  pageRoutes.docs,
  pageRoutes.bundle,
];
