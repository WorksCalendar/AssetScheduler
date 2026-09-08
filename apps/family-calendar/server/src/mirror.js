/**
 * Supabase mirror.
 *
 * The home server is not on the public internet, so a phone away from the
 * house needs somewhere else to read. Changed rows are pushed to Supabase on a
 * timer and the web app falls back to reading them there.
 *
 * The mirror is one-directional and incremental. It carries a cursor — the
 * highest revision it has already pushed — so a steady state costs one empty
 * query, and it pushes tombstones as well as live rows, because a phone that
 * only ever hears about additions slowly fills up with cancelled events.
 *
 * Writes still go to the home server. Making the mirror writable would mean
 * reconciling two masters, which is a much larger project than this one.
 */

import { listMembers, listOverrides, listSeries } from './store.js';
import { currentRev } from './db.js';

/** Rows per request, so a first-run backfill does not send one huge body. */
const BATCH = 200;

const CURSOR_NAME = 'supabase';

/**
 * @param {{
 *   db: import('node:sqlite').DatabaseSync,
 *   url: string,
 *   serviceKey: string,
 *   enabled: boolean,
 *   fetchImpl?: typeof fetch,
 *   log?: (msg: string) => void,
 * }} opts
 */
export function createMirror(opts) {
  const doFetch = opts.fetchImpl ?? fetch;
  const log = opts.log ?? (() => {});
  const base = `${opts.url.replace(/\/+$/, '')}/rest/v1`;

  /**
   * @param {string} table
   * @param {Array<Record<string, unknown>>} rows
   * @returns {Promise<void>}
   */
  async function upsert(table, rows) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const res = await doFetch(`${base}/${table}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: opts.serviceKey,
          Authorization: `Bearer ${opts.serviceKey}`,
          // Upsert rather than insert: a row that changes twice between pushes
          // must not collide with itself.
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`${table} upsert failed: ${res.status} ${detail.slice(0, 300)}`);
      }
    }
  }

  /**
   * Push everything that changed since the stored cursor.
   *
   * @returns {Promise<{ pushed: number, rev: number, skipped?: string }>}
   */
  async function push() {
    if (!opts.enabled) return { pushed: 0, rev: currentRev(opts.db), skipped: 'mirror not configured' };

    const cursor = readCursor(opts.db);
    const rev = currentRev(opts.db);
    if (rev <= cursor) return { pushed: 0, rev };

    const members = listMembers(opts.db).filter((m) => m.rev > cursor);
    const events = listSeries(opts.db, { sinceRev: cursor, includeDeleted: true });
    const overrides = listOverrides(opts.db, { sinceRev: cursor });

    try {
      if (members.length > 0) {
        await upsert('family_members', members.map((m) => ({
          id: m.id,
          display_name: m.displayName,
          color: m.color,
          sort_order: m.sortOrder,
          rev: m.rev,
          // The ntfy topic is deliberately NOT mirrored. It is the one secret
          // that protects a phone's notifications and it has no business
          // leaving the house.
        })));
      }

      if (events.length > 0) {
        await upsert('family_events', events.map((e) => ({
          id: e.id,
          title: e.title,
          notes: e.notes,
          location: e.location,
          category: e.category,
          start_wall: e.start,
          end_wall: e.end,
          all_day: e.allDay,
          rrule: e.rrule,
          exdates: e.exdates,
          member_ids: e.memberIds,
          reminders: e.reminders,
          updated_at: e.updatedAt,
          rev: e.rev,
          deleted: e.deleted,
        })));
      }

      if (overrides.length > 0) {
        await upsert('family_event_overrides', overrides.map((o) => ({
          series_id: o.seriesId,
          recurrence_id: o.recurrenceId,
          cancelled: o.cancelled,
          patch: o.patch,
          rev: o.rev,
          deleted: o.deleted,
        })));
      }

      // The cursor moves only after every table has landed, so a failure
      // halfway through is retried in full rather than leaving a gap that
      // nothing will ever look at again.
      writeCursor(opts.db, rev, null);
      const pushed = members.length + events.length + overrides.length;
      if (pushed > 0) log(`mirror: pushed ${pushed} rows up to rev ${rev}`);
      return { pushed, rev };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeCursorError(opts.db, message);
      log(`mirror push failed: ${message}`);
      throw err;
    }
  }

  return {
    push,

    /** @returns {Record<string, unknown>} */
    status() {
      const row = /** @type {Record<string, unknown> | undefined} */ (
        opts.db.prepare('SELECT * FROM sync_state WHERE name = ?').get(CURSOR_NAME)
      );
      return {
        enabled: opts.enabled,
        cursor: row ? Number(row['cursor']) : 0,
        rev: currentRev(opts.db),
        lastOkAt: row ? row['last_ok_at'] : null,
        lastError: row ? row['last_error'] : null,
      };
    },

    /**
     * Push on a timer. Returns a stop function.
     *
     * @param {number} intervalMs
     * @returns {() => void}
     */
    start(intervalMs) {
      if (!opts.enabled) return () => {};
      let running = false;
      const tick = async () => {
        if (running) return;
        running = true;
        try {
          await push();
        } catch {
          // push() has already recorded and logged it; a mirror that cannot
          // reach Supabase must not take the calendar down with it.
        } finally {
          running = false;
        }
      };
      const handle = setInterval(tick, intervalMs);
      handle.unref?.();
      void tick();
      return () => clearInterval(handle);
    },
  };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {number}
 */
function readCursor(db) {
  const row = /** @type {Record<string, unknown> | undefined} */ (
    db.prepare('SELECT cursor FROM sync_state WHERE name = ?').get(CURSOR_NAME)
  );
  return row ? Number(row['cursor']) : 0;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} cursor
 * @param {string | null} error
 */
function writeCursor(db, cursor, error) {
  db.prepare(
    `INSERT INTO sync_state (name, cursor, last_ok_at, last_error) VALUES (?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET cursor = excluded.cursor,
                                      last_ok_at = excluded.last_ok_at,
                                      last_error = excluded.last_error`,
  ).run(CURSOR_NAME, cursor, new Date().toISOString(), error);
}

/**
 * Record a failure without moving the cursor.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} message
 */
function writeCursorError(db, message) {
  db.prepare(
    `INSERT INTO sync_state (name, cursor, last_ok_at, last_error) VALUES (?, 0, NULL, ?)
     ON CONFLICT (name) DO UPDATE SET last_error = excluded.last_error`,
  ).run(CURSOR_NAME, message.slice(0, 500));
}
