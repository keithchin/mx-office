// office-workers export-pdf and screenshot: an HTML file in the worker's own folder rendered by the
// office's headless Chromium into a PDF or a PNG (src/server/hooks/office-render.ts), for deliverables
// the client reads: a BRD as a PDF, a storyboard of wireframes. Kept apart from office-workers.js,
// which imports it: the command's arguments and the answer in words. Plain Node, no dependencies.

import path from 'node:path';

export const RENDER_USAGE = `  office-workers export-pdf <in.html> <out.pdf> [--landscape]
                                                render an HTML file of your worktree to an A4 PDF
                                                with the office's headless Chromium (no network:
                                                files inside your worktree only)
  office-workers screenshot <in.html> <out.png> [--width 1280] [--height 800] [--viewport]
                                                the same as a PNG, the full page unless --viewport`;

/**
 * The arguments after `export-pdf` or `screenshot`. Paths are made absolute against `cwd`. Throws
 * `UsageError` (passed in, so the caller's usage is shown).
 * @param {'export-pdf' | 'screenshot'} cmd
 * @param {string[]} args
 * @param {new (msg: string) => Error} UsageError
 * @param {string} [cwd]
 */
export function parseRender(cmd, args, UsageError, cwd = process.cwd()) {
  /** @type {Record<string, unknown>} */
  const out = { cmd: 'render', op: cmd === 'export-pdf' ? 'pdf' : 'screenshot' };
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--landscape' && cmd === 'export-pdf') out.landscape = true;
    else if (arg === '--viewport' && cmd === 'screenshot') out.full = false;
    else if ((arg === '--width' || arg === '--height') && cmd === 'screenshot') {
      const n = Number(args[++i]);
      if (!Number.isFinite(n) || n < 200) throw new UsageError(`${arg} takes a number of pixels (200 or more)`);
      out[arg.slice(2)] = n;
    } else if (arg.startsWith('--')) throw new UsageError(`Unknown option for ${cmd}: ${arg}`);
    else words.push(arg);
  }
  if (words.length !== 2) throw new UsageError(`${cmd} takes an input .html file and an output .${cmd === 'export-pdf' ? 'pdf' : 'png'} file`);
  const [input, output] = words.map((w) => path.resolve(cwd, w));
  if (!/\.(html?|svg)$/i.test(input)) throw new UsageError('The input is an .html file');
  if (cmd === 'export-pdf' && !/\.pdf$/i.test(output)) throw new UsageError('export-pdf writes a .pdf file');
  if (cmd === 'screenshot' && !/\.png$/i.test(output)) throw new UsageError('screenshot writes a .png file');
  if (out.full === undefined && cmd === 'screenshot') out.full = true;
  return { ...out, input, output };
}

/** What the office answered, in words. */
export function formatRendered(answer) {
  const kb = Math.max(1, Math.round(Number(answer?.bytes ?? 0) / 1024));
  return `Wrote ${answer?.output ?? 'the file'} (${kb} KB).`;
}
