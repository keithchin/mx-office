// The macOS login Keychain as 🔌 Connections' store (vault.ts picks it on macOS). Each saved value is a
// generic password item of its own: service `com.mxoffice.connections`, account `<office>/<credential>`
// (<office> is 12 hex characters of the vault file's path, so two offices on one Mac never share an
// item), its password data the value base64'd (plain ASCII, so `find-generic-password -w` hands it back
// exactly). credentials.json keeps only the account name, the masked tail and who saved it.
//
// Everything goes through Apple's own /usr/bin/security, never a native module. The value never goes
// on a command line, where any process of any user could read it with `ps`: `security -w <value>`
// would put it there, and `-w` last with no value prompts on a terminal the office doesn't have. So the
// office starts `security -i` (its interactive mode, which reads commands from stdin) and writes one
// line to its stdin: `add-generic-password -U -s <service> -a <account> -X <hex>`, the value as hex
// (`-X`: "password data to be added as a hexadecimal string", so nothing in it needs quoting). Then it
// reads the item back to check it was really saved (interactive mode doesn't fail with an exit code). The
// read is `find-generic-password -s <service> -a <account> -w`, its answer on stdout, which only the
// office reads. Items made by /usr/bin/security are readable again by /usr/bin/security without a
// Keychain prompt (the item's access list names the program that created it).
//
// A Keychain that can't be used (locked, an SSH session with no GUI login, a CI runner with no login
// keychain) makes `protect` fail: the vault then keeps that value in its 0600 file instead (the file
// cipher, `fallback`) and the page says so for that credential.

import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Cipher } from './vault.js';

export const KEYCHAIN_SERVICE = 'com.mxoffice.connections';
export const SECURITY_BIN = '/usr/bin/security';

/** How `security` is started: the program, and arguments that go before every call (a test's `node fake.mjs`). */
export interface SecurityCommand {
  file: string;
  prefix?: string[];
}

/** An account name the office makes: letters, digits, '.', '_', '-' and one '/'; nothing that needs quoting in `security -i`. */
export const safeAccount = (a: string) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(a);

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');
const hex = (s: string) => Buffer.from(s, 'ascii').toString('hex');

/** The one stdin line that saves `value` under `account` (exported for the tests: it's never logged). */
export const addLine = (account: string, value: string, service = KEYCHAIN_SERVICE) => `add-generic-password -U -s ${service} -a ${account} -X ${hex(b64(value))}\n`;

/** Whether the Keychain can be used here at all: macOS, with Apple's security program. */
export const keychainAvailable = (platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync) => platform === 'darwin' && exists(SECURITY_BIN);

/** The login Keychain, through `security` (Apple's by default). `fallback` keeps a value it can't. */
export function keychainCipher(o: { cmd?: SecurityCommand; service?: string; fallback?: Cipher; timeoutMs?: number } = {}): Cipher {
  const cmd = o.cmd ?? { file: SECURITY_BIN };
  const service = o.service ?? KEYCHAIN_SERVICE;
  const timeout = o.timeoutMs ?? 15_000;
  const argv = (args: string[]) => [...(cmd.prefix ?? []), ...args];

  const runAsync = (args: string[], input?: string) =>
    new Promise<{ ok: boolean; out: string }>((resolve) => {
      const child = execFile(cmd.file, argv(args), { timeout, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout) => resolve({ ok: !err, out: String(stdout ?? '') }));
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(input ?? '');
    });

  const readSync = (account: string): string | undefined => {
    if (!safeAccount(account)) return undefined;
    try {
      const out = execFileSync(cmd.file, argv(['find-generic-password', '-s', service, '-a', account, '-w']), { timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      const data = out.replace(/\r?\n$/, '');
      return data ? unb64(data) : undefined;
    } catch {
      return undefined;
    }
  };

  const readAsync = async (account: string): Promise<string | undefined> => {
    const r = await runAsync(['find-generic-password', '-s', service, '-a', account, '-w']);
    const data = r.out.replace(/\r?\n$/, '');
    return r.ok && data ? unb64(data) : undefined;
  };

  return {
    scheme: 'keychain',
    fallback: o.fallback,
    async protect(values, keys) {
      if (!keys || keys.length !== values.length) throw new Error('The Keychain needs a name for each value');
      for (let i = 0; i < values.length; i++) {
        const account = keys[i];
        if (!safeAccount(account)) throw new Error('Not a name the Keychain store makes');
        await runAsync(['-i'], addLine(account, values[i], service));
        // Interactive mode exits 0 whatever happened inside it: the item read back is the proof.
        if ((await readAsync(account)) !== values[i]) throw new Error('The macOS Keychain didn’t save the value (is it locked?)');
      }
      return [...keys];
    },
    unprotectSync: (values) => values.map((account) => (account ? readSync(account) : undefined)),
    forget(values) {
      for (const account of values) if (safeAccount(account)) void runAsync(['delete-generic-password', '-s', service, '-a', account]);
    },
  };
}
