import { spawn } from 'node:child_process';

/**
 * Whether there's a desktop here for a window to open on: not over SSH, in CI, or on a Linux box
 * without one, where nobody would see it.
 */
export function onDesktop(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY || env.CI) return false;
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  return true;
}

/** Opens a page in this computer's browser, when it has a desktop (onDesktop). */
export function openBrowser(url: string): boolean {
  if (!onDesktop()) return false;
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
  return true;
}
