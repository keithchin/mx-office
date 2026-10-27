// POST /office/workers/marketplace: an agent asking for a Mendix Marketplace widget or module
// (`office-workers marketplace add`, `office-marketplace add`, or the agent-office MCP server's
// marketplace_add tool, bin/office-marketplace.js), or listing its project's requests (op: list). The
// worker's own hook token says who's asking (checked by officeWorkers before it hands over). Nothing is
// downloaded or installed here: the request goes to the Project Manager's Needs-you card, and the office
// does the work once they approve (server/marketplace/). The agent never gets a token for it.

import type http from 'node:http';
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { Floor } from '../floor.js';
import { send } from '../http/util.js';
import type { Ctx } from '../office/context.js';
import { askWords, readMarketplaceAsk } from '../../shared/marketplace.js';
import { marketplaceOf } from '../marketplace/index.js';

const branchOf = (dir: string) =>
  new Promise<string | undefined>((resolve) => execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, timeout: 10_000, windowsHide: true }, (err, out) => resolve(err ? undefined : String(out).trim() || undefined)));

export async function officeMarketplace(ctx: Ctx, floor: Floor, me: WorkerInfo, body: unknown, res: http.ServerResponse) {
  const s = marketplaceOf(ctx);
  const op = (body as { op?: unknown } | null)?.op;
  if (op === 'list') {
    const v = await s.view(floor.id, false);
    return send(res, 200, { canDownload: v.canDownload, requests: v.requests.map((r) => ({ rid: r.rid, id: r.id, kind: r.kind, version: r.version, name: r.name, status: r.status, by: r.by.name, branch: r.branch, note: r.note, commit: r.added?.commit })) });
  }
  if (op !== undefined && op !== 'add') return send(res, 400, { error: 'op is add or list' });
  const ask = readMarketplaceAsk(body);
  if (typeof ask === 'string') return send(res, 400, { error: ask });
  if (me.kind !== 'agent') return send(res, 400, { error: 'Only an agent asks this way' });
  // A worker's worktree path may be stored relative to the project (".agent-office/worktrees/x"): always resolved
  // against the project's folder, never the office's working directory.
  const folder = me.worktree?.path ? path.resolve(floor.dir, me.worktree.path) : floor.dir;
  const branch = me.worktree?.branch ?? (await branchOf(folder));
  const { request: r, joined } = await s.ask(floor.id, { id: me.id, name: me.name }, folder, branch, ask);
  if (!joined) ctx.toastFloor(floor, `🧩 ${me.name} asks to add ${askWords(r)} from the Marketplace: see Needs you`);
  return send(res, 200, {
    ok: true,
    joined,
    request: { rid: r.rid, status: r.status, branch: r.branch },
    note: joined
      ? `Already asked (${r.rid}, ${r.status}): the Project Manager's answer comes back to you as a message. Don't ask again.`
      : `Asked the Project Manager (${r.rid}) on the Needs-you card. Once approved, the office downloads it (or takes a package file the PM picks), checks it and commits it to ${branch ?? 'your folder'} as the office, then tells you. Carry on with what doesn't need it; don't install it yourself or ask for a token.`,
  });
}
