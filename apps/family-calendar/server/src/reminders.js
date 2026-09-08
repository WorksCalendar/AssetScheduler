/**
 * The reminder scheduler.
 *
 * Ticks on a timer, works out which reminders have come due since the last
 * tick, and pushes each one to the phones of the people the event is for.
 *
 * Two rules keep it from being annoying:
 *
 *  - A reminder is never sent for an event that has already started. If the
 *    server was off overnight it comes back to a quiet house, not to eleven
 *    notifications about yesterday.
 *  - Every send is recorded, keyed by occurrence + offset + person, so a
 *    restart in the ninety seconds after a reminder fires does not send it
 *    again.
 */

import { formatWall, parseWall } from './time.js';
import { listMembers, listOccurrences } from './store.js';

/** Reminders for an event that started more than this long ago are dropped. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/** How far ahead to look for due reminders. Longer than the longest offset the
 *  API accepts (14 days), so nothing can be scheduled past the horizon. */
const LOOKAHEAD_DAYS = 15;

/** Sent-reminder records older than this are pruned on each tick. */
const LOG_RETENTION_DAYS = 30;

/**
 * Find the reminders that are due right now.
 *
 * Split out from sending so it can be tested without a network or a clock.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Date} now
 * @returns {Array<{ key: string, memberId: string, occurrenceId: string, title: string,
 *                   start: string, location: string, minutesBefore: number, allDay: boolean }>}
 */
export function dueReminders(db, now) {
  const horizon = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const occurrences = listOccurrences(db, {
    from: formatWall(new Date(now.getTime() - STALE_AFTER_MS)),
    to: formatWall(horizon),
  });

  const everyone = listMembers(db).map((m) => m.id);
  const alreadySent = new Set(
    /** @type {Array<Record<string, unknown>>} */ (db.prepare('SELECT key FROM reminder_log').all())
      .map((r) => String(r['key'])),
  );

  const out = [];
  for (const occ of occurrences) {
    if (occ.reminders.length === 0) continue;
    const startAt = parseWall(occ.start);

    // An event that has already begun is news nobody needs.
    if (startAt.getTime() < now.getTime() - STALE_AFTER_MS) continue;

    // An event with nobody assigned belongs to the whole household.
    const recipients = occ.memberIds.length > 0 ? occ.memberIds : everyone;

    for (const minutesBefore of occ.reminders) {
      const fireAt = startAt.getTime() - minutesBefore * 60_000;
      if (fireAt > now.getTime()) continue;

      for (const memberId of recipients) {
        const key = `${occ.id}|${minutesBefore}|${memberId}`;
        if (alreadySent.has(key)) continue;
        out.push({
          key,
          memberId,
          occurrenceId: occ.id,
          title: occ.title,
          start: occ.start,
          location: occ.location,
          minutesBefore,
          allDay: occ.allDay,
        });
      }
    }
  }
  return out;
}

/**
 * The text of a reminder.
 *
 * @param {{ start: string, location: string, minutesBefore: number, allDay: boolean }} r
 * @returns {string}
 */
export function reminderBody(r) {
  const when = r.allDay
    ? 'Today'
    : `at ${to12Hour(r.start.slice(11))}`;
  const lead = r.minutesBefore === 0
    ? 'Starting now'
    : `In ${humanMinutes(r.minutesBefore)}`;
  const where = r.location === '' ? '' : ` · ${r.location}`;
  return `${lead} — ${when}${where}`;
}

/**
 * @param {string} hhmm
 * @returns {string}
 */
function to12Hour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

/**
 * @param {number} minutes
 * @returns {string}
 */
function humanMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % (60 * 24) === 0) {
    const days = minutes / (60 * 24);
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Send everything that is due, recording each send.
 *
 * @param {{
 *   db: import('node:sqlite').DatabaseSync,
 *   publisher: import('./ntfy.js').Publisher,
 *   now?: Date,
 *   appUrl?: string,
 *   log?: (msg: string) => void,
 * }} opts
 * @returns {Promise<{ sent: number, failed: number }>}
 */
export async function runReminderTick(opts) {
  const { db, publisher } = opts;
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});

  const members = new Map(listMembers(db).map((m) => [m.id, m]));
  const due = dueReminders(db, now);

  let sent = 0;
  let failed = 0;

  for (const r of due) {
    const member = members.get(r.memberId);
    if (!member) continue;

    const result = await publisher.publish({
      topic: member.ntfyTopic,
      title: r.title,
      body: reminderBody(r),
      priority: r.minutesBefore <= 15 ? 4 : 3,
      tags: ['calendar'],
      ...(opts.appUrl ? { click: opts.appUrl } : {}),
    });

    if (result.ok) {
      sent++;
      // Recorded only on success, so a push that failed because the wifi was
      // down is retried on the next tick rather than silently skipped.
      db.prepare('INSERT OR REPLACE INTO reminder_log (key, sent_at) VALUES (?, ?)')
        .run(r.key, now.toISOString());
    } else {
      failed++;
      log(`reminder push failed for ${r.memberId} (${r.title}): ${result.error ?? result.status}`);
    }
  }

  pruneLog(db, now);
  return { sent, failed };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Date} now
 */
function pruneLog(db, now) {
  const cutoff = new Date(now.getTime() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM reminder_log WHERE sent_at < ?').run(cutoff);
}

/**
 * Start ticking. Returns a stop function; the interval is unref'd so it never
 * keeps the process alive on its own.
 *
 * @param {{
 *   db: import('node:sqlite').DatabaseSync,
 *   publisher: import('./ntfy.js').Publisher,
 *   intervalMs: number,
 *   appUrl?: string,
 *   log?: (msg: string) => void,
 * }} opts
 * @returns {() => void}
 */
export function startReminderLoop(opts) {
  const log = opts.log ?? (() => {});
  let running = false;

  const tick = async () => {
    if (running) return; // a slow ntfy must not stack ticks on top of each other
    running = true;
    try {
      const { sent, failed } = await runReminderTick({
        db: opts.db,
        publisher: opts.publisher,
        ...(opts.appUrl ? { appUrl: opts.appUrl } : {}),
        log,
      });
      if (sent > 0 || failed > 0) log(`reminders: ${sent} sent, ${failed} failed`);
    } catch (err) {
      log(`reminder tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, opts.intervalMs);
  handle.unref?.();
  void tick();
  return () => clearInterval(handle);
}
