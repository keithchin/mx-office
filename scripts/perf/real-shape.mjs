#!/usr/bin/env node
// A scrubbed copy of a real office's data SHAPES, for the performance guard: the office's .agent-office
// and each floor's, read only, written under a test office's folder with every piece of free text
// replaced by filler of the same length, people's and workers' names by stand-ins, floor ids, the
// GitHub org and the user's paths renamed, and tokens replaced. The floors' repositories are NOT
// copied: each floor gets a small git repository with the same number of files, and each worker's
// worktree is made again from it on the same branch. No GitHub remote, so nothing reaches GitHub.
//
//   node scripts/perf/real-shape.mjs --office <real office dir> --out <test office dir under scratch/test-offices>
//
// Then: node scripts/perf/run.mjs --suite pages --from <out>/office --root <test-offices dir> --out <dir> --id <id>
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertTestDir, removeTestDir } from './office.mjs';

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const realOffice = path.resolve(arg('office') ?? '');
const out = path.resolve(arg('out') ?? '');
assertTestDir(out, 'the copy');
const realData = path.join(realOffice, '.agent-office');
if (!fs.existsSync(path.join(realData, 'floors.json'))) throw new Error(`no ${realData}/floors.json`);
if (path.resolve(out).toLowerCase().startsWith(realOffice.toLowerCase())) throw new Error('refused: the copy would be inside the real office');
if (fs.existsSync(out)) removeTestDir(out);

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const floors = readJson(path.join(realData, 'floors.json'));

// ---- What gets renamed --------------------------------------------------------------------------
const rename = new Map();
floors.forEach((f, i) => {
  const id = `real-${String.fromCharCode(97 + i)}`;
  rename.set(f.id, id);
  if (f.name && f.name !== f.id) rename.set(f.name, id);
  const org = f.repo?.split('/')[0];
  if (org) rename.set(org, 'test-org');
});
const names = new Set();
const people = new Set();
const noteName = (n, set = names) => typeof n === 'string' && n.trim() && n.length < 40 && set.add(n.trim().replace(/ 🐚$/, ''));
for (const f of floors) {
  const wf = path.join(f.dir, '.agent-office', 'workers.json');
  if (fs.existsSync(wf)) for (const w of readJson(wf)) noteName(w.name), noteName(w.createdBy, people);
  const rf = path.join(realData, 'roster', `${f.id}.json`);
  if (fs.existsSync(rf)) for (const m of Object.values(readJson(rf).members ?? {})) noteName(m?.name);
}
for (const file of fs.existsSync(path.join(realData, 'audit')) ? fs.readdirSync(path.join(realData, 'audit')).filter((x) => x.endsWith('.jsonl')) : []) {
  for (const l of fs.readFileSync(path.join(realData, 'audit', file), 'utf8').split('\n')) {
    try {
      const e = JSON.parse(l);
      if (e.actor?.kind === 'human') noteName(e.actor.name, people);
    } catch {
      // not a line
    }
  }
}
[...names].forEach((n, i) => rename.set(n, `Agent${String(i + 1).padStart(2, '0')}`));
[...people].filter((n) => !names.has(n) && !/^(the office|office|claude)/i.test(n)).forEach((n, i) => rename.set(n, `Person${i + 1}`));
const home = path.dirname(realOffice);
// Paths first (any case, either slash), then names and ids as whole words only ("Ada" never in "adapter").
// Claude Code names its project folders after the path with every : \ / . as a dash: those too.
const dashed = (p) => p.replace(/[:\\/.]/g, '-');
const basePaths = [[realOffice, path.join(out, 'office')], ...floors.map((f, i) => [f.dir, path.join(out, 'floors', `real-${String.fromCharCode(97 + i)}`)]), [home, path.join(out, 'home')]];
// Floor ids and the GitHub org are distinctive: replaced anywhere, inside other words too.
const anywhere = [...rename].filter(([a, b]) => b === 'test-org' || b.startsWith('real-'));
const paths = [...basePaths, ...basePaths.map(([a, b]) => [dashed(a), dashed(b)]), ...anywhere].sort((a, b) => b[0].length - a[0].length);
// Workers' names, and the lower-case slugs made of them (office/pixel-d363), as whole words.
for (const [a, b] of [...rename]) if (/^(Agent|Person)\d/.test(b)) rename.set(a.toLowerCase(), b.toLowerCase());
const words = [...rename].filter(([, b]) => !(b === 'test-org' || b.startsWith('real-'))).sort((a, b) => b[0].length - a[0].length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pathRe = new RegExp(paths.flatMap(([a]) => [esc(a), esc(a.replaceAll('\\', '/'))]).join('|'), 'gi');
const pathTo = new Map(paths.flatMap(([a, b]) => [[a.toLowerCase(), b], [a.replaceAll('\\', '/').toLowerCase(), b.replaceAll('\\', '/')]]));
const wordRe = new RegExp(`(?<![\\w-])(?:${words.map(([a]) => esc(a)).join('|')})(?![\\w-])`, 'g');
const wordTo = new Map(words);
const swap = (s) => s.replace(pathRe, (m) => pathTo.get(m.toLowerCase()) ?? m).replace(wordRe, (m) => wordTo.get(m) ?? m);

// ---- Scrubbing ------------------------------------------------------------------------------------
const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ';
const filler = (s) => {
  let o = '';
  for (let i = 0; i < s.length; i++) o += s[i] === '\n' ? '\n' : LOREM[i % LOREM.length];
  return o;
};
const SECRET = /token|secret|password|apikey|api_key|credential|authorization/i;
const isPathOrUrl = (s) => /^([a-z]:[\\/]|\/|\.{0,2}[\\/]|https?:\/\/)/i.test(s);
function scrubString(s, key) {
  if (key && SECRET.test(key)) return randomBytes(Math.max(1, Math.ceil(s.length / 2))).toString('hex').slice(0, s.length);
  const t = swap(s);
  if (isPathOrUrl(t) && !/\s/.test(t)) return t;
  // The office's own names for itself are labels the pages compare, not anyone's text.
  if (/^(the office|office|project manager|project coordinator|jeff)$/i.test(t)) return t;
  return /\s/.test(t) || t.length > 48 ? filler(t) : t;
}
function scrub(v, key) {
  if (typeof v === 'string') return scrubString(v, key);
  if (Array.isArray(v)) return v.map((x) => scrub(x, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [swap(k), scrub(x, k)]));
  return v;
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const stats = { files: 0, lines: 0 };
function writeOut(dest, text) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  stats.files++;
}
/** Copies one file, scrubbed by its kind; the audit log's chain is worked out again. */
function copyFile(src, dest) {
  const name = path.basename(src);
  dest = path.join(path.dirname(dest), swap(name));
  const text = fs.readFileSync(src, 'utf8');
  if (name.endsWith('.json')) return writeOut(dest, JSON.stringify(scrub(JSON.parse(text)), null, 1));
  if (name.endsWith('.jsonl')) {
    const audit = path.basename(path.dirname(src)) === 'audit';
    let prev = '';
    const lines = [];
    for (const l of text.split('\n')) {
      if (!l.trim()) continue;
      let e;
      try {
        e = scrub(JSON.parse(l));
      } catch {
        continue;
      }
      stats.lines++;
      if (audit) {
        delete e.hash;
        e.prev = prev;
        const line = JSON.stringify({ ...e, hash: sha256(JSON.stringify(e)) });
        prev = sha256(line);
        lines.push(line);
      } else lines.push(JSON.stringify(e));
    }
    return writeOut(dest, lines.length ? `${lines.join('\n')}\n` : '');
  }
  if (name.endsWith('.ansi')) {
    // Terminal history: escape sequences kept, every letter and digit replaced.
    const parts = text.split(/(\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07)/);
    return writeOut(dest, parts.map((p, i) => (i % 2 ? p : p.replace(/[A-Za-z]/g, 'x').replace(/[0-9]/g, '0'))).join(''));
  }
  // Anything else isn't copied (scripts, binaries).
}
function copyTree(src, dest, skip = new Set()) {
  if (!fs.existsSync(src)) return;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, swap(e.name));
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) copyTree(s, d, skip);
    else copyFile(s, d);
  }
}

// ---- The office ---------------------------------------------------------------------------------
const OFFICE_KEEP = ['analysis', 'audit', 'budget', 'chatter', 'flows', 'incidents', 'judge', 'phone', 'ranking', 'roster', 'project-run.json', 'usage.json', 'theme.json'];
const officeData = path.join(out, 'office', '.agent-office');
for (const k of OFFICE_KEEP) {
  const s = path.join(realData, k);
  if (!fs.existsSync(s)) continue;
  if (fs.statSync(s).isDirectory()) copyTree(s, path.join(officeData, k), new Set(['archive', 'chain.json']));
  else copyFile(s, path.join(officeData, k));
}
fs.writeFileSync(
  path.join(officeData, 'floors.json'),
  JSON.stringify(floors.map((f, i) => ({ id: rename.get(f.id), name: rename.get(f.id), dir: path.join(out, 'floors', rename.get(f.id)), palette: i, addedBy: 'the office', addedAt: f.addedAt })), null, 1),
);

// ---- The floors: their data, and stand-in repositories ------------------------------------------
const FLOOR_KEEP = ['budget', 'incidents', 'phone', 'scrollback', 'project-run.json', 'queue.json', 'workers.json', 'meetings.json', 'dog.json'];
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=Shape', '-c', 'user.email=shape@test-office.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...a], { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', windowsHide: true });
const report = [];
for (const f of floors) {
  const id = rename.get(f.id);
  const dir = path.join(out, 'floors', id);
  // How many files the real checkout tracks: read from its index, nothing written there.
  let count = 0;
  try {
    count = execFileSync('git', ['-C', f.dir, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true }).split('\0').filter(Boolean).length;
  } catch {
    count = 100;
  }
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.agent-office/\n');
  for (let i = 0; i < count; i++) {
    const p = path.join(dir, 'src', `d${Math.floor(i / 200)}`, `f${i}.txt`);
    if (i % 200 === 0) fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${i}\n`);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Stand-in for the real checkout');
  const fdata = path.join(dir, '.agent-office');
  for (const k of FLOOR_KEEP) {
    const s = path.join(f.dir, '.agent-office', k);
    if (!fs.existsSync(s)) continue;
    if (fs.statSync(s).isDirectory()) copyTree(s, path.join(fdata, k));
    else copyFile(s, path.join(fdata, k));
  }
  // Each worker's worktree, again, on its (renamed) branch.
  let trees = 0;
  const wf = path.join(fdata, 'workers.json');
  if (fs.existsSync(wf)) {
    for (const w of readJson(wf)) {
      if (!w.worktree?.path || !w.worktree.branch) continue;
      try {
        git(dir, 'worktree', 'add', '-q', '-b', w.worktree.branch, path.join(dir, w.worktree.path), 'HEAD');
        trees++;
      } catch {
        // a branch two workers shared
      }
    }
  }
  report.push(`${id}: ${count} files, ${trees} worktrees`);
}
console.log(`real-shape: ${stats.files} files (${stats.lines} JSONL lines) scrubbed into ${out}`);
console.log(report.join('\n'));
console.log(`renamed: ${names.size} worker names, ${people.size} people, ${floors.length} floors`);
