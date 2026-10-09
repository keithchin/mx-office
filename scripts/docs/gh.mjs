#!/usr/bin/env node
// The docs screenshots' stand-in for the GitHub CLI (scripts/docs-shots.mjs), for their test office only:
// nothing leaves the machine. It answers the board's lists from the demo's <FAKE_GH_DIR>/<project>.json
// (scripts/docs/demo.ts), picking the project by the folder gh runs in, and says yes to everything else.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.FAKE_GH_DIR ?? '';
const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const project = path.basename(process.cwd().split(/[\/]\.agent-office[\/]/)[0]).replace(/^ao-.*?-/, '');
let data = { issues: [], pulls: [] };
try {
  data = JSON.parse(fs.readFileSync(path.join(dir, `${project}.json`), 'utf8'));
} catch {
  // a folder that isn't one of the demo's projects: empty lists
}
const out = (v) => process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v));
const pick = (o, fields) => (fields ? Object.fromEntries(fields.split(',').map((f) => [f, o[f] ?? null])) : o);
const wanted = (s, st) => st === 'ALL' || s === st;
const [a, b] = args;
const state = (flag('state') ?? 'open').toUpperCase();
if (a === 'pr' && b === 'list') out(data.pulls.filter((p) => wanted(p.state, state) && (!flag('head') || p.headRefName === flag('head'))).map((p) => pick(p, flag('json'))));
else if (a === 'issue' && b === 'list') out(data.issues.filter((i) => wanted(i.state, state)).map((i) => pick(i, flag('json'))));
else if ((a === 'pr' || a === 'issue') && b === 'view') {
  const n = String(args[2] ?? '').replace('#', '');
  const x = (a === 'pr' ? data.pulls : data.issues).find((v) => String(v.number) === n);
  if (!x) process.exit(1);
  out(flag('jq') === '.body' ? (x.body ?? '') : pick(x, flag('json')));
} else if (a === 'repo' && b === 'view') out(pick({ nameWithOwner: `example-co/${project}`, isEmpty: false, squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true, description: '' }, flag('json')));
else if (a === 'api') out(flag('jq') ? '' : /labels|comments/.test(args.join(' ')) ? [] : {});
else out('');
