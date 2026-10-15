// Explicit ids in words (decision cards, docs/site/using-the-office/needs-you.md): the only things two
// Needs-you sources may be grouped on. A PR number ("#98", "PR 98"), a register decision or question id
// (OW-1, OQ-07, S4-3, AC-09) and a journey or test id (J-08). Parsed conservatively: a word that only
// looks like an id (UTF-8, SHA-256) is not one, and a title naming two of a kind names none of that kind,
// because a merge on a guess is worse than two cards. Similar wording never groups anything. Pure.

import type { EscalationRefs } from '../roster/escalation.js';

/** Prefixes that look like ids but are encodings, standards or versions. */
const NOT_IDS = new Set(['UTF', 'SHA', 'TLS', 'SSL', 'HTTP', 'MD', 'AES', 'RSA', 'ISO', 'IE', 'ES', 'PDF', 'UI', 'API', 'OS', 'SDK', 'JDK', 'IPV', 'WCAG', 'COVID', 'MX', 'X', 'V', 'H', 'A', 'B', 'C', 'E', 'P']);

export interface ExplicitIds {
  prs: number[];
  /** Register decision and question ids, upper case (OW-1, OQ-07, S4-3). */
  ids: string[];
  /** Journey and test ids (J-08). */
  journeys: string[];
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];

/** Every explicit id a text names. */
export function explicitIds(text: string): ExplicitIds {
  const t = text.replace(/https?:\/\/\S+/g, ' ');
  const prs = uniq([...t.matchAll(/(?:^|[^\w&/#])#(\d{1,6})(?!\d)/g), ...t.matchAll(/\bPR\s+#?(\d{1,6})\b/gi)].map((m) => Number(m[1]))).filter((n) => n > 0);
  const journeys = uniq([...t.matchAll(/(?<![\w-])J-(\d{1,3}[a-z]?)(?![\w-])/g)].map((m) => `J-${m[1]}`));
  const ids = uniq(
    [...t.matchAll(/(?<![\w-])([A-Z]{1,4}\d{0,2})-(\d{1,3})(?![\w-]|\.\d)/g)]
      .filter((m) => m[1] !== 'J' && !NOT_IDS.has(m[1].replace(/\d+$/, '')) && !NOT_IDS.has(m[1]))
      .map((m) => `${m[1]}-${m[2]}`),
  );
  return { prs, ids, journeys };
}

/** The refs a title names: one of a kind only (two PRs in one title name neither). */
export function refsFromTitle(title: string): EscalationRefs {
  const x = explicitIds(title);
  const out: EscalationRefs = {};
  if (x.prs.length === 1) out.pr = x.prs[0];
  if (x.ids.length === 1) out.decisionId = x.ids[0];
  if (x.journeys.length === 1) out.journeyId = x.journeys[0];
  return out;
}

/** Whether a string is a journey or test id (J-08) rather than a free-text test name. */
export const isJourneyId = (s: string) => /^J-\d{1,3}[a-z]?$/.test(s.trim());
