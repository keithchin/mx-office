// Who a walkthrough signs in as: the same identity the toolkit's journey runner uses for that journey, so a
// video films what the journey was written to see. The runner signs in with `credentials()` from the
// project's tests/e2e/project.config.js (TEST_USER / TEST_PASS, else the file's DEFAULT_USER / DEFAULT_PASS),
// and a project may name per-role accounts there (`roles: { approver: { label, user, pass } }`). A journey
// says who runs it in its own words: `persona`, `role`, a `user` / `as` field, or a `$comment` line such as
// "Run as the Approver: TEST_USER=demo_approver". The order:
//   1. the journey's own TEST_USER= line, `user` or `as` (an account name);
//   2. a `role` / `persona` / `as` that names one of the config's roles (by key, label or account);
//   3. a `persona` that is the config's default account;
//   4. the config's default account (the runner's own default);
//   5. the Walkthroughs setting (when the project has no journey-runner config).
// An admin account is never used (walkthroughs show what a demo user sees): it falls through to the next.
// Passwords stay in memory: what's resolved says the user and where it came from, never the password. Pure.

/** An account the project's journey-runner config names. */
export interface RunnerAccount {
  user: string;
  pass: string;
  /** The role's key in `roles` ("approver"), when it is one. */
  key?: string;
  label?: string;
}

/** What the project's tests/e2e/project.config.js says, read with a clean environment (its defaults). */
export interface RunnerConfig {
  /** credentials().user / .pass: the runner's default identity. */
  user?: string;
  pass?: string;
  roles: RunnerAccount[];
}

/** Who a journey says runs it (scriptOf reads it off the journey file). */
export interface IdentityHint {
  /** An account name: a `TEST_USER=` line in `$comment`, or a `user` / `as` field. */
  user?: string;
  /** A role or persona in the journey's words: `role`, `persona`, `as`. */
  names: string[];
}

export type IdentitySource = 'journey' | 'project-config' | 'setting';

export interface ResolvedIdentity {
  user: string;
  password: string;
  from: IdentitySource;
  /** Why an account was passed over (an admin), for the manifest's notes. */
  note?: string;
}

/** Account names a walkthrough never signs in as. */
export const ADMIN_USER = /^(mxadmin|admin|administrator|root)$/i;

const ACCOUNT = /^[A-Za-z0-9_.@+-]{1,80}$/;

/** The identity hint of a parsed journey file. */
export function hintOf(j: Record<string, unknown>): IdentityHint {
  const lines = (Array.isArray(j.$comment) ? j.$comment : [j.$comment]).filter((x): x is string => typeof x === 'string');
  let user: string | undefined;
  for (const l of lines) {
    const m = /\bTEST_USER\s*=\s*([A-Za-z0-9_.@+-]+)/.exec(l);
    if (m) {
      user = m[1];
      break;
    }
  }
  for (const k of ['user', 'as'] as const) {
    const v = j[k];
    if (!user && typeof v === 'string' && ACCOUNT.test(v.trim())) user = v.trim();
  }
  const names = (['role', 'persona', 'as'] as const).map((k) => j[k]).filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim());
  return { ...(user ? { user } : {}), names };
}

const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** The account a journey signs in with (see the header for the order), or undefined when nothing names one. */
export function resolveIdentity(hint: IdentityHint, cfg: RunnerConfig | undefined, setting: { user: string; password: string }): ResolvedIdentity {
  const notes: string[] = [];
  const passFor = (user: string): string => {
    if (cfg?.user && same(user, cfg.user) && cfg.pass !== undefined) return cfg.pass;
    const role = cfg?.roles.find((r) => same(r.user, user));
    if (role) return role.pass;
    if (same(user, setting.user)) return setting.password;
    // A demo account the config doesn't list: the demo seed's usual shared password.
    return cfg?.pass ?? setting.password;
  };
  const pick = (user: string | undefined, password: () => string, from: IdentitySource): ResolvedIdentity | undefined => {
    if (!user) return undefined;
    if (ADMIN_USER.test(user)) {
      notes.push(`passed over ${user}: walkthroughs never sign in as an admin`);
      return undefined;
    }
    return { user, password: password(), from, ...(notes.length ? { note: notes.join('; ') } : {}) };
  };
  const byJourney = pick(hint.user, () => passFor(hint.user!), 'journey');
  if (byJourney) return byJourney;
  for (const n of hint.names) {
    const role = cfg?.roles.find((r) => same(r.key, n) || same(r.label, n) || same(r.user, n));
    const got = role && pick(role.user, () => role.pass, 'journey');
    if (got) return got;
  }
  if (cfg?.user && hint.names.some((n) => same(n, cfg.user))) {
    const got = pick(cfg.user, () => cfg.pass ?? setting.password, 'journey');
    if (got) return got;
  }
  const byConfig = pick(cfg?.user, () => cfg?.pass ?? setting.password, 'project-config');
  if (byConfig) return byConfig;
  return { user: setting.user, password: setting.password, from: 'setting', ...(notes.length ? { note: notes.join('; ') } : {}) };
}

/** Where an identity came from, in words for the page and the manifest. */
export const SOURCE_WORDS: Record<IdentitySource, string> = {
  journey: 'named by the journey',
  'project-config': 'the journey runner’s default (tests/e2e/project.config.js)',
  setting: 'the Walkthroughs demo user setting',
};

/**
 * The lines of a journey's `$comment` worth showing when its recording fails: time windows, start states,
 * preconditions, order between journeys. Anything that looks like a password is masked; at most four lines.
 */
export function journeyNotes(j: Record<string, unknown>): string[] {
  const lines = (Array.isArray(j.$comment) ? j.$comment : [j.$comment]).filter((x): x is string => typeof x === 'string');
  return lines
    .filter((l) => /time[- ]dependent|do not run|don['’]t run|start state|precondition|fresh db|fresh database|not re-?runnable|run (directly )?(after|before)|reset the db|must be running/i.test(l))
    .filter((l) => !/password/i.test(l))
    .map((l) => l.replace(/\b([A-Z_]*PASS(?:WORD)?)\s*=\s*\S+/g, '$1=***').replace(/\s+/g, ' ').trim().slice(0, 300))
    .slice(0, 4);
}
