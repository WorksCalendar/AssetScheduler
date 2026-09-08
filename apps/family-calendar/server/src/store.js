/**
 * Reads and writes over the calendar database.
 *
 * An "event" here is a SERIES: one row that may describe a single afternoon or
 * every Tuesday until further notice. Individual occurrences are computed, not
 * stored — except where somebody has edited or cancelled just one of them,
 * which lands in `event_overrides` keyed by that occurrence's original start.
 * That is the same model iCalendar uses (RRULE + RECURRENCE-ID) and it is what
 * makes "move just this week's practice" possible without unrolling the series
 * into a thousand rows.
 */

import { randomUUID } from 'node:crypto';

import { currentRev, nextRev, transact, freshTopic } from './db.js';
import { expandRRule, parseRRule } from './recurrence.js';
import { expandSeries } from './occurrences.js';
import { addDays, dayKey, formatWall, isWall, parseWall, toWall } from './time.js';

/** Raised for input the caller can fix; the HTTP layer turns it into a 400. */
export class ValidationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Raised when an id does not resolve; the HTTP layer turns it into a 404. */
export class NotFoundError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}

// ── members ────────────────────────────────────────────────────────────────

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Array<{ id: string, displayName: string, color: string, ntfyTopic: string, sortOrder: number, rev: number }>}
 */
export function listMembers(db) {
  const rows = /** @type {Array<Record<string, unknown>>} */ (
    db.prepare('SELECT * FROM members ORDER BY sort_order, id').all()
  );
  return rows.map((r) => ({
    id: String(r['id']),
    displayName: String(r['display_name']),
    color: String(r['color']),
    ntfyTopic: String(r['ntfy_topic']),
    sortOrder: Number(r['sort_order']),
    rev: Number(r['rev']),
  }));
}

/**
 * Update a member's display name or colour.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} id
 * @param {{ displayName?: unknown, color?: unknown }} patch
 * @returns {ReturnType<typeof listMembers>[number]}
 */
export function updateMember(db, id, patch) {
  return transact(db, () => {
    const existing = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
    if (!existing) throw new NotFoundError(`no such family member: ${id}`);

    const displayName = patch.displayName === undefined
      ? String(existing['display_name'])
      : requireText(patch.displayName, 'displayName', 60);
    const color = patch.color === undefined ? String(existing['color']) : requireColor(patch.color);

    const rev = nextRev(db);
    db.prepare('UPDATE members SET display_name = ?, color = ?, rev = ?, updated_at = ? WHERE id = ?')
      .run(displayName, color, rev, new Date().toISOString(), id);
    return listMembers(db).find((m) => m.id === id);
  });
}

/**
 * Issue a member a new ntfy topic, which silently unsubscribes every device
 * still listening on the old one. That is the point: it is how you cut off a
 * lost phone.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} id
 * @returns {ReturnType<typeof listMembers>[number]}
 */
export function rotateMemberTopic(db, id) {
  return transact(db, () => {
    const existing = db.prepare('SELECT id FROM members WHERE id = ?').get(id);
    if (!existing) throw new NotFoundError(`no such family member: ${id}`);
    const rev = nextRev(db);
    db.prepare('UPDATE members SET ntfy_topic = ?, rev = ?, updated_at = ? WHERE id = ?')
      .run(freshTopic(id), rev, new Date().toISOString(), id);
    return listMembers(db).find((m) => m.id === id);
  });
}

// ── validation ─────────────────────────────────────────────────────────────

/**
 * @param {unknown} v
 * @param {string} field
 * @param {number} max
 * @returns {string}
 */
function requireText(v, field, max) {
  if (typeof v !== 'string' || v.trim() === '') throw new ValidationError(`${field} is required`);
  const s = v.trim();
  if (s.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer`);
  return s;
}

/**
 * @param {unknown} v
 * @param {string} field
 * @param {number} max
 * @returns {string}
 */
function optionalText(v, field, max) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text`);
  const s = v.trim();
  if (s.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer`);
  return s;
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function requireColor(v) {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v.trim())) {
    throw new ValidationError('color must be a #rrggbb hex value');
  }
  return v.trim().toLowerCase();
}

/**
 * @param {unknown} v
 * @param {string} field
 * @returns {string}
 */
function requireWall(v, field) {
  if (v instanceof Date || (typeof v === 'string' && isWall(v))) return toWall(/** @type {string|Date} */ (v));
  if (typeof v === 'string') return toWall(v); // lets toWall raise the specific message
  throw new ValidationError(`${field} must be a wall-clock time like 2026-09-08T16:00`);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {unknown} v
 * @returns {string[]}
 */
function requireMemberIds(db, v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ValidationError('memberIds must be an array');
  const known = new Set(listMembers(db).map((m) => m.id));
  /** @type {string[]} */
  const out = [];
  for (const raw of v) {
    const id = String(raw);
    if (!known.has(id)) throw new ValidationError(`no such family member: ${id}`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * @param {unknown} v
 * @returns {number[]}
 */
function requireReminders(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ValidationError('reminders must be an array of minutes');
  /** @type {number[]} */
  const out = [];
  for (const raw of v) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 60 * 24 * 14) {
      throw new ValidationError(`reminder offset out of range: ${raw}`);
    }
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => b - a);
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function requireRRule(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') throw new ValidationError('rrule must be a string');
  const s = v.trim();
  if (s === '') return '';
  if (!parseRRule(s)) {
    throw new ValidationError(
      `unsupported repeat rule: ${s} — needs FREQ=DAILY, WEEKLY, MONTHLY or YEARLY`,
    );
  }
  return s.replace(/^RRULE:/i, '').toUpperCase();
}

/**
 * @param {unknown} v
 * @returns {string[]}
 */
function requireExdates(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ValidationError('exdates must be an array');
  return v.map((d) => (d instanceof Date ? formatWall(d) : String(d).trim())).filter((d) => d !== '');
}

// ── series rows ────────────────────────────────────────────────────────────

/**
 * @param {Record<string, unknown>} r
 * @returns {{
 *   id: string, title: string, notes: string, location: string, category: string,
 *   start: string, end: string, allDay: boolean, rrule: string, exdates: string[],
 *   memberIds: string[], reminders: number[], createdAt: string, updatedAt: string,
 *   rev: number, deleted: boolean,
 * }}
 */
function rowToSeries(r) {
  return {
    id: String(r['id']),
    title: String(r['title']),
    notes: String(r['notes']),
    location: String(r['location']),
    category: String(r['category']),
    start: String(r['start_wall']),
    end: String(r['end_wall']),
    allDay: Number(r['all_day']) === 1,
    rrule: String(r['rrule']),
    exdates: safeJsonArray(r['exdates']),
    memberIds: safeJsonArray(r['member_ids']),
    reminders: safeJsonArray(r['reminders']).map(Number),
    createdAt: String(r['created_at']),
    updatedAt: String(r['updated_at']),
    rev: Number(r['rev']),
    deleted: Number(r['deleted']) === 1,
  };
}

/**
 * @param {unknown} v
 * @returns {any[]}
 */
function safeJsonArray(v) {
  if (typeof v !== 'string') return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * List series rows.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ sinceRev?: number, includeDeleted?: boolean }} [opts]
 * @returns {ReturnType<typeof rowToSeries>[]}
 */
export function listSeries(db, opts = {}) {
  const since = opts.sinceRev ?? -1;
  const sql = opts.includeDeleted
    ? 'SELECT * FROM events WHERE rev > ? ORDER BY rev'
    : 'SELECT * FROM events WHERE rev > ? AND deleted = 0 ORDER BY rev';
  const rows = /** @type {Array<Record<string, unknown>>} */ (db.prepare(sql).all(since));
  return rows.map(rowToSeries);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} id
 * @returns {ReturnType<typeof rowToSeries>}
 */
export function getSeries(db, id) {
  const row = db.prepare('SELECT * FROM events WHERE id = ? AND deleted = 0').get(id);
  if (!row) throw new NotFoundError(`no such event: ${id}`);
  return rowToSeries(/** @type {Record<string, unknown>} */ (row));
}

/**
 * Normalise and check a create/update payload.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Record<string, unknown>} input
 * @param {ReturnType<typeof rowToSeries>} [base]  existing values, for a partial update
 */
function normalizeInput(db, input, base) {
  const pick = (/** @type {string} */ key, /** @type {unknown} */ fallback) =>
    Object.prototype.hasOwnProperty.call(input, key) ? input[key] : fallback;

  const title = requireText(pick('title', base?.title), 'title', 200);
  const allDayRaw = pick('allDay', base?.allDay ?? false);
  const allDay = allDayRaw === true || allDayRaw === 1 || allDayRaw === 'true';

  let start = requireWall(pick('start', base?.start), 'start');
  let end = pick('end', base?.end);
  // An event with no end is an hour long, or the whole day if it is all-day —
  // rather than zero-length, which renders as an invisible sliver.
  end = end === undefined || end === null || end === ''
    ? defaultEnd(start, allDay)
    : requireWall(end, 'end');

  if (allDay) {
    // All-day is stored as a real span from midnight to 23:59 so that every
    // consumer — the wall display, the phones, the reminder scheduler — can
    // treat every event the same way and never has to ask whether an end date
    // is inclusive.
    start = `${start.slice(0, 10)}T00:00`;
    end = `${String(end).slice(0, 10)}T23:59`;
  }

  if (parseWall(String(end)) < parseWall(start)) {
    throw new ValidationError('end must not be before start');
  }

  return {
    title,
    notes: optionalText(pick('notes', base?.notes), 'notes', 4000),
    location: optionalText(pick('location', base?.location), 'location', 200),
    category: optionalText(pick('category', base?.category), 'category', 60),
    start,
    end: String(end),
    allDay,
    rrule: requireRRule(pick('rrule', base?.rrule)),
    exdates: requireExdates(pick('exdates', base?.exdates)),
    memberIds: requireMemberIds(db, pick('memberIds', base?.memberIds)),
    reminders: requireReminders(pick('reminders', base?.reminders)),
  };
}

/**
 * @param {string} start
 * @param {boolean} allDay
 * @returns {string}
 */
function defaultEnd(start, allDay) {
  if (allDay) return `${start.slice(0, 10)}T23:59`;
  const d = parseWall(start);
  d.setHours(d.getHours() + 1);
  return formatWall(d);
}

/**
 * Create an event series.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Record<string, unknown>} input
 * @returns {ReturnType<typeof rowToSeries>}
 */
export function createEvent(db, input) {
  const v = normalizeInput(db, input);
  const id = typeof input['id'] === 'string' && input['id'].trim() !== '' ? input['id'].trim() : randomUUID();
  const now = new Date().toISOString();

  return transact(db, () => {
    const rev = nextRev(db);
    db.prepare(
      `INSERT INTO events (id, title, notes, location, category, start_wall, end_wall, all_day,
                           rrule, exdates, member_ids, reminders, created_at, updated_at, rev, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      id, v.title, v.notes, v.location, v.category, v.start, v.end, v.allDay ? 1 : 0,
      v.rrule, JSON.stringify(v.exdates), JSON.stringify(v.memberIds), JSON.stringify(v.reminders),
      now, now, rev,
    );
    return getSeries(db, id);
  });
}

/**
 * Update an event.
 *
 * `scope` decides what a change to a recurring series means:
 *
 *   'all'       — change the series itself (the default, and the only option
 *                 for a one-off event)
 *   'this'      — write an override for the single occurrence named by
 *                 `recurrenceId`, leaving the rest of the series alone
 *   'following' — split the series in two at `recurrenceId`: the old one is
 *                 fenced off with an UNTIL, and a new one carries the change
 *                 forward. This is what other calendars do, and it is the only
 *                 way "we moved practice to Wednesdays from now on" can be
 *                 true without rewriting history.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} id
 * @param {Record<string, unknown>} patch
 * @param {{ scope?: string, recurrenceId?: string }} [opts]
 * @returns {ReturnType<typeof rowToSeries>}
 */
export function updateEvent(db, id, patch, opts = {}) {
  const series = getSeries(db, id);
  const scope = resolveScope(series, opts);

  if (scope === 'this') {
    const recurrenceId = requireRecurrenceId(series, opts.recurrenceId);
    return transact(db, () => {
      writeOverride(db, series.id, recurrenceId, { cancelled: false, patch: occurrencePatch(db, patch) });
      return getSeries(db, id);
    });
  }

  if (scope === 'following') {
    const recurrenceId = requireRecurrenceId(series, opts.recurrenceId);
    return splitSeries(db, series, recurrenceId, patch);
  }

  const v = normalizeInput(db, patch, series);
  return transact(db, () => {
    const rev = nextRev(db);
    db.prepare(
      `UPDATE events SET title = ?, notes = ?, location = ?, category = ?, start_wall = ?, end_wall = ?,
                         all_day = ?, rrule = ?, exdates = ?, member_ids = ?, reminders = ?,
                         updated_at = ?, rev = ?
       WHERE id = ?`,
    ).run(
      v.title, v.notes, v.location, v.category, v.start, v.end, v.allDay ? 1 : 0,
      v.rrule, JSON.stringify(v.exdates), JSON.stringify(v.memberIds), JSON.stringify(v.reminders),
      new Date().toISOString(), rev, id,
    );
    return getSeries(db, id);
  });
}

/**
 * Delete an event, or one occurrence of it.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} id
 * @param {{ scope?: string, recurrenceId?: string }} [opts]
 * @returns {{ deleted: string, scope: string }}
 */
export function deleteEvent(db, id, opts = {}) {
  const series = getSeries(db, id);
  const scope = resolveScope(series, opts);

  if (scope === 'this') {
    const recurrenceId = requireRecurrenceId(series, opts.recurrenceId);
    transact(db, () => {
      writeOverride(db, series.id, recurrenceId, { cancelled: true, patch: {} });
    });
    return { deleted: `${id}::${recurrenceId}`, scope };
  }

  if (scope === 'following') {
    const recurrenceId = requireRecurrenceId(series, opts.recurrenceId);
    transact(db, () => {
      fenceSeriesBefore(db, series, recurrenceId);
    });
    return { deleted: id, scope };
  }

  transact(db, () => {
    const rev = nextRev(db);
    // Soft delete: a phone that has been in a pocket all week still needs to
    // learn the event is gone, and it can only learn that from a row.
    db.prepare('UPDATE events SET deleted = 1, rev = ?, updated_at = ? WHERE id = ?')
      .run(rev, new Date().toISOString(), id);
    const orphans = /** @type {Array<Record<string, unknown>>} */ (
      db.prepare('SELECT recurrence_id FROM event_overrides WHERE series_id = ? AND deleted = 0').all(id)
    );
    for (const o of orphans) {
      const orev = nextRev(db);
      db.prepare(
        'UPDATE event_overrides SET deleted = 1, rev = ?, updated_at = ? WHERE series_id = ? AND recurrence_id = ?',
      ).run(orev, new Date().toISOString(), id, String(o['recurrence_id']));
    }
  });
  return { deleted: id, scope };
}

/**
 * @param {ReturnType<typeof rowToSeries>} series
 * @param {{ scope?: string }} opts
 * @returns {'all' | 'this' | 'following'}
 */
function resolveScope(series, opts) {
  const raw = (opts.scope ?? 'all').toLowerCase();
  if (series.rrule === '') return 'all'; // a one-off event has only one scope
  if (raw === 'this' || raw === 'single') return 'this';
  if (raw === 'following' || raw === 'this-and-following') return 'following';
  if (raw === 'all' || raw === 'series') return 'all';
  throw new ValidationError(`scope must be one of: all, this, following (got ${raw})`);
}

/**
 * @param {ReturnType<typeof rowToSeries>} series
 * @param {string | undefined} recurrenceId
 * @returns {string}
 */
function requireRecurrenceId(series, recurrenceId) {
  if (!recurrenceId || !isWall(recurrenceId)) {
    throw new ValidationError('recurrenceId (the occurrence start, e.g. 2026-09-15T16:00) is required for this scope');
  }
  const wall = toWall(recurrenceId);
  const start = parseWall(wall);
  const hits = expandRRule(parseWall(series.start), series.rrule, [], start, start);
  if (hits.length === 0) {
    throw new ValidationError(`${wall} is not an occurrence of this event`);
  }
  return wall;
}

/**
 * The subset of fields an occurrence-level override may carry. Repeat rules are
 * deliberately not among them: a single occurrence cannot have its own
 * recurrence, and accepting one would quietly do nothing.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Record<string, unknown>} patch
 * @returns {Record<string, unknown>}
 */
function occurrencePatch(db, patch) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (patch['title'] !== undefined) out['title'] = requireText(patch['title'], 'title', 200);
  if (patch['notes'] !== undefined) out['notes'] = optionalText(patch['notes'], 'notes', 4000);
  if (patch['location'] !== undefined) out['location'] = optionalText(patch['location'], 'location', 200);
  if (patch['category'] !== undefined) out['category'] = optionalText(patch['category'], 'category', 60);
  if (patch['start'] !== undefined) out['start'] = requireWall(patch['start'], 'start');
  if (patch['end'] !== undefined) out['end'] = requireWall(patch['end'], 'end');
  if (patch['memberIds'] !== undefined) out['memberIds'] = requireMemberIds(db, patch['memberIds']);
  if (patch['reminders'] !== undefined) out['reminders'] = requireReminders(patch['reminders']);
  if (out['start'] && out['end'] && parseWall(String(out['end'])) < parseWall(String(out['start']))) {
    throw new ValidationError('end must not be before start');
  }
  return out;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} seriesId
 * @param {string} recurrenceId
 * @param {{ cancelled: boolean, patch: Record<string, unknown> }} value
 */
function writeOverride(db, seriesId, recurrenceId, value) {
  const rev = nextRev(db);
  db.prepare(
    `INSERT INTO event_overrides (series_id, recurrence_id, cancelled, patch, updated_at, rev, deleted)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (series_id, recurrence_id) DO UPDATE SET
       cancelled = excluded.cancelled,
       patch = excluded.patch,
       updated_at = excluded.updated_at,
       rev = excluded.rev,
       deleted = 0`,
  ).run(seriesId, recurrenceId, value.cancelled ? 1 : 0, JSON.stringify(value.patch), new Date().toISOString(), rev);
}

/**
 * Stop a series before `recurrenceId` by giving it an UNTIL (or a COUNT, when
 * the rule was counted rather than dated).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof rowToSeries>} series
 * @param {string} recurrenceId
 * @returns {number} how many occurrences remain in the fenced-off series
 */
function fenceSeriesBefore(db, series, recurrenceId) {
  const split = parseWall(recurrenceId);
  const before = expandRRule(
    parseWall(series.start), series.rrule, series.exdates,
    parseWall(series.start), addDays(split, -1),
  ).filter((d) => d < split);

  const rule = parseRRule(series.rrule);
  let fenced;
  if (rule && rule.count !== null) {
    fenced = withRulePart(series.rrule, 'COUNT', String(Math.max(1, before.length)));
  } else {
    const lastDay = addDays(split, -1);
    const until = `${dayKey(lastDay).replace(/-/g, '')}T235959`;
    fenced = withRulePart(series.rrule, 'UNTIL', until);
  }

  const rev = nextRev(db);
  if (before.length === 0) {
    // Nothing precedes the split, so there is no earlier half worth keeping.
    db.prepare('UPDATE events SET deleted = 1, rev = ?, updated_at = ? WHERE id = ?')
      .run(rev, new Date().toISOString(), series.id);
  } else {
    db.prepare('UPDATE events SET rrule = ?, rev = ?, updated_at = ? WHERE id = ?')
      .run(fenced, rev, new Date().toISOString(), series.id);
  }
  return before.length;
}

/**
 * Replace or add one part of an RRULE, dropping the parts it supersedes.
 *
 * @param {string} rrule
 * @param {'UNTIL' | 'COUNT'} part
 * @param {string} value
 * @returns {string}
 */
function withRulePart(rrule, part, value) {
  const kept = rrule
    .split(';')
    .filter((chunk) => {
      const key = chunk.split('=')[0].trim().toUpperCase();
      return key !== 'UNTIL' && key !== 'COUNT' && chunk.trim() !== '';
    });
  kept.push(`${part}=${value}`);
  return kept.join(';');
}

/**
 * Split a series at `recurrenceId` and apply `patch` to the forward half.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof rowToSeries>} series
 * @param {string} recurrenceId
 * @param {Record<string, unknown>} patch
 * @returns {ReturnType<typeof rowToSeries>}
 */
function splitSeries(db, series, recurrenceId, patch) {
  const split = parseWall(recurrenceId);
  const rule = parseRRule(series.rrule);

  // How many occurrences the forward half inherits, when the rule was counted.
  /** @type {string | null} */
  let forwardRule = series.rrule;
  if (rule && rule.count !== null) {
    const all = expandRRule(
      parseWall(series.start), series.rrule, [],
      parseWall(series.start), addDays(split, 365 * 10),
    );
    const remaining = all.filter((d) => d >= split).length;
    forwardRule = remaining > 1 ? withRulePart(series.rrule, 'COUNT', String(remaining)) : '';
  }

  return transact(db, () => {
    fenceSeriesBefore(db, series, recurrenceId);

    // The forward half starts at the split occurrence, keeping the original
    // duration unless the caller moved it.
    const durationMs = parseWall(series.end).getTime() - parseWall(series.start).getTime();
    const newStart = patch['start'] !== undefined ? requireWall(patch['start'], 'start') : formatWall(split);
    const newEnd = patch['end'] !== undefined
      ? requireWall(patch['end'], 'end')
      : formatWall(new Date(parseWall(newStart).getTime() + durationMs));

    const forward = createEventRow(db, {
      ...series,
      ...patch,
      id: randomUUID(),
      start: newStart,
      end: newEnd,
      rrule: patch['rrule'] !== undefined ? patch['rrule'] : forwardRule,
      // Exception dates and overrides belong to whichever half now contains
      // the occurrence they name.
      exdates: series.exdates.filter((d) => parseWall(String(d).slice(0, 16)) >= split),
    });

    const moved = /** @type {Array<Record<string, unknown>>} */ (
      db.prepare('SELECT * FROM event_overrides WHERE series_id = ? AND deleted = 0').all(series.id)
    );
    for (const o of moved) {
      const rid = String(o['recurrence_id']);
      if (parseWall(rid) < split) continue;
      const revOld = nextRev(db);
      db.prepare(
        'UPDATE event_overrides SET deleted = 1, rev = ?, updated_at = ? WHERE series_id = ? AND recurrence_id = ?',
      ).run(revOld, new Date().toISOString(), series.id, rid);
      writeOverride(db, forward.id, rid, {
        cancelled: Number(o['cancelled']) === 1,
        patch: JSON.parse(String(o['patch']) || '{}'),
      });
    }

    return getSeries(db, forward.id);
  });
}

/**
 * Insert a series row from already-validated-ish values. Used by the split
 * path, which is already inside a transaction.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Record<string, unknown>} input
 * @returns {{ id: string }}
 */
function createEventRow(db, input) {
  const v = normalizeInput(db, input);
  const id = String(input['id']);
  const now = new Date().toISOString();
  const rev = nextRev(db);
  db.prepare(
    `INSERT INTO events (id, title, notes, location, category, start_wall, end_wall, all_day,
                         rrule, exdates, member_ids, reminders, created_at, updated_at, rev, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    id, v.title, v.notes, v.location, v.category, v.start, v.end, v.allDay ? 1 : 0,
    v.rrule, JSON.stringify(v.exdates), JSON.stringify(v.memberIds), JSON.stringify(v.reminders),
    now, now, rev,
  );
  return { id };
}

// ── overrides ──────────────────────────────────────────────────────────────

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ sinceRev?: number }} [opts]
 * @returns {Array<{ seriesId: string, recurrenceId: string, cancelled: boolean, patch: Record<string, unknown>, rev: number, deleted: boolean }>}
 */
export function listOverrides(db, opts = {}) {
  const since = opts.sinceRev ?? -1;
  const rows = /** @type {Array<Record<string, unknown>>} */ (
    db.prepare('SELECT * FROM event_overrides WHERE rev > ? ORDER BY rev').all(since)
  );
  return rows.map((r) => ({
    seriesId: String(r['series_id']),
    recurrenceId: String(r['recurrence_id']),
    cancelled: Number(r['cancelled']) === 1,
    patch: JSON.parse(String(r['patch']) || '{}'),
    rev: Number(r['rev']),
    deleted: Number(r['deleted']) === 1,
  }));
}

// ── occurrences ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Occurrence
 * @property {string} id            `seriesId::recurrenceId`, stable across reloads
 * @property {string} seriesId
 * @property {string} recurrenceId  the occurrence's original start
 * @property {string} title
 * @property {string} notes
 * @property {string} location
 * @property {string} category
 * @property {string} start         wall clock, after any override
 * @property {string} end
 * @property {boolean} allDay
 * @property {string[]} memberIds
 * @property {number[]} reminders
 * @property {boolean} recurring
 * @property {string} rrule
 * @property {string} repeatText
 * @property {boolean} overridden
 * @property {number} rev
 */

/**
 * Expand every series into the occurrences that fall inside a window.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ from: string | Date, to: string | Date, memberIds?: string[] }} opts
 * @returns {Occurrence[]} ascending by start
 */
export function listOccurrences(db, opts) {
  const from = toWall(opts.from);
  const to = toWall(opts.to);
  if (parseWall(to) < parseWall(from)) throw new ValidationError('`to` must not be before `from`');

  return expandSeries(listSeries(db), listOverrides(db), {
    from,
    to,
    ...(opts.memberIds && opts.memberIds.length > 0 ? { memberIds: opts.memberIds } : {}),
  });
}

/**
 * Everything that changed since a revision, for delta sync.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} sinceRev
 * @returns {{ rev: number, members: ReturnType<typeof listMembers>, events: ReturnType<typeof listSeries>, overrides: ReturnType<typeof listOverrides> }}
 */
export function changesSince(db, sinceRev) {
  return {
    rev: currentRev(db),
    members: listMembers(db).filter((m) => m.rev > sinceRev),
    events: listSeries(db, { sinceRev, includeDeleted: true }),
    overrides: listOverrides(db, { sinceRev }),
  };
}
