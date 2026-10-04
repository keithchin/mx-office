// How the office runs floors' live apps: which mxcli, which ports it may hand out, and the PostgreSQL
// the apps keep their data in. Environment variables win over <data dir>/live-app.json, which wins
// over the defaults, so a laptop needs nothing set and a server can be told everything once.

import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface LiveAppConfig {
  /** The mxcli to run (a name on PATH, or a path). */
  mxcli: string;
  /** The ports apps may take, both ends included. Each app needs three: the app's, its admin API's and mxbuild's. */
  ports: { from: number; to: number };
  db: { host: string; port: number; user: string; password: string };
  /** How often (ms) a running app's branch is asked about on GitHub (git ls-remote). 0 turns auto-refresh off. */
  pollMs: number;
  /** How long (ms) a start may take before it counts as failed: a cold start bundles the web client. */
  readyTimeoutMs: number;
}

export const LIVE_APP_DEFAULTS: LiveAppConfig = {
  mxcli: 'mxcli',
  ports: { from: 8110, to: 8199 },
  db: { host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres' },
  pollMs: 60_000,
  readyTimeoutMs: 8 * 60_000,
};

/** "8110-8199" (or "8110") as a range; undefined when it isn't one. */
export function parseRange(s: string | undefined): { from: number; to: number } | undefined {
  const m = /^\s*(\d{2,5})\s*(?:-\s*(\d{2,5}))?\s*$/.exec(s ?? '');
  if (!m) return undefined;
  const from = Number(m[1]);
  const to = Number(m[2] ?? m[1]);
  return from >= 1024 && to <= 65535 && from <= to ? { from, to } : undefined;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * The live apps' settings: AGENT_OFFICE_LIVE_* from `env`, then `live-app.json` in the office's data
 * folder ({ "mxcli", "ports": "8110-8199", "dbHost": "127.0.0.1:5432", "dbUser", "dbPassword", "pollSeconds" }).
 */
export function liveAppConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): LiveAppConfig {
  let file: Record<string, unknown> = {};
  try {
    file = JSON.parse(readFileSync(path.join(dataDir, 'live-app.json'), 'utf8')) ?? {};
  } catch {
    // No file (the usual case), or one we can't read: the defaults and the environment.
  }
  const d = LIVE_APP_DEFAULTS;
  const hostPort = text(env.AGENT_OFFICE_LIVE_DB_HOST) ?? text(file.dbHost) ?? `${d.db.host}:${d.db.port}`;
  const [host, port] = splitHost(hostPort, d.db.port);
  const pollS = num(env.AGENT_OFFICE_LIVE_POLL_SECONDS) ?? num(file.pollSeconds);
  return {
    mxcli: text(env.AGENT_OFFICE_LIVE_MXCLI) ?? text(file.mxcli) ?? d.mxcli,
    ports: parseRange(env.AGENT_OFFICE_LIVE_PORTS) ?? parseRange(text(file.ports)) ?? d.ports,
    db: {
      host,
      port,
      user: text(env.AGENT_OFFICE_LIVE_DB_USER) ?? text(file.dbUser) ?? d.db.user,
      password: env.AGENT_OFFICE_LIVE_DB_PASSWORD ?? text(file.dbPassword) ?? d.db.password,
    },
    pollMs: pollS === undefined ? d.pollMs : pollS * 1000,
    readyTimeoutMs: (num(env.AGENT_OFFICE_LIVE_READY_SECONDS) ?? num(file.readySeconds) ?? d.readyTimeoutMs / 1000) * 1000,
  };
}

/** "db.example:5433" → ["db.example", 5433]; "[::1]:5432" keeps its brackets off; no port → `fallback`. */
export function splitHost(s: string, fallback: number): [string, number] {
  const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(s) ?? /^([^:]+)(?::(\d+))?$/.exec(s);
  if (!m) return [s, fallback];
  return [m[1], m[2] ? Number(m[2]) : fallback];
}

/** The database a floor's app keeps its data in: its id, made safe for PostgreSQL, and "_live". */
export function databaseName(floorId: string): string {
  const base = floorId.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'floor';
  return `${/^[a-z_]/.test(base) ? base : `f_${base}`}_live`.slice(0, 63);
}
