import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { openDatabase } from '../src/db.js';
import { createEvent, listMembers } from '../src/store.js';
import { dueReminders, reminderBody, runReminderTick } from '../src/reminders.js';
import { createPublisher } from '../src/ntfy.js';
import { parseWall } from '../src/time.js';

/** @type {import('node:sqlite').DatabaseSync} */
let db;
/** @type {Array<{ topic: string, title: string, body: string }>} */
let sent;
/** @type {import('../src/ntfy.js').Publisher} */
let publisher;
/** Set to a status to make every push fail. */
let failWith = 0;

beforeEach(() => {
  db = openDatabase(':memory:');
  sent = [];
  failWith = 0;
  publisher = createPublisher({
    baseUrl: 'https://ntfy.test',
    token: '',
    enabled: true,
    fetchImpl: async (input, init) => {
      if (failWith !== 0) return new Response('nope', { status: failWith });
      const headers = /** @type {Record<string, string>} */ (init?.headers ?? {});
      sent.push({
        topic: decodeURIComponent(String(input).split('/').pop() ?? ''),
        title: headers['Title'] ?? '',
        body: String(init?.body ?? ''),
      });
      return new Response('ok', { status: 200 });
    },
  });
});

/** @param {string} id */
function topicFor(id) {
  return listMembers(db).find((m) => m.id === id).ntfyTopic;
}

describe('dueReminders', () => {
  it('fires once the offset has been reached', () => {
    createEvent(db, {
      title: 'Soccer', start: '2026-09-08T16:00', memberIds: ['redmond'], reminders: [30],
    });

    assert.equal(dueReminders(db, parseWall('2026-09-08T15:20')).length, 0, 'too early');
    assert.equal(dueReminders(db, parseWall('2026-09-08T15:30')).length, 1, 'exactly on the offset');
    assert.equal(dueReminders(db, parseWall('2026-09-08T15:45')).length, 1, 'still due, not yet sent');
  });

  it('sends one reminder per person the event is for', () => {
    createEvent(db, {
      title: 'Parent evening', start: '2026-09-08T18:00', memberIds: ['dad', 'mom'], reminders: [60],
    });
    const due = dueReminders(db, parseWall('2026-09-08T17:00'));
    assert.deepEqual(due.map((d) => d.memberId).sort(), ['dad', 'mom']);
  });

  it('treats an event with nobody assigned as the whole household', () => {
    createEvent(db, { title: 'Power out', start: '2026-09-08T18:00', reminders: [60] });
    const due = dueReminders(db, parseWall('2026-09-08T17:00'));
    assert.deepEqual(due.map((d) => d.memberId).sort(), ['dad', 'mom', 'redmond']);
  });

  it('handles several offsets on one event', () => {
    createEvent(db, {
      title: 'Flight', start: '2026-09-08T18:00', memberIds: ['dad'], reminders: [1440, 60],
    });
    assert.equal(dueReminders(db, parseWall('2026-09-07T18:00')).length, 1, 'the day-before one');
    assert.equal(dueReminders(db, parseWall('2026-09-08T17:00')).length, 2, 'both, none sent yet');
  });

  it('stays quiet about an event that has already started', () => {
    createEvent(db, {
      title: 'Soccer', start: '2026-09-08T16:00', memberIds: ['redmond'], reminders: [30],
    });
    // The server was off all afternoon and came back at six.
    assert.deepEqual(dueReminders(db, parseWall('2026-09-08T18:00')), []);
  });

  it('does not remind about a cancelled occurrence', () => {
    const ev = createEvent(db, {
      title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU',
      memberIds: ['redmond'], reminders: [30],
    });
    db.prepare(
      `INSERT INTO event_overrides (series_id, recurrence_id, cancelled, patch, updated_at, rev, deleted)
       VALUES (?, ?, 1, '{}', ?, 999, 0)`,
    ).run(ev.id, '2026-09-15T16:00', new Date().toISOString());

    assert.equal(dueReminders(db, parseWall('2026-09-15T15:30')).length, 0);
  });

  it('follows a moved occurrence to its new time', () => {
    const ev = createEvent(db, {
      title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU',
      memberIds: ['redmond'], reminders: [30],
    });
    db.prepare(
      `INSERT INTO event_overrides (series_id, recurrence_id, cancelled, patch, updated_at, rev, deleted)
       VALUES (?, ?, 0, ?, ?, 999, 0)`,
    ).run(ev.id, '2026-09-15T16:00', JSON.stringify({ start: '2026-09-15T19:00' }), new Date().toISOString());

    assert.equal(dueReminders(db, parseWall('2026-09-15T15:30')).length, 0, 'not at the old time');
    assert.equal(dueReminders(db, parseWall('2026-09-15T18:30')).length, 1, 'at the new one');
  });
});

describe('runReminderTick', () => {
  it('pushes to the right topic with a readable message', async () => {
    createEvent(db, {
      title: 'Soccer practice', start: '2026-09-08T16:00', location: 'Field 3',
      memberIds: ['redmond'], reminders: [30],
    });

    const result = await runReminderTick({ db, publisher, now: parseWall('2026-09-08T15:30') });
    assert.deepEqual(result, { sent: 1, failed: 0 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].topic, topicFor('redmond'));
    assert.equal(sent[0].title, 'Soccer practice');
    assert.equal(sent[0].body, 'In 30 min — at 4:00pm · Field 3');
  });

  it('never sends the same reminder twice', async () => {
    createEvent(db, {
      title: 'Soccer', start: '2026-09-08T16:00', memberIds: ['redmond'], reminders: [30],
    });

    await runReminderTick({ db, publisher, now: parseWall('2026-09-08T15:30') });
    await runReminderTick({ db, publisher, now: parseWall('2026-09-08T15:31') });
    await runReminderTick({ db, publisher, now: parseWall('2026-09-08T15:45') });

    assert.equal(sent.length, 1, 'the tick runs every 30 seconds; one reminder means one push');
  });

  it('retries on the next tick when the push fails', async () => {
    createEvent(db, {
      title: 'Soccer', start: '2026-09-08T16:00', memberIds: ['redmond'], reminders: [30],
    });

    failWith = 503;
    const bad = await runReminderTick({ db, publisher, now: parseWall('2026-09-08T15:30') });
    assert.deepEqual(bad, { sent: 0, failed: 1 });
    assert.equal(sent.length, 0);

    // Wifi comes back.
    failWith = 0;
    const good = await runReminderTick({ db, publisher, now: parseWall('2026-09-08T15:31') });
    assert.deepEqual(good, { sent: 1, failed: 0 });
    assert.equal(sent.length, 1);
  });

  it('reminds about each occurrence of a repeating event in turn', async () => {
    createEvent(db, {
      title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU',
      memberIds: ['redmond'], reminders: [30],
    });

    await runReminderTick({ db, publisher, now: parseWall('2026-09-08T15:30') });
    await runReminderTick({ db, publisher, now: parseWall('2026-09-15T15:30') });
    await runReminderTick({ db, publisher, now: parseWall('2026-09-22T15:30') });

    assert.equal(sent.length, 3);
  });

  it('does nothing at all when no reminders are set', async () => {
    createEvent(db, { title: 'Quiet event', start: '2026-09-08T16:00', memberIds: ['dad'] });
    const result = await runReminderTick({ db, publisher, now: parseWall('2026-09-08T15:30') });
    assert.deepEqual(result, { sent: 0, failed: 0 });
  });
});

describe('reminderBody', () => {
  const cases = [
    [{ start: '2026-09-08T16:00', location: '', minutesBefore: 30, allDay: false }, 'In 30 min — at 4:00pm'],
    [{ start: '2026-09-08T16:00', location: 'Field 3', minutesBefore: 60, allDay: false }, 'In 1 hour — at 4:00pm · Field 3'],
    [{ start: '2026-09-08T09:05', location: '', minutesBefore: 120, allDay: false }, 'In 2 hours — at 9:05am'],
    [{ start: '2026-09-08T16:00', location: '', minutesBefore: 1440, allDay: false }, 'In 1 day — at 4:00pm'],
    [{ start: '2026-09-08T16:00', location: '', minutesBefore: 0, allDay: false }, 'Starting now — at 4:00pm'],
    [{ start: '2026-09-08T00:00', location: '', minutesBefore: 90, allDay: true }, 'In 1h 30m — Today'],
    [{ start: '2026-09-08T12:00', location: '', minutesBefore: 30, allDay: false }, 'In 30 min — at 12:00pm'],
    [{ start: '2026-09-08T00:30', location: '', minutesBefore: 30, allDay: false }, 'In 30 min — at 12:30am'],
  ];

  for (const [input, want] of cases) {
    it(`renders ${want}`, () => {
      assert.equal(reminderBody(/** @type {any} */ (input)), want);
    });
  }
});

describe('ntfy publisher', () => {
  it('refuses an empty message instead of spending a round trip', async () => {
    const result = await publisher.publish({ topic: 't', title: 'x', body: '  ' });
    assert.equal(result.ok, false);
    assert.equal(sent.length, 0);
  });

  it('strips characters that would break an HTTP header out of the title', async () => {
    await publisher.publish({ topic: 't', title: '⚽ Soccer — practice', body: 'hi' });
    assert.equal(sent[0].title, 'Soccer  practice');
    assert.equal(sent[0].body, 'hi', 'the body keeps the real text');
  });

  it('reports a non-2xx rather than pretending it worked', async () => {
    failWith = 429;
    const result = await publisher.publish({ topic: 't', title: 'x', body: 'y' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 429);
  });

  it('says so when notifications are switched off', async () => {
    const off = createPublisher({ baseUrl: 'https://ntfy.test', token: '', enabled: false });
    const result = await off.publish({ topic: 't', title: 'x', body: 'y' });
    assert.equal(result.ok, false);
    assert.match(result.error, /disabled/);
  });
});
