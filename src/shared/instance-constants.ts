// Per-run constants for an app instance (server/app-instance/constants.ts reads them; agent-app/ and the Live
// app pass them to `mxcli run --constant Module.Name=value`, which mxcli applies to that run's runtime
// MicroflowConstants only: never the model, never a commit, never a cloud deployment).
//
// The real build that asked for this: a production-minded app keeps its seed off in the model (a Boolean
// constant such as Core.SeedDemoData=false, no known password, no demo users), which is right, but then an
// instance has no account and smoke runs and journeys can't sign in. The team worked round it with a demo admin
// and a throwaway password in the model, which then reached a public cloud sandbox. Now:
//   * the project says once, in .agent-office/instance-constants.json (committed: no secrets in it), which
//     constants its instances run with ({"constants": {"Core.SeedDemoData": true}});
//   * an agent can add or change one for its own instance (`office-app start --const Module.Name=value`, the
//     MCP tool's `constants`);
//   * the file may name the constant that holds the seed's password ("seedPassword": "Core.SeedPassword") and
//     the users the seed makes ("seedUsers"); the office then generates a strong password per instance, passes
//     it as that constant for that run only, and gives it only to the agent that asked (office-app status, the
//     MCP response) and to its own smoke runs and journeys.
// Pure (no Node imports): the parsing, the checks and the words.

export const INSTANCE_CONSTANTS_FILE = '.agent-office/instance-constants.json';

export type ConstValue = string | number | boolean;
/** A constant's type as the model declares it (Constants$Constant's Type). */
export type ConstType = 'boolean' | 'integer' | 'decimal' | 'string' | 'datetime' | 'other';

/** What the project's file says, checked. */
export interface InstanceConstantsFile {
  constants: Record<string, ConstValue>;
  /** The constant the seed reads its password from: generated per instance. */
  seedPassword?: string;
  /** The accounts the seed makes (with that password), when no config or journey names them. */
  seedUsers: { user: string; role?: string }[];
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;
const ACCOUNT = /^[A-Za-z0-9_.@+-]{1,80}$/;
/** A constant whose name says it holds a secret: never a value in a committed file or on a command line. */
const SECRET = /(pass(word)?|passwd|pwd|secret|token|api_?key|private_?key|credentials?)$/i;

export const isConstName = (n: string) => NAME.test(n);
export const secretLooking = (n: string) => SECRET.test(n.slice(n.indexOf('.') + 1));

const secretWords = (n: string, where: string) =>
  `${n} looks like a secret (its name says password, token or key): ${where}. For a test account's password, name the constant as "seedPassword" in ${INSTANCE_CONSTANTS_FILE} and the office generates one per instance; a real secret never goes to an instance this way.`;

/** The project's file, checked: what it says, or the problems in words. */
export function parseConstantsFile(text: string): { file: InstanceConstantsFile; problems: string[] } {
  const file: InstanceConstantsFile = { constants: {}, seedUsers: [] };
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { file, problems: [`${INSTANCE_CONSTANTS_FILE} isn't JSON (${(err as Error).message})`] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { file, problems: [`${INSTANCE_CONSTANTS_FILE} must be an object: {"constants": {"Module.Name": value}, "seedPassword": "Module.Name", "seedUsers": ["user"]}`] };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['constants', 'seedPassword', 'seedUsers', '$comment', 'comment'].includes(k)) problems.push(`${INSTANCE_CONSTANTS_FILE}: unknown field "${k}" (constants, seedPassword, seedUsers)`);
  const c = o.constants;
  if (c !== undefined && (!c || typeof c !== 'object' || Array.isArray(c))) problems.push(`${INSTANCE_CONSTANTS_FILE}: "constants" must be an object of "Module.Name": value`);
  else
    for (const [k, v] of Object.entries((c as Record<string, unknown>) ?? {})) {
      if (!isConstName(k)) problems.push(`${INSTANCE_CONSTANTS_FILE}: "${k}" isn't a constant's name (Module.Name)`);
      else if (secretLooking(k)) problems.push(secretWords(k, `${INSTANCE_CONSTANTS_FILE} is committed, so its values must not be secrets`));
      else if (typeof v !== 'string' && typeof v !== 'boolean' && !(typeof v === 'number' && Number.isFinite(v))) problems.push(`${INSTANCE_CONSTANTS_FILE}: ${k} must be a string, a number or true/false`);
      else file.constants[k] = v;
    }
  if (o.seedPassword !== undefined) {
    if (typeof o.seedPassword !== 'string' || !isConstName(o.seedPassword)) problems.push(`${INSTANCE_CONSTANTS_FILE}: "seedPassword" must be a constant's name (Module.Name)`);
    else if (o.seedPassword in file.constants) problems.push(`${INSTANCE_CONSTANTS_FILE}: ${o.seedPassword} is the seed password constant: the office generates its value, so it can't be in "constants" too`);
    else file.seedPassword = o.seedPassword;
  }
  if (o.seedUsers !== undefined && !Array.isArray(o.seedUsers)) problems.push(`${INSTANCE_CONSTANTS_FILE}: "seedUsers" must be a list of user names (or {"user", "role"})`);
  for (const u of Array.isArray(o.seedUsers) ? o.seedUsers.slice(0, 16) : []) {
    const user = typeof u === 'string' ? u : u && typeof u === 'object' ? (u as { user?: unknown }).user : undefined;
    const role = u && typeof u === 'object' ? (u as { role?: unknown }).role : undefined;
    if (typeof user !== 'string' || !ACCOUNT.test(user)) problems.push(`${INSTANCE_CONSTANTS_FILE}: a seed user must be a user name (letters, digits, . _ @ + -)`);
    else file.seedUsers.push({ user, ...(typeof role === 'string' && role ? { role: role.slice(0, 60) } : {}) });
  }
  return { file, problems };
}

/**
 * What an agent asked for: `Module.Name=value` strings (the command line) or an object (the MCP tool). The
 * values stay strings or what JSON gave; the model's type decides later.
 */
export function parseRequested(v: unknown): { constants: Record<string, ConstValue>; problems: string[] } {
  const constants: Record<string, ConstValue> = {};
  const problems: string[] = [];
  const add = (k: string, val: unknown) => {
    const name = k.trim();
    if (!isConstName(name)) problems.push(`"${name}" isn't a constant's name: give Module.Name=value (for example Core.SeedDemoData=true)`);
    else if (secretLooking(name)) problems.push(secretWords(name, 'a value given on the command line shows in the process list and your transcript'));
    else if (typeof val !== 'string' && typeof val !== 'boolean' && !(typeof val === 'number' && Number.isFinite(val))) problems.push(`${name} must be a string, a number or true/false`);
    else constants[name] = val;
  };
  if (v === undefined || v === null) return { constants, problems };
  if (Array.isArray(v)) {
    for (const s of v.slice(0, 40)) {
      if (typeof s !== 'string' || !s.includes('=')) problems.push(`"${String(s)}" must be Module.Name=value`);
      else add(s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1));
    }
  } else if (typeof v === 'object') for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 40)) add(k, val);
  else problems.push('constants must be a list of Module.Name=value or an object of "Module.Name": value');
  return { constants, problems };
}

/** The model's type from Constants$Constant's Type ($Type "DataTypes$BooleanType", …). */
export function constTypeOf(bsonType: string): ConstType {
  const t = bsonType.replace(/^.*\$/, '').replace(/Type$/, '').toLowerCase();
  if (t === 'boolean') return 'boolean';
  if (t === 'integer' || t === 'long') return 'integer';
  if (t === 'decimal' || t === 'float') return 'decimal';
  if (t === 'string') return 'string';
  if (t === 'datetime') return 'datetime';
  return 'other';
}

/** The value as mxcli's `--constant Module.Name=value` takes it for `type`, or why it doesn't fit. */
export function valueFor(name: string, v: ConstValue, type: ConstType | undefined): { value: string } | { why: string } {
  const s = String(v).trim();
  switch (type) {
    case 'boolean':
      return /^(true|false)$/i.test(s) ? { value: s.toLowerCase() } : { why: `${name} is a Boolean constant: give true or false, not "${String(v)}"` };
    case 'integer':
      return /^-?\d+$/.test(s) ? { value: s } : { why: `${name} is an Integer constant: give a whole number, not "${String(v)}"` };
    case 'decimal':
      return /^-?\d+(\.\d+)?$/.test(s) ? { value: s } : { why: `${name} is a Decimal constant: give a number such as 12.5, not "${String(v)}"` };
    case 'datetime':
      return /^\d{4}-\d\d-\d\d([ T]\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)?)?$/.test(s) ? { value: s } : { why: `${name} is a Date and time constant: give an ISO date such as 2026-01-31T09:00:00Z, not "${String(v)}"` };
    default:
      return { value: String(v) };
  }
}

/** The model's constants (name → type), or undefined when they couldn't be read (mxcli then judges the names). */
export type ModelConstants = Map<string, ConstType> | undefined;

/** What an instance runs with: mxcli's `Module.Name=value` arguments, and the names alone for words. */
export interface ConstantsPlan {
  args: string[];
  names: string[];
  /** The generated seed password, when the project names its constant: given to the asking agent only. */
  generated?: { constant: string; value: string; users: { user: string; role?: string }[] };
}

/**
 * The constants of one run: the project's file, then what the agent asked for (it wins), then the generated
 * seed password (nobody overrides it). Every name checked against the model when it could be read, every value
 * against its type. A string says what's wrong.
 */
export function planConstants(file: InstanceConstantsFile | undefined, requested: Record<string, ConstValue>, model: ModelConstants, password?: string): ConstantsPlan | string {
  const all: Record<string, ConstValue> = { ...(file?.constants ?? {}), ...requested };
  const problems: string[] = [];
  const seed = file?.seedPassword;
  if (seed && seed in requested) problems.push(`${seed} is the seed password constant: the office generates it for each instance, so it can't be set by hand`);
  const known = model ? [...model.keys()] : [];
  const unknown = (n: string) => {
    const near = known.filter((k) => k.toLowerCase() === n.toLowerCase() || k.split('.')[1]?.toLowerCase() === n.split('.')[1]?.toLowerCase()).slice(0, 3);
    return `the model at this commit has no constant ${n}${near.length ? ` (did you mean ${near.join(', ')}?)` : known.length ? ` (it has ${known.slice(0, 8).join(', ')}${known.length > 8 ? ', …' : ''})` : ' (it has none)'}`;
  };
  const args: string[] = [];
  for (const [n, v] of Object.entries(all)) {
    if (model && !model.has(n)) {
      problems.push(`${unknown(n)}${n in requested ? '' : ` (from ${INSTANCE_CONSTANTS_FILE})`}`);
      continue;
    }
    const got = valueFor(n, v, model?.get(n));
    if ('why' in got) problems.push(got.why);
    else args.push(`${n}=${got.value}`);
  }
  let generated: ConstantsPlan['generated'];
  if (seed && password) {
    if (model && !model.has(seed)) problems.push(`${unknown(seed)} (the seedPassword of ${INSTANCE_CONSTANTS_FILE})`);
    else if (model && model.get(seed) !== 'string') problems.push(`${seed} (the seedPassword of ${INSTANCE_CONSTANTS_FILE}) must be a String constant`);
    else {
      args.push(`${seed}=${password}`);
      generated = { constant: seed, value: password, users: file?.seedUsers ?? [] };
    }
  }
  if (problems.length) return `The app instance can't start with these constants: ${problems.join('; ')}.`;
  return { args, names: args.map((a) => a.slice(0, a.indexOf('='))), ...(generated ? { generated } : {}) };
}

/** A stable key of what was asked for (not the generated password): the same ask reuses the same instance. */
export const requestKey = (requested: Record<string, ConstValue>) =>
  Object.keys(requested)
    .sort()
    .map((k) => `${k}=${String(requested[k])}`)
    .join('\n');

/** Words for an mxcli that can't take a constant for one run. */
export const NO_CONSTANT_FLAG = 'this mxcli can’t set constants for one run (it has no `mxcli run --constant`): update mxcli (Connections › Folders › mxcli) to start the app with instance constants';
