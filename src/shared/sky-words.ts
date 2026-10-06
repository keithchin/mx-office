// The sky over the office in words, for ⚙️ Settings' Outside (the 3D window and the flat Settings page
// alike): "🌙 Clear · 9:41 PM outside · Berlin, Germany, 11 °C". Pure, no three.js, so the flat views
// can say it too; the 3D sky (client/world/sky.ts) re-exports it.

import type { SkyState, Weather } from './protocol.js';
import { skyNow, sunPosition } from './sun.js';

const DEG = Math.PI / 180;
const LABEL: Record<Weather, string> = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Thunderstorm', snow: 'Snow', fog: 'Fog' };
const ICON: Record<Weather, string> = { clear: '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️', snow: '🌨️', fog: '🌫️' };

/** "🌙 Clear · 9:41 PM outside · Berlin, Germany, 11 °C", for Settings: the time of day in the sky (see skyTime). */
export function describeSky(s: SkyState, now = Date.now()): string {
  const sky = skyNow(now, s);
  const night = sunPosition(sky, s.lat, s.lon).el < -4 * DEG;
  const icon = s.weather === 'clear' && night ? '🌙' : ICON[s.weather];
  const time = new Date(sky + s.utcOffset * 60_000).toLocaleTimeString([], { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
  const where = s.city ? ` · ${s.city}${s.temp !== undefined ? `, ${s.temp} °C` : ''}` : '';
  return `${icon} ${LABEL[s.weather]} · ${time} outside${where}`;
}
