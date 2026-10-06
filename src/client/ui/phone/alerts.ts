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

let audio: AudioContext | undefined;
/** Two short notes, quietly. Never throws (no audio, or the browser wants a tap first). */
function ping() {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'square';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.05, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.08);
      o.connect(g).connect(audio.destination);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.1);
    }
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
      for (const n of newAlerts(items, had)) {
        const urgent = n.level === 'block';
        const plan = alertPlan(urgent, s, now());
        if (plan === 'drop') continue;
        if (plan === 'digest') {
          queueDigest(n.text);
          continue;
        }
        notifier.notice(`${n.icon} ${n.text}`, 'Open the team phone to act on it', `need-${n.key}`, openNeeds, urgent);
        if (s.sound) ping();
      }
    },
  };
}
