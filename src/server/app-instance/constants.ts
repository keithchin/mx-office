// Per-run constants for an office-run app instance (the rules and words are shared/instance-constants.ts):
// the project's .agent-office/instance-constants.json at the commit (read from git, never the working folder),
// the model's constants at that commit with their types (model/units.ts, straight out of git; no mxcli), a
// strong generated seed password, and whether this mxcli takes `mxcli run --constant` (asked once per binary).
// What it gives goes to mxcli as `--constant Module.Name=value` for that run only: never the model, never a
// commit, never a cloud deployment. The generated password is masked in the instance log like the database's.

import { execFile } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { doc, typeOf } from '../model/bson.js';
import type { ModelUnits } from '../model/units.js';
import { constTypeOf, INSTANCE_CONSTANTS_FILE, NO_CONSTANT_FLAG, parseConstantsFile, parseRequested, planConstants, type ConstantsPlan, type ConstType, type InstanceConstantsFile, type ModelConstants } from '../../shared/instance-constants.js';

/** The project's file at `commit`: what it says (undefined when there's none), or its problems. */
export async function constantsFileAt(floorDir: string, commit: string): Promise<{ file?: InstanceConstantsFile; problems: string[] }> {
  // Loaded when asked: the Live app imports this module too, and the Testing tab's reader is not its business.
  const { readFiles } = await import('../testing/repo.js');
  const text = (await readFiles(floorDir, commit, [INSTANCE_CONSTANTS_FILE], 256 * 1024).catch(() => new Map<string, string>())).get(INSTANCE_CONSTANTS_FILE);
  if (text === undefined) return { problems: [] };
  return parseConstantsFile(text);
}

/** The model's constants at `commit` (Module.Name → type), or undefined when the model can't be read here. */
export async function modelConstantsAt(units: ModelUnits, floorDir: string, commit: string): Promise<ModelConstants> {
  const m = await units.commit(floorDir, commit).catch(() => null);
  if (!m) return undefined;
  const out = new Map<string, ConstType>();
  for (const u of m.ix.units.values()) {
    if (u.type !== 'Constants$Constant' || !u.qn) continue;
    const d = await m.ix.read(u.id).catch(() => null);
    out.set(u.qn, d ? constTypeOf(typeOf(doc(d.Type))) : 'other');
  }
  return out;
}

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SYMBOL = '-_.';

/**
 * A strong password for one instance: 24 characters with lower and upper case, digits and a symbol (any
 * Mendix password policy passes), nothing a shell, a URL or a JSON string would need to escape.
 */
export function generatePassword(length = 24): string {
  const all = LOWER + UPPER + DIGIT;
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
  for (let i = chars.length; i < length; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export interface PlanDeps {
  file?(floorDir: string, commit: string): Promise<{ file?: InstanceConstantsFile; problems: string[] }>;
  model?(floorDir: string, commit: string): Promise<ModelConstants>;
  password?(): string;
}

/** The constants of one instance at `commit`: the project's file, what was asked for, the generated seed password. */
export async function instanceConstants(floorDir: string, commit: string, requested: unknown, d: PlanDeps = {}): Promise<ConstantsPlan | string> {
  const asked = parseRequested(requested);
  const read = await (d.file ?? constantsFileAt)(floorDir, commit);
  const problems = [...read.problems, ...asked.problems];
  if (problems.length) return `The app instance can't start with these constants: ${problems.join('; ')}.`;
  if (!read.file && !Object.keys(asked.constants).length) return { args: [], names: [] };
  const model = await (d.model ?? (async () => undefined))(floorDir, commit).catch(() => undefined);
  return planConstants(read.file, asked.constants, model, read.file?.seedPassword ? (d.password ?? generatePassword)() : undefined);
}

const flagCache = new Map<string, { mtime: number; ok: boolean }>();

/** Whether this mxcli takes `mxcli run --constant` (mxcli.org: per-run constant values; older builds don't). */
export function supportsConstantFlag(mxcli: string, timeoutMs = 20_000): Promise<boolean> {
  let mtime = 0;
  try {
    mtime = statSync(mxcli).mtimeMs;
  } catch {
    // A name on PATH: asked every time.
  }
  const had = flagCache.get(mxcli);
  if (had && mtime && had.mtime === mtime) return Promise.resolve(had.ok);
  return new Promise((resolve) => {
    execFile(mxcli, ['run', '--help'], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } }, (_err, stdout, stderr) => {
      const ok = /--constant\b/.test(`${stdout ?? ''}${stderr ?? ''}`);
      if (mtime) flagCache.set(mxcli, { mtime, ok });
      resolve(ok);
    });
  });
}

/**
 * The project's instance constants for the 🌐 Live app (its checkout `dir`, at the commit it runs): the file's
 * `constants` only. Its seedPassword is not generated there: nobody asks the Live app for a password, and the
 * page must never show one. A file with problems, or an mxcli without `--constant`, throws (the Live app says
 * so in its log and starts without them).
 */
export async function liveAppConstants(dir: string, mxcli: string | null, flag: (mxcli: string) => Promise<boolean> = supportsConstantFlag): Promise<string[]> {
  const text = await readFile(path.join(dir, ...INSTANCE_CONSTANTS_FILE.split('/')), 'utf8').catch(() => undefined);
  if (text === undefined) return [];
  const { file, problems } = parseConstantsFile(text);
  if (problems.length) throw new Error(`${problems.join('; ')}; started without them`);
  const args = Object.entries(file.constants).map(([k, v]) => `${k}=${String(v)}`);
  if (!args.length) return [];
  if (!mxcli || !(await flag(mxcli).catch(() => false))) throw new Error(`${NO_CONSTANT_FLAG}; started without them`);
  return args;
}

/** A model reader of the office's own per data folder for test runs (its .mpr copies kept apart from the Model tab's). */
const testUnits = new Map<string, ModelUnits>();
const unitsFor = async (dataDir: string): Promise<ModelUnits> => {
  let u = testUnits.get(dataDir);
  if (!u) {
    const { ModelUnits: Units } = await import('../model/units.js');
    testUnits.set(dataDir, (u = new Units(path.join(dataDir, 'testing', '.model-units'))));
  }
  return u;
};

/**
 * The instance constants of an office-run microflow test run at `commit` (testing/mxcli-run.ts): the project's
 * file with a generated seed password (the startup seed then makes its accounts with a real password instead
 * of refusing an empty one), and the model's password-like String constants to name when a seed finds its
 * password empty anyway. Or why the file can't be used.
 */
export async function testRunConstants(dataDir: string, floorDir: string, commit: string, d: PlanDeps = {}): Promise<{ args: string[]; secrets: string[]; seedPassword?: string; passwordConstants(): Promise<string[]> } | { why: string }> {
  let model: ModelConstants;
  const readModel = async () => {
    if (model) return model;
    if (d.model) return (model = await d.model(floorDir, commit));
    const units = await unitsFor(dataDir);
    return (model = await modelConstantsAt(units, floorDir, commit).finally(() => units.blobs(floorDir).close()));
  };
  const plan = await instanceConstants(floorDir, commit, undefined, { ...d, model: readModel });
  if (typeof plan === 'string') return { why: plan };
  // Read only when a seed found its password empty: most runs never need it.
  const passwordConstants = async () => [...((await readModel().catch(() => undefined)) ?? new Map<string, ConstType>())].filter(([n, t]) => t === 'string' && /pass(word)?|pwd/i.test(n.slice(n.indexOf('.') + 1))).map(([n]) => n).slice(0, 6);
  return { args: plan.args, secrets: plan.generated ? [plan.generated.value] : [], ...(plan.generated ? { seedPassword: plan.generated.constant } : {}), passwordConstants };
}
