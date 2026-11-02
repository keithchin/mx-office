// One git start for the same question at the same time (release 83, real build: while microflow tests loaded the
// machine, GET /api/local-merge took 52 to over 120 s and /api/m/status timed out, with many identical `git log`
// and `rev-parse` calls the office itself had started queued behind each other: every view asked again before
// the last answer came back). A read-only command already running in the same folder with the same arguments
// hands its answer to whoever asks meanwhile; it's forgotten the moment it settles, so a later ask always runs
// git again. Never for a command that changes anything (fetch, push, merge, commit, worktree, checkout, reset…).

/** git subcommands that only read: the same arguments in the same folder at the same moment give the same answer. */
const READ_ONLY = new Set(['log', 'rev-parse', 'rev-list', 'for-each-ref', 'show', 'cat-file', 'ls-tree', 'ls-files', 'diff', 'merge-base', 'status', 'remote', 'show-ref', 'describe', 'name-rev', 'symbolic-ref', 'blame', 'shortlog', 'count-objects']);

/** At most this many distinct commands shared at once (a safety bound: each entry goes when it settles). */
const MAX_SHARED = 500;

/** The subcommand after any leading `-c k=v` / `-C dir` options. */
function subcommand(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-c' || a === '-C') {
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    return a;
  }
  return undefined;
}

/** Whether `args` only reads (and may share an in-flight answer). `config` only with --get; `branch` only listing. */
export function readOnlyGit(args: readonly string[]): boolean {
  const sub = subcommand(args);
  if (!sub) return false;
  if (READ_ONLY.has(sub)) return !(sub === 'remote' && args.some((a) => ['add', 'remove', 'rm', 'rename', 'set-url', 'prune', 'update', 'set-head'].includes(a)));
  if (sub === 'config') return args.some((a) => a === '--get' || a === '--get-all' || a === '--list' || a === '-l');
  if (sub === 'branch') return args.some((a) => a === '--list' || a === '-l' || a === '--show-current' || a === '--contains' || a === '--merged');
  return false;
}

/** A sharer of in-flight answers (one per git wrapper: their answers differ in shape). */
export function singleFlight<T>() {
  const flying = new Map<string, Promise<T>>();
  const share = (args: readonly string[], cwd: string, run: () => Promise<T>, extra = ''): Promise<T> => {
    if (!readOnlyGit(args) || flying.size >= MAX_SHARED) return run();
    const key = `${cwd}\u0000${extra}\u0000${args.join('\u0000')}`;
    const had = flying.get(key);
    if (had) return had;
    const p = run();
    flying.set(key, p);
    const drop = () => {
      if (flying.get(key) === p) flying.delete(key);
    };
    p.then(drop, drop);
    return p;
  };
  return Object.assign(share, { inFlight: () => flying.size });
}
