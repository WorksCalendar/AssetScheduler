import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { openDatabase } from '../src/db.js';
import { createEvent, deleteEvent, updateMember } from '../src/store.js';
import { createMirror } from '../src/mirror.js';

/** @type {import('node:sqlite').DatabaseSync} */
let db;
/** @type {Array<{ table: string, rows: any[], prefer: string }>} */
let requests;
/** Set to a status to make the next push fail. */
let failWith = 0;

beforeEach(() => {
  db = openDatabase(':memory:');
  requests = [];
  failWith = 0;
});

/** @param {boolean} [enabled] */
function mirror(enabled = true) {
  return createMirror({
    db,
    url: 'https://project.supabase.co',
    serviceKey: 'service-key',
    enabled,
    log: () => {},
    fetchImpl: async (input, init) => {
      if (failWith !== 0) return new Response('boom', { status: failWith });
      const headers = /** @type {Record<string, string>} */ (init?.headers ?? {});
      requests.push({
        table: String(input).split('/').pop() ?? '',
        rows: JSON.parse(String(init?.body ?? '[]')),
        prefer: headers['Prefer'] ?? '',
      });
      return new Response('', { status: 201 });
    },
  });
}

describe('mirror', () => {
  it('pushes events and members, and upserts rather than inserts', async () => {
    createEvent(db, { title: 'Soccer', start: '2026-09-08T16:00', memberIds: ['redmond'] });

    const result = await mirror().push();
    assert.ok(result.pushed > 0);

    const events = requests.find((r) => r.table === 'family_events');
    assert.ok(events, 'events must reach the mirror');
    assert.equal(events.rows[0].title, 'Soccer');
    assert.equal(events.rows[0].start_wall, '2026-09-08T16:00');
    assert.match(events.prefer, /merge-duplicates/);
  });

  it('never mirrors an ntfy topic', async () => {
    updateMember(db, 'dad', { displayName: 'Papa' });
    await mirror().push();

    const members = requests.find((r) => r.table === 'family_members');
    assert.ok(members);
    for (const row of members.rows) {
      assert.ok(!('ntfy_topic' in row), 'the topic is the only thing protecting push — keep it home');
      assert.ok(!JSON.stringify(row).includes('fam-'));
    }
  });

  it('only sends what changed since the last push', async () => {
    const m = mirror();
    createEvent(db, { title: 'First', start: '2026-09-08T09:00' });
    await m.push();

    requests = [];
    createEvent(db, { title: 'Second', start: '2026-09-09T09:00' });
    await m.push();

    const events = requests.find((r) => r.table === 'family_events');
    assert.equal(events.rows.length, 1);
    assert.equal(events.rows[0].title, 'Second');
  });

  it('does nothing when nothing has changed', async () => {
    const m = mirror();
    createEvent(db, { title: 'Only thing', start: '2026-09-08T09:00' });
    await m.push();

    requests = [];
    const second = await m.push();
    assert.equal(second.pushed, 0);
    assert.equal(requests.length, 0, 'a quiet house should cost no requests at all');
  });

  it('mirrors a deletion as a tombstone', async () => {
    const m = mirror();
    const ev = createEvent(db, { title: 'Cancelled', start: '2026-09-08T09:00' });
    await m.push();

    requests = [];
    deleteEvent(db, ev.id);
    await m.push();

    const events = requests.find((r) => r.table === 'family_events');
    assert.equal(events.rows[0].id, ev.id);
    assert.equal(events.rows[0].deleted, true);
  });

  it('mirrors an occurrence override', async () => {
    const m = mirror();
    const ev = createEvent(db, { title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
    await m.push();

    requests = [];
    deleteEvent(db, ev.id, { scope: 'this', recurrenceId: '2026-09-15T16:00' });
    await m.push();

    const overrides = requests.find((r) => r.table === 'family_event_overrides');
    assert.ok(overrides);
    assert.equal(overrides.rows[0].recurrence_id, '2026-09-15T16:00');
    assert.equal(overrides.rows[0].cancelled, true);
  });

  it('leaves the cursor alone when the push fails, so nothing is skipped', async () => {
    const m = mirror();
    createEvent(db, { title: 'Important', start: '2026-09-08T09:00' });

    failWith = 500;
    await assert.rejects(() => m.push(), /upsert failed: 500/);
    assert.equal(m.status().cursor, 0);
    assert.match(String(m.status().lastError), /500/);

    failWith = 0;
    requests = [];
    await m.push();
    const events = requests.find((r) => r.table === 'family_events');
    assert.equal(events.rows[0].title, 'Important', 'the row that failed must be retried, not dropped');
    assert.ok(m.status().cursor > 0);
  });

  it('stays out of the way when it is not configured', async () => {
    const off = mirror(false);
    createEvent(db, { title: 'Soccer', start: '2026-09-08T16:00' });

    const result = await off.push();
    assert.equal(result.pushed, 0);
    assert.match(String(result.skipped), /not configured/);
    assert.equal(requests.length, 0);
    assert.equal(off.status().enabled, false);
  });
});
