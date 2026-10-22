// The security baseline and the Mendix check gate (E2): what the office read of an app's security at one
// commit, the project's security policy, the last `mx check` (Mendix's own checker, through mxcli's
// `docker check`) bound to the commit it ran at, and the rule that says whether a sign-off or an acceptance
// at that commit meets the baseline. The server reads and runs (server/security-gate/); this file is the
// shapes and the pure rules both sides share, so the card, the gate and the tests read the same words.
//
// Honest by construction: a value the office didn't read is absent, never guessed; the rule speaks of
// "meets the baseline" and "missing", never of "secure".

/** Mendix's app security level. The model writes CheckNothing / CheckFormsAndMicroflows / CheckEverything. */
export type SecurityLevel = 'off' | 'prototype' | 'production';

export const LEVEL_WORDS: Record<SecurityLevel, string> = { off: 'Off', prototype: 'Prototype / demo', production: 'Production' };

/** A level as the model (units) or mxcli (`show project security`) says it, or undefined when it's neither. */
export function levelOf(raw: string | undefined): SecurityLevel | undefined {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'checknothing' || s === 'off') return 'off';
  if (s === 'checkformsandmicroflows' || s === 'prototype' || s === 'prototype/demo') return 'prototype';
  if (s === 'checkeverything' || s === 'production') return 'production';
  return undefined;
}

const RANK: Record<SecurityLevel, number> = { off: 0, prototype: 1, production: 2 };

/** What the office read of the app's project security at one commit. Never a password: names and counts only. */
export interface SecurityState {
  commit: string;
  readAt: number;
  /** model: the commit's units, read straight from git; mxcli: `mxcli show project security` on a copy. */
  source: 'model' | 'mxcli';
  level?: SecurityLevel;
  strict?: boolean;
  demoUsers?: { enabled: boolean; count?: number };
  guest?: { enabled: boolean; role?: string };
  passwordMinLength?: number;
  userRoles?: number;
  /** Persistable entities outside System with no access rule (from the domain models; units only). */
  entities?: { total: number; withoutRules: number; sample: string[] };
}

/** One `mx check` run, bound to the commit it checked. */
export interface MxCheckResult {
  commit: string;
  at: number;
  /** pass: 0 errors; fail: errors; error: the check didn't run to a verdict (no mxbuild, a timeout, …). */
  status: 'pass' | 'fail' | 'error';
  errors?: number;
  warnings?: number;
  /** Error codes, most frequent first ("CE2729" × 6). */
  codes?: { code: string; count: number }[];
  /** The first few error lines as Mendix printed them. */
  first?: string[];
  /** Why it didn't reach a verdict (status error). */
  why?: string;
  ms: number;
  /** What ran it: the mx it used, and the mxcli version. */
  tool?: string;
  by: string;
}

export interface SecurityPolicy {
  /** production (the default): Production security before the build starts; prototype: a spike, with a reason. */
  level: 'production' | 'prototype';
  /** recommended (the default): strict mode off is flagged, not refused; required: refused. */
  strict: 'recommended' | 'required';
  /** true (the default): the office refuses a sign-off or acceptance that doesn't meet it; false: it only says so (with a reason). */
  enforce: boolean;
  /** Why it differs from the default (required for prototype and for advisory). */
  reason?: string;
  by?: string;
  at?: number;
}

export const DEFAULT_POLICY: SecurityPolicy = { level: 'production', strict: 'recommended', enforce: true };

/** Why a policy can't be saved, or undefined. */
export function policyProblem(p: SecurityPolicy): string | undefined {
  if ((p.level === 'prototype' || !p.enforce) && !(p.reason ?? '').trim()) return p.level === 'prototype' ? 'Say why this project is a prototype only (a spike, a throwaway demo…)' : 'Say why the office should only advise';
  return undefined;
}

/** A policy from anything (a stored file, a request body): unknown fields dropped, the default where unclear. */
export function cleanPolicy(v: unknown): SecurityPolicy {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const reason = typeof o.reason === 'string' ? o.reason.replace(/[\r\n]+/g, ' ').trim().slice(0, 400) : '';
  return {
    level: o.level === 'prototype' ? 'prototype' : 'production',
    strict: o.strict === 'required' ? 'required' : 'recommended',
    enforce: o.enforce !== false,
    ...(reason ? { reason } : {}),
    ...(typeof o.by === 'string' && o.by ? { by: o.by.slice(0, 80) } : {}),
    ...(typeof o.at === 'number' && Number.isFinite(o.at) ? { at: o.at } : {}),
  };
}

export const isDefaultPolicy = (p: SecurityPolicy) => p.level === 'production' && p.strict === 'recommended' && p.enforce;

/** The policy in a line, for the card, the Playbook and the gate's refusal. */
export function policyWords(p: SecurityPolicy): string {
  const lvl = p.level === 'production' ? 'Production security before the build starts (by the end of Stage 3, Architecture & Design)' : `Prototype only${p.reason ? ` (${p.reason})` : ''}: at least Prototype security`;
  const strict = p.strict === 'required' ? 'strict mode required' : 'strict mode recommended';
  return `${lvl}; ${strict}; demo users allowed while building, flagged for release; a clean mx check (0 errors) before the build is signed off or a delivery accepted${p.enforce ? '' : ' (advisory only: the office says so but doesn\'t refuse)'}`;
}

/**
 * Where the office applies the gate. build: signing off Stage 4 (the build plan, so the build starts);
 * release: signing off Stage 5 (Build), 6 or 7, and ✅ Accept of a delivery.
 */
export type GatePoint = 'build' | 'release';

/** The gate point of signing off toolkit stage `id`, or undefined when the gate doesn't apply (P to 3). */
export function gatePointOfStage(id: string): GatePoint | undefined {
  const s = id.trim().toUpperCase().replace(/^STAGE\s*/, '');
  if (s === '4') return 'build';
  if (s === '5' || s === '6' || s === '7') return 'release';
  return undefined;
}

export interface GateResult {
  point: GatePoint;
  commit?: string;
  meets: boolean;
  /** What stops it, a line each. */
  missing: string[];
  /** What's flagged but doesn't stop it (strict mode recommended, demo users on). */
  flags: string[];
  /** The policy enforces it: an unmet gate refuses the sign-off or acceptance. */
  enforced: boolean;
}

const short = (sha: string | undefined) => (sha ?? '').slice(0, 7);

/**
 * Whether the baseline is met at `commit`, from what was read there (`state`, undefined: not read) and the
 * `mx check` of that same commit (undefined: not run there). A state or check of another commit counts as
 * not there: the gate is bound to the revision.
 */
export function judgeGate(policy: SecurityPolicy, point: GatePoint, commit: string | undefined, state: SecurityState | undefined, check: MxCheckResult | undefined): GateResult {
  const missing: string[] = [];
  const flags: string[] = [];
  const at = commit ? ` at ${short(commit)}` : '';
  const st = state && commit && state.commit === commit ? state : undefined;
  const want: SecurityLevel = policy.level === 'production' ? 'production' : 'prototype';
  if (!commit) missing.push('No commit to check: the project has no main branch yet');
  else if (!st) missing.push(`App security not read${at} yet`);
  else if (!st.level) missing.push(`App security level couldn't be read${at}`);
  else if (RANK[st.level] < RANK[want]) missing.push(`App security is ${LEVEL_WORDS[st.level]}${at}; the policy needs ${LEVEL_WORDS[want]}`);
  if (st && st.level === 'production') {
    if (st.strict === false) (policy.strict === 'required' ? missing : flags).push(policy.strict === 'required' ? `Strict mode is off${at}; the policy requires it` : `Strict mode is off${at} (recommended: on; it disables mx.data.* client APIs, so vet widgets that use them)`);
    if (st.entities && st.entities.withoutRules > 0) missing.push(`${st.entities.withoutRules} persistable entit${st.entities.withoutRules === 1 ? 'y has' : 'ies have'} no access rule${at}${st.entities.sample.length ? ` (${st.entities.sample.join(', ')}${st.entities.withoutRules > st.entities.sample.length ? ', …' : ''})` : ''}`);
  }
  if (st?.demoUsers?.enabled) flags.push(`Demo users are on${at}${st.demoUsers.count !== undefined ? ` (${st.demoUsers.count})` : ''}: fine while building, switch them off before a release`);
  if (st?.guest?.enabled) flags.push(`Anonymous (guest) access is on${at}${st.guest.role ? ` (role ${st.guest.role})` : ''}: review what it can read`);
  if (st?.passwordMinLength !== undefined && st.passwordMinLength < 8) flags.push(`The password policy's minimum length is ${st.passwordMinLength}${at} (8 or more recommended)`);
  if (point === 'release' && commit) {
    const c = check && check.commit === commit ? check : undefined;
    if (!c) missing.push(`No mx check${at} yet`);
    else if (c.status === 'error') missing.push(`mx check${at} didn't finish: ${c.why ?? 'no verdict'}`);
    else if (c.status === 'fail') missing.push(`mx check${at} found ${c.errors ?? 'some'} error${c.errors === 1 ? '' : 's'}${c.codes?.length ? ` (${c.codes.slice(0, 3).map((x) => `${x.code}${x.count > 1 ? ` ×${x.count}` : ''}`).join(', ')})` : ''}`);
  }
  return { point, ...(commit ? { commit } : {}), meets: missing.length === 0, missing, flags, enforced: policy.enforce };
}

/** The refusal a sign-off or acceptance gets when the gate isn't met and the policy enforces it. */
export function gateRefusal(r: GateResult, what: string): string {
  return `${what} needs the project's security baseline met${r.commit ? ` at ${short(r.commit)}` : ''}. Missing: ${r.missing.join('; ')}. See App Insights › Security${r.missing.some((m) => /mx check/.test(m)) ? ' (Run mx check there)' : ''}, or change the project's security policy there with a reason.`;
}

/** `mx check`'s output (through `mxcli docker check`): its error count, warnings, codes and first lines. */
export function parseMxCheck(out: string): { errors?: number; warnings: number; codes: { code: string; count: number }[]; first: string[]; passed: boolean } {
  const lines = out.replace(/\r/g, '').split('\n');
  const errLines = lines.filter((l) => /^\s*\[error\]/i.test(l));
  const warnings = lines.filter((l) => /^\s*\[warning\]/i.test(l)).length;
  const counts = new Map<string, number>();
  for (const l of errLines) {
    const code = /\[(C[EW]\d+)\]/.exec(l)?.[1] ?? 'other';
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const total = /The app contains:\s*(\d+)\s*errors?/i.exec(out)?.[1];
  const errors = total !== undefined ? Number(total) : errLines.length ? errLines.length : /Project check passed/i.test(out) ? 0 : undefined;
  return {
    ...(errors !== undefined ? { errors } : {}),
    warnings,
    codes: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, count]) => ({ code, count })),
    first: errLines.slice(0, 5).map((l) => l.trim().slice(0, 300)),
    passed: errors === 0 && /Project check passed|The app contains:\s*0 errors/i.test(out),
  };
}

/** `mxcli --json -c "show project security;"`: its Property/Value rows as a state (no commit or time yet). */
export function stateFromShowJson(rows: unknown): Omit<SecurityState, 'commit' | 'readAt' | 'source'> | undefined {
  if (!Array.isArray(rows)) return undefined;
  const m = new Map<string, string>();
  for (const r of rows) if (r && typeof r === 'object' && typeof (r as { Property?: unknown }).Property === 'string') m.set(String((r as { Property: string }).Property), String((r as { Value?: unknown }).Value ?? ''));
  if (!m.size) return undefined;
  const bool = (k: string) => (m.has(k) ? m.get(k)!.toLowerCase() === 'true' : undefined);
  const num = (k: string) => (m.has(k) && /^\d+$/.test(m.get(k)!) ? Number(m.get(k)) : undefined);
  const level = levelOf(m.get('SecurityLevel'));
  const strict = bool('StrictMode');
  const demo = bool('DemoUsersEnabled');
  const guest = bool('GuestAccess');
  return {
    ...(level ? { level } : {}),
    ...(strict !== undefined ? { strict } : {}),
    ...(demo !== undefined ? { demoUsers: { enabled: demo, ...(num('DemoUsers') !== undefined ? { count: num('DemoUsers') } : {}) } } : {}),
    ...(guest !== undefined ? { guest: { enabled: guest } } : {}),
    ...(num('PasswordPolicy.MinimumLength') !== undefined ? { passwordMinLength: num('PasswordPolicy.MinimumLength') } : {}),
    ...(num('UserRoles') !== undefined ? { userRoles: num('UserRoles') } : {}),
  };
}

/** What the Security card shows. */
export interface SecurityView {
  floor: string;
  admin: boolean;
  policy: SecurityPolicy;
  /** Main's head, when there is one. */
  main?: { branch: string; commit: string };
  /** No .mpr at main: nothing to secure (yet). */
  noApp?: boolean;
  /** The state at main, when it was read. */
  state?: SecurityState;
  /** Why it wasn't read (the units can't be read here, the read failed). */
  stateWhy?: string;
  /** The newest mx check, of any commit (`check.commit` says which). */
  check?: MxCheckResult;
  /** An mx check running now. */
  running?: { commit: string; since: number };
  gates: Record<GatePoint, GateResult>;
}

/** The words the lead is told when the Project Manager presses "Ask … to fix" on the Needs-you card. */
export function securityTell(lines: readonly string[]): string {
  return `The Project Manager asks you to bring the app up to the project's security baseline (the office reads it from main, and refuses the sign-off of the build and the acceptance of a delivery without it):\n${lines.map((l, n) => `${n + 1}. ${l}`).join('\n')}\nFix it in the script that owns project security, run \`mxcli docker check -p <app>.mpr\` (Mendix's own check) until it reports 0 errors, and merge. If the policy itself is wrong for this project (a prototype, a widget that needs strict mode off), escalate (office-workers escalate) with options instead.`;
}

/** The Playbook's section:the policy as instruction (the office checks it at sign-off and acceptance). */
export function securityPlaybookLines(p: SecurityPolicy): string[] {
  const level =
    p.level === 'production'
      ? '- **Production security before the build.** By the end of Stage 3 (Architecture & Design), and before any build row, the app runs at Production security: `ALTER APP SECURITY ( SecurityLevel: PRODUCTION );` in the security script that owns project security (one script owns each setting; a later replay must not set it back). Write each entity\'s access rules in the same script as the entity, deny by default.'
      : `- **This project is a prototype only** (${p.reason ?? 'recorded by the Project Manager'}): at least Prototype security (\`ALTER APP SECURITY ( SecurityLevel: PROTOTYPE );\`). Don't present it as production-ready.`;
  return [
    '## Security baseline (checked by the office)',
    level,
    `- **Strict mode ${p.strict === 'required' ? 'is required' : 'is recommended'}** (\`ALTER APP SECURITY ( StrictMode: TRUE );\`, lint SEC005). Strict mode disables the \`mx.data.*\` client APIs, which some Marketplace and pluggable widgets use: vet each widget under strict mode when you add it${p.strict === 'required' ? ', and escalate if one needs it off' : '; if one needs strict mode off, record that as a decision'}.`,
    '- **Demo users** are fine while building; they are flagged for a release, so switch them off (`ALTER APP SECURITY ( EnableDemoUsers: FALSE );`) before one, and keep demo passwords out of nanoflows.',
    "- **`mx check`, not only `mxcli check`.** `mxcli check` checks an MDL script; Mendix's own checker can still fail the model (it has, with errors `mxcli check` passed). Run `mxcli docker check -p <app>.mpr` before saying a build is done, and fix every error.",
    `- The office reads the app's security from main and runs \`mx check\` at a commit itself: ${p.enforce ? 'it refuses' : 'it flags'} the Project Manager's sign-off of Stage 4 or later, and ✅ Accept of a delivery, when the baseline isn't met at that commit. So never ask for one before it is.`,
    '',
  ];
}
