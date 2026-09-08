/**
 * Turning stored series into the occurrences you actually see.
 *
 * This is a pure function over plain arrays, with no database in sight, for one
 * specific reason: the web app imports THIS FILE too. When a phone is away from
 * home it reads series out of the Supabase mirror and expands them itself, and
 * if it did that with its own copy of the logic then the phone and the wall
 * screen would drift apart — different weeks shown for the same event, and no
 * obvious way to tell which one is lying. One implementation, two callers.
 */

import { describeRRule, expandRRule } from './recurrence.js';
import { addDays, formatWall, parseWall } from './time.js';

/**
 * How far outside the requested window to expand. An occurrence that somebody
 * dragged into next week still has to be found by its ORIGINAL date, which may
 * sit outside the window being drawn.
 */
export const OVERRIDE_PAD_DAYS = 31;

/**
 * @typedef {Object} SeriesInput
 * @property {string} id
 * @property {string} title
 * @property {string} [notes]
 * @property {string} [location]
 * @property {string} [category]
 * @property {string} start
 * @property {string} end
 * @property {boolean} [allDay]
 * @property {string} [rrule]
 * @property {string[]} [exdates]
 * @property {string[]} [memberIds]
 * @property {number[]} [reminders]
 * @property {number} [rev]
 */

/**
 * @typedef {Object} OverrideInput
 * @property {string} seriesId
 * @property {string} recurrenceId
 * @property {boolean} [cancelled]
 * @property {Record<string, unknown>} [patch]
 * @property {number} [rev]
 * @property {boolean} [deleted]
 */

/**
 * Expand series into the occurrences that fall inside a window.
 *
 * @param {SeriesInput[]} series
 * @param {OverrideInput[]} overrides
 * @param {{ from: string, to: string, memberIds?: string[] }} window
 * @returns {import('./store.js').Occurrence[]} ascending by start
 */
export function expandSeries(series, overrides, window) {
  const from = parseWall(window.from);
  const to = parseWall(window.to);
  const padFrom = addDays(from, -OVERRIDE_PAD_DAYS);
  const padTo = addDays(to, OVERRIDE_PAD_DAYS);

  /** @type {Map<string, Map<string, OverrideInput>>} */
  const bySeries = new Map();
  for (const o of overrides) {
    if (o.deleted) continue;
    if (!bySeries.has(o.seriesId)) bySeries.set(o.seriesId, new Map());
    bySeries.get(o.seriesId).set(o.recurrenceId, o);
  }

  const wanted = window.memberIds && window.memberIds.length > 0 ? new Set(window.memberIds) : null;

  /** @type {import('./store.js').Occurrence[]} */
  const out = [];

  for (const s of series) {
    const rrule = s.rrule ?? '';
    const starts = expandRRule(parseWall(s.start), rrule, s.exdates ?? [], padFrom, padTo);
    const durationMs = parseWall(s.end).getTime() - parseWall(s.start).getTime();
    const seriesMembers = s.memberIds ?? [];

    for (const startDate of starts) {
      const recurrenceId = formatWall(startDate);
      const ov = bySeries.get(s.id)?.get(recurrenceId);
      if (ov?.cancelled) continue;

      const patch = ov?.patch ?? {};
      const start = typeof patch['start'] === 'string' ? patch['start'] : recurrenceId;
      const end = typeof patch['end'] === 'string'
        ? patch['end']
        : formatWall(new Date(parseWall(start).getTime() + durationMs));

      // Overlap rather than containment, so a weekend away shows up on the
      // Sunday in the middle of it and not only on the Friday it started.
      if (parseWall(end) < from || parseWall(start) > to) continue;

      const memberIds = Array.isArray(patch['memberIds'])
        ? patch['memberIds'].map(String)
        : seriesMembers;
      if (wanted && !memberIds.some((m) => wanted.has(m))) continue;

      out.push({
        id: `${s.id}::${recurrenceId}`,
        seriesId: s.id,
        recurrenceId,
        title: typeof patch['title'] === 'string' ? patch['title'] : s.title,
        notes: typeof patch['notes'] === 'string' ? patch['notes'] : (s.notes ?? ''),
        location: typeof patch['location'] === 'string' ? patch['location'] : (s.location ?? ''),
        category: typeof patch['category'] === 'string' ? patch['category'] : (s.category ?? ''),
        start,
        end,
        allDay: s.allDay ?? false,
        memberIds,
        reminders: Array.isArray(patch['reminders']) ? patch['reminders'].map(Number) : (s.reminders ?? []),
        recurring: rrule !== '',
        rrule,
        repeatText: describeRRule(rrule),
        overridden: ov !== undefined,
        rev: Math.max(s.rev ?? 0, ov?.rev ?? 0),
      });
    }
  }

  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title)));
}
