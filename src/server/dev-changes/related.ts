// Overlap between changes, and between a change and commits on main (assessment §5, §6):
//
//   units      a change's model units: the documents its references are in, and (once it has a candidate) the
//              documents its candidate changed since its source revision (the explorer's unit diff, no mxcli)
//   depends    a queued or active change that overlaps an earlier change nobody has tried yet (no "Looks right")
//              shows "depends on DC-k (not yet tried)"; by default it proceeds, the project's policy may make it wait
//   related    first-parent commits on main since a change's source that aren't any change's own candidate or
//              merge, and whose changed documents overlap the change's units, are *possibly related*; one whose
//              message names the change (its DC id, branch or Task: line) is *linked*. Neither ever marks it
//              implemented; a person confirms or dismisses a possible one (audited, in the record).
//
// Commits never change, so a commit's documents are worked out once and kept. Asked on the events the queue
// already moves on (the PR list, the requests read), never on a timer.

import { changeBranch, changeNumber, refDoc, refsOf, type DevChange, type DevChangeEvent } from '../../shared/dev-changes.js';

export interface RelatedDeps {
  /** The documents (`kind:qn`) changed from `from` to `to`, or undefined when the model can't be read there. */
  docs(from: string, to: string): Promise<string[] | undefined>;
  /** First-parent commits on main after `from` (oldest first, at most `max`), with their parent, subject and body. */
  commits(from: string, max: number): Promise<{ sha: string; parent: string; subject: string; body: string }[] | undefined>;
  /** Whether a change has a "Looks right" review. */
  triedOk(id: string): boolean;
}

const OVER = new Set(['cancelled', 'superseded']);
const SETTLED_OVER = new Set(['abandoned', 'not-found', 'cancelled', 'set-aside']);

/** Whether a change still counts as work others may build on (not cancelled, superseded or settled without a merge). */
export const counts = (c: DevChange) => !OVER.has(c.queue) && !(c.settled && SETTLED_OVER.has(c.settled.why));

/** A change's model units: its references' documents, plus what its newest candidate changed since its source. */
export async function unitsOf(c: DevChange, d: Pick<RelatedDeps, 'docs'>): Promise<Set<string>> {
  const out = new Set(refsOf(c).map(refDoc));
  const cand = c.candidates.filter((x) => !x.late).at(-1);
  const from = c.activated?.main ?? c.source.sha;
  if (cand && from) for (const k of (await d.docs(from, cand.sha).catch(() => undefined)) ?? []) out.add(k);
  return out;
}

const hit = (a: ReadonlySet<string>, b: Iterable<string>) => [...b].filter((x) => a.has(x));

/** Earlier changes nobody has tried yet whose units overlap this one's, oldest first. */
export async function dependsOn(c: DevChange, all: readonly DevChange[], d: Pick<RelatedDeps, 'docs' | 'triedOk'>): Promise<{ id: string; docs: string[] }[]> {
  const mine = await unitsOf(c, d);
  if (!mine.size) return [];
  const earlier = all.filter((x) => x.id !== c.id && x.queue !== 'linked' && changeNumber(x.id) < changeNumber(c.id) && counts(x) && !d.triedOk(x.id));
  const out: { id: string; docs: string[] }[] = [];
  for (const x of earlier.sort((a, b) => changeNumber(a.id) - changeNumber(b.id))) {
    const both = hit(mine, await unitsOf(x, d));
    if (both.length) out.push({ id: x.id, docs: both });
  }
  return out;
}

/** The commits that are some change's own (its candidates): linked to that change, never external. */
const ownCommits = (all: readonly DevChange[]) => new Set(all.flatMap((c) => c.candidates.map((x) => x.sha)));

const names = (c: DevChange, text: string) => {
  const ids = [c.id, changeBranch(c.id), ...(c.activated?.taskId ? [c.activated.taskId] : [])];
  return ids.some((id) => new RegExp(`(^|[^\\w/-])${id.replace(/[-/]/g, (m) => `\\${m}`)}(?![\\w-])`).test(text));
};

/** New `related` events for an open change: commits on main since its source that overlap its units or name it. */
export async function relatedFor(c: DevChange, all: readonly DevChange[], d: RelatedDeps, now: number, merges: ReadonlySet<string>): Promise<Extract<DevChangeEvent, { type: 'related' }>[]> {
  if (!c.source.sha || c.queue === 'linked' || OVER.has(c.queue) || c.queue === 'settled') return [];
  const seen = new Set((c.related ?? []).map((r) => r.sha));
  const own = ownCommits(all);
  const commits = (await d.commits(c.source.sha, 30).catch(() => undefined)) ?? [];
  const mine = await unitsOf(c, d);
  const out: Extract<DevChangeEvent, { type: 'related' }>[] = [];
  for (const k of commits) {
    if (seen.has(k.sha) || own.has(k.sha) || merges.has(k.sha)) continue;
    const explicit = names(c, `${k.subject}\n${k.body}`);
    const docs = mine.size ? hit(mine, (await d.docs(k.parent, k.sha).catch(() => undefined)) ?? []) : [];
    if (!explicit && !docs.length) continue;
    out.push({ type: 'related', at: now, sha: k.sha, subject: k.subject.slice(0, 200), docs, ...(explicit ? { explicit: true as const } : {}) });
  }
  return out;
}
