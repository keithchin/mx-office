// The analyzer's backfill without an office running it: reads an office's data folder (its floors,
// and each floor's saved workers and queue) and writes the run records into another folder's store,
// then prints the global leaderboard. For the runs from before the analyzer existed, and for checking
// it against a live office's data without writing anything there.
//
//   node --import tsx src/server/analysis/cli.ts <office data dir> <out data dir> [--no-llm]

import { rank } from '../../shared/analysis.js';
import { Analysis } from './index.js';

const [from, to, ...flags] = process.argv.slice(2);
if (!from || !to) {
  console.error('usage: cli.ts <office data dir (.agent-office)> <out data dir> [--no-llm]');
  process.exit(2);
}
const noLlm = flags.includes('--no-llm');
const analysis = new Analysis(to, noLlm ? null : undefined);
const runs = await analysis.backfillDisk(from, !noLlm);
const min = (ms: number) => `${(ms / 60000).toFixed(1)}m`;
console.log('\nRuns');
for (const r of runs.sort((a, b) => a.startedAt - b.startedAt)) {
  console.log(
    [r.worker.padEnd(9), r.modelLabel.padEnd(11), (r.effort ?? 'default').padEnd(8), `wall ${min(r.durationMs)}`.padEnd(12), `active ${min(r.activeMs)}`.padEnd(14), `$${r.cost.toFixed(2)}`.padEnd(7), `calls ${r.apiCalls}`.padEnd(10), `tools ${r.toolCalls}`.padEnd(10), `human ${r.humanPrompts}`.padEnd(8), r.outcome.padEnd(8), r.pr ? `PR #${r.pr.number}` : '-', r.scorecard?.score !== undefined ? `score ${r.scorecard.score} (${r.scorecard.source})` : '', r.types.join(','), r.typesBy, r.excluded ? `[excluded: ${r.excluded}]` : ''].join(' '),
  );
  if (r.note) console.log(`           ${r.note}`);
}
console.log('\nGlobal leaderboard (by model)');
for (const row of rank(analysis.store.all())) {
  console.log(`${row.label.padEnd(12)} score ${row.score.toFixed(1).padStart(5)}  n=${row.n}${row.lowConfidence ? ' (low confidence)' : ''}  avg $${row.avgCost.toFixed(2)}  avg active ${min(row.avgActiveMs)}  PRs ${row.prs} (merged ${row.merged})  quality ${row.avgQuality?.toFixed(0) ?? '-'}`);
}
