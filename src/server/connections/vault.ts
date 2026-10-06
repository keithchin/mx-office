// Where 🔌 Connections keeps its secrets: <office data>/credentials.json. On Windows each value is
// encrypted with DPAPI for the Windows user the office runs as (System.Security.Cryptography.
// ProtectedData, through a PowerShell child: no native module), so the file is useless to anyone else
// and on any other machine. Elsewhere there's no DPAPI, so values are kept base64'd in a file only the
// office's user can read (0600), and the page says so. Values travel to and from PowerShell on its
// stdin and stdout only (never its command line), are kept in memory once read, and never go to a
// browser, a log or the audit log. The file also keeps each value's masked tail, who saved it and when,
// and the last Test of each credential, none of them secret.

import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isCredentialId, maskTail, type CredentialCheck, type CredentialId } from '../../shared/connections.js';

export type Scheme = 'dpapi' | 'file';

/** 12 hex characters of a salted SHA-256: tells one value from another without saying anything about it. */
export const fingerprint = (value: string) => createHash('sha256').update(`agent-office-check:${value.trim()}`).digest('hex').slice(0, 12);

/** Turns values into what's written and back. `protect` may run a child process; `unprotectSync` is for loading at start. */
export interface Cipher {
  scheme: Scheme;
  protect(values: string[]): Promise<string[]>;
  unprotectSync(values: string[]): (string | undefined)[];
}

// One PowerShell run handles a batch: a line per value, "P <base64 plain>" to protect or "U <base64
// cipher>" to unprotect, answered a line each (an empty line for one it couldn't do). The extra entropy
// ties the ciphertext to this purpose, so another program of the same user's can't just Unprotect it.
const PS_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Security',
  '$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser',
  '$entropy = [System.Text.Encoding]::UTF8.GetBytes("agent-office-connections-v1")',
  '$out = New-Object System.Collections.Generic.List[string]',
  'foreach ($line in ([Console]::In.ReadToEnd() -split "`n")) {',
  '  $line = $line.Trim(); if (-not $line) { continue }',
  '  try {',
  '    $bytes = [Convert]::FromBase64String($line.Substring(2))',
  '    if ($line[0] -eq "P") { $r = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope) }',
  '    else { $r = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope) }',
  '    $out.Add([Convert]::ToBase64String($r))',
  '  } catch { $out.Add("") }',
  '}',
  '[Console]::Out.Write(($out -join "`n"))',
].join('\n');

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')];
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');
const answers = (out: string, n: number) => {
  const lines = out.split(/\r?\n/);
  return Array.from({ length: n }, (_, i) => lines[i]?.trim() ?? '');
};

/** Windows DPAPI (current user), through powershell.exe. */
export function dpapiCipher(powershell = 'powershell.exe'): Cipher {
  return {
    scheme: 'dpapi',
    protect(values) {
      if (!values.length) return Promise.resolve([]);
      return new Promise((resolve, reject) => {
        const child = execFile(powershell, PS_ARGS, { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
          if (err) return reject(new Error('Windows DPAPI (PowerShell) could not encrypt the value'));
          const out = answers(String(stdout), values.length);
          if (out.some((x) => !x)) return reject(new Error('Windows DPAPI refused to encrypt the value'));
          resolve(out);
        });
        child.stdin?.end(values.map((v) => `P ${b64(v)}`).join('\n'));
      });
    },
    unprotectSync(values) {
      if (!values.length) return [];
      try {
        const out = execFileSync(powershell, PS_ARGS, { input: values.map((v) => `U ${v}`).join('\n'), windowsHide: true, timeout: 30_000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        return answers(out, values.length).map((x) => (x ? unb64(x) : undefined));
      } catch {
        return values.map(() => undefined);
      }
    },
  };
}

/** No DPAPI here: base64 in a file only the office's user may read. */
export const fileCipher: Cipher = {
  scheme: 'file',
  protect: (values) => Promise.resolve(values.map(b64)),
  unprotectSync: (values) => values.map((v) => (v ? unb64(v) : undefined)),
};

export const defaultCipher = (): Cipher => (process.platform === 'win32' ? dpapiCipher() : fileCipher);

export interface VaultEntry {
  scheme: Scheme;
  data: string;
  tail: string;
  savedAt: number;
  savedBy: string;
}

interface VaultFile {
  version: 1;
  entries: Partial<Record<CredentialId, VaultEntry>>;
  /** The last Test of each credential, with a short one-way fingerprint of the value it tested (so a new value isn't shown as tested). */
  checks: Partial<Record<CredentialId, CredentialCheck & { fp: string }>>;
}

/** The saved credentials: read and decrypted once at start (`load`), kept in memory, written through on every change. */
export class Vault {
  private data: VaultFile = { version: 1, entries: {}, checks: {} };
  private plain = new Map<CredentialId, string>();
  /** Saved values that wouldn't decrypt (another Windows user's, another machine's). */
  private unreadable = new Set<CredentialId>();

  constructor(
    readonly file: string,
    readonly cipher: Cipher = defaultCipher(),
  ) {}

  get scheme(): Scheme {
    return this.cipher.scheme;
  }

  load(): this {
    let raw: Partial<VaultFile> = {};
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      // none yet
    }
    const entries: VaultFile['entries'] = {};
    for (const [id, e] of Object.entries(raw.entries ?? {})) {
      if (isCredentialId(id) && e && typeof e.data === 'string' && (e.scheme === 'dpapi' || e.scheme === 'file')) entries[id] = { scheme: e.scheme, data: e.data, tail: String(e.tail ?? ''), savedAt: Number(e.savedAt) || 0, savedBy: String(e.savedBy ?? 'someone') };
    }
    const checks: VaultFile['checks'] = {};
    for (const [id, c] of Object.entries(raw.checks ?? {})) if (isCredentialId(id) && c && typeof c.at === 'number') checks[id] = c;
    this.data = { version: 1, entries, checks };
    this.plain.clear();
    this.unreadable.clear();
    const ids = Object.keys(entries) as CredentialId[];
    // A file written with DPAPI is only read with DPAPI (and the other way round).
    const mine = ids.filter((id) => entries[id]!.scheme === this.cipher.scheme);
    const values = this.cipher.unprotectSync(mine.map((id) => entries[id]!.data));
    mine.forEach((id, i) => (values[i] ? this.plain.set(id, values[i]!) : this.unreadable.add(id)));
    for (const id of ids) if (!mine.includes(id)) this.unreadable.add(id);
    return this;
  }

  get(id: CredentialId): string | undefined {
    return this.plain.get(id);
  }

  entry(id: CredentialId): (Omit<VaultEntry, 'data'> & { unreadable: boolean }) | undefined {
    const e = this.data.entries[id];
    if (!e) return undefined;
    const { data: _data, ...meta } = e;
    return { ...meta, unreadable: this.unreadable.has(id) };
  }

  /** Encrypts and saves a value (replacing what was there). */
  async set(id: CredentialId, value: string, by: string): Promise<void> {
    const v = value.trim();
    if (!v) throw new Error('Nothing to save');
    const [data] = await this.cipher.protect([v]);
    this.data.entries[id] = { scheme: this.cipher.scheme, data, tail: maskTail(v), savedAt: Date.now(), savedBy: by };
    this.plain.set(id, v);
    this.unreadable.delete(id);
    this.save();
  }

  remove(id: CredentialId): boolean {
    const had = !!this.data.entries[id];
    delete this.data.entries[id];
    this.plain.delete(id);
    this.unreadable.delete(id);
    if (had) this.save();
    return had;
  }

  /** The last Test of `value` (the one in use now), if it was tested. */
  check(id: CredentialId, value: string): CredentialCheck | undefined {
    const c = this.data.checks[id];
    if (!c || c.fp !== fingerprint(value)) return undefined;
    const { fp: _fp, ...check } = c;
    return check;
  }

  setCheck(id: CredentialId, value: string, check: CredentialCheck) {
    this.data.checks[id] = { ...check, fp: fingerprint(value) };
    this.save();
  }

  private save() {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
    try {
      chmodSync(this.file, 0o600);
    } catch {
      // Windows: the data folder's ACL is what guards it; DPAPI is what keeps it secret
    }
  }
}
