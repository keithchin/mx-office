// Studio mode's enforcement: the PreToolUse hook every Claude worker on a floor gets (bin/studio-guard.js,
// installed through the office's own --settings file for the floor, providers/claude.ts), and the
// hook server's /office/studio, where the guard tells the office it held a write, for the audit log.
// The hook is there on every floor all the time and does nothing (a shell test, no Node) unless the
// floor's marker is there, which the office writes only while Studio Pro has the project open
// (watch.ts). The workers' own settings files are never touched.

import type http from 'node:http';
import path from 'node:path';
import { STUDIO_MARKER } from '../../shared/studio.js';
import { agent, audit } from '../audit/index.js';
import { readBody, send } from '../http/util.js';
import type { Ctx } from '../office/context.js';
import { binScript, shq } from '../workers/process.js';

/** A path as the hook's shell (sh, or Git Bash on Windows) and Node both take it. */
const shellPath = (p: string) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p);

/**
 * The PreToolUse entry for Bash in a floor's Claude hook settings (`dataDir` is the floor's
 * .agent-office): a shell test for the marker, and the guard only when it's there. Undefined when
 * the guard script can't be found (an install without bin/).
 */
export function studioGuardHook(dataDir: string, script = binScript('studio-guard.js'), node = process.execPath): { matcher: string; hooks: { type: 'command'; command: string; timeout: number }[] } | undefined {
  if (!script) return undefined;
  const marker = shq(shellPath(path.join(dataDir, STUDIO_MARKER)));
  const command = `if [ -f ${marker} ]; then ${shq(shellPath(node))} ${shq(shellPath(script))} ${marker}; fi`;
  return { matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 10 }] };
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** POST /office/studio {why, command}: a worker's guard held one of its mxcli writes while Studio Pro was open. */
export async function officeStudio(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const floor = ctx.workerFloor(workerId);
  const me = floor?.workers.authenticate(workerId, token);
  if (!floor || !me) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST /office/studio' });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse((await readBody(req, 8192)) || '{}');
  } catch {
    return send(res, 400, { error: 'Send JSON' });
  }
  const why = clip(body.why, 120) || 'a model write';
  const command = clip(body.command, 300);
  audit.record({
    floor: floor.id,
    actor: agent(me.name, me.id),
    action: 'studio.denied',
    target: { kind: 'project', id: floor.id, label: floor.def.name },
    summary: `Held ${why} while Studio Pro has the project open`,
    details: { why, command },
    severity: 'notice',
  });
  return send(res, 200, { ok: true });
}
