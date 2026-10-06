// The office's two folders on the Connections page: where new projects are cloned (the building's
// projects folder, the same setting as ⚙️ Settings › Building) and the mxcli-project-toolkit clone the
// wizard and the Playbooks use. The toolkit folder picked here is kept in office-settings.json and beats
// AGENT_OFFICE_TOOLKIT_DIR; neither change needs a restart.

import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PathsView } from '../../shared/connections.js';
import type { Ctx } from '../office/context.js';
import { audit, human } from '../audit/index.js';
import { tildify } from '../building.js';
import { toolkitDirState, updateOfficeSettings } from './store.js';

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** What's wrong with a toolkit folder: missing, or not the toolkit (no bin/init-project.sh). */
export function toolkitProblem(dir: string): string | undefined {
  if (!isDir(dir)) return `${tildify(dir)} isn’t there`;
  if (!existsSync(path.join(dir, 'bin', 'init-project.sh'))) return `${tildify(dir)} has no bin/init-project.sh: it isn’t the mxcli-project-toolkit`;
  return undefined;
}

export function pathsView(ctx: Ctx): PathsView {
  const p = ctx.building.projectsDirState();
  const projectsAbs = ctx.building.projectsDir;
  const t = toolkitDirState();
  return {
    projectsDir: { dir: p.dir, source: p.custom ? 'settings' : process.env.AGENT_OFFICE_PROJECTS ? 'command line' : 'default', problem: isDir(projectsAbs) ? undefined : `${p.dir} isn’t there yet: it’s made when the first project is cloned` },
    toolkitDir: { dir: tildify(t.dir), source: t.source, problem: toolkitProblem(t.dir) },
  };
}

const untilde = (s: string) => s.replace(/^~(?=$|[\\/])/, os.homedir());

/** Sets one folder ('' goes back to the default). Returns why it couldn't. */
export function setPath(ctx: Ctx, which: 'projectsDir' | 'toolkitDir', raw: string, who: { name: string; id?: string }): string | undefined {
  const text = raw.trim();
  if (which === 'projectsDir') {
    const err = ctx.building.setProjectsDir(text, who.name);
    if (err) return err;
    const state = ctx.building.projectsDirState();
    audit.record({ actor: human(who.name, who.id), action: 'settings.change', target: { kind: 'setting', id: 'projectsDir', label: 'Workspace folder' }, summary: `Moved the workspace folder to ${state.dir}`, details: { after: { dir: state.dir, custom: state.custom } }, severity: 'notice' });
    ctx.broadcast({ t: 'projectsDir', state });
    return undefined;
  }
  let dir: string | undefined;
  if (text) {
    const typed = untilde(text);
    if (!path.isAbsolute(typed)) return 'Use a full path, like ~/agent-spike/mendix-toolkit';
    dir = path.resolve(typed);
    const why = toolkitProblem(dir);
    if (why) return why;
  }
  updateOfficeSettings({ toolkitDir: dir });
  const now = toolkitDirState();
  audit.record({ actor: human(who.name, who.id), action: 'settings.change', target: { kind: 'setting', id: 'toolkitDir', label: 'Toolkit folder' }, summary: `Toolkit folder set to ${tildify(now.dir)}${dir ? '' : ' (the default)'}`, details: { after: { dir: tildify(now.dir), source: now.source } }, severity: 'notice' });
  return undefined;
}
