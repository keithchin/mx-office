#!/usr/bin/env node
// studio-guard: Claude Code's PreToolUse hook for Bash on a Mendix floor's workers, while Studio Pro
// has the floor's project open (Studio mode, src/server/studio/). The office writes a marker,
// <floor>/.agent-office/studio-open.json, while Studio Pro is open and takes it away once it closes;
// this reads it and denies the commands that write the model with mxcli (mxcli exec, fix, layout,
// rename, -c with a write statement, the toolkit's bin/exec.sh …), because Studio Pro doesn't reload
// the model from disk and its next save would quietly throw the agent's change away. Reads (check,
// lint, report, show, describe, diff…) and writes routed through Studio Pro itself (mxcli --mcp) go
// through. A denial is told to the office (/office/studio on the hook port) for the audit log, best
// effort. Plain Node, no build step, no dependencies; the decision is pure and exported for the tests.
//
//   node studio-guard.js [<marker>]    (the PreToolUse payload on stdin)
//
// Without <marker>, the marker is looked for from the session's folder up, and in the main checkout
// of the git worktree it's in.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER_NAME = 'studio-open.json';

// ---------------------------------------------------------------------------------------------
// Reading a shell command

/**
 * The simple commands in a shell command line, each as its words with the quotes taken off: split at
 * ; & | newlines and parentheses (and backticks and $( ) outside single quotes. Not a shell, but
 * enough to see which program runs with which arguments.
 */
export function simpleCommands(line) {
  const out = [];
  let words = [];
  let word = '';
  let inWord = false;
  let quote = '';
  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = '';
      else word += c;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = '';
      else if (c === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) word += line[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === '\\' && i + 1 < line.length) {
      if (line[i + 1] === '\n') i++;
      else {
        word += line[++i];
        inWord = true;
      }
    } else if (c === ' ' || c === '\t') endWord();
    else if (';&|\n\r()`'.includes(c)) endCommand();
    else if (c === '$' && line[i + 1] === '(') {
      endCommand();
      i++;
    } else {
      word += c;
      inWord = true;
    }
  }
  endCommand();
  return out;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Programs that run the rest of the line: what they run is what counts. */
const WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command', 'nice', 'stdbuf', 'xargs', 'npx', 'winpty']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const PYTHONS = /^(python[0-9.]*|py)$/;

/** A program's name as written, without its folder or .exe, in lower case. */
export const programName = (word) =>
  word
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .toLowerCase()
    .replace(/\.exe$/, '');

/** The words without redirections (< in, > out, 2> err, <<EOF), which say nothing about what runs. */
function unredirect(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const m = /^\d*(<<?-?|>>?)(.*)$/.exec(words[i]);
    if (!m) out.push(words[i]);
    else if (!m[2]) i++; // the operator on its own: the file is the next word
  }
  return out;
}

/** The words after any VAR=value and wrappers (sudo, env -i, timeout 60, xargs -0 …). */
function unwrap(all) {
  const words = unredirect(all);
  let i = 0;
  for (;;) {
    while (i < words.length && ASSIGNMENT.test(words[i])) i++;
    if (i >= words.length) return [];
    const p = programName(words[i]);
    if (p === 'timeout') {
      i++;
      while (i < words.length && words[i].startsWith('-')) i++;
      i++; // the duration
      continue;
    }
    if (!WRAPPERS.has(p)) return words.slice(i);
    i++;
    while (i < words.length && words[i].startsWith('-')) i++;
  }
}

// ---------------------------------------------------------------------------------------------
// Which mxcli commands write the model (from `mxcli --help` and each command's own help, 2026-10)

/** MDL statements that only read: everything else in a -c is taken for a write. */
const MDL_READS = new Set(['connect', 'disconnect', 'list', 'show', 'describe', 'search', 'help', 'mdl', 'select', 'explain', 'status', 'exit', 'quit', 'refresh', 'find', 'count', 'check']);

/** Whether MDL text (an `mxcli -c` argument) has a statement in it that may write. */
export function mdlWrites(text) {
  const clean = String(text)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
  for (const st of clean.split(/[;\n]|^\s*\/\s*$/m)) {
    const verb = st.trim().split(/\s+/)[0]?.toLowerCase();
    if (!verb || verb === '/') continue;
    if (!MDL_READS.has(verb)) return true;
  }
  return false;
}

/** Global flags that take a value (the rest take none). */
const VALUE_FLAGS = new Set(['-p', '--project', '-c', '--command', '--mdl', '--engine', '--mcp', '--mcp-concord', '--mcp-concord-dial', '--mcp-dial']);

/**
 * Whether `mxcli <args>` writes the model: exec, fix, layout and rename (bar --dry-run), widget sync,
 * theme switcher install, -c with a write statement, and the REPL (no command at all, so stdin may
 * hold anything). Anything routed through Studio Pro's MCP server (--mcp) is Studio Pro's own write,
 * and help is never a write. A string says which, undefined that it only reads.
 */
export function mxcliWrite(args) {
  const words = [];
  let command;
  let mcp = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    if (flag === '-h' || flag === '--help' || flag === '-v' || flag === '--version') return undefined;
    if (VALUE_FLAGS.has(flag)) {
      const v = inline ?? args[++i] ?? '';
      if (flag === '--mcp') mcp = true;
      if (flag === '-c' || flag === '--command') command = (command ?? '') + ';' + v;
      continue;
    }
    if (!a.startsWith('-')) words.push(a.toLowerCase());
  }
  if (mcp) return undefined;
  const dry = args.some((a) => a === '--dry-run' || a === '--check');
  const [sub, sub2, sub3] = words;
  if (command !== undefined && !sub) return mdlWrites(command) ? 'mxcli -c with a statement that writes' : undefined;
  if (!sub) return 'the mxcli REPL';
  if (sub === 'help') return undefined;
  if (sub === 'exec' || sub === 'fix') return `mxcli ${sub}`;
  if ((sub === 'layout' || sub === 'rename') && !dry) return `mxcli ${sub}`;
  if (sub === 'widget' && sub2 === 'sync' && !dry) return 'mxcli widget sync';
  if (sub === 'theme' && sub2 === 'switcher' && sub3 === 'install') return 'mxcli theme switcher install';
  return undefined;
}

/** The toolkit's scripts that write the model (mxcli-project-toolkit/project-bin). */
const TOOLKIT_WRITERS = new Set(['exec.sh', 'restore-mpr.sh']);
/** Mendix's own mx, where it rewrites the project. */
const MX_WRITES = new Set(['update-widgets', 'rename-design-properties', 'convert']);

/** Whether one simple command writes the model; a string says what, undefined that it doesn't. */
export function commandWrite(words, depth = 0) {
  const w = unwrap(words);
  if (!w.length) return undefined;
  const p = programName(w[0]);
  // Ends in mxcli: an unquoted C:\tools\mxcli.exe loses its backslashes to the shell (C:toolsmxcli).
  if (p === 'mxcli' || /^[a-z]:.*mxcli$/.test(p)) return mxcliWrite(w.slice(1));
  if (TOOLKIT_WRITERS.has(p)) return `the toolkit's ${p}`;
  if (p === 'mx' && MX_WRITES.has((w[1] ?? '').toLowerCase())) return `mx ${w[1]}`;
  if (SHELLS.has(p)) {
    const c = w.indexOf('-c');
    if (c > 0 && w[c + 1] !== undefined) return depth < 3 ? lineWrite(w[c + 1], depth + 1) : undefined;
    const script = w.slice(1).find((a) => !a.startsWith('-'));
    return script ? commandWrite([script], depth + 1) : undefined;
  }
  if (PYTHONS.test(p)) {
    const script = w.slice(1).find((a) => !a.startsWith('-'));
    if (script && /^wf-.*\.py$/i.test(programName(script))) return `the toolkit's ${programName(script)}`;
  }
  return undefined;
}

/** Whether a whole command line writes the model anywhere in it. */
export function lineWrite(line, depth = 0) {
  for (const words of simpleCommands(String(line ?? ''))) {
    const why = commandWrite(words, depth);
    if (why) return why;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Finding the marker, and deciding

/**
 * Where the floor's marker is from a folder: in `.agent-office/` of that folder or one above it (the
 * office's worktrees are in <floor>/.agent-office/worktrees/), or of the main checkout of the git
 * worktree it's in (a `.git` file naming its gitdir, whose `commondir` leads back to the main .git).
 */
export function findMarker(cwd, fs = { exists: existsSync, read: (p) => readFileSync(p, 'utf8'), isFile: (p) => statSync(p).isFile() }) {
  let dir = path.resolve(cwd);
  for (;;) {
    const here = path.join(dir, '.agent-office', MARKER_NAME);
    if (fs.exists(here)) return here;
    const dotGit = path.join(dir, '.git');
    if (fs.exists(dotGit)) {
      try {
        if (fs.isFile(dotGit)) {
          const gitdir = path.resolve(dir, /^gitdir:\s*(.+)$/m.exec(fs.read(dotGit))?.[1]?.trim() ?? '');
          const common = path.resolve(gitdir, fs.read(path.join(gitdir, 'commondir')).trim());
          const main = path.join(path.dirname(common), '.agent-office', MARKER_NAME);
          if (fs.exists(main)) return main;
        }
      } catch {
        // Not a worktree we can read: keep looking up.
      }
    }
    const up = path.dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** The marker's contents, when it's there and still true (its Studio Pro still runs). */
export function readMarker(file, alive = pidAlive) {
  let m;
  try {
    m = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
  if (!m || typeof m !== 'object') return undefined;
  // The office went away with Studio Pro open and Studio Pro has since closed: nothing to hold.
  if (typeof m.pid === 'number' && !alive(m.pid)) return undefined;
  return m;
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/** What the agent is told when a write is held. */
export function denyReason(marker, why) {
  const app = marker.app || 'the project';
  let text = `Studio Pro has ${app} open, so the office has paused model writes (${why}). Don't write to the model with mxcli: Studio Pro doesn't reload it from disk, and its next save would throw your change away.`;
  if (marker.mcp) text += ` Studio Pro's MCP server answers at ${marker.mcp}: route the write through Studio Pro with mxcli --mcp ${marker.mcp} (e.g. mxcli --mcp ${marker.mcp} -p <app>.mpr exec script.mdl), or use the Studio Pro MCP tools if you have them.`;
  else text += ' Use the Studio Pro MCP tools if you have them; otherwise work on reviews, tests or docs, or escalate to the Project Manager.';
  return `${text} Reads (mxcli check, lint, report, show, describe, diff) still work. Writes are allowed again once Studio Pro is closed.`;
}

/**
 * The hook's decision on one PreToolUse payload: undefined to let it run, or what to deny it with.
 * Only Bash is looked at; `marker` is the marker's contents (undefined: Studio Pro isn't open).
 */
export function decide(payload, marker) {
  if (!marker || payload?.tool_name !== 'Bash') return undefined;
  const command = payload?.tool_input?.command;
  if (typeof command !== 'string') return undefined;
  const why = lineWrite(command);
  return why ? { why, reason: denyReason(marker, why) } : undefined;
}

/** Tells the office a write was held, for the audit log; never waits long, never fails the hook. */
function report(marker, payload, why) {
  const { AGENT_OFFICE_HOOK_URL: base, AGENT_OFFICE_WORKER_ID: worker, AGENT_OFFICE_HOOK_TOKEN: token } = process.env;
  if (!base || !worker) return Promise.resolve();
  return new Promise((resolve) => {
    import('node:http')
      .then(({ default: http }) => {
        const url = new URL(`${base}/office/studio`);
        url.searchParams.set('worker', worker);
        const req = http.request(url, { method: 'POST', timeout: 1500, headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' } }, (res) => {
          res.resume();
          res.on('end', resolve);
        });
        req.on('error', () => resolve());
        req.on('timeout', () => req.destroy());
        req.end(JSON.stringify({ floor: marker.floor, why, command: String(payload?.tool_input?.command ?? '').slice(0, 300) }));
      })
      .catch(() => resolve());
  });
}

async function main() {
  let body = '';
  for await (const c of process.stdin) body += c;
  let payload;
  try {
    payload = JSON.parse(body || '{}');
  } catch {
    return;
  }
  const file = process.argv[2] || findMarker(payload?.cwd || process.cwd());
  if (!file || !existsSync(file)) return;
  const marker = readMarker(file);
  const d = decide(payload, marker);
  if (!d) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
  await report(marker, payload, d.why);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  main().catch(() => undefined);
}
