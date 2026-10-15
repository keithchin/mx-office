// Synthetic portfolio fixtures for the portfolio tests (not a test file itself): two company brains with
// planted markers, a few toolkit-scaffolded-looking projects, a copy of the toolkit's
// wire-company-brain.sh (tests/fixtures/portfolios/toolkit, copied from the pin at 7b4b4cf, never the pin
// itself), a fake HOME and no tokens, all in a temporary folder. No network, no Claude, no GitHub.
// The markers are assembled at run time so this file itself is not a marker-bearing fixture (findings §7.3).

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuditInput } from '../src/shared/audit.js';
import { PortfolioService, type HiredMember, type PortfolioFloor } from '../src/server/portfolios/service.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A planted marker: MARKER-<what>-<n>. */
export const mark = (what: string) => ['MARKER', what, 'x7'].join('-');
export const M = {
  aShared: mark('A-SHARED'),
  aOnly: mark('A-ONLY'),
  bOnly: mark('B-ONLY'),
  candidate: mark('CANDIDATE'),
  profileNote: mark('PROFILENOTE'),
  a1Lesson: mark('A1-LESSON'),
  aV2: mark('A-V2'),
  withdrawn: mark('WITHDRAWN'),
};
export const ALL_MARKERS = Object.values(M);

export const BASH = process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\bin\\bash.exe') ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';

const ROUTING_HEAD = '# Company brain: routing\n\n| When (trigger) | Read this |\n|---|---|\n';

export class World {
  readonly root = mkdtempSync(path.join(os.tmpdir(), 'pfl-world-'));
  readonly home = path.join(this.root, 'home');
  readonly toolkit = path.join(this.root, 'toolkit');
  readonly denyFile = path.join(this.root, 'contrib-clone', '.leakguard-deny');
  readonly data = path.join(this.root, 'data');
  readonly env: NodeJS.ProcessEnv;
  floors: PortfolioFloor[] = [];
  hired = new Map<string, HiredMember[]>();
  phases = new Map<string, string>();
  benched: string[] = [];
  hiredAgain: string[] = [];
  audits: AuditInput[] = [];
  clock = 1_760_000_000_000;

  constructor() {
    mkdirSync(this.home, { recursive: true });
    mkdirSync(path.dirname(this.denyFile), { recursive: true });
    writeFileSync(path.join(this.home, '.gitconfig'), '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[init]\n\tdefaultBranch = main\n');
    cpSync(path.join(HERE, 'fixtures', 'portfolios', 'toolkit'), this.toolkit, { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: this.home, USERPROFILE: this.home, GIT_CONFIG_GLOBAL: path.join(this.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0' };
    for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[k];
    this.env = env;
  }

  git(dir: string, ...args: string[]) {
    return execFileSync('git', ['-C', dir, ...args], { env: this.env, encoding: 'utf8', windowsHide: true }).trim();
  }

  /** A brain folder: README.md, ROUTING.md with `rows` (trigger → file), and `files`; a git repository when `versioned`. */
  brain(name: string, rows: [string, string][], files: Record<string, string>, versioned = true): string {
    const dir = path.join(this.root, 'brains', name);
    for (const d of ['skills', 'inbox', 'handoffs', 'proposals', 'patches']) mkdirSync(path.join(dir, d), { recursive: true });
    writeFileSync(path.join(dir, 'README.md'), `# ${name}\n\nA synthetic company brain.\n`);
    writeFileSync(path.join(dir, 'ROUTING.md'), ROUTING_HEAD + rows.map(([w, f]) => `| ${w} | \`${f}\` |`).join('\n') + '\n');
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), text);
    }
    if (versioned) {
      this.git(dir, 'init', '-q');
      this.commit(dir, 'brain');
    }
    return dir;
  }

  commit(dir: string, msg: string) {
    this.git(dir, 'add', '-A');
    this.git(dir, 'commit', '-q', '-m', msg);
    return this.git(dir, 'rev-parse', 'HEAD');
  }

  /** A project as init-project.sh and the pin instructions leave it: CLAUDE.local.md, CLAUDE.md, AGENTS.md. */
  project(id: string, extra: Record<string, string> = {}): PortfolioFloor {
    const dir = path.join(this.root, 'projects', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'CLAUDE.local.md'), `# ${id} (local)\n\nThe .mpr is ${id}.mpr.\n`);
    writeFileSync(path.join(dir, 'CLAUDE.md'), `# ${id}\n\nRead AGENTS.md.\n`);
    writeFileSync(path.join(dir, 'AGENTS.md'), `# AGENTS.md for ${id}\n`);
    for (const [rel, text] of Object.entries(extra)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), text);
    }
    const f = { id, name: id, dir, projectId: `prj_${id}` };
    this.floors.push(f);
    return f;
  }

  service(): PortfolioService {
    return new PortfolioService({
      dataDir: this.data,
      floors: () => this.floors,
      wireEnv: async () => ({ bash: BASH, toolkitDir: this.toolkit, denyFile: this.denyFile, env: this.env }),
      hired: (id) => this.hired.get(id) ?? [],
      phase: (id, role) => this.phases.get(`${id}/${role}`),
      bench: (id, role) => {
        this.benched.push(`${id}/${role}`);
        this.phases.set(`${id}/${role}`, 'benching');
        return undefined;
      },
      hire: async (id, role) => void this.hiredAgain.push(`${id}/${role}`),
      audit: (e) => void this.audits.push(e),
      now: () => this.clock,
    });
  }

  /** Every file under `dir` (relative), for "nothing was written there". */
  tree(dir: string): string[] {
    const out: string[] = [];
    const walk = (rel: string) => {
      for (const e of readdirSync(path.join(dir, rel))) {
        const r = rel ? `${rel}/${e}` : e;
        if (statSync(path.join(dir, r)).isDirectory()) walk(r);
        else out.push(`${r}:${readFileSync(path.join(dir, r)).length}`);
      }
    };
    walk('');
    return out.sort();
  }
}

/** The usual two portfolios' brains: Acme (versioned, with a candidate, a handoff note, a missing routed file) and Beta. */
export function acmeAndBeta(w: World, betaVersioned = true) {
  const acme = w.brain(
    'acme-brain',
    [
      ['Using Acme terminology (visit, host, desk)', 'skills/acme-glossary.md'],
      ['Integrating with Acme SSO / Entra ID', 'skills/acme-entra.md'],
      ['Example row nobody wrote yet', 'skills/house-page-conventions.md'],
      ['A candidate someone routed by mistake', 'inbox/2026-10-14-a1-candidate.md'],
    ],
    {
      'skills/acme-glossary.md': `# Acme glossary\n- A "visit" is a scheduled guest arrival. Shared fact: ${M.aShared}\n`,
      'skills/acme-entra.md': `# Acme Entra ID\n- Employee number is in extension_EmpNo. Confidential: ${M.aOnly}\n`,
      'skills/acme-unrouted.md': '# Not routed yet\n',
      'inbox/2026-10-14-a1-candidate.md': `# Candidate\nUnreviewed candidate lesson ${M.candidate}\n`,
      'handoffs/ada-profile-note.md': `# Owner note\nPrivate owner note ${M.profileNote}\n`,
    },
  );
  const beta = w.brain('beta-brain', [['Building any Beta page', 'skills/beta-style.md']], { 'skills/beta-style.md': `# Beta style\n- Beta-only fact ${M.bOnly}\n` }, betaVersioned);
  return { acme, beta };
}
