// A local merge's refusal in words (server/local-merge/merge.ts): which files conflict, never git's own error
// text, which repeats the command line, the merge message and its `Mx-Office-Local-Merge:` trailer (the rebuild
// run showed that trailer to the Project Manager). Pure.

/** Strips git's command echo, trailers and long hashes from an error, leaving its own reason (one line, short). */
export function gitReason(message: string): string {
  const lines = message
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^Command failed:/i.test(l) && !/^[\w-]+: .*@[0-9a-f]{12,}/i.test(l) && !/^(Reviewed at|Merge \S+ @)/.test(l));
  const reason = lines.find((l) => /^(CONFLICT|error|fatal|Automatic merge failed)/i.test(l)) ?? lines[0] ?? '';
  return reason.replace(/\b[0-9a-f]{12,40}\b/g, (h) => h.slice(0, 7)).slice(0, 160);
}

/** "Not merged: @abc1234 of office/carl-1 conflicts with main in 2 files (App.mpr, docs/x.md). Ask the lead…" */
export function refusalWords(sha: string, branch: string, main: string, files: readonly string[], message: string): string {
  const where = files.length ? ` in ${files.length} file${files.length === 1 ? '' : 's'} (${files.slice(0, 4).join(', ')}${files.length > 4 ? ', …' : ''})` : (() => {
    const why = gitReason(message);
    return why ? ` (${why})` : '';
  })();
  return `Not merged: @${sha.slice(0, 7)} of ${branch} conflicts with ${main}${where}. Ask the lead to bring ${main} into the branch, then review the new commit.`;
}
