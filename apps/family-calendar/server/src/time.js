/**
 * Wall-clock time helpers.
 *
 * The whole calendar is stored in HOUSEHOLD WALL-CLOCK TIME — the string
 * `2026-09-08T16:00`, with no offset and no zone suffix. "Soccer at 4pm" means
 * 4pm on the kitchen clock, in March and in July alike; storing a UTC instant
 * and adding seven days to it would silently move practice an hour when the
 * clocks change.
 *
 * The server therefore runs in the household's timezone (set TZ before
 * launching — see config.js) and every recurrence step is done with the local
 * Date methods, which know about DST. UTC instants are still derived on the way
 * out, because reminders have to fire at a real moment in time; they are never
 * the stored form.
 */

const WALL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Two-digit zero pad. */
function p2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Parse a wall-clock string into a Date in the server's local timezone.
 * A date-only string is taken as midnight that morning.
 *
 * @param {string} s
 * @returns {Date}
 * @throws {TypeError} when the string is not a wall-clock timestamp
 */
export function parseWall(s) {
  if (typeof s !== 'string') throw new TypeError(`wall-clock time must be a string, got ${typeof s}`);
  const trimmed = s.trim();
  const m = WALL.exec(trimmed);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, 0);
  }
  const d = DATE_ONLY.exec(trimmed);
  if (d) {
    return new Date(+d[1], +d[2] - 1, +d[3], 0, 0, 0, 0);
  }
  throw new TypeError(`not a wall-clock timestamp: ${s}`);
}

/**
 * Format a Date as a household wall-clock string, minute precision.
 *
 * @param {Date} d
 * @returns {string} `YYYY-MM-DDTHH:MM`
 */
export function formatWall(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/**
 * The calendar day a Date falls on, as `YYYY-MM-DD`.
 *
 * @param {Date} d
 * @returns {string}
 */
export function dayKey(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/**
 * `HH:MM` for a Date.
 *
 * @param {Date} d
 * @returns {string}
 */
export function timeKey(d) {
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/**
 * True when a string is a valid wall-clock or date-only timestamp.
 *
 * @param {unknown} s
 * @returns {boolean}
 */
export function isWall(s) {
  return typeof s === 'string' && (WALL.test(s.trim()) || DATE_ONLY.test(s.trim()));
}

/**
 * Normalise any accepted time input to a wall-clock string.
 *
 * Accepts a wall-clock string (returned as-is, seconds trimmed), a date-only
 * string (midnight), or a Date. An ISO string carrying an offset or a `Z` is
 * rejected rather than silently reinterpreted: an instant is not a wall clock,
 * and guessing which one the caller meant is how "4pm" becomes "9pm".
 *
 * @param {string | Date} v
 * @returns {string}
 */
export function toWall(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new TypeError('invalid Date');
    return formatWall(v);
  }
  if (typeof v === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/.test(v.trim())) {
    throw new TypeError(
      `times must be household wall clock (YYYY-MM-DDTHH:MM), not an instant with an offset: ${v}`,
    );
  }
  return formatWall(parseWall(v));
}

/**
 * Midnight at the start of the day `d` falls on.
 *
 * @param {Date} d
 * @returns {Date}
 */
export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * `n` days after `d`, preserving the wall-clock time across DST boundaries.
 *
 * @param {Date} d
 * @param {number} n
 * @returns {Date}
 */
export function addDays(d, n) {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + n);
  return out;
}

/** Weekday names in RFC 5545 order, indexed to `Date.getDay()`. */
export const RFC_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** `Date.getDay()` index for each RFC 5545 weekday code. */
export const DAY_INDEX = Object.freeze({ SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 });
