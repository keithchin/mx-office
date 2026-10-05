// Every HTTP route the office answers, in the order they're tried: a new route goes where it has to
// come in that order (see http/router.ts). The public ones are tried first, then the sign-in check,
// then the rest; the last one answers every path left with the client bundle, or a 404.
import type { Route } from '../router.js';
import { agentRoutes } from './agents.js';
import { analysisRoutes } from './analysis.js';
import { authRoutes } from './auth.js';
import { fileRoutes } from './files.js';
import { githubRoutes } from './github.js';
import { homeRoutes } from './home.js';
import { pageRoutes } from './pages.js';
import { prShotRoutes } from './prshots.js';
import { rosterRoutes } from './roster.js';
import { searchRoutes } from './search.js';
import { teamRoutes } from './teams.js';
import { serviceRoutes } from './services.js';
import { wizardRoutes } from './wizard.js';

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
  analysisRoutes.report,
  analysisRoutes.backfill,
  analysisRoutes.summary,
  homeRoutes.stats,
  prShotRoutes.checks,
  prShotRoutes.file,
  rosterRoutes.view,
  rosterRoutes.standup,
  rosterRoutes.action,
  teamRoutes.page,
  teamRoutes.labels,
  wizardRoutes.wizard,
  pageRoutes.office,
  pageRoutes.home,
  pageRoutes.lite,
  pageRoutes.pixel,
  pageRoutes.bundle,
];
