// The office's folders on the Connections page: where new projects are cloned (the building's projects
// folder, the same setting as ⚙️ Settings › Building), the mxcli-project-toolkit clone the wizard and the
// Playbooks use, and the office's own mxcli (the one first-run setup picks: wizard/config.ts officeMxcli,
// which the live apps, microflow tests, the model reader and the wizard all run). The toolkit folder and
// mxcli picked here are kept in office-settings.json and beat AGENT_OFFICE_TOOLKIT_DIR / AGENT_OFFICE_MXCLI
// (and, for mxcli, AGENT_OFFICE_LIVE_MXCLI too); no change needs a restart.

import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PathState, PathsView } from '../../shared/connections.js';
import type { Ctx } from '../office/context.js';
import { audit, human } from '../audit/index.js';
import { tildify } from '../building.js';
import { officeSettings, toolkitDirState, updateOfficeSettings } from './store.js';
import { officeMxcli } from '../wizard/config.js';

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
    mxcli: mxcliState(),
  };
}

/** The office's mxcli as the Folders card shows it: where it is, where that came from, and what's wrong. */
export function mxcliState(env: NodeJS.ProcessEnv = process.env): PathState {
  const m = officeMxcli(env);
  if (!m) return { dir: '', source: 'default', problem: 'No mxcli found: the office falls back to an `mxcli` on PATH. Pick mxcli.exe here (or set AGENT_OFFICE_MXCLI)' };
  const source = m.source === 'settings' ? 'settings' : m.source === 'env' ? 'env' : 'default';
  return { dir: tildify(m.path), source, problem: existsSync(m.path) ? undefined : `There’s no mxcli at ${tildify(m.path)}` };
}

const untilde = (s: string) => s.replace(/^~(?=$|[\\/])/, os.homedir());

/**
 * Sets the office's mxcli ('' clears it: AGENT_OFFICE_MXCLI, else the workspace's). A folder means the mxcli in
 * it. Audited (settings.change); first-run setup's mxcli step saves through this too. Returns why it couldn't.
 */
export function setOfficeMxcli(raw: unknown, who: { name: string; id?: string }): string | undefined {
  const text = typeof raw === 'string' ? untilde(raw.trim().replace(/^"|"$/g, '')) : '';
  let p: string | undefined;
  if (text) {
    if (!path.isAbsolute(text)) return 'Use a full path, like C:\\Tools\\mxcli\\mxcli.exe';
    p = path.resolve(text);
    if (isDir(p)) p = path.join(p, process.platform === 'win32' ? 'mxcli.exe' : 'mxcli');
    if (!existsSync(p)) return `There’s no mxcli at ${tildify(p)}`;
  }
  const before = officeSettings().mxcliPath;
  updateOfficeSettings({ mxcliPath: p });
  audit.record({
    actor: human(who.name, who.id),
    action: 'settings.change',
    target: { kind: 'setting', id: 'mxcliPath', label: 'mxcli' },
    summary: p ? `${who.name} set mxcli to ${tildify(p)}` : `${who.name} cleared the mxcli path`,
    details: { before: { path: before ? tildify(before) : null }, after: { path: p ? tildify(p) : null } },
    severity: 'notice',
  });
  return undefined;
}

/** Sets one folder, or the office's mxcli ('' goes back to the default). Returns why it couldn't. */
export function setPath(ctx: Ctx, which: 'projectsDir' | 'toolkitDir' | 'mxcli', raw: string, who: { name: string; id?: string }): string | undefined {
  if (which === 'mxcli') return setOfficeMxcli(raw, who);
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
