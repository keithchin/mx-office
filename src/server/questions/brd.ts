// Reading a folder's BRDs as the toolkit finds them (bin/open-questions.sh, the same convention as
// gate-check.sh): <kb>/brd/*.brd.json where <kb> is analysis/*/knowledge-base, analysis/knowledge-base or
// knowledge-base, and analysis/sme-questions.md or analysis/*/sme-questions.md. Everything asynchronous:
// a project's folder and each worktree are read on every collection.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { BrdRef } from '../../shared/questions.js';
import type { RawQuestion } from './normalise.js';

export interface FoundFile {
  /** Absolute. */
  abs: string;
  /** Relative to the folder, with forward slashes (for git). */
  rel: string;
  name: string;
  mtimeMs: number;
  size: number;
}

export interface Found {
  brds: FoundFile[];
  smes: FoundFile[];
}

const dirs = async (p: string) => (await readdir(p, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name);

async function filesIn(root: string, relDir: string, match: (name: string) => boolean): Promise<FoundFile[]> {
  const abs = path.join(root, relDir);
  const names = (await readdir(abs).catch(() => [] as string[])).filter(match).sort();
  const out: FoundFile[] = [];
  for (const name of names) {
    const s = await stat(path.join(abs, name)).catch(() => undefined);
    if (s?.isFile()) out.push({ abs: path.join(abs, name), rel: `${relDir.replace(/\\/g, '/')}/${name}`, name, mtimeMs: s.mtimeMs, size: s.size });
  }
  return out;
}

/** The BRD and sme-questions files the toolkit would read in `dir`. */
export async function findQuestionFiles(dir: string): Promise<Found> {
  const kbs = [...(await dirs(path.join(dir, 'analysis'))).filter((d) => d !== 'knowledge-base').map((d) => `analysis/${d}/knowledge-base`), 'analysis/knowledge-base', 'knowledge-base'];
  const brds: FoundFile[] = [];
  for (const kb of kbs) brds.push(...(await filesIn(dir, `${kb}/brd`, (n) => n.endsWith('.brd.json'))));
  const smes = [...(await filesIn(dir, 'analysis', (n) => n === 'sme-questions.md'))];
  for (const d of await dirs(path.join(dir, 'analysis'))) smes.push(...(await filesIn(dir, `analysis/${d}`, (n) => n === 'sme-questions.md')));
  return { brds, smes };
}

/** What changes when any of them changes: the script needn't run again on the same files. */
export const signatureOf = (f: Found) => [...f.brds, ...f.smes].map((x) => `${x.rel}:${x.mtimeMs}:${x.size}`).join('|');

export interface BrdQuestion extends RawQuestion {
  id?: unknown;
  question?: unknown;
  kind?: unknown;
  evidence?: unknown;
  proposedPosition?: unknown;
  blocks?: unknown;
  owner?: unknown;
  sourceRef?: unknown;
  options?: unknown;
  raisedAtGate?: unknown;
}

export interface ReadBrd extends BrdRef {
  found: FoundFile;
  questions: BrdQuestion[];
  /** The file couldn't be read as JSON. */
  error?: string;
}

/** One BRD's id, title and openQuestions. */
export async function readBrd(f: FoundFile): Promise<ReadBrd> {
  try {
    const d = JSON.parse((await readFile(f.abs, 'utf8')).replace(/^﻿/, '')) as Record<string, unknown>;
    const qs = Array.isArray(d.openQuestions) ? (d.openQuestions.filter((q) => q && typeof q === 'object') as BrdQuestion[]) : [];
    return { file: f.name, ...(typeof d.id === 'string' ? { id: d.id } : {}), ...(typeof d.title === 'string' ? { title: d.title } : {}), found: f, questions: qs };
  } catch (err) {
    return { file: f.name, found: f, questions: [], error: `${f.rel}: ${(err as Error).message}` };
  }
}

/** A text field as the page shows it: trimmed, and empty for null or "none". */
export const text = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = (Array.isArray(v) ? v.join(', ') : String(v)).trim();
  return s ? s : undefined;
};

/** A choice's options, when the data has them as a list (or "a | b | c"). */
export function optionsOf(v: unknown): string[] | undefined {
  const list = Array.isArray(v) ? v.map((x) => (typeof x === 'object' && x ? String((x as Record<string, unknown>).label ?? (x as Record<string, unknown>).text ?? '') : String(x))) : typeof v === 'string' && v.includes('|') ? v.split('|') : [];
  const out = list.map((s) => s.trim()).filter(Boolean);
  return out.length >= 2 ? out.slice(0, 12) : undefined;
}

/** The date in raisedAtGate ("Stage 2 gate, 2026-08-12"): when it was put to the user. */
export function raisedAt(v: unknown): number | undefined {
  const m = /\b(\d{4}-\d{2}-\d{2})\b/.exec(typeof v === 'string' ? v : '');
  const t = m ? Date.parse(`${m[1]}T00:00:00Z`) : NaN;
  return Number.isFinite(t) ? t : undefined;
}
