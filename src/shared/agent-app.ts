// Agents' app instances (server/agent-app/): what an agent asks the office for with `office-app` (or the MCP
// tools app_start, app_status, app_stop, journey_run, app_smoke, app_test), what it gets back, and the words.
// The real APAC-style rebuild test (P0-1): four runtime defects passed every model gate (mxbuild, lint, mx
// check) because the agents could not start the app, so the Project Manager was the only runtime tester. Now
// an agent asks for a running instance of a commit (its candidate, or main), drives journeys against it, and
// the results are recorded against exactly that commit. Pure (no Node imports): the CLI's words come from here.

export type AgentAppState = 'starting' | 'ready' | 'failed' | 'stopped';

/** One agent's instance, as the office tells the agent about it. */
export interface AgentAppView {
  state: AgentAppState;
  commit: string;
  /** http://127.0.0.1:<port>/ once ready. */
  url?: string;
  /** The project's test accounts (tests/e2e/project.config.js at the commit): names and roles, passwords stay in that file. */
  users?: { user: string; role?: string }[];
  /** Where the passwords are. */
  passwords?: string;
  /** When it stops by itself unless used (ms since epoch), and the hard end. */
  expires?: number;
  ends?: number;
  /** Where the start is ("Building…"), or why it failed or stopped. */
  phase?: string;
  why?: string;
  /** What seeded it: the after-startup microflow always runs; tests/e2e/seed.journey.json when the project has one. */
  seed?: string;
  startedAt?: number;
}

/** How long an instance lives without a call from its agent, and at most. */
export const AGENT_APP_IDLE_MS = 15 * 60_000;
export const AGENT_APP_MAX_MS = 60 * 60_000;
/** Memory a new instance needs free (mxbuild, the runtime and the bundle together; measured ≈ 1.6–2.2 GB). */
export const AGENT_APP_MIN_FREE = 2.5 * 1024 ** 3;
/** At most this many agents' instances on the machine at once (each is a JVM and an mxbuild). */
export const AGENT_APP_MAX = 2;
/** The seed journey a project may define: played once after each start, before the instance is ready. */
export const SEED_JOURNEY = 'tests/e2e/seed.journey.json';

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

/** Refused for memory: what's free, what's needed, what to do. */
export const memoryWords = (free: number, need = AGENT_APP_MIN_FREE) =>
  `Not enough memory on the office's machine for an app instance: ${gb(free)} free, and one needs about ${gb(need)} (mxbuild, the Mendix runtime and the web bundle). Stop your other instance or wait for others to stop; don't start the app yourself with mxcli run (it would hit the same limit and leave processes behind).`;

/** One line about an instance, for the CLI and the MCP tools. */
export function viewLine(v: AgentAppView | undefined, now = Date.now()): string {
  if (!v) return 'You have no app instance. Start one: office-app start --commit <sha|main>';
  const at = `@${v.commit.slice(0, 7)}`;
  const mins = (t?: number) => (t ? `${Math.max(0, Math.round((t - now) / 60_000))} min` : '?');
  if (v.state === 'starting') return `Starting your app instance ${at}: ${v.phase ?? 'starting'} (a cold start takes 2–8 min)`;
  if (v.state === 'failed') return `Your app instance ${at} didn't start: ${v.why ?? 'no reason given'}`;
  if (v.state === 'stopped') return `Your app instance ${at} stopped: ${v.why ?? 'stopped'}`;
  const users = v.users?.length ? ` · test users: ${v.users.map((u) => (u.role ? `${u.user} (${u.role})` : u.user)).join(', ')}${v.passwords ? ` (passwords: ${v.passwords})` : ''}` : '';
  return `Your app instance ${at} is ready at ${v.url} · stops after ${mins(v.expires)} without a call (at most ${mins(v.ends)})${users}${v.seed ? ` · seed: ${v.seed}` : ''}`;
}

/** A runtime error the instance logged while a journey or smoke run played: a failed check with its line. */
export interface RuntimeError {
  /** The log line (time, level, node, message). */
  line: string;
  /** The exception's first lines after it, when the runtime logged them. */
  more: string[];
}

const ENTRY = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:[.,]\d+)?\s+(ERROR|CRITICAL)\s+-\s+(.*)$/;
const FRAME = /^\s*(at\s|\.\.\.\s*\d+\s+more|\^\s*$|Advanced stacktrace)/;
const ANY_ENTRY = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d/;

/**
 * The ERROR and CRITICAL entries in a stretch of the Mendix runtime log (mxcli's .mxcli/runtime.log: a
 * timestamp, the level, `- Node: message`, an exception's lines after it), at most `max`. The session cap is a
 * WARNING (shared/liveapp/session-cap.ts), never counted here.
 */
export function runtimeErrorsIn(text: string, max = 5): RuntimeError[] {
  const out: RuntimeError[] = [];
  let cur: RuntimeError | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trimEnd();
    if (ANY_ENTRY.test(l)) {
      cur = undefined;
      if (ENTRY.test(l) && out.length < max) out.push((cur = { line: l.slice(0, 400), more: [] }));
      continue;
    }
    // The exception's own lines, without its stack frames: the message, the failing expression, each "Caused by".
    if (cur && l.trim() && !FRAME.test(l) && cur.more.length < 12) cur.more.push(l.trim().slice(0, 300));
  }
  return out;
}

/** A runtime error in one line: the entry, and the exception's "…not supported…" / "Caused by" line when there is one. */
export function runtimeErrorWords(e: RuntimeError): string {
  const message = (m: string) => m.replace(/^Caused by:\s*/i, '');
  const causes = e.more.filter((m) => /^Caused by:/i.test(m));
  // The first cause says what failed (and the line after it, the expression); the deepest says why.
  const first = causes[0];
  const after = first ? e.more[e.more.indexOf(first) + 1] : undefined;
  const parts = first
    ? [message(first), ...(after && !/^Caused by:/i.test(after) ? [after] : []), ...(causes.length > 1 ? [message(causes[causes.length - 1])] : [])]
    : [e.more.find((m) => /not supported|exception|error/i.test(m) && !e.line.includes(m))].filter((m): m is string => !!m);
  return parts.length ? `${e.line} — ${parts.join(' — ')}`.slice(0, 900) : e.line;
}

/** A journey or smoke run's outcome, as the agent hears it. */
export interface RunOutcome {
  suite: string;
  commit: string;
  status: 'passed' | 'failed' | 'error';
  steps?: { n: number; caption: string; status: string; why?: string }[];
  failure?: string;
  runtimeErrors?: string[];
  /** The session cap hit, said plainly. */
  sessionCap?: string;
  /** The test-run record it went into (bound to `commit`). */
  record?: string;
  signedOut?: boolean;
}

/** The outcome in a few lines. */
export function outcomeWords(o: RunOutcome): string {
  const head = `${o.suite} @${o.commit.slice(0, 7)}: ${o.status === 'passed' ? 'PASSED' : o.status === 'failed' ? 'FAILED' : 'DID NOT RUN'}`;
  const lines = [head];
  for (const s of o.steps ?? []) if (s.status !== 'passed') lines.push(`  step ${s.n} ${s.status}: ${s.caption}${s.why ? ` — ${s.why}` : ''}`);
  if (o.failure && !(o.steps ?? []).some((s) => !!s.why && o.failure!.endsWith(s.why))) lines.push(`  ${o.failure}`);
  for (const r of o.runtimeErrors ?? []) lines.push(`  runtime error (failed check): ${r}`);
  if (o.sessionCap) lines.push(`  ${o.sessionCap}`);
  lines.push(o.record ? `  recorded against ${o.commit.slice(0, 7)} (${o.record}): it shows on the Testing page and in the change's Checks` : '  not recorded');
  return lines.join('\n');
}
