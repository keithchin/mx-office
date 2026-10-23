// office-workers escalate: raising something to the Project Manager (the human who owns the project)
// from inside Agent Office, as a Lead does when reviewing a subagent's work turns up what it shouldn't
// decide alone (its Playbook's review protocol says when, by autonomy level). The office keeps it on
// the floor, shows it on the project console (🎛️ Command Center) with Reply / Approve / Reject, and sends the
// answer back to this worker as a prompt. Kept apart from office-workers.js, which imports it: the
// command's arguments, the MCP tool and the answer in words. Plain Node, no dependencies.

export const URGENCIES = ['info', 'important', 'urgent', 'critical'];
export const TRIGGERS = ['plan', 'scope', 'design', 'architecture', 'revisions-exhausted', 'blocked', 'milestone', 'repeated-failure', 'budget-risk', 'security', 'data-loss', 'client-milestone', 'budget-overrun', 'blocked-no-path', 'needs-human', 'question'];

export const ESCALATE_USAGE = `  office-workers escalate --title "…" [--urgency info|important|urgent|critical]
        [--trigger <kind>] [--option "A"]... [--recommend "A"]
        [--artifact <kind>:<ref>] <<'EOF'
  …the details…                                 raise something to the Project Manager (the human);
  EOF                                           details on stdin or --details "…". The answer comes
                                                back to you as a prompt. --trigger needs-human for
                                                a hands-on action only a person can do (merge, sign
                                                in, paste a key, install, allow, restart): never FYI.
                                                A Studio Pro hand-add or "mxcli can't" needs a
                                                Tried: section in the details (each attempt with
                                                its exact error), or it comes back to you unraised.
                                                --artifact names what to look at to answer it:
                                                screenshot:<path>, process-map:<path>,
                                                document:<path>, walkthrough:<id> or journey:<J-nn>
                                                (paths from the project root); shown beside the
                                                decision in the App workspace, never guessed`;

/**
 * The escalate command's arguments (the words after `escalate`). `--option` may be given several
 * times; the rest once each. Throws `UsageError` (passed in, so the caller's usage is shown).
 * @param {string[]} args
 * @param {new (msg: string) => Error} UsageError
 */
export function parseEscalate(args, UsageError) {
  /** @type {Record<string, unknown>} */
  const out = { cmd: 'escalate', options: [] };
  const valued = { '--title': 'title', '--urgency': 'urgency', '--trigger': 'trigger', '--recommend': 'recommendation', '--details': 'details', '--option': 'options', '--artifact': 'artifact' };
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
  if (answer?.returned) return `Escalation not raised: ${answer.note ?? ''}`;
  const e = answer?.escalation ?? {};
  return `Escalation ${e.id ?? ''} raised (${e.fyi ? 'FYI' : e.urgency ?? 'important'}): ${e.title ?? ''}${answer?.note ? `\n${answer.note}` : ''}`;
}

export const ESCALATE_TOOL = {
  name: 'escalate',
  title: 'Escalate to the Project Manager',
  description:
    'Raises something to the Project Manager: the human who owns the project (not the Project Coordinator agent). Use it when reviewing a subagent\'s work (or anything else) turns up ' +
    "what your Playbook's review protocol says to escalate at the project's autonomy level: Directive escalates every change to scope, design or plan; Guided design, architecture and scope changes, " +
    'a review failing after 2 revision rounds, anything blocking; Delegated milestone-level issues, repeated failures, budget risk; Autonomous only critical issues (security, data loss, ' +
    'a client-facing milestone, a budget overrun, blocked with no path). It shows on the project console (the Command Center tab) with Reply / Approve / Reject; urgent and critical ones alert the human. ' +
    "Below the project's threshold it is filed as FYI. FYI is information only; anything with options or that needs an answer is a decision, and the office files it as one. The answer comes back to you as your next prompt: don't wait for it, carry on with whatever it doesn't block. Subagents never escalate: their Lead does. " +
    "Before asking for a Studio Pro hand-add or saying mxcli can't do something, try `mxcli syntax <topic>`, `mxcli widget list -p <app>` / `mxcli widget describe <name> -p <app>`, `mxcli marketplace search \"<what>\"` (a pluggable widget or module that does it), `--engine legacy` for a write the default engine refuses, `mxcli check -p` with the attempt, and the office's workarounds list (.ai-context/office/mendix-workarounds.md and .ai-context/office/mendix-workarounds.local.md). Put a `Tried:` section in the details listing each attempt with its exact error: without one the office hands it back to you unraised.",
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'One line: what needs the Project Manager.' },
      urgency: { type: 'string', enum: URGENCIES, description: 'critical: security, data loss, client-facing milestone, budget overrun, blocked with no path. urgent: work stops until answered. important (default): a decision needed today. info: for their information.' },
      trigger: { type: 'string', enum: TRIGGERS, description: 'What the review turned up; the office judges it against the project\'s autonomy level. needs-human: a hands-on action only a person can do (merge a PR, sign in, paste a key, install a tool, allow something, restart a preview), never filed as FYI.' },
      details: { type: 'string', description: "What happened, what you checked, what it affects. For a Studio Pro hand-add or \"mxcli can't\": a `Tried:` line, then one `- ` line per attempt with its exact error." },
      options: { type: 'array', items: { type: 'string' }, description: 'The choices the Project Manager has, each a short line.' },
      recommendation: { type: 'string', description: 'Which option you recommend, and why, in a line.' },
      artifact: { type: 'string', description: 'What to look at to answer it, as <kind>:<ref>: screenshot:<path>, process-map:<path>, document:<path> (paths from the project root), walkthrough:<id> or journey:<J-nn>. Shown beside the decision in the App workspace; only what you name here is shown, never a guess.' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
};
