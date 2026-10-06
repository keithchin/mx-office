// The office password on 🔌 Connections. Only its hash is ever kept: a new one is hashed with the
// office's salt into config.json, marked as set here (so it beats AGENT_OFFICE_PASSWORD and the
// launcher's ~/.agent-office-password from then on, config.ts), and any plaintext password config.json
// still held is dropped. The running office takes it at once (Auth.setVerifier): sessions on the old
// shared password stop working, accounts' sessions don't.

import { scryptSync } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Auth } from '../auth.js';
import type { Config } from '../config.js';
import type { CredentialView } from '../../shared/connections.js';
import { STARTED_ENV } from './store.js';

const STARTED_PASSWORD = STARTED_ENV.AGENT_OFFICE_PASSWORD;

export const PASSWORD_MIN = 8;

interface StoredConfig {
  password?: string;
  verifier?: string;
  salt?: string;
  claimedAt?: number;
  verifierFrom?: string;
  passwordSetBy?: string;
  passwordSetAt?: number;
}

const read = (cfg: Pick<Config, 'dataDir'>): StoredConfig => {
  try {
    return JSON.parse(readFileSync(path.join(cfg.dataDir, 'config.json'), 'utf8')) as StoredConfig;
  } catch {
    return {};
  }
};

function write(cfg: Pick<Config, 'dataDir'>, stored: StoredConfig) {
  const file = path.join(cfg.dataDir, 'config.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(stored, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

export function passwordProblem(pw: string): string | undefined {
  if (pw.length < PASSWORD_MIN) return `Pick a password of at least ${PASSWORD_MIN} characters`;
  if (pw.length > 200) return 'That password is too long';
  return undefined;
}

/** Sets the shared office password. Returns why it couldn't. */
export function changePassword(cfg: Config, auth: Pick<Auth, 'setVerifier'>, pw: string, by: string): string | undefined {
  const why = passwordProblem(pw);
  if (why) return why;
  const stored = read(cfg);
  const salt = stored.salt ? Buffer.from(stored.salt, 'hex') : cfg.salt;
  const verifier = scryptSync(pw, salt, 32);
  delete stored.password;
  Object.assign(stored, { verifier: verifier.toString('hex'), verifierFrom: 'connections', claimedAt: stored.claimedAt ?? Date.now(), passwordSetBy: by, passwordSetAt: Date.now() });
  write(cfg, stored);
  cfg.verifier = verifier;
  cfg.password = undefined;
  cfg.passwordGenerated = false;
  cfg.claimed = true;
  auth.setVerifier(verifier);
  return undefined;
}

/**
 * Hands the password back to where it came from before (AGENT_OFFICE_PASSWORD, else the generated one
 * config.json keeps the hash of). With neither, the current password stays, as the generated one.
 */
export function releasePassword(cfg: Config, auth: Pick<Auth, 'setVerifier'>): void {
  const stored = read(cfg);
  if (stored.verifierFrom !== 'connections') return;
  delete stored.verifierFrom;
  delete stored.passwordSetBy;
  delete stored.passwordSetAt;
  write(cfg, stored);
  if (STARTED_PASSWORD) {
    const verifier = scryptSync(STARTED_PASSWORD, cfg.salt, 32);
    cfg.verifier = verifier;
    auth.setVerifier(verifier);
  }
}

/** What the page shows for the password. */
export function passwordView(cfg: Config, launcherFile: string | undefined): CredentialView {
  const stored = read(cfg);
  if (stored.verifierFrom === 'connections') {
    return { id: 'password', status: 'connected', source: 'connections', savedAt: stored.passwordSetAt, savedBy: stored.passwordSetBy, warning: launcherFile && existsSync(launcherFile) ? `${launcherFile} is still there but no longer used: you can delete it.` : undefined };
  }
  if (STARTED_PASSWORD || !cfg.passwordGenerated) return { id: 'password', status: 'connected', source: 'env', where: launcherFile && existsSync(launcherFile) ? `AGENT_OFFICE_PASSWORD (from ${launcherFile})` : 'AGENT_OFFICE_PASSWORD / --password' };
  return {
    id: 'password',
    status: 'connected',
    source: 'generated',
    where: 'config.json (generated)',
    warning: stored.password ? 'config.json still holds the generated password as plain text (until it’s claimed): change it here and only a hash is kept.' : undefined,
  };
}
