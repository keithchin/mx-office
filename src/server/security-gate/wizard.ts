// A brand-new project's app starts at the security baseline (E2). Studio Pro's Blank template, and mxcli
// new, make an app whose security is Off; right after the wizard's `app` step makes one, this sets it to
// Production with strict mode off (the default policy: Production before the build, strict mode
// recommended, not required: strict mode disables the mx.data client APIs some Marketplace widgets need,
// so the team switches it on after vetting its widgets; measured on a Blank 11.12.4 app: `mx check` 0
// errors either way), with mxcli, then reads it
// back with `show project security` so the step says what the model now holds rather than what was asked.
// Demo users stay on: they're allowed while building and flagged for a release.
//
// It never fails the setup: no mxcli, a refusal or an unreadable answer is said in the step's line, and
// the first build-plan row (the Playbook's security section) and the office's gate (index.ts) still ask for
// it. An existing app (a change request) is never touched. A model edit can simply be done again, so it is
// not an operation record (those are for actions that can't, wizard/operations.ts); the step's line, kept
// with the setup, is its record, and the card reads the model itself.

import path from 'node:path';
import type { AppRun } from '../wizard/mendix-app.js';
import { findMpr } from '../liveapp/checkout.js';
import { stripNoise } from '../model/mxcli.js';
import { LEVEL_WORDS, stateFromShowJson } from '../../shared/security.js';

const MIN = 60_000;

/** The MDL that sets a new app to the baseline. */
export const BASELINE_MDL = 'alter app security (SecurityLevel: PRODUCTION, StrictMode: FALSE);';

/** After the app was made in `dir`: its security set to the baseline and read back; `made` with what happened added. */
export async function withSecurityBaseline(mxcli: string | undefined, dir: string, made: string, r: AppRun): Promise<string> {
  const mpr = findMpr(dir);
  if (!mpr) return made;
  if (!mxcli) return `${made}; app security left as the template made it (no mxcli to set it: the first build-plan row must set Production)`;
  const opts = { cwd: path.dirname(mpr), env: r.env, timeoutMs: 5 * MIN, allowFail: true };
  try {
    const set = await r.run(mxcli, ['-p', mpr, '-c', BASELINE_MDL], opts);
    if (set.code !== 0) return `${made}; couldn't set app security (mxcli exit ${set.code ?? '?'}: ${set.tail.slice(-1)[0] ?? ''}): the first build-plan row must set Production`;
    const shown = await r.run(mxcli, ['--json', '-p', mpr, '-c', 'show project security;'], opts);
    const body = stripNoise(shown.stdout);
    const s = shown.code === 0 && body.includes('[') ? stateFromShowJson(JSON.parse(body.slice(body.indexOf('[')))) : undefined;
    if (!s?.level) return `${made}; app security set to Production, strict mode off (not read back)`;
    return `${made}; app security now ${LEVEL_WORDS[s.level]}, strict mode ${s.strict ? 'on' : 'off'}${s.demoUsers?.enabled ? ', demo users on (for building)' : ''} (read back with mxcli)`;
  } catch (err) {
    return `${made}; couldn't set app security (${(err as Error).message.slice(0, 160)}): the first build-plan row must set Production`;
  }
}
