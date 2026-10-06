import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { floorToolkitEnv, parseToolkitEnv, withFloorToolkitEnv } from '../src/server/toolkit-env.js';
import { childEnv } from '../src/server/workers/env.js';

const MX12 = 'C:\\Program Files\\Mendix\\11.12.4\\modeler\\mxbuild.exe';
const MX10 = 'C:\\Program Files\\Mendix\\10.24.15.93102\\modeler\\mxbuild.exe';

function floorWith(text?: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'toolkit-env-'));
  if (text !== undefined) {
    mkdirSync(path.join(dir, '.claude'), { recursive: true });
    writeFileSync(path.join(dir, '.claude', 'toolkit.env'), text);
  }
  return dir;
}

test("toolkit.env is read as the toolkit's _common.sh reads it", () => {
  const env = parseToolkitEnv(
    [
      '# Per-project toolkit settings',
      '',
      `MXBUILD_PATH=${MX12}`,
      'MXCLI_VERSION = nightly ',
      'export PYTHON="C:\\Python\\python.exe"',
      "JAVA_HOME='/usr/lib/jvm/21'",
      'EMPTY=',
      'not a setting',
      '1BAD=x',
      'BAD-KEY=x',
      'PATH=/evil',
      'Path=/evil',
      'AGENT_OFFICE_DATA=/elsewhere',
      'MENDIX_APP=C:\\a=b',
    ].join('\r\n'),
  );
  assert.deepEqual(env, {
    MXBUILD_PATH: MX12,
    MXCLI_VERSION: 'nightly',
    PYTHON: 'C:\\Python\\python.exe',
    JAVA_HOME: '/usr/lib/jvm/21',
    MENDIX_APP: 'C:\\a=b',
  });
});

test("a floor's toolkit.env wins over the environment the office inherited; without one the environment stays", () => {
  const dir = floorWith(`MXBUILD_PATH=${MX12}\nMXCLI_VERSION=nightly\n`);
  const none = floorWith();
  try {
    assert.deepEqual(floorToolkitEnv(dir), { MXBUILD_PATH: MX12, MXCLI_VERSION: 'nightly' });
    const inherited = { MXBUILD_PATH: MX10, HOME: '/home/office', PATH: '/bin' };
    const env = withFloorToolkitEnv(dir, inherited, false);
    assert.deepEqual(env, { MXBUILD_PATH: MX12, HOME: '/home/office', PATH: '/bin', MXCLI_VERSION: 'nightly' });
    assert.equal(inherited.MXBUILD_PATH, MX10, 'the environment passed in is left as it was');

    assert.deepEqual(floorToolkitEnv(none), {});
    assert.deepEqual(withFloorToolkitEnv(none, inherited, false), inherited);
    assert.deepEqual(floorToolkitEnv(path.join(none, 'gone')), {}, 'no floor folder at all');

    // Windows: one spelling of a variable, the file's, so the child can't get the inherited one instead.
    const win = withFloorToolkitEnv(dir, { Mxbuild_Path: MX10, Path: 'C:\\bin' }, true);
    assert.deepEqual(win, { Path: 'C:\\bin', MXBUILD_PATH: MX12, MXCLI_VERSION: 'nightly' });
    // Off Windows, case is part of the name: both stay.
    assert.equal(withFloorToolkitEnv(dir, { Mxbuild_Path: MX10 }, false).Mxbuild_Path, MX10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(none, { recursive: true, force: true });
  }
});

test("a worker's environment for a floor carries that floor's toolkit.env", () => {
  const dir = floorWith(`MXBUILD_PATH=${MX12}\n`);
  const had = process.env.MXBUILD_PATH;
  process.env.MXBUILD_PATH = MX10;
  try {
    assert.equal(childEnv().MXBUILD_PATH, MX10, 'not for a floor: the office environment as it is');
    const env = childEnv(dir);
    assert.equal(env.MXBUILD_PATH, MX12);
    assert.equal(Object.keys(env).filter((k) => k.toUpperCase() === 'MXBUILD_PATH').length, 1);
    assert.equal(childEnv(floorWith()).MXBUILD_PATH, MX10, 'a floor without toolkit.env keeps the inherited one');
  } finally {
    if (had === undefined) delete process.env.MXBUILD_PATH;
    else process.env.MXBUILD_PATH = had;
    rmSync(dir, { recursive: true, force: true });
  }
});
