#!/usr/bin/env node
// A stand-in for macOS's /usr/bin/security, for tests/keychain.test.ts: the handful of calls the
// office makes, against a JSON file (FAKE_KEYCHAIN). It records every command line it was started with
// in FAKE_KEYCHAIN.argv (one JSON array per line), so a test can check no value ever went on one.
// FAKE_KEYCHAIN_LOCKED=1 behaves like a locked Keychain: adds and reads fail as security's do.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const file = process.env.FAKE_KEYCHAIN;
if (!file) process.exit(2);
const locked = process.env.FAKE_KEYCHAIN_LOCKED === '1';
const args = process.argv.slice(2);
appendFileSync(`${file}.argv`, `${JSON.stringify(args)}\n`);
const db = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const save = () => writeFileSync(file, JSON.stringify(db));
const opt = (a, flag) => {
  const i = a.indexOf(flag);
  return i >= 0 ? a[i + 1] : undefined;
};

function run(a, out) {
  const [cmd, ...rest] = a;
  const key = `${opt(rest, '-s')}|${opt(rest, '-a')}`;
  if (cmd === 'add-generic-password') {
    if (locked) return (process.stderr.write('security: SecKeychainItemCreateFromContent: User interaction is not allowed.\n'), 1);
    if (rest.includes('-w')) return (process.stderr.write('fake security: -w is not used by the office\n'), 2);
    const hex = opt(rest, '-X');
    if (!hex || !/^[0-9a-f]*$/i.test(hex)) return 2;
    if (db[key] !== undefined && !rest.includes('-U')) return 45;
    db[key] = Buffer.from(hex, 'hex').toString('latin1');
    save();
    return 0;
  }
  if (cmd === 'find-generic-password') {
    if (locked || db[key] === undefined) return (process.stderr.write('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n'), 44);
    if (rest.includes('-w')) out.push(`${db[key]}\n`);
    return 0;
  }
  if (cmd === 'delete-generic-password') {
    if (db[key] === undefined) return 44;
    delete db[key];
    save();
    return 0;
  }
  return 1;
}

if (args[0] === '-i') {
  // Interactive mode: a command per stdin line, words split on spaces (the office never needs quotes); exits 0 regardless.
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    const out = [];
    for (const line of input.split('\n')) if (line.trim()) run(line.trim().split(/\s+/), out);
    process.stdout.write(out.join(''));
    process.exit(0);
  });
} else {
  const out = [];
  const code = run(args, out);
  process.stdout.write(out.join(''));
  process.exit(code);
}
