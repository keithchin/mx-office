// The live app's `mxcli run` command line (app.ts spawnApp): the ports, the database, the mxbuild told to mxcli
// rather than left to its resolution (a cached Linux download can't run on Windows), hot reload's --watch and
// the project's instance constants, with the lines the log says about each choice. Its own module so app.ts
// keeps to its size; nothing here starts a process.

import path from 'node:path';
import type { LiveHotMode } from '../../shared/protocol.js';
import { hotMode } from './hot-mode.js';
import { databaseName } from './config.js';
import { floorToolkitEnv } from '../toolkit-env.js';
import { MXBUILD_FROM, pickMxbuild, supportsMxbuildPath, supportsWatch, type MxbuildPick } from './mxbuild.js';
import type { LiveAppDeps } from './app.js';

export interface RunArgs {
  args: string[];
  env: Record<string, string>;
  hot: LiveHotMode;
  pick: MxbuildPick;
  flag?: boolean;
  /** Lines for the log, in order. */
  notes: string[];
}

/** The command line for `mpr` on `ports` (app, admin, serve), run in `dir`; undefined when `alive()` turned false meanwhile. */
export async function runArgs(d: LiveAppDeps, mpr: string, ports: number[], dir: string, hotMisses: number, alive: () => boolean): Promise<RunArgs | undefined> {
  const { cfg } = d;
  const notes: string[] = [];
  const [app, admin, serve] = ports;
  const args = ['run', '--local', '-p', path.basename(mpr), '--app-port', String(app), '--admin-port', String(admin), '--serve-port', String(serve)];
  args.push('--db-host', `${cfg.db.host.includes(':') ? `[${cfg.db.host}]` : cfg.db.host}:${cfg.db.port}`, '--db-user', cfg.db.user, '--db-password', cfg.db.password, '--db-name', databaseName(d.floorId), '--ensure-db');
  // The floor's toolkit.env (its MXBUILD_PATH) over the office's own, as for its workers.
  const floorEnv = floorToolkitEnv(d.floorDir);
  const pick = (d.mxbuild?.pick ?? pickMxbuild)(mpr, floorEnv);
  let flag: boolean | undefined;
  const env: Record<string, string> = { ...floorEnv };
  if (pick.path) {
    flag = await (d.mxbuild?.supportsFlag ?? supportsMxbuildPath)(d.mxcli!);
    if (!alive()) return undefined;
    if (flag) args.push('--mxbuild-path', pick.path);
    env.MXBUILD_PATH = pick.path;
  }
  // Hot reload (on unless turned off): mxcli watches its folder, so a page or logic change applies in place.
  const hot = await hotMode(d.mxcli!, { prefs: d.prefs, supportsWatch: d.supportsWatch ?? supportsWatch, free: d.freeMemory }, hotMisses);
  if (!alive()) return undefined;
  if (hot.on) args.push('--watch');
  else if (d.prefs?.().hotReload) notes.push(`hot reload: ${hot.why}`);
  for (const c of (await d.constants?.(dir).catch((err: Error) => (notes.push(`instance constants: ${err.message}`), [])) ?? [])) args.push('--constant', c);
  if (!alive()) return undefined;
  for (const s of pick.skipped) notes.push(`mxbuild: ${s}`);
  if (pick.path) notes.push(`mxbuild: ${pick.path} (${MXBUILD_FROM[pick.source!]})${flag ? '' : ': this mxcli has no --mxbuild-path, so it only gets MXBUILD_PATH'}`);
  else if (pick.expected) notes.push(`mxbuild: Studio Pro ${pick.version} isn't installed (no ${pick.expected}); mxcli picks one itself`);
  notes.push(`$ mxcli ${args.map((a, i) => (args[i - 1] === '--db-password' ? '***' : a)).join(' ')}`);
  return { args, env, hot, pick, flag, notes };
}
