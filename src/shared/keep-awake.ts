// Keep-awake while agents work (server/keep-awake/): what ⚙️ Settings shows and may change.

/** What's keeping the computer awake right now. */
export interface AwakeActivity {
  /** Workers starting or mid-turn, on every floor. */
  workers: number;
  /** Queued tasks being run, The Firm's audits, gate-checks and workflow runs. */
  jobs: number;
}

export interface KeepAwakeView {
  /** The setting: keep the computer from sleeping while agents work. */
  on: boolean;
  /** Minutes of everything idle before the computer may sleep again. */
  idleMinutes: number;
  /** The office is asking the computer not to sleep right now. */
  holding: boolean;
  activity: AwakeActivity;
  /** Since when it's been holding, or since everything went idle. */
  since?: number;
  /** When it lets go, once everything has been idle (ms). */
  releaseAt?: number;
  /** windows | darwin | linux | …: how it asks (PowerShell, caffeinate, systemd-inhibit), or that it can't. */
  platform: string;
  supported: boolean;
  /** Why it couldn't, when the helper failed. */
  error?: string;
  by?: string;
  at?: number;
  admin: boolean;
}

export const IDLE_MIN = 1;
export const IDLE_MAX = 240;
export const IDLE_DEFAULT = 10;

/** "Keeping this computer awake: 3 agents working", or why not. */
export function awakeLine(v: Pick<KeepAwakeView, 'on' | 'holding' | 'activity' | 'releaseAt' | 'supported'>, now: number): string {
  if (!v.supported) return 'Keep-awake isn’t available on this computer.';
  if (!v.on) return 'Off: this computer sleeps on its own power settings.';
  if (!v.holding) return 'Not holding: nothing is running, so this computer may sleep.';
  const { workers, jobs } = v.activity;
  const busy = [workers && `${workers} agent${workers === 1 ? '' : 's'} working`, jobs && `${jobs} job${jobs === 1 ? '' : 's'} running`].filter(Boolean).join(', ');
  if (busy) return `Keeping this computer awake: ${busy}.`;
  const left = v.releaseAt !== undefined ? Math.max(1, Math.ceil((v.releaseAt - now) / 60_000)) : undefined;
  return `Keeping this computer awake: everything is idle${left ? `, letting go in ${left} min` : ''}.`;
}
