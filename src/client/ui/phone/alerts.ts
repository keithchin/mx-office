// The team phone's alerts: a desktop notification (through notify.ts) and a short sound for a new
// Needs-you item only (the red ones), held back by Do not disturb and bundled by the digest
// (shared/phone.ts decides which). The workers' own alerts (asking, done) and the office's urgent
// escalations go through the same policy (setAlertPolicy), so one Do not disturb quiets them all. A turn
// the office started never alerts: it ends acknowledged, so it isn't a Needs-you item at all.

import { alertPlan, cleanAlerts, digestDue, storedAlerts, type AlertSettings } from '../../../shared/phone';
import { digestWaiting, queueDigest, setAlertPolicy, type DesktopNotifier } from '../../notify';
import type { NeedItem } from '../needsyou/logic';
import { newAlerts } from './notes';

const KEY = 'agent-office.phone.alerts';

export function loadAlerts(): AlertSettings {
  try {
    return cleanAlerts(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return cleanAlerts(undefined);
  }
}

export function saveAlerts(s: AlertSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(storedAlerts(s)));
  } catch {
    // Only for this visit, then.
  }
}

/**
 * The ping: two short square-wave notes (880 and 1320 Hz), made once as a tiny WAV and played by an
 * <audio> element. Not a Web Audio graph: starting an AudioContext opens the sound device on the
 * page's main thread, which held up the phone's paint for a sixth of a second (the performance guard,
 * 2026-10-07).
 */
export function pingWav(rate = 8000): Uint8Array {
  const notes: [number, number, number][] = [
    [880, 0, 0.08],
    [1320, 0.09, 0.17],
  ];
  const n = Math.round(rate * 0.2);
  const out = new Uint8Array(44 + n);
  const v = new DataView(out.buffer);
  const str = (at: number, t: string) => [...t].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const note = notes.find(([, a, b]) => t >= a && t < b);
    // 8-bit PCM is unsigned: 128 is silence; quiet, as the old gain of 0.05 was.
    out[44 + i] = note ? (Math.floor(t * note[0] * 2) % 2 ? 140 : 116) : 128;
  }
  return out;
}

let pingUrl: string | undefined;
/** Two short notes, quietly. Never throws (no audio, or the browser wants a tap first). */
function ping() {
  try {
    pingUrl ??= URL.createObjectURL(new Blob([pingWav() as BlobPart], { type: 'audio/wav' }));
    void new Audio(pingUrl).play().catch(() => undefined);
  } catch {
    // no sound, then
  }
}

export interface PhoneAlerts {
  settings(): AlertSettings;
  set(s: AlertSettings): void;
  /** The floor's Needs-you items now: the new ones alert (the first look at a floor only learns them). */
  saw(floor: string | undefined, items: readonly NeedItem[]): void;
}

export function phoneAlerts(notifier: DesktopNotifier, openNeeds: () => void, now = () => Date.now()): PhoneAlerts {
  let s = loadAlerts();
  let lastDigest = now();
  /** Per floor, the keys already seen; a floor's first look alerts nothing. */
  const seen = new Map<string, Set<string>>();
  setAlertPolicy((urgent) => alertPlan(urgent, s, now()));

  setInterval(() => {
    if (!digestDue(s, digestWaiting(), lastDigest, now())) return;
    lastDigest = now();
    notifier.flushDigest(openNeeds);
  }, 20_000);

  return {
    settings: () => s,
    set(next) {
      s = next;
      saveAlerts(s);
    },
    saw(floor, items) {
      if (!floor) return;
      const had = seen.get(floor);
      seen.set(floor, new Set(items.map((n) => n.key)));
      if (!had) return;
      // One ping however many arrive at once.
      let pinged = false;
      for (const n of newAlerts(items, had)) {
        const urgent = n.level === 'block';
        const plan = alertPlan(urgent, s, now());
        if (plan === 'drop') continue;
        if (plan === 'digest') {
          queueDigest(n.text);
          continue;
        }
        notifier.notice(`${n.icon} ${n.text}`, 'Open the team phone to act on it', `need-${n.key}`, openNeeds, urgent);
        if (s.sound && !pinged) {
          pinged = true;
          ping();
        }
      }
    },
  };
}
