// A neutral toolkit project for the readiness check's screenshots (scripts/expert-ready-shots.mjs): "Order Desk",
// a git folder with an MPR v2 model (tests/support/mendix.ts: two app modules' worth of units, demo users on), the
// toolkit's skills, subagents and project scripts, journeys and e2e scripts but no microflow tests, a lint
// baseline and a GitHub-style origin (never contacted).
//
//   node --import tsx scripts/expert-ready-fixture.ts --dir <test office folder>/projects/order-desk
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { project, type MadeUnit } from '../tests/support/mendix.js';

const dir = path.resolve(process.argv[process.argv.indexOf('--dir') + 1] ?? '');
if (!/test-office/i.test(dir)) throw new Error(`refused: ${dir} is not under a test-office folder`);
const put = (rel: string, text: string) => {
  const f = path.join(dir, ...rel.split('/'));
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
};

const units: MadeUnit[] = [
  { n: 1, container: 1, hash: 'h1', doc: { $Type: 'Projects$Project', Name: 'OrderDesk' } },
  { n: 2, container: 1, hash: 'h2', doc: { $Type: 'Projects$ModuleImpl', Name: 'Orders' } },
  { n: 3, container: 1, hash: 'h3', doc: { $Type: 'Projects$ModuleImpl', Name: 'Customers' } },
  { n: 4, container: 1, hash: 'h4', doc: { $Type: 'Projects$ModuleImpl', Name: 'Helpers', FromAppStore: true } },
  { n: 5, container: 2, hash: 'h5', doc: { $Type: 'DomainModels$DomainModel', Name: '', Entities: [{ Name: 'Order' }, { Name: 'OrderLine' }, { Name: 'Shipment' }] } },
  { n: 6, container: 3, hash: 'h6', doc: { $Type: 'DomainModels$DomainModel', Name: '', Entities: [{ Name: 'Customer' }, { Name: 'Address' }] } },
  ...['ACT_Order_Save', 'ACT_Order_Ship', 'ACT_Order_Cancel', 'SUB_Order_Total', 'ACT_Customer_Save'].map((name, i) => ({ n: 10 + i, container: i < 4 ? 2 : 3, hash: `m${i}`, doc: { $Type: 'Microflows$Microflow', Name: name } })),
  ...['Order_Overview', 'Order_NewEdit', 'Customer_Overview'].map((name, i) => ({ n: 20 + i, container: i < 2 ? 2 : 3, hash: `p${i}`, doc: { $Type: 'Forms$Page', Name: name } })),
  { n: 30, container: 4, hash: 'h30', doc: { $Type: 'Microflows$Microflow', Name: 'Helper_Log' } },
  { n: 40, container: 1, hash: 'h40', doc: { $Type: 'Security$ProjectSecurity', EnableDemoUsers: true, DemoUsers: [{ UserName: 'demo_clerk' }, { UserName: 'demo_planner' }, { UserName: 'demo_manager' }] } },
];

mkdirSync(dir, { recursive: true });
await project(dir, units);
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(path.join(dir, 'App.mpr'));
db.exec('CREATE TABLE _MetaData (_ProductVersion TEXT)');
db.prepare('INSERT INTO _MetaData VALUES (?)').run('11.12.4');
db.close();
for (const s of ['mdl', 'pages', 'security', 'tests', 'journeys', 'deploy']) put(`.claude/skills/${s}/SKILL.md`, `# ${s}\n`);
for (const a of ['mdl-agent', 'tester']) put(`.claude/agents/${a}.md`, `# ${a}\n`);
for (const b of ['_common.sh', 'affected-tests.sh', 'exec.sh', 'lint-gate.sh']) put(`bin/${b}`, '#!/bin/sh\n');
put('PROJECT.md', '# Order Desk\n\nToolkit commit: 3f2a9c1\n');
put('CLAUDE.md', '# Order Desk\n\nA neutral example app for the office\'s screenshots.\n');
for (const j of ['J01-new-order', 'J02-ship-order', 'J03-cancel-order']) put(`journeys/${j}.journey.json`, '{}\n');
for (const e of ['new-order', 'ship-order']) put(`tests/e2e/${e}.js`, '// e2e\n');
put('.claude/lint-baseline.json', `${JSON.stringify({ counts: { CONV010: 6, MPR001: 4, ARCH003: 2 }, total: 12, findings: {} }, null, 2)}\n`);
put('mxcli.exe', '');
const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
git('init', '-q', '-b', 'main');
git('add', '-A');
git('commit', '-q', '-m', 'Order Desk: order list and shipping');
git('remote', 'add', 'origin', 'https://github.com/example/order-desk.git');
console.log(dir);
