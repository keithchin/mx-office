// The fixture generator's toolbox: one seeded random stream (shared/rng.ts's Mulberry32), ids and
// synthetic text made from it, and a fixed clock. Nothing here reads the time or real data, so the same
// seed always gives the same bytes.

import { mulberry32 } from '../../../src/shared/rng.js';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Where the generated data ends (its newest event) unless the caller says otherwise: 2026-10-01 UTC. */
export const DEFAULT_BASE = Date.UTC(2026, 9, 1);

export class Gen {
  readonly rand: () => number;
  private seq = 0;

  constructor(
    seed: number,
    /** The newest moment in the data: everything is spread over the days before it. */
    readonly base: number,
  ) {
    this.rand = mulberry32(seed);
  }

  int(lo: number, hi: number): number {
    return lo + Math.floor(this.rand() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.rand() < p;
  }

  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rand() * xs.length)];
  }

  /** Some of `xs`, in their order, each kept with probability `p` (at least one). */
  some<T>(xs: readonly T[], p = 0.5): T[] {
    const out = xs.filter(() => this.chance(p));
    return out.length ? out : [this.pick(xs)];
  }

  hex(n: number): string {
    let s = '';
    while (s.length < n) s += Math.floor(this.rand() * 0x100000000).toString(16).padStart(8, '0');
    return s.slice(0, n);
  }

  /** A worker id, as the office makes them (12 hex). */
  workerId(): string {
    return this.hex(12);
  }

  uuid(): string {
    const h = this.hex(32);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

  /** A short id like the chatter's (14 url-safe characters). */
  shortId(): string {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let s = '';
    for (let i = 0; i < 14; i++) s += abc[Math.floor(this.rand() * 64)];
    return s;
  }

  /** A unique, sortable id with a prefix. */
  id(prefix: string): string {
    return `${prefix}-${(this.seq++).toString(36).padStart(5, '0')}${this.hex(4)}`;
  }

  /** A moment `days` back from the base at most, at least `minAgo` ms before it. */
  ago(days: number, minAgo = 0): number {
    return this.base - minAgo - Math.floor(this.rand() * Math.max(1, days * DAY - minAgo));
  }

  /** The day (YYYY-MM-DD, UTC) of a moment. */
  static day(at: number): string {
    return new Date(at).toISOString().slice(0, 10);
  }

  /** A sentence of synthetic project talk, `words` long (roughly). */
  sentence(words = 12): string {
    const out: string[] = [];
    for (let i = 0; i < words; i++) out.push(this.pick(WORDS));
    const s = out.join(' ');
    return `${s[0].toUpperCase()}${s.slice(1)}.`;
  }

  paragraph(sentences = 3, words = 12): string {
    return Array.from({ length: sentences }, () => this.sentence(this.int(Math.max(4, words - 5), words + 5))).join(' ');
  }

  /** A task title: "Add the order export page", "Fix the approval microflow"… */
  title(): string {
    return `${this.pick(VERBS)} the ${this.pick(THINGS)} ${this.pick(PARTS)}`;
  }
}

const VERBS = ['Add', 'Fix', 'Refactor', 'Review', 'Test', 'Design', 'Document', 'Validate', 'Split', 'Wire up', 'Harden', 'Draft'];
const THINGS = ['order', 'invoice', 'customer', 'approval', 'inventory', 'shipment', 'report', 'dashboard', 'profile', 'catalog', 'payment', 'audit', 'session', 'workflow', 'notification'];
const PARTS = ['page', 'microflow', 'entity', 'export', 'import job', 'API', 'validation', 'list view', 'form', 'module', 'security role', 'nanoflow', 'unit tests', 'e2e journey'];
const WORDS = [
  'the', 'a', 'module', 'page', 'entity', 'microflow', 'review', 'build', 'test', 'branch', 'merge', 'pull', 'request', 'domain', 'model', 'layout',
  'widget', 'checks', 'passed', 'failed', 'again', 'after', 'before', 'scope', 'design', 'plan', 'stage', 'gate', 'brief', 'draft', 'journal',
  'subagent', 'lead', 'handoff', 'standup', 'next', 'blocked', 'ready', 'waiting', 'approve', 'reject', 'option', 'risk', 'budget', 'cost',
  'order', 'invoice', 'customer', 'approval', 'inventory', 'report', 'dashboard', 'export', 'import', 'validation', 'role', 'access', 'rule',
  'is', 'was', 'needs', 'has', 'with', 'for', 'into', 'from', 'on', 'and', 'but', 'so', 'then', 'now', 'still', 'only', 'every', 'one',
];

/** First names for workers (none from the roster's own pool, so a worker never looks like a member). */
export const WORKER_NAMES = [
  'Pixel', 'Bolt', 'Widget', 'Sprocket', 'Nimbus', 'Quill', 'Rivet', 'Comet', 'Juniper', 'Marble', 'Pepper', 'Tango', 'Echo', 'Zephyr', 'Clover',
  'Maple', 'Orbit', 'Saffron', 'Cobalt', 'Hazel', 'Indigo', 'Kestrel', 'Lumen', 'Mosaic', 'Nova', 'Onyx', 'Prism', 'Quartz', 'Rune', 'Sable',
  'Tidal', 'Umber', 'Vesper', 'Wren', 'Yarrow', 'Zinnia', 'Basil', 'Cedar', 'Dune', 'Ember',
];

/** People who use the synthetic office. */
export const PEOPLE = ['Avery Park', 'Jordan Lee', 'Sam Rivera', 'Robin Chen'];
