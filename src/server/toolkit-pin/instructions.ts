// What a pinned project's instruction files say about the toolkit. The toolkit writes its own absolute
// path into them (CLAUDE.local.md's Wiring table and session-start ritual, the wiring block in CLAUDE.md
// and AGENTS.md, the routing table, RESUME.md), so pinning a project points every one of those at its pin
// folder, in whichever spelling each used (C:\…, C:/… or Git Bash's /c/…). The ritual's step 1,
// `git -C <toolkit> pull --ff-only`, is what moved a running project onto new toolkit rules mid-stage: it
// becomes a read of the pinned commit, and an Agent Office block above the ritual says why and how a newer
// toolkit comes (the Update toolkit action). Pure text in, text out, plus one function that does it to
// the files of a checkout.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The files the toolkit (and the office's Playbooks) name the toolkit folder in, relative to the project. */
export const INSTRUCTION_FILES = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.github/copilot-instructions.md', '.cursorrules', '.windsurfrules', '.aider.conf.yml', '.kiro/steering/mxtk-toolkit.md', 'docs/progress/RESUME.md'];
/** Folders whose files are instruction files too: subagents and the office's Playbooks. */
const INSTRUCTION_DIRS: [dir: string, file: RegExp][] = [
  ['.claude/agents', /\.md$/],
  ['.ai-context/skills', /^team-[\w-]+$/],
  ['.claude/skills', /^team-[\w-]+$/],
];

export const BLOCK_START = '<!-- agent-office:toolkit-pin:start';
export const BLOCK_END = '<!-- agent-office:toolkit-pin:end -->';

/** Git Bash's spelling of a Windows path (C:\a\b → /c/a/b). */
export const bashForm = (p: string) => {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  return m ? `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/');
};

/** `target` spelled the way `like` is: backslashes, C:/ forward slashes, or Git Bash's /c/. */
export function spellLike(like: string, target: string): string {
  const bash = bashForm(target);
  const m = /^\/([a-z])\/(.*)$/.exec(bash);
  if (!m) return target;
  if (/^[A-Za-z]:\\/.test(like)) return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
  if (/^[A-Za-z]:\//.test(like)) return `${m[1].toUpperCase()}:/${m[2]}`;
  return bash;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Absolute paths in `text` that are a toolkit folder: a folder named `mxcli-project-toolkit`, `mendix-toolkit`
 * or one of `names` (the office's clone's own name), or a pin of one (`<name>-pins/<sha>`), in any spelling.
 */
export function toolkitPaths(text: string, names: readonly string[] = []): string[] {
  return [...new Set(text.match(pathRe(names)) ?? [])];
}

function pathRe(names: readonly string[]): RegExp {
  const alts = [...new Set(['mxcli-project-toolkit', 'mendix-toolkit', ...names].filter(Boolean))].map(esc).join('|');
  const seg = '[^\\\\/\\s`\'"|<>*?()\\[\\]]+';
  const tail = `(?:${alts})(?:-pins[\\\\/][0-9a-f]{7,40})?(?=[\\\\/\\s\`'"|)\\].,;:]|$)`;
  return new RegExp(`(?<![\\w.:/\\\\-])(?:[A-Za-z]:[\\\\/](?:${seg}[\\\\/])*?|/[a-z]/(?:${seg}/)*?)${tail}`, 'gm');
}

/** `text` with every toolkit folder in it pointed at `pin`, each in its own spelling (one pass, so a pin's own path is never replaced again). */
export function pointAtPin(text: string, pin: string, names: readonly string[] = []): string {
  return text.replace(pathRe(names), (p) => spellLike(p, pin));
}

/** The ritual's `git -C <toolkit> pull --ff-only` (with or without its "then rev-parse"), made a read of the pinned commit. */
export function withoutPull(text: string, sha: string): string {
  const note = `(the toolkit is pinned by Agent Office at ${sha.slice(0, 7)}: never pull, fetch or check out in that folder)`;
  return text
    .replace(/`git -C (\S+?) pull --ff-only`(?: then `git -C \S+? rev-parse --short HEAD`)?/g, (_m, dir: string) => `\`git -C ${dir} rev-parse --short HEAD\` ${note}`)
    .replace(/(^|[^`\w])git -C (\S+) pull --ff-only(?![`\w])/gm, (_m, pre: string, dir: string) => `${pre}git -C ${dir} rev-parse --short HEAD  # pinned by Agent Office: never pull`);
}

/** Whether `text` still tells an agent to pull the toolkit. */
export const saysPull = (text: string) => /git -C \S+ pull\b/.test(text);

/** The Agent Office block: the pinned commit, where it is, and that nobody pulls it. */
export function pinBlock(pin: string, sha: string, date?: string): string {
  const dir = bashForm(pin);
  return [
    `${BLOCK_START} — written by Agent Office; replaced on every toolkit update, edit the office's Update toolkit, not this. -->`,
    '## Toolkit version (pinned by Agent Office)',
    '',
    `This project runs on the mxcli-project-toolkit at commit \`${sha.slice(0, 7)}\`${date ? ` (${date})` : ''}, a read-only copy at`,
    `\`${dir}\`. It is pinned so the toolkit's rules don't change under a stage that's under way.`,
    '',
    "- **Never `git pull`, `git fetch`, `git checkout` or edit anything in that folder**, even where older wording",
    '  below says to pull: its HEAD is detached on purpose, so a pull fails.',
    `- The session-start ritual's step 1 is just \`git -C ${dir} rev-parse --short HEAD\`; its warning about not`,
    "  being on the clone's default branch doesn't apply to a pin.",
    "- A newer toolkit comes only through the office's 🧰 Update toolkit action (the setup panel's Toolkit line),",
    "  which moves the pin, runs the toolkit's sync over the project and records it here, in",
    "  `agent-office.project.json` and in `PROJECT.md`'s `Toolkit commit:` line. If the project needs a newer",
    '  toolkit, say so in chat or in your journal.',
    BLOCK_END,
  ].join('\n');
}

/** `text` with the block put in (or replaced): before the session-start ritual when there is one, else at the end. */
export function withBlock(text: string, block: string): string {
  const start = text.indexOf(BLOCK_START);
  if (start >= 0) {
    const end = text.indexOf(BLOCK_END, start);
    if (end >= 0) return text.slice(0, start) + block + text.slice(end + BLOCK_END.length);
  }
  const ritual = /^## Session-start ritual/m.exec(text);
  if (ritual) return `${text.slice(0, ritual.index)}${block}\n\n${text.slice(ritual.index)}`;
  return `${text.replace(/\s*$/, '')}\n\n${block}\n`;
}

export interface PinTextOptions {
  pin: string;
  sha: string;
  date?: string;
  /** Other names the toolkit folder goes by (the office clone's folder name). */
  names?: readonly string[];
}

/** Every instruction file in the checkout at `dir` (that's there), relative. */
export function instructionFiles(dir: string): string[] {
  const out = INSTRUCTION_FILES.filter((f) => existsSync(path.join(dir, f)));
  for (const [sub, re] of INSTRUCTION_DIRS) {
    let names: string[] = [];
    try {
      names = readdirSync(path.join(dir, sub));
    } catch {
      continue;
    }
    for (const n of names.filter((x) => re.test(x))) {
      const rel = sub.endsWith('agents') ? `${sub}/${n}` : `${sub}/${n}/SKILL.md`;
      if (existsSync(path.join(dir, rel))) out.push(rel);
    }
  }
  return out;
}

/**
 * Points the checkout's instruction files at the pin, takes the pull out of the ritual and puts the Agent
 * Office block into CLAUDE.local.md (CLAUDE.md when there's no local file). Returns the files it changed.
 */
export function pinInstructions(dir: string, o: PinTextOptions): string[] {
  const changed: string[] = [];
  const files = instructionFiles(dir);
  const home = files.includes('CLAUDE.local.md') ? 'CLAUDE.local.md' : files.includes('CLAUDE.md') ? 'CLAUDE.md' : undefined;
  for (const rel of files) {
    const f = path.join(dir, rel);
    const before = readFileSync(f, 'utf8');
    let after = withoutPull(pointAtPin(before, o.pin, o.names), o.sha);
    if (rel === home) after = withBlock(after, pinBlock(o.pin, o.sha, o.date));
    if (after !== before) {
      writeFileSync(f, after);
      changed.push(rel);
    }
  }
  return changed;
}
