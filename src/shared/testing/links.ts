// Where the Testing tab's links come from (Testing release 1, part B), all from files at main:
//   * recorded: architecture/acceptance-criteria.md's AC → journey table; test and journey files that
//     name UC / BR / AC ids or point into a BRD (F001#/useCases/0); a report's own requirement field;
//   * inferred: ids in a test's name, a PR title or a report's file name, kept with the rule that matched.
// The use cases and business rules are the BRDs' (analysis/knowledge-base/brd/*.brd.json). Pure: no Node.

import type { Link } from './record.js';

export interface BrdUseCase {
  id: string;
  title: string;
  /** The business rules it names, and those whose appliesTo names it. */
  rules: string[];
}

export interface BrdRule {
  id: string;
  title: string;
  appliesTo: string[];
}

export interface Brd {
  /** F001 */
  id: string;
  title: string;
  file: string;
  useCases: BrdUseCase[];
  rules: BrdRule[];
}

export interface AcRow {
  /** AC-04 */
  id: string;
  text: string;
  /** The Proof cell as written. */
  proof: string;
  /** Journey ids the proof names (J-01, a range "J-01 to J-05" spelled out). */
  journeys: string[];
  /** UC / BR ids the criterion itself names. */
  names: string[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export const UC_RE = /\bUC-?\d{2,4}\b/g;
export const BR_RE = /\bBR-?\d{2,4}\b/g;
export const AC_RE = /\bAC-\d{1,4}\b/g;
export const J_RE = /\bJ-\d{1,3}[a-z]?\b/g;

/** "UC-001" and "UC001" are the same use case; ids are kept the way the BRD writes them (UC001, BR012, AC-04). */
export const normId = (id: string) => {
  const m = /^(UC|BR)-?(\d+)$/i.exec(id);
  return m ? `${m[1].toUpperCase()}${m[2]}` : id.toUpperCase().replace(/^J-/, 'J-');
};

const uniq = <T>(xs: T[]) => [...new Set(xs)];

/** Every UC / BR / AC id in a text, normalised. */
export function idsIn(text: string): string[] {
  return uniq([...(text.match(UC_RE) ?? []), ...(text.match(BR_RE) ?? []), ...(text.match(AC_RE) ?? [])].map(normId));
}

/** Journey ids in a text, a range ("J-01 to J-05", "J-01..J-05") spelled out. */
export function journeysIn(text: string): string[] {
  const out: string[] = [];
  const ranged = text.replace(/\bJ-(\d{1,3})\s*(?:to|\.\.|–|—)\s*J-(\d{1,3})\b/g, (_m, a: string, b: string) => {
    const from = Number(a);
    const to = Number(b);
    if (to >= from && to - from <= 50) for (let n = from; n <= to; n++) out.push(`J-${String(n).padStart(a.length, '0')}`);
    return ' ';
  });
  out.push(...(ranged.match(J_RE) ?? []));
  return uniq(out);
}

/** A BRD file's use cases and business rules; undefined when it isn't one. */
export function parseBrd(text: string, file: string): Brd | undefined {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(text.replace(/^﻿/, '')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!d || typeof d !== 'object' || !Array.isArray(d.useCases)) return undefined;
  const rules: BrdRule[] = (Array.isArray(d.businessRules) ? d.businessRules : [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string')
    .map((r) => ({ id: normId(str(r.id)), title: str(r.title) || str(r.name), appliesTo: strs(r.appliesTo).map(normId) }));
  const useCases: BrdUseCase[] = (d.useCases as unknown[])
    .filter((u): u is Record<string, unknown> => !!u && typeof u === 'object' && typeof (u as { id?: unknown }).id === 'string')
    .map((u) => {
      const id = normId(str(u.id));
      const own = strs(u.rules).map(normId);
      const applying = rules.filter((r) => r.appliesTo.includes(id)).map((r) => r.id);
      return { id, title: str(u.title) || str(u.name), rules: uniq([...own, ...applying]).sort() };
    });
  return { id: str(d.id) || file.replace(/\..*$/, ''), title: str(d.title) || str(d.id) || file, file, useCases, rules };
}

/** "F001#/useCases/0" or "F001#/businessRules/12" → UC001 / BR013, from the BRDs; undefined when it points nowhere known. */
export function resolvePointer(ptr: string, brds: readonly Brd[]): string | undefined {
  const m = /^\s*([A-Za-z0-9_-]+)#\/(useCases|businessRules)\/(\d+)\s*$/.exec(ptr);
  if (!m) return undefined;
  const brd = brds.find((b) => b.id === m[1]);
  if (!brd) return undefined;
  const list = m[2] === 'useCases' ? brd.useCases : brd.rules;
  return list[Number(m[3])]?.id;
}

/** BRD pointers in a text ("F001#/useCases/0, F001#/businessRules/1"). */
export const pointersIn = (text: string) => text.match(/\b[A-Za-z0-9_-]+#\/(?:useCases|businessRules)\/\d+/g) ?? [];

/** The acceptance-criteria table rows: | AC-01 | criterion | proof |. */
export function parseAcTable(md: string): AcRow[] {
  const out: AcRow[] = [];
  for (const line of md.replace(/\r/g, '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const id = cells[0]?.match(/^AC-\d{1,4}$/) ? cells[0] : undefined;
    if (!id || out.some((r) => r.id === id)) continue;
    const text = cells[1] ?? '';
    const proof = cells.slice(2).join(' | ');
    out.push({ id, text, proof, journeys: journeysIn(proof), names: idsIn(text).filter((x) => !x.startsWith('AC-')) });
  }
  return out;
}

/** Recorded links from what a file says: the ids it names and the BRD entries it points at. */
export function recordedLinks(text: string, via: string, brds: readonly Brd[]): Link[] {
  const ids = idsIn(text);
  for (const p of pointersIn(text)) {
    const id = resolvePointer(p, brds);
    if (id) ids.push(id);
  }
  return uniq(ids).map((target) => ({ target, basis: 'recorded', via }));
}

/** The rule that matched, in words, by where it was found. */
export type InferWhere = 'test name' | 'PR title' | 'report file name';

/** Inferred links from a name: each UC / BR / AC id (and journey id) in it, with its rule. */
export function inferredLinks(text: string, where: InferWhere, via: string): Link[] {
  const out: Link[] = [];
  for (const id of idsIn(text)) {
    const kind = id.startsWith('UC') ? 'use case id' : id.startsWith('BR') ? 'business rule id' : 'acceptance criterion id';
    out.push({ target: id, basis: 'inferred', via, rule: `${kind} in the ${where}` });
  }
  for (const j of text.match(J_RE) ?? []) if (!out.some((l) => l.target === j)) out.push({ target: j, basis: 'inferred', via, rule: `journey id in the ${where}` });
  return out;
}

/** Links joined by target, a recorded one winning over an inferred one for the same target. */
export function mergeLinks(...lists: Link[][]): Link[] {
  const by = new Map<string, Link>();
  for (const l of lists.flat()) {
    const had = by.get(l.target);
    if (!had || (had.basis === 'inferred' && l.basis === 'recorded')) by.set(l.target, l);
  }
  return [...by.values()];
}

/** A journey file's id from its name: tests/e2e/J-02b.journey.json → J-02b. */
export const journeyIdOf = (file: string) => /(?:^|\/)(J-\d{1,3}[a-z]?)[^/]*$/.exec(file)?.[1];
