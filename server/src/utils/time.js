import { env } from '../config/env.js';

/** Offset (ms) of APP_TIMEZONE from UTC at the given instant. */
function tzOffsetMs(instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: env.timezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** 'YYYY-MM-DD' + 'HH:mm' (wall-clock in APP_TIMEZONE) -> UTC Date */
export function zonedToUtc(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const first = new Date(guess.getTime() - tzOffsetMs(guess));
  return new Date(guess.getTime() - tzOffsetMs(first));
}

export const DAY_MS = 86_400_000;
export const daysBetweenInclusive = (start, end) => Math.round((new Date(end) - new Date(start)) / DAY_MS) + 1;
export const minutesBetween = (a, b) => Math.max(Math.round((new Date(b) - new Date(a)) / 60000), 0);
