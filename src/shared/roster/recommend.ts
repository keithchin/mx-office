// The new-project wizard's recommendation of a team shape and a budget level (docs/wizard.md, "Team &
// budget"), from what the person said before it: the size tier, the entry mode, and the intake answers
// that bear on it (Q2 what drives the project, Q4 how much it covers, Q5 what must stay as it is, Q7
// whether an SME is there and how fast). The answers are free text, so each is read for a few plain
// signals; one that says nothing recognisable is "unknown" and changes nothing. Pure, and every rule is
// in the tests (tests/team-shapes.test.ts), with a "why" line per signal that counted.

import type { LevelDef } from '../budget/levels.js';
import type { EntryMode, IntakeAnswer, SizeTier } from '../wizard.js';
import type { TeamShape } from './coverage.js';

export type Driver = 'poc' | 'hard-date' | 'open-ended' | 'unknown';
export type Breadth = 'narrow' | 'broad' | 'unknown';
export type Integrations = 'none' | 'some' | 'many' | 'unknown';
export type Sme = 'not-needed' | 'available' | 'slow' | 'unknown';

export interface Signals {
  driver: Driver;
  /** The date has to be met soon: "asap", "urgent", "in three weeks". */
  urgent: boolean;
  breadth: Breadth;
  integrations: Integrations;
  sme: Sme;
}

export interface Recommendation {
  shape: TeamShape;
  level: LevelDef['id'];
  /** Why, a short line per signal that counted: "you said: POC". */
  why: string[];
  signals: Signals;
}

export interface RecommendInput {
  tier: SizeTier;
  entry: EntryMode;
  intake: readonly IntakeAnswer[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const text = (intake: readonly IntakeAnswer[], n: number) => norm(intake.find((a) => a.n === n)?.text ?? '');

/** Q2: what drives the project. The toolkit's own options are (a) POC/demo, (b) a hard date, (c) open-ended. */
export function driverOf(raw: string): Driver {
  const q2 = norm(raw);
  if (!q2) return 'unknown';
  if (/\(a\)|^a[).:\s]|\bpoc\b|proof[- ]of[- ]concept|\bdemo\b|prototype|feasib|throwaway|spike\b/.test(q2)) return 'poc';
  if (/\(b\)|^b[).:\s]|hard date|deadline|go[- ]live|expir|\beol\b|end[- ]of[- ]life|contract|licen[cs]e (ends|runs out)|\bby (the )?(end of |q[1-4]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d)/.test(q2)) return 'hard-date';
  if (/\(c\)|^c[).:\s]|open[- ]ended|moderni[sz]|no (fixed |hard )?(date|deadline)|whenever/.test(q2)) return 'open-ended';
  return 'unknown';
}

const URGENT = /\basap\b|urgent|in (one|two|three|four|1|2|3|4) weeks?|next (week|month)|tight/;

const COUNT: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, several: 3, many: 3, multiple: 3 };

/** Q4: one module, flow, feature or fix is narrow; the whole application or three or more modules is broad. */
export function breadthOf(raw: string): Breadth {
  const q4 = norm(raw);
  if (!q4) return 'unknown';
  const mods = /(\d+|two|three|four|five|six|several|many|multiple) (modules|features|apps|applications|systems|processes)/.exec(q4);
  const count = mods ? (COUNT[mods[1]] ?? Number(mods[1])) : 0;
  if (/whole (app|application|system)|entire|full (app|application|system|replacement)|everything|all (the )?modules/.test(q4) || count >= 3) return 'broad';
  if (/\b(one|a single|single|1|a|the) (module|feature|flow|fix|screen|page|form|process|app)\b|small|just the|only the/.test(q4)) return 'narrow';
  return 'unknown';
}

/** Q5: what must stay as it is. Nothing is none; integrations, contracts and feeds count, three or more is many. */
export function integrationsOf(raw: string): Integrations {
  const q5 = norm(raw);
  if (!q5) return 'unknown';
  if (/^(none|nothing|n\/?a|no(ne)?\.?|-)$|\bno integrations?\b|nothing (external|must stay)|stand-?alone|greenfield/.test(q5)) return 'none';
  const hits = q5.match(/\b(api|rest|soap|odata|sap|salesforce|integration|interface|feed|export|import|sso|ldap|active directory|azure ad|entra|database|db|contract|url|report|scheduled|batch|job|queue|kafka|file drop|sftp|email)s?\b/g) ?? [];
  const items = q5.split(/[,;\n]| and /).map((s) => s.trim()).filter(Boolean).length;
  if (!hits.length) return 'unknown';
  return new Set(hits).size >= 3 || items >= 3 ? 'many' : 'some';
}

/** Q7: an SME who answers fast, one who's slow (which reshapes the plan as much as none), or none needed. */
export function smeOf(raw: string): Sme {
  const q7 = norm(raw);
  if (!q7) return 'unknown';
  if (/not needed|no sme needed|none needed|don'?t need|myself|i am the|i'm the|the operator|^(no|none|nobody|n\/?a)\.?$/.test(q7)) return 'not-needed';
  if (/two weeks|2 weeks|slow|rarely|monthly|limited|hard to reach|part[- ]time|when (they|she|he) can|weeks? (to|turnaround)/.test(q7)) return 'slow';
  if (/daily|weekly|same day|next day|available|on call|any ?time|\bhours?\b|\byes\b/.test(q7)) return 'available';
  return 'unknown';
}

export function signalsOf(intake: readonly IntakeAnswer[]): Signals {
  const q2 = text(intake, 2);
  return { driver: driverOf(q2), urgent: URGENT.test(q2), breadth: breadthOf(text(intake, 4)), integrations: integrationsOf(text(intake, 5)), sme: smeOf(text(intake, 7)) };
}

const ENTRY_WORD: Record<EntryMode, string> = { greenfield: 'greenfield', 'requirements-driven': 'requirements-driven', 'existing-app-change': 'a change to a live app', migration: 'a migration', assurance: 'assurance only' };

/**
 * The shape and level to pre-select. Shape: assurance has no pipeline (Solo); a small greenfield or POC
 * with nothing to keep is one agent's work (Solo); a migration, integrations that must stay or a broad
 * scope want the full team on a standard project (Enterprise) and two on a small one (Startup); what's
 * left is requirements to analyse and an app to build (Startup when small or a POC, else Enterprise).
 * Level: a POC is Lean; a hard date is Balanced, Fast when it's urgent (but not when the SME is slow:
 * agents would only wait faster); open-ended is Balanced; with nothing said, Lean for Solo, else Balanced.
 */
export function recommendShape(i: RecommendInput): Recommendation {
  const s = signalsOf(i.intake);
  const why: string[] = [`${i.tier} tier`, ENTRY_WORD[i.entry]];
  if (s.driver !== 'unknown') why.push(`you said: ${s.driver === 'poc' ? 'POC / demo' : s.driver === 'hard-date' ? `a hard date${s.urgent ? ', soon' : ''}` : 'open-ended'}`);
  if (s.breadth !== 'unknown') why.push(s.breadth === 'narrow' ? 'one module or feature' : 'the whole app or several modules');
  if (s.integrations !== 'unknown') why.push(s.integrations === 'none' ? 'no integrations must stay' : s.integrations === 'many' ? 'several integrations must stay' : 'integrations must stay');
  if (s.sme !== 'unknown') why.push(s.sme === 'not-needed' ? 'no SME needed' : s.sme === 'slow' ? 'the SME is slow to answer' : 'an SME is available');

  const keeps = s.integrations === 'some' || s.integrations === 'many';
  const heavy = i.entry === 'migration' || keeps || s.breadth === 'broad';
  let shape: TeamShape;
  if (i.entry === 'assurance') shape = 'solo';
  else if (i.tier === 'small') {
    if (i.entry === 'migration' || s.integrations === 'many' || s.breadth === 'broad') shape = 'startup';
    else if ((i.entry === 'greenfield' || s.driver === 'poc') && !keeps) shape = 'solo';
    else shape = 'startup';
  } else if (heavy) shape = 'enterprise';
  else if (s.driver === 'poc' || i.entry === 'greenfield') shape = 'startup';
  else shape = 'enterprise';

  let level: LevelDef['id'];
  if (s.driver === 'poc') level = 'lean';
  else if (s.driver === 'hard-date') level = s.urgent && s.sme !== 'slow' ? 'fast' : 'balanced';
  else if (s.driver === 'open-ended') level = 'balanced';
  else level = shape === 'solo' ? 'lean' : 'balanced';
  return { shape, level, why, signals: s };
}
