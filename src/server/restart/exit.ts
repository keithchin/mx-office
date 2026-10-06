// How the office leaves for a safe restart (restart/index.ts): cli.ts says what exiting means (shut the
// office down, workers' terminals kept for the next one, then exit with a code), and a looping launcher
// starts it again when that code is RESTART_EXIT_CODE. The office can't respawn itself reliably on
// Windows, so the loop is the launcher's (docs/site/administration/running-the-office.md).

import { LAUNCHER_ENV } from '../../shared/project-run.js';

let handler: ((code: number) => void) | undefined;

/** cli.ts: how the office exits with `code`. */
export function onOfficeExit(fn: (code: number) => void) {
  handler = fn;
}

/** Shuts the office down and exits with `code` (without cli.ts's handler: just exits). */
export function exitOffice(code: number) {
  if (handler) handler(code);
  else process.exit(code);
}

/** Whether a looping launcher started the office, so exiting with the restart code brings it back. */
export const launcherLoops = (env: NodeJS.ProcessEnv = process.env) => env[LAUNCHER_ENV] === '1';
