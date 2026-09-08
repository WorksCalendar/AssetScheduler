/**
 * SQLite storage.
 *
 * `node:sqlite` ships with Node 22, so the home server has no native modules to
 * compile and no `npm install` step — clone it onto the Pi and run it. The
 * database is a single file; back it up by copying it.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Ordered schema steps. Each one runs exactly once, tracked by SQLite's own
 * `user_version`, so upgrading is additive and a half-applied migration cannot
 * happen — each step is wrapped in its own transaction.
 *
 * @type {readonly string[]}
 */
const MIGRATIONS = [
  // 1 — members, events, per-occurrence overrides, revision counter.
  `
  CREATE TABLE members (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    color        TEXT NOT NULL,
    ntfy_topic   TEXT NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    rev          INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE events (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    location    TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT '',
    start_wall  TEXT NOT NULL,
    end_wall    TEXT NOT NULL,
    all_day     INTEGER NOT NULL DEFAULT 0,
    rrule       TEXT NOT NULL DEFAULT '',
    exdates     TEXT NOT NULL DEFAULT '[]',
    member_ids  TEXT NOT NULL DEFAULT '[]',
    reminders   TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    rev         INTEGER NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX events_rev_idx   ON events (rev);
  CREATE INDEX events_start_idx ON events (start_wall);

  -- One row per edited or cancelled occurrence of a recurring series. The
  -- recurrence_id is the occurrence's ORIGINAL wall-clock start, which is what
  -- identifies it even after the occurrence has been moved.
  CREATE TABLE event_overrides (
    series_id     TEXT NOT NULL,
    recurrence_id TEXT NOT NULL,
    cancelled     INTEGER NOT NULL DEFAULT 0,
    patch         TEXT NOT NULL DEFAULT '{}',
    updated_at    TEXT NOT NULL,
    rev           INTEGER NOT NULL,
    deleted       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (series_id, recurrence_id)
  );
  CREATE INDEX event_overrides_rev_idx    ON event_overrides (rev);
  CREATE INDEX event_overrides_series_idx ON event_overrides (series_id);

  -- A single monotonic counter. Every write takes the next value, so any
  -- client can ask "what changed since rev N" and get a complete answer.
  CREATE TABLE revision (
    id    INTEGER PRIMARY KEY CHECK (id = 1),
    value INTEGER NOT NULL
  );
  INSERT INTO revision (id, value) VALUES (1, 0);

  -- Which reminders have already gone out. Keyed by occurrence + offset +
  -- member so a restart cannot push the same reminder to a phone twice.
  CREATE TABLE reminder_log (
    key     TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL
  );

  CREATE TABLE sync_state (
    name       TEXT PRIMARY KEY,
    cursor     INTEGER NOT NULL DEFAULT 0,
    last_ok_at TEXT,
    last_error TEXT
  );
  `,
];

/**
 * The three people this calendar is for. Seeded once, on an empty database.
 * Names, colours and topics are all editable afterwards through the API — this
 * is a starting point, not a hardcoded family.
 */
const SEED_MEMBERS = [
  { id: 'dad', displayName: 'Dad', color: '#2563eb', sortOrder: 1 },
  { id: 'mom', displayName: 'Mom', color: '#db2777', sortOrder: 2 },
  { id: 'redmond', displayName: 'Redmond', color: '#059669', sortOrder: 3 },
];

/**
 * Open (creating if needed) the calendar database and bring it up to date.
 *
 * @param {string} path  file path, or ':memory:' for tests
 * @returns {DatabaseSync}
 */
export function openDatabase(path) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);

  // WAL keeps the wall display's reads from blocking a phone's write. It is
  // not available for an in-memory database, where it is also pointless.
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  migrate(db);
  seedMembers(db);
  return db;
}

/**
 * Apply any schema steps this database has not seen.
 *
 * @param {DatabaseSync} db
 */
function migrate(db) {
  const row = /** @type {{ user_version: number }} */ (db.prepare('PRAGMA user_version').get());
  let version = row.user_version;

  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    db.exec('BEGIN');
    try {
      db.exec(sql);
      // PRAGMA does not accept a bound parameter; the value is a loop counter,
      // never user input.
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${version + 1} failed: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
    version++;
  }
}

/**
 * Put Dad, Mom and Redmond in an empty database, each with their own random
 * ntfy topic. The topic is the only secret protecting a phone's notifications,
 * so it is generated rather than guessable: anyone who can guess the topic name
 * can read the pushes.
 *
 * @param {DatabaseSync} db
 */
function seedMembers(db) {
  const count = /** @type {{ n: number }} */ (db.prepare('SELECT COUNT(*) AS n FROM members').get());
  if (count.n > 0) return;

  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO members (id, display_name, color, ntfy_topic, sort_order, rev, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  );
  for (const m of SEED_MEMBERS) {
    insert.run(m.id, m.displayName, m.color, freshTopic(m.id), m.sortOrder, now);
  }
}

/**
 * A hard-to-guess ntfy topic for one member.
 *
 * @param {string} memberId
 * @returns {string}
 */
export function freshTopic(memberId) {
  return `fam-${memberId}-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/**
 * Take the next revision number. Callers must already be inside a transaction
 * when the value is used to stamp rows, or a concurrent write can interleave.
 *
 * @param {DatabaseSync} db
 * @returns {number}
 */
export function nextRev(db) {
  db.prepare('UPDATE revision SET value = value + 1 WHERE id = 1').run();
  const row = /** @type {{ value: number }} */ (db.prepare('SELECT value FROM revision WHERE id = 1').get());
  return row.value;
}

/**
 * The current revision, without consuming one.
 *
 * @param {DatabaseSync} db
 * @returns {number}
 */
export function currentRev(db) {
  const row = /** @type {{ value: number } | undefined} */ (
    db.prepare('SELECT value FROM revision WHERE id = 1').get()
  );
  return row ? row.value : 0;
}

/**
 * Run `fn` inside a transaction, rolling back if it throws.
 *
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
export function transact(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // A rollback failure means the transaction is already gone; the original
      // error is the one worth reporting.
    }
    throw err;
  }
}
