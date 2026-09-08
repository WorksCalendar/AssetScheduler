/**
 * RRULE expansion over household wall-clock time.
 *
 * Supports the RFC 5545 subset a family calendar actually uses:
 *
 *   FREQ=DAILY|WEEKLY|MONTHLY|YEARLY   INTERVAL   COUNT   UNTIL
 *   BYDAY (incl. ordinals: 3SA, -1FR)  BYMONTHDAY   BYMONTH
 *
 * Everything else in the spec (BYSETPOS, BYWEEKNO, BYYEARDAY, WKST, …) is
 * deliberately absent. Adding a rule nobody can express in the UI would be
 * untested code on the path that decides whether Redmond has practice.
 *
 * Two invariants matter more than coverage:
 *
 *  1. Occurrences step in LOCAL time. Weekly means "same clock time next week",
 *     which is 7 local days, not 168 hours — those differ twice a year.
 *  2. COUNT counts from DTSTART, not from the start of the window being
 *     rendered. Counting only what is visible makes "10 swim lessons" grow
 *     every time you scroll back, which is the same bug in a different hat.
 */

import { addDays, dayKey, formatWall, parseWall, startOfDay, DAY_INDEX } from './time.js';

/** Ceiling on generated periods, so a malformed rule cannot spin forever. */
const MAX_PERIODS = 4000;

/** Ceiling on emitted occurrences for one series in one call. */
const MAX_OCCURRENCES = 2000;

/**
 * @typedef {Object} ByDay
 * @property {number | null} ordinal  1 = first, -1 = last, null = every
 * @property {number} day             `Date.getDay()` index
 */

/**
 * @typedef {Object} ParsedRule
 * @property {'DAILY'|'WEEKLY'|'MONTHLY'|'YEARLY'} freq
 * @property {number} interval
 * @property {number | null} count
 * @property {Date | null} until
 * @property {ByDay[] | null} byDay
 * @property {number[] | null} byMonthDay
 * @property {number[] | null} byMonth
 */

const FREQS = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);

/**
 * Parse an RRULE string into its parts.
 *
 * The leading `RRULE:` is optional, casing is ignored, and unknown parts are
 * dropped rather than rejected — a rule copied out of another calendar should
 * still produce the right dates for the parts we do understand.
 *
 * @param {string} s
 * @returns {ParsedRule | null} null when there is no usable FREQ
 */
export function parseRRule(s) {
  if (typeof s !== 'string' || s.trim() === '') return null;

  /** @type {Record<string, string>} */
  const parts = {};
  for (const chunk of s.replace(/^RRULE:/i, '').split(';')) {
    const eq = chunk.indexOf('=');
    if (eq === -1) continue;
    parts[chunk.slice(0, eq).trim().toUpperCase()] = chunk.slice(eq + 1).trim();
  }

  const freq = (parts['FREQ'] || '').toUpperCase();
  if (!FREQS.has(freq)) return null;

  const interval = Math.max(1, parseInt(parts['INTERVAL'] || '1', 10) || 1);
  const count = parts['COUNT'] ? Math.max(1, parseInt(parts['COUNT'], 10)) : null;

  let until = null;
  if (parts['UNTIL']) {
    until = parseUntil(parts['UNTIL']);
  }

  const byDay = parts['BYDAY'] ? parseByDay(parts['BYDAY']) : null;
  const byMonthDay = parts['BYMONTHDAY'] ? numberList(parts['BYMONTHDAY']) : null;
  const byMonth = parts['BYMONTH'] ? numberList(parts['BYMONTH']) : null;

  return {
    freq: /** @type {ParsedRule['freq']} */ (freq),
    interval,
    count,
    until,
    byDay: byDay && byDay.length > 0 ? byDay : null,
    byMonthDay: byMonthDay && byMonthDay.length > 0 ? byMonthDay : null,
    byMonth: byMonth && byMonth.length > 0 ? byMonth : null,
  };
}

/**
 * UNTIL arrives either as a basic-format iCal stamp (`20261231T235959Z`) or as
 * the wall-clock string this app writes. Both are read as a local wall-clock
 * ceiling: an UNTIL is a "stop after this date" fence, and pulling it back
 * across midnight by a UTC offset would drop the last occurrence.
 *
 * @param {string} v
 * @returns {Date | null}
 */
function parseUntil(v) {
  const basic = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(v.trim());
  if (basic) {
    return new Date(
      +basic[1], +basic[2] - 1, +basic[3],
      basic[4] ? +basic[4] : 23,
      basic[5] ? +basic[5] : 59,
      basic[6] ? +basic[6] : 59,
      0,
    );
  }
  try {
    return parseWall(v);
  } catch {
    return null;
  }
}

/**
 * @param {string} v
 * @returns {ByDay[]}
 */
function parseByDay(v) {
  /** @type {ByDay[]} */
  const out = [];
  for (const token of v.split(',')) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(token.trim());
    if (!m) continue;
    const day = DAY_INDEX[/** @type {keyof typeof DAY_INDEX} */ (m[2].toUpperCase())];
    const ordinal = m[1] ? parseInt(m[1], 10) : null;
    if (ordinal === 0) continue;
    out.push({ ordinal, day });
  }
  return out;
}

/**
 * @param {string} v
 * @returns {number[]}
 */
function numberList(v) {
  return v
    .split(',')
    .map((n) => parseInt(n.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

/**
 * Every occurrence of a weekday in a month, or the nth / nth-from-last one.
 *
 * @param {number} year
 * @param {number} month  0-indexed
 * @param {ByDay} bd
 * @param {Date} template  supplies the hours/minutes
 * @returns {Date[]}
 */
function weekdaysInMonth(year, month, bd, template) {
  /** @type {Date[]} */
  const all = [];
  const probe = new Date(year, month, 1, template.getHours(), template.getMinutes(), 0, 0);
  while (probe.getMonth() === month) {
    if (probe.getDay() === bd.day) all.push(new Date(probe.getTime()));
    probe.setDate(probe.getDate() + 1);
  }
  if (bd.ordinal === null) return all;
  const idx = bd.ordinal > 0 ? bd.ordinal - 1 : all.length + bd.ordinal;
  const hit = all[idx];
  return hit ? [hit] : [];
}

/**
 * Candidate start times inside one recurrence period.
 *
 * @param {{ year: number, month: number, day: number }} period
 * @param {ParsedRule} rule
 * @param {Date} dtstart
 * @returns {Date[]}
 */
function candidatesForPeriod(period, rule, dtstart) {
  const h = dtstart.getHours();
  const min = dtstart.getMinutes();

  if (rule.freq === 'DAILY') {
    const d = new Date(period.year, period.month, period.day, h, min, 0, 0);
    if (rule.byDay && !rule.byDay.some((bd) => bd.day === d.getDay())) return [];
    if (rule.byMonthDay && !rule.byMonthDay.includes(d.getDate())) return [];
    if (rule.byMonth && !rule.byMonth.includes(d.getMonth() + 1)) return [];
    return [d];
  }

  if (rule.freq === 'WEEKLY') {
    // `period.day` is the Sunday that opens the week.
    const weekStart = new Date(period.year, period.month, period.day, h, min, 0, 0);
    const days = rule.byDay ? rule.byDay.map((bd) => bd.day) : [dtstart.getDay()];
    return days
      .map((dow) => {
        const d = new Date(weekStart.getTime());
        d.setDate(weekStart.getDate() + dow);
        return d;
      })
      .filter((d) => !rule.byMonth || rule.byMonth.includes(d.getMonth() + 1))
      .sort((a, b) => a.getTime() - b.getTime());
  }

  // MONTHLY and YEARLY both resolve to a set of (month, day) pairs.
  const months = rule.freq === 'YEARLY'
    ? (rule.byMonth ?? [dtstart.getMonth() + 1]).map((m) => m - 1)
    : [period.month];

  if (rule.freq === 'MONTHLY' && rule.byMonth && !rule.byMonth.includes(period.month + 1)) {
    return [];
  }

  /** @type {Date[]} */
  const out = [];
  for (const month of months) {
    if (rule.byDay) {
      for (const bd of rule.byDay) {
        out.push(...weekdaysInMonth(period.year, month, bd, dtstart));
      }
      continue;
    }
    const daysOfMonth = rule.byMonthDay ?? [dtstart.getDate()];
    for (const md of daysOfMonth) {
      // A negative BYMONTHDAY counts back from the end; -1 is the last day.
      const lastDay = new Date(period.year, month + 1, 0).getDate();
      const dom = md > 0 ? md : lastDay + md + 1;
      if (dom < 1 || dom > lastDay) continue; // e.g. the 31st of February
      out.push(new Date(period.year, month, dom, h, min, 0, 0));
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Step the period cursor forward by one INTERVAL.
 *
 * Months are advanced as a (year, month) pair rather than by mutating a Date,
 * because `setMonth` on the 31st slides into the following month and every
 * later occurrence inherits the drift.
 *
 * @param {{ year: number, month: number, day: number }} period
 * @param {ParsedRule} rule
 * @returns {{ year: number, month: number, day: number }}
 */
function advance(period, rule) {
  if (rule.freq === 'DAILY' || rule.freq === 'WEEKLY') {
    const step = rule.freq === 'DAILY' ? rule.interval : rule.interval * 7;
    const d = new Date(period.year, period.month, period.day + step, 12, 0, 0, 0);
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  }
  const monthStep = rule.freq === 'MONTHLY' ? rule.interval : rule.interval * 12;
  const total = period.year * 12 + period.month + monthStep;
  return { year: Math.floor(total / 12), month: total % 12, day: 1 };
}

/**
 * Expand a recurrence rule into concrete start times.
 *
 * @param {Date} dtstart          first occurrence, local time
 * @param {string} rrule
 * @param {Iterable<string>} exdates  wall-clock or date-only strings to skip
 * @param {Date} rangeStart       window to collect (inclusive)
 * @param {Date} rangeEnd         window to collect (inclusive)
 * @returns {Date[]} occurrence starts inside the window, ascending
 */
export function expandRRule(dtstart, rrule, exdates, rangeStart, rangeEnd) {
  const rule = parseRRule(rrule);
  if (!rule) return dtstart >= rangeStart && dtstart <= rangeEnd ? [new Date(dtstart.getTime())] : [];

  const skip = new Set();
  for (const ex of exdates ?? []) {
    if (typeof ex !== 'string') continue;
    skip.add(ex.trim().slice(0, 16));
  }

  const hardEnd = rule.until && rule.until < rangeEnd ? rule.until : rangeEnd;

  /** @type {Date[]} */
  const found = [];
  let emitted = 0; // counts toward COUNT, including occurrences before the window

  let period = rule.freq === 'WEEKLY'
    ? (() => {
        const sunday = addDays(startOfDay(dtstart), -dtstart.getDay());
        return { year: sunday.getFullYear(), month: sunday.getMonth(), day: sunday.getDate() };
      })()
    : { year: dtstart.getFullYear(), month: dtstart.getMonth(), day: dtstart.getDate() };

  for (let i = 0; i < MAX_PERIODS; i++) {
    const candidates = candidatesForPeriod(period, rule, dtstart);

    for (const c of candidates) {
      if (c < dtstart) continue;
      if (rule.until && c > rule.until) return sortUnique(found);
      if (rule.count !== null && emitted >= rule.count) return sortUnique(found);

      // An occurrence removed by EXDATE still consumes nothing: RFC 5545 counts
      // occurrences generated by the rule, and the exception list is applied
      // after COUNT. Increment first, then decide whether to keep it.
      emitted++;

      const isSkipped = skip.has(formatWall(c)) || skip.has(dayKey(c));
      if (!isSkipped && c >= rangeStart && c <= hardEnd) {
        found.push(new Date(c.getTime()));
        if (found.length >= MAX_OCCURRENCES) return sortUnique(found);
      }
    }

    // Stop once the cursor is past everything we could still collect. The
    // check is deliberately loose (a whole period of slack) so a period that
    // opens after the window but contains an earlier candidate is not cut off.
    const cursor = new Date(period.year, period.month, period.day, 0, 0, 0, 0);
    if (cursor > hardEnd) break;
    if (rule.count !== null && emitted >= rule.count) break;

    period = advance(period, rule);
  }

  return sortUnique(found);
}

/**
 * @param {Date[]} dates
 * @returns {Date[]}
 */
function sortUnique(dates) {
  const seen = new Set();
  /** @type {Date[]} */
  const out = [];
  for (const d of dates.sort((a, b) => a.getTime() - b.getTime())) {
    const k = d.getTime();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}

/**
 * Plain-English summary of a rule, for notification bodies and the wall display.
 *
 * @param {string} rrule
 * @returns {string} empty string when the rule is absent or unreadable
 */
export function describeRRule(rrule) {
  const rule = parseRRule(rrule);
  if (!rule) return '';

  const every = rule.interval === 1 ? '' : `every ${rule.interval} `;
  const names = { SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat' };
  const dayNames = (rule.byDay ?? [])
    .map((bd) => Object.keys(DAY_INDEX).find((k) => DAY_INDEX[/** @type {keyof typeof DAY_INDEX} */ (k)] === bd.day))
    .filter((k) => typeof k === 'string')
    .map((k) => names[/** @type {keyof typeof names} */ (k)]);

  let base;
  switch (rule.freq) {
    case 'DAILY':
      base = rule.interval === 1 ? 'Daily' : `Every ${rule.interval} days`;
      break;
    case 'WEEKLY':
      base = dayNames.length > 0
        ? `${rule.interval === 1 ? 'Weekly' : `Every ${rule.interval} weeks`} on ${dayNames.join(', ')}`
        : rule.interval === 1 ? 'Weekly' : `Every ${rule.interval} weeks`;
      break;
    case 'MONTHLY':
      base = `${every === '' ? 'Monthly' : `Every ${rule.interval} months`}`;
      break;
    default:
      base = rule.interval === 1 ? 'Yearly' : `Every ${rule.interval} years`;
  }

  if (rule.count !== null) return `${base}, ${rule.count} times`;
  if (rule.until) return `${base}, until ${dayKey(rule.until)}`;
  return base;
}
