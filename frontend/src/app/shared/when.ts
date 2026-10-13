import { LOCALE } from '../core/i18n/i18n';

const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
const date = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
const full = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'full', timeStyle: 'short' });

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60],
  ['hour', 3600],
  ['day', 86400],
  ['week', 7 * 86400],
];

/** A commit's time: "3 hours ago" within a month, its date before. */
export function when(seconds: number, now = Date.now() / 1000): string {
  const ago = now - seconds;
  if (ago < 60) return relative.format(0, 'second');
  if (ago < 30 * 86400) {
    const [unit, size] = [...STEPS].reverse().find(([, size]) => ago >= size) ?? STEPS[0];
    return relative.format(-Math.floor(ago / size), unit);
  }
  return date.format(seconds * 1000);
}

/** The full date and time. */
export function fullDate(seconds: number): string {
  return full.format(seconds * 1000);
}
