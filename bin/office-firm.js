// office-workers firm: The Firm's commands (see src/server/hooks/firm.ts). A reviewer asks the project
// team questions, fetches the office's evidence, sends its section of the report and says it's done,
// with its own AGENT_OFFICE_FIRM_URL, AGENT_OFFICE_FIRM_REVIEWER and AGENT_OFFICE_FIRM_TOKEN; a project
// worker answers a question with its usual AGENT_OFFICE_HOOK_URL, _WORKER_ID and _HOOK_TOKEN.
// Plain Node, no build step, no dependencies.

import { readFileSync } from 'node:fs';

export const FIRM_USAGE = `  office-workers firm ask [--team <team>] "question"   (a reviewer) ask the project team; the
                                                answer comes back as your next prompt
  office-workers firm answer <id> "answer"      (a project worker) answer the Firm's question <id>
                                                (or pipe a longer answer in)
  office-workers firm report --section <key> --file <json>
                                                (a reviewer) send a section of the audit report
  office-workers firm evidence <name>           (a reviewer) the office's data: github, ranking,
                                                roster, summary, judge, analysis, audit, liveapp,
                                                sections
  office-workers firm status                    (a reviewer) budget, questions left, who's done
  office-workers firm done ["note"]             (a reviewer) everything is sent: release me`;

class FirmUsage extends Error {}

/** What the firm command line asks for. */
export function parseFirm(argv) {
  const [sub, ...rest] = argv;
  const opt = (name) => {
    const i = rest.findIndex((a) => a === name || a.startsWith(`${name}=`));
    if (i < 0) return undefined;
    const a = rest[i];
    const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : rest[i + 1];
    rest.splice(i, a.includes('=') ? 1 : 2);
    if (v === undefined) throw new FirmUsage(`${name} needs a value`);
    return v;
  };
  if (sub === 'ask') {
    const team = opt('--team');
    return { sub, team, text: rest.join(' ').trim() };
  }
  if (sub === 'answer') {
    const [id, ...words] = rest;
    if (!id) throw new FirmUsage('answer takes the question id, then the answer');
    return { sub, question: id, text: words.join(' ').trim() };
  }
  if (sub === 'report') {
    const section = opt('--section');
    const file = opt('--file');
    if (!section || !file) throw new FirmUsage('report needs --section <key> and --file <json>');
    return { sub, section, file };
  }
  if (sub === 'evidence') {
    if (rest.length !== 1) throw new FirmUsage('evidence takes one name');
    return { sub, name: rest[0] };
  }
  if (sub === 'status') return { sub };
  if (sub === 'done') return { sub, note: rest.join(' ').trim() };
  throw new FirmUsage(`Unknown firm command: ${sub ?? '(none)'}`);
}

/** The address and credentials for a call: a reviewer's own, or a worker's for answer. */
export function firmEnv(sub, env) {
  if (sub === 'answer') {
    const missing = ['AGENT_OFFICE_HOOK_URL', 'AGENT_OFFICE_WORKER_ID', 'AGENT_OFFICE_HOOK_TOKEN'].filter((k) => !env[k]);
    if (missing.length) throw new Error(`${missing.join(', ')} not set: firm answer only works from a worker's terminal in Agent Office`);
    return { base: env.AGENT_OFFICE_HOOK_URL.replace(/\/+$/, ''), q: `worker=${encodeURIComponent(env.AGENT_OFFICE_WORKER_ID)}`, token: env.AGENT_OFFICE_HOOK_TOKEN };
  }
  const missing = ['AGENT_OFFICE_FIRM_URL', 'AGENT_OFFICE_FIRM_REVIEWER', 'AGENT_OFFICE_FIRM_TOKEN'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`${missing.join(', ')} not set: only a reviewer of the Firm, mid-engagement, can run firm ${sub}`);
  return { base: env.AGENT_OFFICE_FIRM_URL.replace(/\/+$/, ''), q: `reviewer=${encodeURIComponent(env.AGENT_OFFICE_FIRM_REVIEWER)}`, token: env.AGENT_OFFICE_FIRM_TOKEN };
}

async function readAll(stdin) {
  if (!stdin || stdin.isTTY) return '';
  let s = '';
  for await (const c of stdin) s += c;
  return s.trim();
}

/** Runs `office-workers firm …`; resolves to its exit code. */
export async function firmMain(argv, io) {
  const out = io.out;
  const err = io.err;
  try {
    const cmd = parseFirm(argv);
    const at = firmEnv(cmd.sub, io.env);
    const get = cmd.sub === 'status' || cmd.sub === 'evidence';
    let body;
    if (cmd.sub === 'ask' || cmd.sub === 'answer') {
      const text = cmd.text || (await readAll(io.stdin));
      if (!text) throw new FirmUsage(`${cmd.sub} needs the text, as an argument or on stdin`);
      body = cmd.sub === 'ask' ? { team: cmd.team, text } : { question: cmd.question, text };
    } else if (cmd.sub === 'report') {
      let data;
      try {
        data = JSON.parse(readFileSync(cmd.file, 'utf8'));
      } catch (e) {
        throw new Error(`Couldn't read ${cmd.file} as JSON: ${e.message}`);
      }
      body = { section: cmd.section, data };
    } else if (cmd.sub === 'done') body = { note: cmd.note };
    const url = `${at.base}/office/firm/${cmd.sub}?${at.q}${cmd.sub === 'evidence' ? `&name=${encodeURIComponent(cmd.name)}` : ''}`;
    const res = await io.fetch(url, {
      method: get ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${at.token}`, ...(get ? {} : { 'content-type': 'application/json' }) },
      body: get ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(cmd.sub === 'ask' ? 120_000 : 30_000),
    });
    const text = await res.text();
    let answer;
    try {
      answer = text ? JSON.parse(text) : {};
    } catch {
      answer = { error: text.slice(0, 300) };
    }
    if (!res.ok) throw new Error(answer.error ?? `The office said no (${res.status})`);
    if (get) out(JSON.stringify(answer, null, 2));
    else if (cmd.sub === 'ask') out(`${answer.id} (${answer.status}): ${answer.note}`);
    else if (cmd.sub === 'answer') out(`Answered: back to ${answer.reviewer} at the Firm. Carry on.`);
    else out(answer.note ?? 'OK');
    return 0;
  } catch (e) {
    err(`office-workers firm: ${e.message}`);
    if (e instanceof FirmUsage) err(`\n${FIRM_USAGE}`);
    return e instanceof FirmUsage ? 2 : 1;
  }
}
