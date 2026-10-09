// The stand-ins the journey's test office runs instead of the real tools, so the new-project wizard runs
// every step for real without GitHub, Mendix or the toolkit: a fake `gh` (fake-gh.mjs), a fake Studio
// Pro (mx create-project writes an empty .mpr), and a stub mxcli-project-toolkit whose scripts write
// the scaffold's marker files. The office runs gh and mx without a shell, so on Windows each is a tiny
// .exe shim (compiled once with the .NET Framework's csc) that runs node on the .mjs beside it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';
export const MENDIX_VERSION = '11.12.4';

const SHIM_CS = `using System; using System.Diagnostics; using System.IO; using System.Text; using System.Runtime.InteropServices;
class Shim {
  [DllImport("kernel32.dll")] static extern uint GetConsoleCP();
  static string Q(string s) {
    if (s.Length > 0 && s.IndexOfAny(new char[] { ' ', '\\t', '"' }) < 0) return s;
    var sb = new StringBuilder("\\"");
    int bs = 0;
    foreach (char c in s) {
      if (c == '\\\\') { bs++; continue; }
      if (c == '"') { sb.Append('\\\\', bs * 2 + 1); sb.Append('"'); bs = 0; continue; }
      sb.Append('\\\\', bs); bs = 0; sb.Append(c);
    }
    sb.Append('\\\\', bs * 2); sb.Append('"');
    return sb.ToString();
  }
  static int Main(string[] args) {
    string exe = Process.GetCurrentProcess().MainModule.FileName;
    string script = Path.Combine(Path.GetDirectoryName(exe), Path.GetFileNameWithoutExtension(exe) + ".mjs");
    string node = Environment.GetEnvironmentVariable("FAKE_NODE");
    if (string.IsNullOrEmpty(node)) node = "node";
    var line = new StringBuilder(Q(script));
    foreach (var a in args) { line.Append(' '); line.Append(Q(a)); }
    var psi = new ProcessStartInfo(node, line.ToString());
    psi.UseShellExecute = false;
    // No console to share (started detached): node gets a hidden one, not a window of its own.
    psi.CreateNoWindow = GetConsoleCP() == 0;
    var p = Process.Start(psi);
    p.WaitForExit();
    return p.ExitCode;
  }
}
`;

function csc() {
  const root = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET');
  for (const fw of ['Framework64', 'Framework']) {
    const p = path.join(root, fw, 'v4.0.30319', 'csc.exe');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('no csc.exe (.NET Framework 4) to build the gh/mx shims with');
}

/** Puts `name` (a command the office runs without a shell) in `dir`, running `script` with node. */
function shim(dir, name, script, shimExe) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(script, path.join(dir, `${name}.mjs`));
  if (isWin) fs.copyFileSync(shimExe, path.join(dir, `${name}.exe`));
  else {
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\nexec node "$(dirname "$0")/${name}.mjs" "$@"\n`);
    fs.chmodSync(path.join(dir, name), 0o755);
  }
}

const sh = (body) => `#!/usr/bin/env bash\n# Stub mxcli-project-toolkit script for a test office (scripts/perf/journey/stubs.mjs).\n${body}\n`;

const INTAKE = `# Intake

## 1. Entry mode
_Not yet asked._ Which kind of project is this?

## 2. The client
_Not yet asked._ Who is the client and what do they need?

## 3. Users
_Not yet asked._ Who uses the app?

## 9. Attended or unattended
_Not yet asked._

## 11. Exec approval
_Not yet asked._
`;

const PROJECT = `# PROJECT

Toolkit commit: stub
Exec approval: auto

## Current stage
P

## Decisions

| Stage | Decision | Status | Notes |
|---|---|---|---|
`;

function toolkit(dir) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(path.join(bin, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(bin, 'lib', 'intake-template.sh'), `cat <<'MXTK_INTAKE_EOF'\n${INTAKE}\nMXTK_INTAKE_EOF\n`);
  const intakeB64 = Buffer.from(INTAKE).toString('base64');
  const projectB64 = Buffer.from(PROJECT).toString('base64');
  fs.writeFileSync(
    path.join(bin, 'init-project.sh'),
    sh(`set -e
d="$1"
mkdir -p "$d/bin" "$d/.claude"
echo '${intakeB64}' | base64 -d > "$d/intake.md"
echo '${projectB64}' | base64 -d > "$d/PROJECT.md"
echo "# local (stub)" > "$d/CLAUDE.local.md"
printf '#!/usr/bin/env bash\\necho stub hooks installed\\n' > "$d/bin/install-project-hooks.sh"
echo '{}' > "$d/.claude/settings.local.json"
echo stub > "$d/.claude/.doctor-receipt"
grep -q CLAUDE.local.md "$d/.gitignore" 2>/dev/null || printf 'CLAUDE.local.md\\n.claude/settings.local.json\\n.claude/.doctor-receipt\\n.claude/toolkit.env\\n' >> "$d/.gitignore"
echo "stub toolkit: scaffolded $d"`),
  );
  fs.writeFileSync(path.join(bin, 'gate-check.sh'), sh('echo "stub gate-check: ok"; exit 0'));
}

/**
 * Makes the stand-ins under `root`/stubs and returns where they are and the environment the office needs
 * to use them (PATH first, the wizard's offline folder, the toolkit and Studio Pro folders, git kept off
 * the network: it reaches only the local bare repositories).
 */
export function makeStubs(root) {
  const base = path.join(root, 'stubs');
  const bin = path.join(base, 'bin');
  const github = path.join(root, 'github');
  const mendix = path.join(base, 'mendix');
  const modeler = path.join(mendix, MENDIX_VERSION, 'modeler');
  const tk = path.join(base, 'toolkit');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(github, { recursive: true });
  let shimExe;
  if (isWin) {
    shimExe = path.join(base, 'shim.exe');
    if (!fs.existsSync(shimExe)) {
      fs.writeFileSync(path.join(base, 'shim.cs'), SHIM_CS);
      execFileSync(csc(), ['/nologo', '/optimize', `/out:${shimExe}`, path.join(base, 'shim.cs')], { stdio: 'pipe', windowsHide: true });
    }
  }
  shim(bin, 'gh', path.join(HERE, 'fake-gh.mjs'), shimExe);
  shim(modeler, 'mx', path.join(HERE, 'fake-mx.mjs'), shimExe);
  // The fake agent as an .exe too: a .cmd wrapper cuts a multi-line prompt argument at its first line.
  shim(bin, 'fake-claude', path.join(HERE, '..', 'fakebin', 'fake-agent.mjs'), shimExe);
  fs.writeFileSync(path.join(modeler, isWin ? 'mxbuild.exe' : 'mxbuild'), '');
  toolkit(tk);
  return {
    bin,
    github,
    agent: path.join(bin, isWin ? 'fake-claude.exe' : 'fake-claude'),
    env: {
      FAKE_NODE: process.execPath,
      FAKE_GH_DIR: github,
      AGENT_OFFICE_WIZARD_OFFLINE: github,
      AGENT_OFFICE_TOOLKIT_DIR: tk,
      AGENT_OFFICE_MENDIX_DIR: mendix,
      AGENT_OFFICE_MXCLI: path.join(base, 'mxcli-not-installed'),
      AGENT_OFFICE_PROJECT_ORG: 'test-org',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      // git may only reach local paths: a fetch from github.com fails at once instead of going out (the
      // checkouts' pushes already go to the local bare repositories, steps.ts).
      GIT_ALLOW_PROTOCOL: 'file',
    },
  };
}
