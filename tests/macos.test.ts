// macOS support (preview): the darwin branches, run on any platform against stand-ins for the Mac's
// folders and programs (nothing here needs a Mac, and nothing is installed or started). Studio Pro's app
// bundles in /Applications (studio/mac.ts), opening a project and seeing it open, the bundled mxbuild the
// live app builds with, psql from Postgres.app or Homebrew, Homebrew's folders on PATH, the wizard's
// Studio Pro versions, the prerequisite rows and Homebrew fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { macBundles, macLauncherFor, parsePsStudio, baseVersion } from '../src/server/studio/mac.js';
import { checkStudio, machineProblem, type StudioDeps } from '../src/server/studio/open.js';
import { namesProject, sightFloor } from '../src/server/studio/detect.js';
import { pickMxbuild, linuxMxbuildIn, linuxMxbuildMessage, type MxbuildDeps } from '../src/server/liveapp/mxbuild.js';
import { macPgBinDir, POSTGRES_APP_BIN } from '../src/server/liveapp/pg-mac.js';
import { withMacPath } from '../src/server/macpath.js';
import { mendixVersions } from '../src/server/wizard/config.js';
import { prereqIdsFor } from '../src/server/first-run/checks.js';
import { planFix, runFixes, brewArgs, type FixDeps } from '../src/server/first-run/fixes.js';
import { fakeFixDeps, scriptedChild } from '../src/server/first-run/fix-fake.js';
import type { FixEvent, FixStep } from '../src/shared/first-run-fix.js';

const APPS = '/Applications';
const bundle = (name: string) => `${APPS}/${name}`;
const MPR = '/Users/pat/mx-office/shop app/Shop App.mpr';

/** A Mac with `files` (and every folder above them). */
function mac(files: string[]) {
  const set = new Set<string>();
  for (const f of files) {
    let p = f;
    while (p && p !== '/') {
      set.add(p);
      p = path.posix.dirname(p);
    }
  }
  return {
    exists: (p: string) => set.has(p),
    readdir: (p: string) => {
      const kids = [...new Set([...set].filter((f) => path.posix.dirname(f) === p).map((f) => path.posix.basename(f)))];
      if (!kids.length) throw new Error('ENOENT');
      return kids;
    },
  };
}

const INSTALLED = [
  bundle('Mendix Studio Pro 11.12.4.app/Contents/modeler/mxbuild'),
  bundle('Mendix Studio Pro 11.12.4.app/Contents/modeler/mx'),
  bundle('Mendix Studio Pro 11.6.4.app/Contents/modeler/mxbuild'),
  bundle('Mendix Studio Pro 11.13.0-rc.2 Beta.app/Contents/MacOS/studiopro'),
  bundle('Safari.app/Contents/MacOS/Safari'),
];

test('Studio Pro bundles: named by their X.Y.Z, newest first, other apps left out', () => {
  const m = mac(INSTALLED);
  assert.deepEqual(macBundles(APPS, m).map((b) => b.version), ['11.13.0', '11.12.4', '11.6.4']);
  assert.deepEqual(macBundles(APPS, m, 'mxbuild').map((b) => b.version), ['11.12.4', '11.6.4'], 'a bundle without mxbuild has none to give');
  assert.equal(macBundles(APPS, m)[1].modeler, bundle('Mendix Studio Pro 11.12.4.app/Contents/modeler'));
  assert.deepEqual(macBundles('/nowhere', m), []);
  assert.equal(baseVersion('11.12.4.81234'), '11.12.4');
});

test('opening a project on a Mac: open -n -a on the bundle of its version, the .mpr as its argument', () => {
  const m = { env: {}, ...mac(INSTALLED) };
  assert.deepEqual(macLauncherFor(MPR, '11.12.4', m), { via: 'studiopro', cmd: '/usr/bin/open', args: ['-n', '-a', bundle('Mendix Studio Pro 11.12.4.app'), '--args', MPR] });
  assert.ok('cmd' in macLauncherFor(MPR, '11.12.4.80000', m), 'a build number after X.Y.Z still matches');
  const newest = macLauncherFor(MPR, undefined, m);
  assert.ok('args' in newest && newest.args[2] === bundle('Mendix Studio Pro 11.13.0-rc.2 Beta.app'), 'no version: the newest');
  const other = macLauncherFor(MPR, '10.24.0', m);
  assert.ok('problem' in other && /Studio Pro 10\.24\.0 isn't installed on the office's Mac \(it has 11\.13\.0, 11\.12\.4, 11\.6\.4\)/.test(other.error));
  const none = macLauncherFor(MPR, '11.12.4', { env: {}, ...mac([]) });
  assert.ok('problem' in none && /no "Mendix Studio Pro <version>\.app" in \/Applications/.test(none.error));
  // AGENT_OFFICE_MENDIX_DIR points somewhere else.
  const elsewhere = macLauncherFor(MPR, '11.12.4', { env: { AGENT_OFFICE_MENDIX_DIR: '/Volumes/Tools' }, ...mac(['/Volumes/Tools/Mendix Studio Pro 11.12.4.app/Contents/MacOS/studiopro']) });
  assert.ok('args' in elsewhere && elsewhere.args[2] === '/Volumes/Tools/Mendix Studio Pro 11.12.4.app');
});

test('checkStudio and machineProblem on darwin: the bundle launcher, not "Windows only"', () => {
  const d = (files: string[], env: NodeJS.ProcessEnv = {}): StudioDeps => ({
    platform: 'darwin',
    env,
    ...mac(files),
    findMpr: () => MPR,
    readVersion: () => '11.12.4',
    spawn: () => ({ on: () => undefined, unref: () => undefined }),
  });
  const ok = checkStudio('/Users/pat/mx-office/shop app', d(INSTALLED));
  assert.equal(ok.problem, undefined);
  assert.equal(ok.launcher?.cmd, '/usr/bin/open');
  assert.equal(machineProblem(d(INSTALLED)), undefined);
  assert.equal(machineProblem(d([]))?.problem, 'not-installed');
  assert.equal(checkStudio('/x', d(INSTALLED, { SSH_CONNECTION: '1 2 3 4' })).problem, 'no-desktop');
});

test('seeing Studio Pro run on a Mac: ps lines out of a Studio Pro bundle, helpers left out, matched to the project', () => {
  const ps = [
    '  101 /Applications/Mendix Studio Pro 11.12.4.app/Contents/MacOS/studiopro /Users/pat/mx-office/shop app/Shop App.mpr',
    '  102 /Applications/Mendix Studio Pro 11.12.4.app/Contents/Frameworks/Web Helper.app/Contents/MacOS/Web Helper --type=renderer',
    '  103 /Applications/Safari.app/Contents/MacOS/Safari',
    '  104 /Applications/Mendix Studio Pro 11.6.4.app/Contents/MacOS/studiopro',
  ].join('\n');
  const procs = parsePsStudio(ps);
  assert.deepEqual(procs.map((p) => p.pid), [101, 104]);
  assert.ok(namesProject(procs[0].cmd, MPR), 'the .mpr, spaces and all');
  assert.ok(!namesProject(procs[1].cmd, MPR));
  assert.ok(namesProject('/Applications/Mendix Studio Pro 11.12.4.app/Contents/MacOS/studiopro /Users/pat/mx-office/shop app', MPR), 'the folder');
  assert.ok(!namesProject('/Applications/Mendix Studio Pro 11.12.4.app/Contents/MacOS/studiopro', '/Applications/x/App.mpr'), 'the program’s own folder is not a project argument');
  assert.deepEqual(sightFloor(MPR, undefined, procs), { open: true, pid: 101, via: 'process', staleLock: false });
});

test('the live app’s mxbuild on a Mac: the bundle of the project’s version, else where it would be', () => {
  const m = mac(INSTALLED);
  const d = (over: Partial<MxbuildDeps> = {}): MxbuildDeps => ({ platform: 'darwin', env: {}, isFile: m.exists, isDir: () => false, readdir: m.readdir, readVersion: () => '11.12.4', ...over });
  assert.deepEqual(pickMxbuild('App.mpr', {}, d()), { path: bundle('Mendix Studio Pro 11.12.4.app/Contents/modeler/mxbuild'), source: 'studio-pro', version: '11.12.4', skipped: [] });
  const missing = pickMxbuild('App.mpr', {}, d({ readVersion: () => '11.9.0' }));
  assert.deepEqual(missing, { version: '11.9.0', expected: bundle('Mendix Studio Pro 11.9.0.app/Contents/modeler/mxbuild'), skipped: [] });
  // toolkit.env's MXBUILD_PATH still wins.
  assert.equal(pickMxbuild('App.mpr', { MXBUILD_PATH: bundle('Mendix Studio Pro 11.6.4.app/Contents/modeler/mxbuild') }, d()).source, 'toolkit.env');
  // mxcli's error on a Mac, and the words for it.
  const found = linuxMxbuildIn(['mxbuild at /Users/pat/.mxcli/mxbuild/11.12.4/modeler/mxbuild is a linux binary and cannot run on darwin']);
  assert.deepEqual(found, { mxbuild: '/Users/pat/.mxcli/mxbuild/11.12.4/modeler/mxbuild' });
  const msg = linuxMxbuildMessage(found!, missing, undefined, 'mxcli', 'darwin');
  assert.match(msg, /can't run on macOS/);
  assert.match(msg, /Contents\/modeler\/mxbuild inside the Studio Pro app/);
});

test('psql on a Mac: Postgres.app first, then Homebrew’s newest postgresql@<n>', () => {
  assert.equal(macPgBinDir(mac([`${POSTGRES_APP_BIN}/psql`, '/opt/homebrew/opt/postgresql@17/bin/psql'])), POSTGRES_APP_BIN);
  assert.equal(macPgBinDir(mac(['/opt/homebrew/opt/postgresql@14/bin/psql', '/opt/homebrew/opt/postgresql@17/bin/psql', '/opt/homebrew/opt/python@3/bin/python3'])), '/opt/homebrew/opt/postgresql@17/bin');
  assert.equal(macPgBinDir(mac(['/usr/local/opt/postgresql@16/bin/psql'])), '/usr/local/opt/postgresql@16/bin');
  assert.equal(macPgBinDir(mac([])), undefined);
});

test('Homebrew’s folders go at the end of PATH on a Mac (only those that exist, never twice); elsewhere nothing changes', () => {
  const exists = (p: string) => ['/opt/homebrew/bin', '/Users/pat/.local/bin', '/usr/local/bin'].includes(p);
  const env = { PATH: '/usr/bin:/bin:/usr/local/bin' };
  withMacPath(env, 'darwin', exists, '/Users/pat');
  assert.equal(env.PATH, '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:/Users/pat/.local/bin');
  withMacPath(env, 'darwin', exists, '/Users/pat');
  assert.equal(env.PATH, '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:/Users/pat/.local/bin', 'twice changes nothing');
  const win = { PATH: 'C:\\x' };
  withMacPath(win, 'win32', () => true, 'C:\\Users\\pat');
  assert.equal(win.PATH, 'C:\\x');
});

test('the wizard’s Studio Pro versions on a Mac: the bundles in /Applications (real folders here)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mac-apps-'));
  for (const v of ['11.12.4', '11.6.4']) {
    mkdirSync(path.join(dir, `Mendix Studio Pro ${v}.app`, 'Contents', 'modeler'), { recursive: true });
    writeFileSync(path.join(dir, `Mendix Studio Pro ${v}.app`, 'Contents', 'modeler', 'mxbuild'), '');
  }
  mkdirSync(path.join(dir, 'Mendix Studio Pro 11.13.0.app', 'Contents'), { recursive: true });
  assert.deepEqual(mendixVersions(dir, 'darwin'), ['11.12.4', '11.6.4']);
  assert.deepEqual(mendixVersions(dir, 'win32'), [], 'Windows looks only for version folders, as before');
});

test('the prerequisite rows on a Mac: no Git Bash or Windows long paths, but jq', () => {
  const ids = prereqIdsFor('darwin');
  assert.ok(ids.includes('jq'));
  assert.ok(!ids.includes('gitbash') && !ids.includes('longpaths'));
  assert.ok(!prereqIdsFor('linux').includes('jq'), 'Linux as before');
  assert.ok(prereqIdsFor('win32').includes('gitbash'));
});

test('Fix on a Mac installs with Homebrew (after the confirm), or says to get Homebrew first', async () => {
  const base = fakeFixDeps({ checks: {} });
  const started: string[] = [];
  const envs: (NodeJS.ProcessEnv | undefined)[] = [];
  const d: FixDeps = {
    ...base,
    platform: 'darwin',
    arch: 'arm64',
    find: async (c) => (c === 'brew' ? '/opt/homebrew/bin/brew' : undefined),
    spawn: (file, args, env) => (started.push(`${path.posix.basename(file)} ${args.join(' ')}`), envs.push(env), scriptedChild(['==> Pouring jq'], 0, 1)),
    refreshPath: async () => ['/opt/homebrew/bin'],
  };
  assert.deepEqual(brewArgs('node'), ['install', 'node']);
  const plan = await planFix('jq', d);
  assert.ok('sources' in plan);
  assert.deepEqual((plan as FixStep).commands, ['brew install jq']);
  assert.equal(plan.title, 'Install jq');
  const git = await planFix('git', d);
  assert.equal(git.title, 'Install Git', 'not “Git for Windows”');
  const events: FixEvent[] = [];
  const r = await runFixes([plan as FixStep], d, (e) => events.push(e), new AbortController().signal);
  assert.equal(r.error, undefined);
  assert.deepEqual(started, ['brew install jq']);
  assert.equal(envs[0]?.NONINTERACTIVE, '1');
  const noBrew = await planFix('gh', { ...d, find: async () => undefined });
  assert.ok('links' in noBrew && noBrew.links.includes('https://brew.sh') && noBrew.commands.includes('brew install gh'));
});

test('the desktop app on a Mac takes the login shell’s PATH (between markers, whatever the rc files print), then Homebrew’s folders', async () => {
  const { appPath, parseShellPath, loginShellPath, mergePath } = await import('../desktop/src/core/mac.ts');
  assert.equal(parseShellPath('Welcome!\n__MXO_PATH__/opt/homebrew/bin:/usr/bin__MXO_END__'), '/opt/homebrew/bin:/usr/bin');
  assert.equal(parseShellPath('nothing here'), undefined);
  assert.equal(loginShellPath('/bin/zsh', () => { throw new Error('timed out'); }), undefined);
  let asked: string[] = [];
  assert.equal(loginShellPath(undefined, (f, a) => ((asked = [f, ...a]), '__MXO_PATH__/a:/b__MXO_END__')), '/a:/b');
  assert.equal(asked[0], '/bin/zsh');
  assert.equal(mergePath('/usr/bin:/bin', ['/bin', '/x']), '/usr/bin:/bin:/x');
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: '/bin/zsh' };
  assert.equal(appPath(env, 'darwin', '/Users/pat', { shellPath: () => '/Users/pat/.nvm/versions/node/v22.12.0/bin:/usr/bin', exists: (p) => p === '/opt/homebrew/bin' }), '/usr/bin:/bin:/usr/sbin:/sbin:/Users/pat/.nvm/versions/node/v22.12.0/bin:/opt/homebrew/bin');
  assert.equal(appPath(env, 'darwin', '/Users/pat', { shellPath: () => undefined, exists: () => false }), env.PATH, 'no shell, no Homebrew: as it was');
  assert.equal(appPath({ PATH: 'C:\\x' }, 'win32', 'C:\\Users\\pat', { shellPath: () => '/nope' }), 'C:\\x', 'Windows: untouched, no shell asked');
});
