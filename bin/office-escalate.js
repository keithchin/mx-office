// office-workers escalate: raising something to the Project Manager (the human who owns the project)
// from inside Agent Office, as a Lead does when reviewing a subagent's work turns up what it shouldn't
// decide alone (its Playbook's review protocol says when, by autonomy level). The office keeps it on
// the floor, shows it on the board's project console with Reply / Approve / Reject, and sends the
// answer back to this worker as a prompt. Kept apart from office-workers.js, which imports it: the
// command's arguments, the MCP tool and the answer in words. Plain Node, no dependencies.

export const URGENCIES = ['info', 'important', 'urgent', 'critical'];
export const TRIGGERS = ['plan', 'scope', 'design', 'architecture', 'revisions-exhausted', 'blocked', 'milestone', 'repeated-failure', 'budget-risk', 'security', 'data-loss', 'client-milestone', 'budget-overrun', 'blocked-no-path'];

export const ESCALATE_USAGE = `  office-workers escalate --title "…" [--urgency info|important|urgent|critical]
        [--trigger <kind>] [--option "A"]... [--recommend "A"] <<'EOF'
  …the details…                                 raise something to the Project Manager (the human);
  EOF                                           details on stdin or --details "…". The answer comes
                                                back to you as a prompt`;

/**
 * The escalate command's arguments (the words after `escalate`). `--option` may be given several
 * times; the rest once each. Throws `UsageError` (passed in, so the caller's usage is shown).
 * @param {string[]} args
 * @param {new (msg: string) => Error} UsageError
 */
export function parseEscalate(args, UsageError) {
  /** @type {Record<string, unknown>} */
  const out = { cmd: 'escalate', options: [] };
  const valued = { '--title': 'title', '--urgency': 'urgency', '--trigger': 'trigger', '--recommend': 'recommendation', '--details': 'details', '--option': 'options' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    const eq = arg.indexOf('=');
    const flag = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    const key = valued[flag];
    if (!key) throw new UsageError(arg.startsWith('-') ? `Unknown option: ${flag}` : `Unexpected argument: ${arg} (give the details on stdin or with --details)`);
    let value;
    if (eq > 0 && arg.startsWith('--')) value = arg.slice(eq + 1);
    else if (i + 1 < args.length) value = args[++i];
    else throw new UsageError(`${flag} needs a value`);
    if (key === 'options') /** @type {string[]} */ (out.options).push(value);
    else out[key] = value;
  }
  if (!out.title || !String(out.title).trim()) throw new UsageError('escalate needs a --title: one line saying what needs the Project Manager');
  if (out.urgency !== undefined && !URGENCIES.includes(String(out.urgency))) throw new UsageError(`--urgency is one of ${URGENCIES.join(', ')}`);
  if (out.trigger !== undefined && !TRIGGERS.includes(String(out.trigger))) throw new UsageError(`--trigger is one of ${TRIGGERS.join(', ')}`);
  return out;
}

/** What the office answered, in words. */
export function formatEscalated(answer) {
  const e = answer?.escalation ?? {};
  return `Escalation ${e.id ?? ''} raised (${e.fyi ? 'FYI' : e.urgency ?? 'important'}): ${e.title ?? ''}${answer?.note ? `\n${answer.note}` : ''}`;
}

export const ESCALATE_TOOL = {
  name: 'escalate',
  title: 'Escalate to the Project Manager',
  description:
    'Raises something to the Project Manager: the human who owns the project (not the Project Coordinator agent). Use it when reviewing a subagent\'s work (or anything else) turns up ' +
    "what your Playbook's review protocol says to escalate at the floor's autonomy level: Directive escalates every change to scope, design or plan; Guided design, architecture and scope changes, " +
    'a review failing after 2 revision rounds, anything blocking; Delegated milestone-level issues, repeated failures, budget risk; Autonomous only critical issues (security, data loss, ' +
    'a client-facing milestone, a budget overrun, blocked with no path). It shows on the board\'s project console with Reply / Approve / Reject; urgent and critical ones alert the human. ' +
    "Below the floor's threshold it is filed as FYI. The answer comes back to you as your next prompt: don't wait for it, carry on with whatever it doesn't block. Subagents never escalate: their Lead does.",
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'One line: what needs the Project Manager.' },
      urgency: { type: 'string', enum: URGENCIES, description: 'critical: security, data loss, client-facing milestone, budget overrun, blocked with no path. urgent: work stops until answered. important (default): a decision needed today. info: for their information.' },
      trigger: { type: 'string', enum: TRIGGERS, description: 'What the review turned up; the office judges it against the floor\'s autonomy level.' },
      details: { type: 'string', description: 'What happened, what you checked, what it affects.' },
      options: { type: 'array', items: { type: 'string' }, description: 'The choices the Project Manager has, each a short line.' },
      recommendation: { type: 'string', description: 'Which option you recommend, and why, in a line.' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
};
