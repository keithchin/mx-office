// office-marketplace (also `office-workers marketplace`): asking for a Mendix Marketplace widget or module
// from inside Agent Office. The agent never downloads or installs it and never needs a token: the request
// goes to the Project Manager's Needs-you card, and once they approve, the office downloads it with its own
// Mendix credential (or takes a package file the PM picked), checks it, commits it to the agent's branch as
// the office and tells the agent (src/server/marketplace/). office-workers.js imports the parts below; the
// office-marketplace command the office writes runs `office-workers marketplace …` (workers/process.ts). Plain Node, no dependencies.

export const MARKETPLACE_USAGE = `  office-workers marketplace add --id <content id> --kind widget|module
        [--version 2.5.1] [--name <package name>] [--why "…"]
                                                ask for a Mendix Marketplace widget or module: the
                                                Project Manager approves it on Needs you, and the
                                                office downloads it (or takes a package file the PM
                                                picks), checks it and commits it to your branch, then
                                                tells you. --name is the package's own name to check
                                                the file against (a widget id or package name like
                                                com.mendix.widget.web.FileUploader, a module name).
                                                Never install one yourself or ask for a token.
                                                (Also: office-marketplace add …)
  office-workers marketplace list               this project's Marketplace requests and where each is`;

const KINDS = ['widget', 'module'];

/**
 * The arguments after `marketplace`. Throws `UsageError` (passed in, so the caller's usage is shown).
 * @param {string[]} args
 * @param {new (msg: string) => Error} UsageError
 */
export function parseMarketplace(args, UsageError) {
  const [op, ...rest] = args;
  if (op === 'list' || op === 'ls') {
    if (rest.some((a) => a !== '--json')) throw new UsageError('marketplace list takes no arguments');
    return { cmd: 'marketplace', op: 'list', json: rest.includes('--json') };
  }
  if (op !== 'add') throw new UsageError('marketplace add --id <content id> --kind widget|module [--version …] [--name …] [--why "…"], or marketplace list');
  /** @type {Record<string, unknown>} */
  const out = { cmd: 'marketplace', op: 'add' };
  const valued = { '--id': 'id', '--version': 'version', '--kind': 'kind', '--name': 'name', '--why': 'why' };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    const eq = arg.indexOf('=');
    const flag = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    const key = valued[flag];
    if (!key) throw new UsageError(arg.startsWith('-') ? `Unknown option: ${flag}` : `Unexpected argument: ${arg}`);
    let value;
    if (eq > 0 && arg.startsWith('--')) value = arg.slice(eq + 1);
    else if (i + 1 < rest.length) value = rest[++i];
    else throw new UsageError(`${flag} needs a value`);
    out[key] = String(value).trim();
  }
  if (!/^\d{1,9}$/.test(String(out.id ?? ''))) throw new UsageError('--id is the Marketplace content id: the number in the item’s Marketplace URL (e.g. 235351)');
  if (!KINDS.includes(String(out.kind))) throw new UsageError('--kind is widget or module');
  return out;
}

/** What the office answered, in words. */
export function formatMarketplace(answer, op) {
  if (op === 'list') {
    const rs = answer?.requests ?? [];
    const head = `${rs.length} Marketplace request${rs.length === 1 ? '' : 's'}${answer?.canDownload ? '' : ' (the office can’t download itself here: the PM picks a package file)'}`;
    return [head, ...rs.map((r) => `${r.rid}  ${r.kind} ${r.name ?? r.id} ${r.version ?? '(latest)'} · ${r.status}${r.commit ? ` · commit ${String(r.commit).slice(0, 7)}` : ''}${r.branch ? ` · ${r.branch}` : ''} · ${r.by}${r.note ? ` · ${r.note}` : ''}`)].join('\n');
  }
  return answer?.note ?? `Asked (${answer?.request?.rid ?? ''}).`;
}

export const MARKETPLACE_TOOL = {
  name: 'marketplace_add',
  title: 'Ask for a Mendix Marketplace widget or module',
  description:
    'Asks the Project Manager to add a Mendix Marketplace widget or module to your branch, e.g. the File Uploader widget (content id 235351) when mxcli says MDL-WIDGET25 "… package not in widgets/". ' +
    'You never download or install it yourself and never need a Mendix token: the request shows on the Needs-you card; once approved, the office downloads it with its own credential (or takes a package file the PM picked from the Marketplace website), ' +
    'checks the package (kind, name, version), commits it to your branch as the office and tells you in a message. Then run `mxcli widget init -p <app>.mpr` and use the widget in MDL. ' +
    "Give name (the package's own name: a widget id or package name like com.mendix.widget.web.FileUploader, a module's name) so a package file can be checked against it. Don't wait: carry on with what doesn't need it.",
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The Marketplace content id (the number in the item’s URL).' },
      kind: { type: 'string', enum: KINDS, description: 'widget or module.' },
      version: { type: 'string', description: 'The version wanted (e.g. 2.5.1). Default: the latest.' },
      name: { type: 'string', description: "The package's own name, to check a file against." },
      why: { type: 'string', description: 'What it is for, in a sentence (shown to the Project Manager).' },
    },
    required: ['id', 'kind'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, openWorldHint: false },
};
