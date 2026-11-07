// The model files' stamp in a project folder, for the asked → visible timer (./shell.ts): the .mpr's modified time
// and size, and its mprcontents folder's (MPR v2 keeps a unit per file there). A different stamp after a tool call
// while the session works is a model change, however it was made (a script, Studio Pro's MCP, a subagent). Read off
// the event loop's way (fs/promises), the .mpr's path found once per folder.

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export class ModelStamps {
  private mprOf = new Map<string, string | null>();

  /** The .mpr at the folder's top, else one level down (as liveapp/checkout.ts findMpr looks), found once. */
  private async mpr(dir: string): Promise<string | null> {
    const had = this.mprOf.get(dir);
    if (had !== undefined) return had;
    const look = async (d: string) => (await readdir(d).catch(() => [] as string[])).find((f) => f.toLowerCase().endsWith('.mpr'));
    let found: string | null = null;
    const top = await look(dir);
    if (top) found = path.join(dir, top);
    else {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'deployment') continue;
        const sub = await look(path.join(dir, e.name));
        if (sub) {
          found = path.join(dir, e.name, sub);
          break;
        }
      }
    }
    this.mprOf.set(dir, found);
    return found;
  }

  /** "mtime:size|contents-mtime", or undefined when the folder has no .mpr. */
  async read(dir: string): Promise<string | undefined> {
    const mpr = await this.mpr(dir);
    if (!mpr) return undefined;
    const [m, c] = await Promise.all([stat(mpr).catch(() => undefined), stat(path.join(path.dirname(mpr), 'mprcontents')).catch(() => undefined)]);
    if (!m) return undefined;
    return `${m.mtimeMs}:${m.size}|${c?.mtimeMs ?? ''}`;
  }
}
