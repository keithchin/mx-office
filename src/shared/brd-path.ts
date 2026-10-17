// Where gate-check's Stage 2 looks for a project's BRDs, and whether they are somewhere else. The pinned
// toolkit (7b4b4cf) has two answers to "where do the BRDs live": bin/lib/discover-brds.sh (read by
// open-questions.sh, facts-lock.sh, brd-report.sh) reads `brd/*.brd.json` in EVERY knowledge base, any of
// analysis/*/knowledge-base, analysis/knowledge-base and knowledge-base; bin/gate-check.sh resolves ONE
// knowledge base (KB_DIR: the analysis/<name>/knowledge-base when there is exactly one, else
// analysis/knowledge-base, else knowledge-base; it refuses outright with two or more nested ones) and its
// Stage 2 reads only `<KB_DIR>/brd/`. A migration's extraction writes analysis/<source>/knowledge-base/, so a
// BRD written to analysis/knowledge-base/brd/ (what the office's Playbook said for every mode before this) is read by
// every script but gate-check, which reports Stage 2 PENDING "no brd/*.brd.json scaffolds yet" over a
// signed BRD (a migration project, release 56). The office doesn't move files: it says where gate-check looked and
// where the BRD is, and the stage card asks the lead to fix it. Pure.

export interface BrdLayout {
  /** The analysis/<name>/knowledge-base folders on the commit. */
  nested: string[];
  /** analysis/knowledge-base is there. */
  flat: boolean;
  /** knowledge-base at the project root is there. */
  root: boolean;
  /** The `*.brd.json` files in each knowledge base's brd/ folder, by knowledge-base path. */
  brds: Record<string, string[]>;
}

/** The knowledge base gate-check resolves (its KB_DIR), or undefined when there's none or it would refuse (several nested ones). */
export function gateCheckKb(l: BrdLayout): string | undefined {
  if (l.nested.length > 1) return undefined;
  if (l.nested.length === 1) return l.nested[0];
  if (l.flat) return 'analysis/knowledge-base';
  if (l.root) return 'knowledge-base';
  return undefined;
}

/** Every BRD the toolkit's other scripts read (discover_brds), in its order. */
export function allBrds(l: BrdLayout): string[] {
  const kbs = [...l.nested, ...(l.flat ? ['analysis/knowledge-base'] : []), ...(l.root ? ['knowledge-base'] : [])];
  return kbs.flatMap((kb) => l.brds[kb] ?? []);
}

/** gate-check's Stage 2 finds no BRD in its knowledge base while the others read some elsewhere: where it looked, where they are, in words. */
export function brdPathFlag(l: BrdLayout): { expected: string; actual: string[]; text: string } | undefined {
  const kb = gateCheckKb(l);
  if (!kb || (l.brds[kb] ?? []).length) return undefined;
  const actual = allBrds(l);
  if (!actual.length) return undefined;
  const more = actual.length > 1 ? ` (and ${actual.length - 1} more)` : '';
  return { expected: `${kb}/brd/`, actual, text: `gate-check didn't find the BRD at ${kb}/brd/; it's at ${actual[0]}${more}` };
}
