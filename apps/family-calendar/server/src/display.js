/**
 * The payload the living-room screen reads.
 *
 * An ESP32 parses this with a fixed JSON buffer and draws it on a 320×240
 * panel, so the shape is chosen for that reader rather than for a browser:
 * already grouped by day, already sorted, already formatted for display, and
 * with short keys because every byte is parsed on a microcontroller. The web
 * app deliberately does NOT use this endpoint — it reads the full event API.
 */

import { createHash } from 'node:crypto';

import { listMembers, listOccurrences } from './store.js';
import { currentRev } from './db.js';
import { addDays, dayKey, formatWall, parseWall, startOfDay } from './time.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Cap on events sent per day, so one over-booked Saturday cannot overrun the
 *  firmware's JSON buffer. The count of what was dropped still goes out. */
const MAX_ITEMS_PER_DAY = 12;

/**
 * Build the wall-display payload.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ days?: number, from?: Date, timezone: string, memberIds?: string[] }} opts
 * @returns {{
 *   rev: number, tz: string, generatedAt: string,
 *   members: Array<{ id: string, name: string, color: string }>,
 *   days: Array<{ date: string, label: string, today: boolean, more: number, items: Array<Record<string, unknown>> }>,
 * }}
 */
export function buildDisplayPayload(db, opts) {
  const now = opts.from ?? new Date();
  const dayCount = Math.min(Math.max(opts.days ?? 3, 1), 14);
  const first = startOfDay(now);
  const last = new Date(addDays(first, dayCount - 1).setHours(23, 59, 0, 0));

  const occurrences = listOccurrences(db, {
    from: formatWall(first),
    to: formatWall(last),
    ...(opts.memberIds && opts.memberIds.length > 0 ? { memberIds: opts.memberIds } : {}),
  });

  const today = dayKey(now);
  const days = [];

  for (let i = 0; i < dayCount; i++) {
    const date = addDays(first, i);
    const key = dayKey(date);
    const dayStart = startOfDay(date);
    const dayEnd = new Date(new Date(dayStart).setHours(23, 59, 0, 0));

    // Overlap, so a multi-day trip shows on every day it covers rather than
    // only on the morning it began.
    const onThisDay = occurrences.filter((o) => {
      const s = parseWall(o.start);
      const e = parseWall(o.end);
      return e >= dayStart && s <= dayEnd;
    });

    const items = onThisDay.slice(0, MAX_ITEMS_PER_DAY).map((o) => {
      const s = parseWall(o.start);
      const e = parseWall(o.end);
      const spansDay = o.allDay || s < dayStart || e > dayEnd;
      // No occurrence id: the wall screen displays the calendar, it does not
      // edit it, and a uuid per row is ~60 bytes of a microcontroller's JSON
      // buffer spent on something nothing on the device will ever read.
      /** @type {Record<string, unknown>} */
      const item = {
        t: o.title,
        m: o.memberIds,
        a: spansDay,
      };
      if (!spansDay) {
        item['s'] = o.start.slice(11);
        item['e'] = o.end.slice(11);
      }
      if (o.location !== '') item['l'] = o.location;
      return item;
    });

    days.push({
      date: key,
      label: `${WEEKDAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}`,
      today: key === today,
      more: Math.max(0, onThisDay.length - items.length),
      items,
    });
  }

  return {
    rev: currentRev(db),
    tz: opts.timezone,
    generatedAt: formatWall(now),
    members: listMembers(db).map((m) => ({ id: m.id, name: m.displayName, color: m.color })),
    days,
  };
}

/**
 * A strong ETag for a payload, so the wall display can poll every 30 seconds
 * over wifi and almost always get a 22-byte 304 back instead of the calendar.
 *
 * `generatedAt` is excluded on purpose: it changes every single poll, and if it
 * fed the tag then nothing would ever match and the ETag would be decoration.
 *
 * @param {ReturnType<typeof buildDisplayPayload>} payload
 * @returns {string}
 */
export function displayEtag(payload) {
  const { generatedAt: _ignored, ...stable } = payload;
  return `"${createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 32)}"`;
}
