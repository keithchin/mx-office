import path from 'node:path';
import type { Config } from '../config.js';
import { Auth } from '../auth.js';
import { Accounts } from '../accounts.js';
import { providerCommand } from '../agents.js';
import type { AgentProvider } from '../../shared/providers.js';
import { createModelCatalogues } from '../models.js';
import { Building } from '../building.js';
import { projectIdsFor } from '../projects/ids.js';
import type { Floor } from '../floor.js';
import { ChatLog } from '../history.js';
import type { Core, Ctx } from './context.js';
import type { Client } from './client.js';
import { startConnections } from '../connections/index.js';

/** The first of the office: accounts and sign-in, the people in it, chat, and the building's floors. */
export function createCore(ctx: Ctx, cfg: Config, publicDir: string): Core {
  // 🔌 Connections' saved credentials, before any worker is started or resumed (connections/).
  startConnections(cfg.dataDir);
  const accounts = new Accounts(cfg.dataDir);
  const auth = new Auth(cfg.verifier, cfg.salt, cfg.secret, accounts);
  const clients = new Map<string, Client>();
  // Kept on disk, so a restart doesn't wipe it.
  const chat = new ChatLog(cfg.dataDir);
  /** What the office is called where it has no project of its own to go by (webhooks, invites). */
  const officeName = cfg.project ? path.basename(cfg.project) : 'the office';
  // The model lists come from the provider's own CLI: the office's --agent when it's that one.
  const cli = (provider: AgentProvider) => {
    const command = providerCommand(provider, cfg.agentCmd);
    return command.includes('/') ? path.resolve(command) : command;
  };
  const models = createModelCatalogues(cli, cfg.dir);

  // --- The building: a floor per project, each with its own workers, boards and queue -----------
  // Each floor's stable project id (projects/ids.ts), stamped into floors.json beside its routing id.
  const building = new Building(cfg.dataDir, cfg.projectsDir, { projectIds: projectIdsFor(cfg.dataDir) });
  if (cfg.projects) {
    const err = building.setProjectsDir(cfg.projects, 'the command line');
    if (err) console.error(`agent-office: --projects: ${err}`);
  }
  const floors = new Map<string, Floor>();
  return { cfg, publicDir, accounts, auth, clients, chat, officeName, models, building, floors };
}
