// The office's own model check at the exact commit a merge is about (server/merge-check/), as the local merge's
// confirm step shows it, with its words. Pure: the browser imports it, the tests too.

export interface MergeCheckView {
  /** pass / fail / error: recorded at that commit; running: under way (started: by this look); none: not run; no-app: no .mpr. */
  status: 'pass' | 'fail' | 'error' | 'running' | 'none' | 'no-app';
  commit: string;
  at?: number;
  by?: string;
  errors?: number;
  codes?: string[];
  why?: string;
  started?: boolean;
}

const short = (s: string) => s.slice(0, 7);

/** The confirm's line: "✓ mx check passed at @abc1234 (0 errors)", "⏳ The office is running mx check at @abc1234 …". */
export function mergeCheckWords(v: MergeCheckView): string {
  const at = `@${short(v.commit)}`;
  switch (v.status) {
    case 'pass':
      return `✓ mx check passed at ${at} (0 errors)${v.by ? `, run by ${v.by}` : ''}`;
    case 'fail':
      return `✗ mx check found ${v.errors ?? '?'} error${v.errors === 1 ? '' : 's'} at ${at}${v.codes?.length ? ` (${v.codes.join(', ')})` : ''}`;
    case 'error':
      return `⚠ mx check didn't finish at ${at}: ${v.why ?? 'no verdict'}`;
    case 'running':
      return `⏳ ${v.started ? 'The office started' : 'The office is running'} mx check at ${at} (off the event loop, a few minutes): this updates when it ends`;
    case 'no-app':
      return `No Mendix app (.mpr) at ${at}: nothing to check`;
    default:
      return `No mx check at ${at} yet`;
  }
}

/** Whether the confirm should look again (a check under way). */
export const checkPending = (v: MergeCheckView | undefined) => v?.status === 'running';
