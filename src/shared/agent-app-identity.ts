// Who an agent's smoke run and journeys sign in as on its app instance (server/agent-app/identity.ts), from the
// project's own test users rather than the toolkit template's (the real rebuild test: office-app smoke signed in
// as the template's placeholder accounts, which the project never seeded, failed at sign-in, and the lead went
// idle). The project's users, in this order:
//   1. tests/e2e/project.config.js, unless all it names are the toolkit template's placeholders;
//   2. the personas the project's own journeys sign in as (`persona: 'x'`, "Persona: x", `TEST_USER=x`, a
//      journey JSON's `persona` / `user` / `as`), in tests/**/*.journey.json and *.journey.js;
// and for a password the config doesn't give, the seed's password constant the instance booted with (a
// constant whose name says password in mxcli's .mxcli/run-local.json boot configuration). Pure: the passwords it
// handles stay in memory, and the words it gives name where a password came from, never the password.

import type { RunnerAccount, RunnerConfig } from './walkthroughs/identity.js';

/** The toolkit template's placeholder accounts (project.config.template.js): never a project's real users. */
export const TEMPLATE_USERS: readonly string[] = ['demo_test_user', 'erika.engineer', 'paul.planner'];

const ACCOUNT = /^[A-Za-z0-9_.@+-]{1,80}$/;
const isTemplate = (u: string | undefined) => !!u && TEMPLATE_USERS.includes(u.toLowerCase());

/** Whether a journey-runner config names only the template's placeholders (or nobody). */
export function templateOnly(cfg: RunnerConfig | undefined): boolean {
  if (!cfg) return true;
  const users = [cfg.user, ...cfg.roles.map((r) => r.user)].filter((u): u is string => !!u);
  return !users.length || users.every(isTemplate);
}

/** The personas a journey file (JSON or JS) says it signs in as, in order, at most 12. */
export function personasIn(text: string): string[] {
  const out: string[] = [];
  const add = (u: string | undefined) => {
    const v = u?.trim();
    if (v && ACCOUNT.test(v) && !isTemplate(v) && !/^(mxadmin|admin|administrator|root)$/i.test(v) && !out.includes(v) && out.length < 12) out.push(v);
  };
  for (const m of text.matchAll(/["']?\b(?:persona|user|as)["']?\s*[:=]\s*["'`]([A-Za-z0-9_.@+-]+)["'`]/g)) add(m[1]);
  for (const m of text.matchAll(/\bPersona:\s*([A-Za-z0-9_.@+-]*[A-Za-z0-9_@+-])/g)) add(m[1]);
  for (const m of text.matchAll(/\bTEST_USER\s*=\s*([A-Za-z0-9_.@+-]+)/g)) add(m[1]);
  for (const m of text.matchAll(/\blogin\(\s*\w+\s*,\s*["'`]([A-Za-z0-9_.@+-]+)["'`]/g)) add(m[1]);
  return out;
}

/** The seed's password constant in mxcli's run-local.json (`bootConfig.MicroflowConstants`): its name and value, or undefined. */
export function seedPasswordIn(runLocal: unknown): { constant: string; value: string } | undefined {
  const consts = (runLocal as { bootConfig?: { MicroflowConstants?: Record<string, unknown> } } | null)?.bootConfig?.MicroflowConstants;
  if (!consts || typeof consts !== 'object') return undefined;
  const named = Object.entries(consts).filter(([k, v]) => /pass(word)?/i.test(k) && typeof v === 'string' && v);
  const best = named.find(([k]) => /seed|test|demo|user/i.test(k)) ?? named[0];
  return best ? { constant: best[0], value: best[1] as string } : undefined;
}

export interface ProjectIdentities {
  /** The config to sign in from (shared/walkthroughs/identity.ts resolveIdentity reads it). */
  cfg: RunnerConfig | undefined;
  /** The users to tell the agent: names, roles and where each came from. */
  users: { user: string; role?: string }[];
  /** Where the passwords come from, in words (never a password). */
  passwords: string;
}

/** The project's test users as one runner config: the usable project config, plus the journeys' personas with the seed password. */
export function projectIdentities(cfg: RunnerConfig | undefined, personas: readonly string[], seed: { constant: string; value: string } | undefined, opts: { generated?: boolean; roles?: readonly { user: string; role?: string }[] } = {}): ProjectIdentities {
  if (opts.generated && seed) return generatedIdentities(templateOnly(cfg) ? undefined : cfg, personas, seed, opts.roles ?? []);
  const usable = templateOnly(cfg) ? undefined : cfg;
  const roles: RunnerAccount[] = [...(usable?.roles ?? [])];
  const known = (u: string) => (usable?.user && usable.user.toLowerCase() === u.toLowerCase()) || roles.some((r) => r.user.toLowerCase() === u.toLowerCase());
  for (const p of personas) if (!known(p)) roles.push({ user: p, pass: seed?.value ?? usable?.pass ?? '', label: 'journey persona' });
  const user = usable?.user ?? personas[0];
  const pass = usable?.user ? usable.pass : seed?.value;
  const out: RunnerConfig | undefined = user || roles.length ? { ...(user ? { user } : {}), ...(pass !== undefined ? { pass } : {}), roles } : undefined;
  const list = [...(user ? [{ user, role: usable?.user ? 'default' : 'journey persona' }] : []), ...roles.map((r) => ({ user: r.user, ...(r.label ?? r.key ? { role: r.label ?? r.key } : {}) }))].filter((u, i, a) => a.findIndex((x) => x.user === u.user) === i);
  const where = [usable ? 'tests/e2e/project.config.js' : '', personas.some((p) => !usable || !known(p)) || !usable ? (seed ? `the seed password constant ${seed.constant} this instance booted with` : 'no seed password constant found: name the accounts and passwords in tests/e2e/project.config.js roles') : ''].filter(Boolean);
  return { cfg: out, users: list.slice(0, 16), passwords: where.join('; ') || 'tests/e2e/project.config.js' };
}

/**
 * A generated seed password (shared/instance-constants.ts): the seed set it for every account it made, so every
 * project test user (the config's, the journeys' personas, the file's seedUsers) signs in with it; a password a
 * config names is the model's old way and is passed over.
 */
function generatedIdentities(usable: RunnerConfig | undefined, personas: readonly string[], seed: { constant: string; value: string }, seedRoles: readonly { user: string; role?: string }[]): ProjectIdentities {
  const roles: RunnerAccount[] = [];
  const add = (user: string, label?: string, key?: string) => {
    if (user && !roles.some((r) => r.user.toLowerCase() === user.toLowerCase())) roles.push({ user, pass: seed.value, ...(label ? { label } : {}), ...(key ? { key } : {}) });
  };
  if (usable?.user) add(usable.user, 'default');
  for (const r of usable?.roles ?? []) add(r.user, r.label, r.key);
  for (const r of seedRoles) add(r.user, r.role ?? 'seed user');
  for (const p of personas) add(p, 'journey persona');
  const user = roles[0]?.user;
  const cfg: RunnerConfig | undefined = user ? { user, pass: seed.value, roles } : undefined;
  return { cfg, users: roles.map((r) => ({ user: r.user, ...(r.label ?? r.key ? { role: r.label ?? r.key } : {}) })).slice(0, 16), passwords: `the seed password the office generated for this instance (${seed.constant}; office-app status shows it)` };
}

/** What the agent is told when the office couldn't sign in: who, where the account came from, what to do. */
export function signInHelp(user: string, from: string, ids: Pick<ProjectIdentities, 'passwords' | 'users'>): string {
  const others = ids.users.filter((u) => u.user !== user).map((u) => u.user).slice(0, 6);
  return `The office signed in as ${user} (${from}; passwords: ${ids.passwords}). If that account or its password isn't what the app was seeded with, name the right ones in tests/e2e/project.config.js (credentials() and roles), or pass --as <user>${others.length ? ` (other known users: ${others.join(', ')})` : ''}. Don't go quiet: this is raised to the Project Manager too.`;
}
