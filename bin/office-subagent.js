// office-workers subagent: a Lead managing its team of Claude Code subagents from inside Agent Office:
// their track record, its review verdict on a result, and putting one on warning, benching it,
// swapping its model or reinstating it. The office enforces the gate each of those has for the Lead
// (its Playbook's "Your skills"): ask raises an escalation, propose files an approval for the Project
// Manager, tell and fyi do it at once. Kept apart from office-workers.js, which imports it: the
// command's arguments, the MCP tool and the answer in words. Plain Node, no dependencies.

export const SUBAGENT_OPS = ['list', 'review', 'warn', 'bench', 'swap-model', 'reinstate'];
export const VERDICTS = ['accept', 'rework'];

export const SUBAGENT_USAGE = `  office-workers subagent list                  your subagents: model, grade, runs, state, gates
  office-workers subagent review <name> --verdict accept|rework [--note "…"]
                                                record your review of its latest result
  office-workers subagent warn <name> --reason "…"
  office-workers subagent bench <name> --reason "…"
  office-workers subagent swap-model <name> --model haiku|sonnet|opus
  office-workers subagent reinstate <name>      each through your gate for it: ask (an escalation),
                                                propose (the Project Manager approves), tell or fyi`;

/**
 * The subagent command's arguments (the words after `subagent`). Throws `UsageError` (passed in, so
 * the caller's usage is shown).
 * @param {string[]} args
 * @param {new (msg: string) => Error} UsageError
 */
export function parseSubagent(args, UsageError) {
  const [op, ...rest] = args;
  if (!op || !SUBAGENT_OPS.includes(op)) throw new UsageError(`subagent takes one of ${SUBAGENT_OPS.join(', ')}`);
  /** @type {Record<string, unknown>} */
  const out = { cmd: 'subagent', op };
  const valued = { '--verdict': 'verdict', '--note': 'note', '--reason': 'reason', '--model': 'model' };
  const words = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      words.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const key = valued[flag];
    if (!key) throw new UsageError(`Unknown option: ${flag}`);
    if (eq > 0) out[key] = arg.slice(eq + 1);
    else if (i + 1 < rest.length) out[key] = rest[++i];
    else throw new UsageError(`${flag} needs a value`);
  }
  if (op === 'list') {
    if (words.length) throw new UsageError('subagent list takes no arguments');
    return out;
  }
  if (words.length !== 1) throw new UsageError(`subagent ${op} takes one subagent, by its name (.claude/agents/<name>.md)`);
  out.name = words[0];
  if (op === 'review' && !VERDICTS.includes(String(out.verdict))) throw new UsageError('subagent review needs --verdict accept or rework');
  if ((op === 'warn' || op === 'bench') && !String(out.reason ?? '').trim()) throw new UsageError(`subagent ${op} needs --reason "…": what went wrong`);
  if (op === 'swap-model' && !String(out.model ?? '').trim()) throw new UsageError('subagent swap-model needs --model haiku|sonnet|opus');
  return out;
}

/** What the office answered, in words. */
export function formatSubagent(answer) {
  return String(answer?.text ?? 'Done.');
}

export const SUBAGENT_TOOL = {
  name: 'subagent',
  title: 'Manage your subagents',
  description:
    "For a Lead of the floor's team: your Claude Code subagents' track record and standing. op list shows each one's model, grade (A–F from your review verdicts over its last 5 runs), " +
    'runs, reworks and state, and your gates. op review records your verdict (accept or rework) on its latest result: do it after every review, it is its track record. ' +
    'warn (with a reason) adds a warning to its definition, bench (with a reason) takes it off your team until a cool-down ends, swap-model sets its model, reinstate brings it back. ' +
    'Those four go through your gate for each (your Playbook\'s "Your skills"): ask raises an escalation and the office does it if the Project Manager approves, propose files it in their approvals, tell and fyi do it at once.',
  inputSchema: {
    type: 'object',
    properties: {
      op: { type: 'string', enum: SUBAGENT_OPS },
      name: { type: 'string', description: 'The subagent, as in .claude/agents/<name>.md. Not for list.' },
      verdict: { type: 'string', enum: VERDICTS, description: 'For review.' },
      note: { type: 'string', description: 'For review: why, in a line.' },
      reason: { type: 'string', description: 'For warn and bench: what went wrong.' },
      model: { type: 'string', description: 'For swap-model: haiku, sonnet, opus (or a model id, or inherit).' },
    },
    required: ['op'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
};
