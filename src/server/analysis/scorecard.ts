// Reading a run's quality off its pull request. The mx-spike pipeline posts a sticky comment (marked
// <!-- mx-pr-checks-scorecard -->) with a table of checks; before that pipeline existed, agents wrote
// the same numbers into their PR's description ("Report: 95/100", "mx check: 0 errors"). The comment
// wins when there is one. Everything here is forgiving: a line it can't read is just not counted.

import type { Scorecard } from '../../shared/analysis.js';

export const SCORECARD_MARKER = '<!-- mx-pr-checks-scorecard -->';

const int = (s: string | undefined) => (s === undefined ? undefined : Number.parseInt(s, 10));

/** The pipeline's comment, as it posts it: one table row per check. */
export function parseScorecard(body: string): Scorecard | undefined {
  if (!body.includes(SCORECARD_MARKER)) return undefined;
  const sc: Scorecard = { source: 'ci' };
  let passed = 0;
  let failed = 0;
  let ran = false;
  for (const row of body.split('\n')) {
    if (!row.trim().startsWith('|')) continue;
    const cells = row.split('|').map((c) => c.trim());
    const check = (cells[2] ?? '').toLowerCase();
    const result = cells[3] ?? '';
    if (check.includes('mx check')) sc.mxErrors = int(/(\d+)\s*error/i.exec(result)?.[1]);
    else if (check.includes('lint')) {
      sc.lintErrors = int(/(\d+)\s*error/i.exec(result)?.[1]);
      sc.lintWarnings = int(/(\d+)\s*warning/i.exec(result)?.[1]);
    } else if (check.includes('best-practices') || check.includes('report')) sc.score = int(/(\d+)\s*\**\s*\/\s*100/.exec(result)?.[1]);
    else if (check.includes('test')) {
      const p = int(/(\d+)\s*passed/i.exec(result)?.[1]);
      const f = int(/(\d+)\s*failed/i.exec(result)?.[1]);
      if (p !== undefined || f !== undefined) {
        ran = true;
        passed += p ?? 0;
        failed += f ?? 0;
      }
    }
  }
  if (ran) Object.assign(sc, { testsPassed: passed, testsFailed: failed });
  return sc;
}

/** What the agent said about its own work in the PR's description, when it said anything we can read. */
export function parseSelfReport(body: string): Scorecard | undefined {
  const sc: Scorecard = { source: 'self-reported' };
  const score = /\b(?:report|best[- ]practices(?: score)?)\b[^\n]{0,40}?(\d{1,3})\s*\/\s*100/i.exec(body);
  if (score) sc.score = int(score[1]);
  const mx = /\bmx(?:build)? check\b[^\n]{0,40}?(\d+)\s*errors?/i.exec(body);
  if (mx) sc.mxErrors = int(mx[1]);
  const lint = /\blint\b[^\n]{0,20}?(\d+)\s*errors?\s*[,/]\s*(\d+)\s*warnings?/i.exec(body);
  if (lint) {
    sc.lintErrors = int(lint[1]);
    sc.lintWarnings = int(lint[2]);
  }
  return sc.score !== undefined || sc.mxErrors !== undefined ? sc : undefined;
}

/** The pipeline's latest comment if there is one, else the description. */
export function scorecardOf(prBody: string, comments: string[]): Scorecard | undefined {
  for (const c of [...comments].reverse()) {
    const sc = parseScorecard(c);
    if (sc) return sc;
  }
  return parseSelfReport(prBody);
}
