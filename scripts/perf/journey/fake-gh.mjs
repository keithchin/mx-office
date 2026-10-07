#!/usr/bin/env node
// A stand-in for the GitHub CLI, for the journey's test office only: nothing leaves the machine. The
// office runs `gh` for its board (issues, pull requests), linking a worker's PR and the wizard's checks;
// this answers from files under FAKE_GH_DIR: pulls.json (the pull requests, which the fake agent and
// `gh pr create` add to) and the offline wizard's issue files (<owner>/<name>.issues/<n>.md).
// Started through a tiny gh.exe shim (journey/stubs.mjs), because the office runs gh without a shell.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.FAKE_GH_DIR || path.join(process.cwd(), '.fake-gh');
const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const pullsFile = path.join(dir, 'pulls.json');
const readPulls = () => {
  try {
    return JSON.parse(fs.readFileSync(pullsFile, 'utf8'));
  } catch {
    return [];
  }
};
const now = new Date().toISOString();
const out = (v) => process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v));
const pick = (o, fields) => (fields ? Object.fromEntries(fields.split(',').map((f) => [f, o[f] ?? null])) : o);

function issues() {
  const list = [];
  let owners = [];
  try {
    owners = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return list;
  }
  for (const o of owners)
    for (const r of fs.readdirSync(path.join(dir, o.name), { withFileTypes: true }))
      if (r.isDirectory() && r.name.endsWith('.issues'))
        for (const f of fs.readdirSync(path.join(dir, o.name, r.name)).filter((x) => /^\d+\.md$/.test(x))) {
          const body = fs.readFileSync(path.join(dir, o.name, r.name, f), 'utf8');
          const n = Number(f.replace('.md', ''));
          list.push({ number: n, title: body.split('\n')[0].replace(/^#\s*/, ''), state: 'OPEN', url: `https://github.com/${o.name}/${r.name.replace('.issues', '')}/issues/${n}`, author: { login: 'perf-tester' }, labels: [], assignees: [], createdAt: now, updatedAt: now, body, comments: [] });
        }
  return list;
}

const [a, b] = args;
if (a === 'pr' && b === 'list') {
  const state = (flag('state') ?? 'open').toUpperCase();
  const head = flag('head');
  const list = readPulls().filter((p) => (state === 'ALL' || p.state === state || (state === 'CLOSED' && p.state === 'MERGED')) && (!head || p.headRefName === head));
  out(list.slice(0, Number(flag('limit') ?? 100)).map((p) => pick(p, flag('json'))));
} else if (a === 'pr' && b === 'view') {
  const key = args[2];
  const p = readPulls().find((x) => String(x.number) === String(key).replace('#', '') || x.url === key);
  if (!p) {
    process.stderr.write(`no pull requests found for ${key}\n`);
    process.exit(1);
  }
  if (flag('jq') === '.body') out(p.body ?? '');
  else out(pick(p, flag('json')));
} else if (a === 'pr' && b === 'create') {
  const pulls = readPulls();
  const n = (pulls.at(-1)?.number ?? 0) + 1;
  const url = `https://github.com/test-org/fake/pull/${n}`;
  pulls.push({ number: n, title: flag('title') ?? `PR ${n}`, state: 'OPEN', isDraft: false, url, author: { login: 'perf-tester' }, labels: [], reviewDecision: '', headRefName: flag('head') ?? 'fake', headRefOid: '0'.repeat(40), baseRefName: flag('base') ?? 'main', createdAt: now, updatedAt: now, additions: 1, deletions: 0, statusCheckRollup: [], body: flag('body') ?? '', closingIssuesReferences: [] });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pullsFile, JSON.stringify(pulls, null, 2));
  out(`${url}\n`);
} else if (a === 'issue' && b === 'list') {
  const state = (flag('state') ?? 'open').toUpperCase();
  out(issues().filter((i) => state === 'ALL' || i.state === state).map((i) => pick(i, flag('json'))));
} else if (a === 'issue' && b === 'view') {
  const i = issues().find((x) => String(x.number) === String(args[2]));
  if (!i) process.exit(1);
  out(pick(i, flag('json')));
} else if (a === 'repo' && b === 'view') {
  const name = args[2] && !args[2].startsWith('-') ? args[2] : 'test-org/fake';
  const r = { nameWithOwner: name, isEmpty: false, squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true, description: 'A test office repository' };
  if (flag('jq') === '.description') out(r.description);
  else out(pick(r, flag('json')));
} else if (a === 'api') {
  const what = args.find((x, i) => i > 0 && !x.startsWith('-') && args[i - 1] !== '--method' && args[i - 1] !== '-f' && args[i - 1] !== '-F' && args[i - 1] !== '--jq');
  if (what === 'user') out(flag('jq') ? 'perf-tester\n' : { login: 'perf-tester' });
  else if (flag('jq')) out('');
  else out(/labels|comments|pulls\/\d+\/comments/.test(what ?? '') ? [] : {});
} else if (a === 'pr' && b === 'diff') {
  out('');
} else {
  // auth status, label create, pr edit, issue edit…: fine.
  out('');
}
