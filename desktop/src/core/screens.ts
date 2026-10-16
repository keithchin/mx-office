// What the window says while there's no office to show. Pure: page specs for window.ts's pageHtml.

import type { PageSpec } from './window.js';
import type { CrashInfo } from './supervisor.js';
import { NODE_MIN, type Problem } from './system.js';

/** The docs on GitHub (the office's own /docs need a running office). */
/** The window's own buttons: links to a host that never resolves, caught before they load (main.ts). */
export const ACTION_BASE = 'https://mxoffice.invalid/action/';
export const act = (name: string) => ACTION_BASE + name;
/** The action a link asks for, or undefined. */
export const actionOf = (url: string) => (url.startsWith(ACTION_BASE) ? url.slice(ACTION_BASE.length).replace(/[?#].*$/, '') : undefined);

export const DOCS = 'https://github.com/keithchin/mx-office/blob/main/docs/site';
export const FIRST_RUN_DOCS = `${DOCS}/get-started/new-machine.md`;
export const DESKTOP_DOCS = `${DOCS}/administration/desktop-app.md`;

export function startingPage(o: { url: string; restarting?: boolean }): PageSpec {
  return { busy: true, title: o.restarting ? 'Restarting Mx Office…' : 'Starting Mx Office…', lines: [o.restarting ? 'The office is starting again. Agents that were mid-turn carry on when it is back.' : `Waiting for the office at ${o.url} to answer.`] };
}

export function crashPage(c: CrashInfo, logFile: string): PageSpec {
  return {
    title: 'The office stopped unexpectedly',
    lines: [`The office ${c.why}. Its agents' sessions are saved: when it starts again, the ones that were mid-turn carry on.`, `Last lines of ${logFile}:`],
    log: c.tail || '(the log is empty)',
    actions: [
      { label: 'Restart the office', href: act('restart'), primary: true },
      { label: 'Open the log', href: act('open-log') },
      { label: 'Quit', href: act('quit') },
    ],
  };
}

export function stoppedPage(): PageSpec {
  return { title: 'The office is stopped', lines: ['Start it again to carry on.'], actions: [{ label: 'Start the office', href: act('restart'), primary: true }, { label: 'Quit', href: act('quit') }] };
}

export function problemPage(p: Problem): PageSpec {
  const firstRun = { label: 'Setting up a new machine (First-run)', href: FIRST_RUN_DOCS };
  switch (p.kind) {
    case 'no-node':
      return {
        title: "Node.js isn't installed",
        lines: [`The desktop app runs the office with the Node.js on this computer (${NODE_MIN} or newer), and found none on PATH.`, 'Install it (winget install OpenJS.NodeJS.LTS, or from nodejs.org), then try again. If it is installed somewhere else, start the app with --node <path to node.exe> or set MX_OFFICE_NODE.'],
        actions: [{ label: 'Try again', href: act('retry'), primary: true }, { label: 'nodejs.org', href: 'https://nodejs.org/' }, firstRun],
      };
    case 'old-node':
      return {
        title: 'Node.js is too old',
        lines: [`${p.node} is Node.js ${p.version}; the office needs ${NODE_MIN} or newer.`, 'Update it (winget upgrade OpenJS.NodeJS.LTS), then try again.'],
        actions: [{ label: 'Try again', href: act('retry'), primary: true }, { label: 'nodejs.org', href: 'https://nodejs.org/' }, firstRun],
      };
    case 'no-checkout':
      return {
        title: 'Where is your Mx Office?',
        lines: ['The desktop app runs the office from your own copy of it (the folder you cloned, with its package.json), and found none.', 'Choose that folder, or get Mx Office first (scripts/get-mx-office.ps1 clones and builds it).', `Looked in: ${p.tried.slice(0, 6).join(', ') || 'nowhere'}`],
        actions: [{ label: 'Choose the office folder…', href: act('choose-dir'), primary: true }, { label: 'Try again', href: act('retry') }, firstRun],
      };
    case 'not-built':
      return {
        title: "The office isn't built yet",
        lines: [`${p.dir} has no build. In a terminal in that folder run: npm install, then npm run build. Then try again.`, 'A new office then opens on its First-run setup, which installs and signs in everything else.'],
        actions: [{ label: 'Try again', href: act('retry'), primary: true }, { label: 'Choose another folder…', href: act('choose-dir') }, firstRun],
      };
  }
}

export function busyPortPage(port: number): PageSpec {
  return {
    title: `Port ${port} is taken`,
    lines: [`Another program (not an office) listens on port ${port}.`, 'Close it, or start the app on another port: --port 4610 (or MX_OFFICE_PORT).'],
    actions: [{ label: 'Try again', href: act('retry'), primary: true }, { label: 'Quit', href: act('quit') }],
  };
}

export function refusedPage(url: string): PageSpec {
  return {
    title: 'An office is already running',
    lines: [`An office already answers at ${url}. The app never starts a second one beside it, on the same data.`],
    actions: [{ label: 'Open it here', href: act('attach'), primary: true }, { label: 'Quit', href: act('quit') }],
  };
}
