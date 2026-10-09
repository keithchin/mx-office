// How the office asks the computer not to sleep, with no native dependency: a small helper process
// that holds the request for as long as it runs, and never outlives the office.
//
// - Windows: PowerShell calls SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) through
//   Add-Type P/Invoke (not ES_DISPLAY_REQUIRED: the screen may still turn off), then waits. It ends
//   when the office writes a line or closes its stdin (which also happens when the office dies), or
//   when the office's process is gone (checked every 5 s). The request ends with its thread.
// - macOS: `caffeinate -i -w <office pid>` (idle sleep prevented until the office exits).
// - Linux: `systemd-inhibit --what=sleep:idle` around a shell loop that ends when the office does.
// - Anything else: not supported (Settings says so).

import { spawnOff, type OffChild } from '../offloop/exec.js';
import type { Holder, Spawner } from './machine.js';

/** ES_CONTINUOUS | ES_SYSTEM_REQUIRED, and ES_CONTINUOUS alone to clear it. */
const HOLD = 0x80000001;
const CLEAR = 0x80000000;

export function windowsScript(parentPid: number): string {
  return [
    "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'",
    "Add-Type -Namespace AgentOffice -Name Power -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'",
    `if ([AgentOffice.Power]::SetThreadExecutionState([uint32]${HOLD}) -eq 0) { [Console]::Error.WriteLine('SetThreadExecutionState refused'); exit 3 }`,
    "[Console]::Out.WriteLine('held'); [Console]::Out.Flush()",
    `$parent = ${Math.trunc(parentPid)}`,
    // A stream read runs on the thread pool, so this thread can keep checking on the office meanwhile.
    '$buf = New-Object byte[] 1',
    '$read = [Console]::OpenStandardInput().ReadAsync($buf, 0, 1)',
    'while ($true) {',
    '  if ($read.Wait(5000)) { break }',
    '  if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { break }',
    '}',
    `[void][AgentOffice.Power]::SetThreadExecutionState([uint32]${CLEAR})`,
  ].join('\n');
}

/** PowerShell's -EncodedCommand: UTF-16LE, base64, so nothing in the script needs quoting. */
export const encodeCommand = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

/** The command that holds the computer awake on `platform`, or undefined where there's none. */
export function helperCommand(platform: NodeJS.Platform, parentPid: number): { cmd: string; args: string[] } | undefined {
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodeCommand(windowsScript(parentPid))] };
  if (platform === 'darwin') return { cmd: 'caffeinate', args: ['-i', '-w', String(parentPid)] };
  if (platform === 'linux') return { cmd: 'systemd-inhibit', args: ['--what=sleep:idle', '--who=Agent Office', '--why=Agents are working', '--mode=block', 'sh', '-c', `while kill -0 ${Math.trunc(parentPid)} 2>/dev/null; do sleep 5; done`] };
  return undefined;
}

/** Every helper still running, so an office that exits takes them along (the helpers watch for that too). */
const live = new Set<OffChild>();
let hooked = false;
function hookExit() {
  if (hooked) return;
  hooked = true;
  process.once('exit', () => {
    for (const c of live) c.kill();
  });
}

/** The real spawner for this computer, or undefined when it can't keep awake. */
export function systemSpawner(platform: NodeJS.Platform = process.platform, parentPid = process.pid): Spawner | undefined {
  const how = helperCommand(platform, parentPid);
  if (!how) return undefined;
  return (exited): Holder => {
    // Started from the off-loop thread: on Windows starting PowerShell held the event loop for 1.3-2 s,
    // the freeze after every office start (the live office and the perf journey, 2026-10-09).
    const child = spawnOff(how.cmd, how.args, { stdin: true, windowsHide: true });
    hookExit();
    live.add(child);
    let stopping = false;
    let err = '';
    child.on('stderr', (d: string) => (err = (err + d).slice(-400)));
    child.on('error', (e) => {
      live.delete(child);
      if (!stopping) exited(`Couldn't start ${how.cmd}: ${e.message}`);
    });
    child.on('close', (code: number | null) => {
      live.delete(child);
      if (!stopping) exited(`${how.cmd} stopped (exit ${code ?? 'signal'})${err.trim() ? `: ${err.trim().split('\n').pop()}` : ''}`);
    });
    return {
      stop() {
        stopping = true;
        // Windows: a line on stdin lets it clear its request itself; then make sure.
        child.write('release\n');
        child.end();
        const t = setTimeout(() => child.kill(), platform === 'win32' ? 3000 : 0);
        t.unref?.();
      },
    };
  };
}
