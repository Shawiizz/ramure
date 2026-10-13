import { computed } from '@angular/core';
import { locale } from '../core/i18n/i18n';

/** The formats of the UI's language, made again when it changes. */
const formats = computed(() => {
  const l = locale();
  return {
    relative: new Intl.RelativeTimeFormat(l, { numeric: 'auto' }),
    date: new Intl.DateTimeFormat(l, { day: 'numeric', month: 'short', year: 'numeric' }),
    full: new Intl.DateTimeFormat(l, { dateStyle: 'full', timeStyle: 'short' }),
    short: new Intl.DateTimeFormat(l, { dateStyle: 'short', timeStyle: 'short' }),
  };
});

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60],
  ['hour', 3600],
  ['day', 86400],
  ['week', 7 * 86400],
];

/** A commit's time: "3 hours ago" within a month, its date before. */
export function when(seconds: number, now = Date.now() / 1000): string {
  const ago = now - seconds;
  const { relative, date } = formats();
  if (ago < 60) return relative.format(0, 'second');
  if (ago < 30 * 86400) {
    const [unit, size] = [...STEPS].reverse().find(([, size]) => ago >= size) ?? STEPS[0];
    return relative.format(-Math.floor(ago / size), unit);
  }
  return date.format(seconds * 1000);
}

/** The date and time in figures. */
export function shortDate(seconds: number): string {
  return formats().short.format(seconds * 1000);
}

/** The full date and time. */
export function fullDate(seconds: number): string {
  return formats().full.format(seconds * 1000);
}
