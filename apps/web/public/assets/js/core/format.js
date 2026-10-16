/**
 * Core — formatting helpers.
 *
 * Every user-visible number, date and duration goes through here so the app has
 * one definition of "40 minutes", "2 days ago" and "₦1,200". Locale comes from
 * the browser; nothing is hard-coded to a single country.
 */

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const numberFormatter = new Intl.NumberFormat();
const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatDate(value) {
  if (!value) return '—';
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value) {
  if (!value) return '—';
  return dateTimeFormatter.format(new Date(value));
}

export function formatNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? numberFormatter.format(number) : '0';
}

export function formatPercent(value) {
  const number = Number(value ?? 0);
  return `${Math.max(0, Math.min(100, Math.round(number)))}%`;
}

/** "45 min", "1 h 15 min", "3 h" — used for lesson and course durations. */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes ?? 0)));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Seconds → "12:05" style clock, for video or time-on-task display. */
export function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds ?? 0)));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

const UNITS = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

export function formatRelative(value) {
  if (!value) return '—';
  const diff = new Date(value).getTime() - Date.now();
  const magnitude = Math.abs(diff);
  for (const [unit, ms] of UNITS) {
    if (magnitude >= ms) {
      return relativeFormatter.format(Math.round(diff / ms), /** @type {Intl.RelativeTimeFormatUnit} */ (unit));
    }
  }
  return 'just now';
}

export function formatScore(points, maxPoints) {
  return `${formatNumber(points)} / ${formatNumber(maxPoints)}`;
}

/** Human label for an enum-ish API value: `pending_verification` → `Pending verification`. */
export function humanize(value) {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value).replace(/[_-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Initials for an avatar placeholder: "Amara Nwachukwu" → "AN". */
export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'GW';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${formatNumber(count)} ${Number(count) === 1 ? singular : plural}`;
}
