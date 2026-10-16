// The task ids a merged pull request's commits carry (`Task: tsk_…` lines in their messages), read from
// local git so a task's outcome can ask "does this PR carry my task?" without a GitHub call. A merged PR
// can't change, so each answer is kept for good; the lookup is a peek (task-outcome.ts is pure and sync):
// the first ask starts one `git log` off the event loop and answers "not known yet", and the next look
// has it. Not known reads as unconfirmed, never as delivered.
//
// Which commits: those reachable from the PR's head but not from the base its merge commit came onto
// (`<merge>^1`), plus the merge commit's own message (a squash merge copies the branch's messages there).
// Either revision missing locally (a branch never fetched) leaves what the other gives.

import { git } from '../asks/sources.js';
import { taskIdsIn } from '../../shared/tasks.js';

const SHA = /^[0-9a-f]{7,64}$/i;
const KEPT = 500;
const SEP = '\u001e';

export interface PrRevs {
  number: number;
  headRefOid?: string;
  mergeCommit?: string;
}

/** The ids on `Task:` lines of a text (every such line, not only the last). */
export function taskLineIds(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) if (/^\s*Task:\s*tsk_/i.test(line)) out.push(...taskIdsIn(line));
  return out;
}

export class PrTaskIds {
  private known = new Map<string, ReadonlySet<string>>();
  private asking = new Set<string>();

  constructor(private run: (args: string[], cwd: string) => Promise<string | undefined> = git) {}

  private key(dir: string, p: PrRevs) {
    return `${dir}\0${p.number}\0${p.headRefOid ?? ''}\0${p.mergeCommit ?? ''}`;
  }

  /** The task ids its commits carry, or undefined while that isn't known (a look is started then). */
  peek(dir: string, p: PrRevs): ReadonlySet<string> | undefined {
    const key = this.key(dir, p);
    const had = this.known.get(key);
    if (had || this.asking.has(key)) return had;
    if (!SHA.test(p.headRefOid ?? '') && !SHA.test(p.mergeCommit ?? '')) return undefined;
    this.asking.add(key);
    void this.read(dir, p)
      .then((ids) => {
        if (ids) {
          this.known.set(key, ids);
          while (this.known.size > KEPT) this.known.delete(this.known.keys().next().value!);
        }
      })
      .finally(() => this.asking.delete(key));
    return undefined;
  }

  /** Reads it now (tests, and peek's background look); undefined when git can't tell. */
  async read(dir: string, p: PrRevs): Promise<ReadonlySet<string> | undefined> {
    const head = SHA.test(p.headRefOid ?? '') ? p.headRefOid! : undefined;
    const merge = SHA.test(p.mergeCommit ?? '') ? p.mergeCommit! : undefined;
    const texts: string[] = [];
    let any = false;
    if (head) {
      const range = merge ? [head, '--not', `${merge}^1`] : [head, '-n1'];
      const out = await this.run(['log', ...range, '-n200', `--format=%B${SEP}`, '--'], dir);
      if (out !== undefined) {
        any = true;
        texts.push(out);
      }
    }
    if (merge) {
      const out = await this.run(['log', '-n1', `--format=%B`, merge, '--'], dir);
      if (out !== undefined) {
        any = true;
        texts.push(out);
      }
    }
    return any ? new Set(texts.flatMap(taskLineIds)) : undefined;
  }
}
