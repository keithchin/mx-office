// Why the live preview isn't showing the app, in one line, for the Developer view (the canvas's Live preview tab
// and its line, and the docked chat's header): a build that failed says at which commit and why ("the last
// build failed at 1a2b3c4: CE1613 …"), a crash says so, and an app that was simply stopped, never started since
// the office started, or can't run on this computer says that instead, never "failed". Only what the live
// app's own state (LiveAppState, server/liveapp/) holds: the failure's commit, its first line and when. Pure.

import type { LiveAppState } from '../protocol/liveapp.js';

export type PreviewOffKind = 'checking' | 'starting' | 'failed' | 'crashed' | 'timeout' | 'unavailable' | 'stopped' | 'never';

export interface PreviewOff {
  kind: PreviewOffKind;
  /** The canvas tab's few words: "not running", "build failed", "starting". */
  short: string;
  /** The sentence: "Preview not running: the last build failed at 1a2b3c4: … (details on the Live app page)". */
  line: string;
  /** The commit the failure names, when it names one. */
  sha?: string;
  /** The failure's reason in short, when there is one. */
  reason?: string;
}

const short7 = (sha?: string) => (sha ?? '').slice(0, 7);

/** A failure's reason in one short line: its first non-empty line, at most `max` characters. */
export function shortReason(why: string | undefined, max = 140): string {
  const first = (why ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

const DETAILS = ' (details on the Live app page)';

/** Why the preview isn't serving, or undefined while it serves a revision. */
export function previewOff(s: LiveAppState | null | undefined): PreviewOff | undefined {
  if (!s) return { kind: 'checking', short: 'checking…', line: 'Checking whether the preview runs…' };
  const serving = !!s.served && (s.status === 'running' || s.status === 'updating');
  if (serving) return undefined;
  if (s.status === 'starting' || s.status === 'updating' || s.status === 'running') {
    const at = s.target?.sha ? ` ${short7(s.target.sha)}` : '';
    return { kind: 'starting', short: 'starting', line: `Preview starting: building and starting${at}. It shows as soon as it answers.` };
  }
  if (s.status === 'stopping') return { kind: 'stopped', short: 'stopping', line: 'Preview stopping: the app is being stopped.' };
  const f = s.failure;
  if (s.status === 'failed' && f) {
    const sha = f.sha ?? s.target?.sha;
    const reason = shortReason(f.why) || shortReason(s.message) || 'no reason was given';
    const at = sha ? ` at ${short7(sha)}` : '';
    if (f.kind === 'crash') return { kind: 'crashed', short: 'stopped by itself', line: `Preview not running: the app stopped by itself${at}: ${reason}${DETAILS}`, ...(sha ? { sha } : {}), reason };
    if (f.kind === 'timeout') return { kind: 'timeout', short: 'didn’t come up', line: `Preview not running: the last start${at} never answered: ${reason}${DETAILS}`, ...(sha ? { sha } : {}), reason };
    return { kind: 'failed', short: 'build failed', line: `Preview not running: the last build failed${at}: ${reason}${DETAILS}`, ...(sha ? { sha } : {}), reason };
  }
  if (s.status === 'failed') {
    const reason = shortReason(s.message) || 'no reason was given';
    return { kind: 'failed', short: 'build failed', line: `Preview not running: the last start failed: ${reason}${DETAILS}`, reason };
  }
  if (!s.available) return { kind: 'unavailable', short: 'not running', line: `Preview not running: the office can’t run the app on this computer yet${DETAILS}` };
  const last = s.lastServed ? ` It last ran ${short7(s.lastServed.sha)}.` : '';
  if (s.started) return { kind: 'stopped', short: 'not running', line: `Preview not running: it was stopped${s.by ? ` by ${s.by}` : ''}.${last} Start it on the Live app page.` };
  return { kind: 'never', short: 'not running', line: s.lastServed ? `Preview not running: not started since the office started.${last} Start it on the Live app page.` : 'Preview not running: the app hasn’t been started yet. Start it on the Live app page.' };
}
