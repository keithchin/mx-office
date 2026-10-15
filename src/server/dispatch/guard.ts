// The rollback guard (Slice 1B-1, plan §2.6): an older build (release 47) knows nothing of dispatch records,
// so going back to it while one is unsettled could lose an answer's outcome or type a held answer twice.
// `agent-office dispatch status` lists every unsettled record (prepared, in-flight, held, outcome-unknown,
// an issue intent) and exits non-zero while there is one; 🔁 Restart safely refuses to restart onto a
// build whose dispatch schema is older than the records' while any is unsettled. Settling means
// reconciled, confirmed by a person, or abandoned (docs/site/running-the-office). Sync reads of a few
// small files: the CLI, and a restart's last step.

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { DISPATCH_SCHEMA, decisionLabel, isUnsettled, type DispatchRecord } from '../../shared/dispatch.js';
import { readDispatchFile } from './store.js';

export interface DispatchStatus {
  /** The newest schema any floor's file was written with (0: none). */
  schema: number;
  unsettled: { floor: string; record: DispatchRecord }[];
  /** Files that couldn't be read: the guard counts them as unsettled (it can't tell). */
  errors: string[];
}

/** Every floor's unsettled records under `<dataDir>/dispatch/`. */
export function dispatchStatus(dataDir: string): DispatchStatus {
  const dir = path.join(dataDir, 'dispatch');
  const out: DispatchStatus = { schema: 0, unsettled: [], errors: [] };
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return out;
  }
  for (const n of names) {
    const floor = n.slice(0, -5);
    const f = readDispatchFile(path.join(dir, n));
    if (f.error) {
      out.errors.push(`${n}: ${f.error}`);
      continue;
    }
    out.schema = Math.max(out.schema, f.v);
    for (const r of f.records) if (isUnsettled(r.state)) out.unsettled.push({ floor, record: r });
  }
  return out;
}

/** One record as a line of the status list. */
export const statusLine = (u: { floor: string; record: DispatchRecord }) =>
  `${u.floor}  ${u.record.id}  ${u.record.state}${u.record.channel === 'github-issue' ? ' (issue intent)' : ''}  ${decisionLabel(u.record.decision)} rev ${u.record.answerRev} → ${u.record.workerName ?? 'the agent'}`;

/**
 * Why a restart onto a build with dispatch schema `buildSchema` (undefined: a build from before durable
 * dispatch, release 47) must not go ahead, or undefined when it may. Only refused while records are
 * unsettled and the build is older than what wrote them.
 */
export function rollbackRefusal(dataDir: string, buildSchema: number | undefined, label = 'the build on disk'): string | undefined {
  const s = dispatchStatus(dataDir);
  const schema = Math.max(s.schema, s.unsettled.length || s.errors.length ? DISPATCH_SCHEMA : 0);
  if ((buildSchema ?? 0) >= schema) return undefined;
  const n = s.unsettled.length + s.errors.length;
  if (!n) return undefined;
  return `${label} predates durable dispatch (schema ${buildSchema ?? 0} < ${schema}) and ${n} answer dispatch${n === 1 ? ' is' : 'es are'} unsettled: settle ${n === 1 ? 'it' : 'them'} in Needs you (Send again, It went through or Abandon), or see agent-office dispatch status, before going back to it`;
}

/** `agent-office dispatch status [dir] [--json]`: 0 when nothing is unsettled, 1 when something is, 2 for a usage error. */
export function dispatchCommand(argv: string[], log: (s: string) => void = console.log): number {
  if (argv[0] !== 'status' || argv.includes('-h') || argv.includes('--help')) {
    log('Usage: agent-office dispatch status [dir] [--json]\n\nLists the answer dispatches the office in [dir] (default: the current folder) has not settled:\nprepared, in flight, held, outcome unknown, and issue intents. Exits 1 while any is unsettled, so a\nrollback to an older build waits until each is reconciled, confirmed by a person, or abandoned.');
    return argv[0] === 'status' ? 0 : 2;
  }
  const rest = argv.slice(1).filter((a) => !a.startsWith('-'));
  const dir = path.resolve(rest[0] ?? process.cwd());
  const dataDir = path.basename(dir) === '.agent-office' ? dir : path.join(dir, '.agent-office');
  const s = dispatchStatus(dataDir);
  if (argv.includes('--json')) log(JSON.stringify({ schema: s.schema, unsettled: s.unsettled.map((u) => ({ floor: u.floor, id: u.record.id, state: u.record.state, channel: u.record.channel, decision: u.record.decision, answerRev: u.record.answerRev })), errors: s.errors }, null, 2));
  else if (!s.unsettled.length && !s.errors.length) log('No unsettled answer dispatches: a rollback is safe as far as dispatch is concerned.');
  else {
    log(`${s.unsettled.length + s.errors.length} unsettled answer dispatch${s.unsettled.length + s.errors.length === 1 ? '' : 'es'}:`);
    for (const u of s.unsettled) log(`  ${statusLine(u)}`);
    for (const e of s.errors) log(`  unreadable: ${e}`);
    log('Settle each in Needs you (Send again, It went through, Abandon; for an issue Check GitHub, Create it, It exists) before rolling back.');
  }
  return s.unsettled.length || s.errors.length ? 1 : 0;
}
