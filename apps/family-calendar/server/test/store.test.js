import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { openDatabase } from '../src/db.js';
import {
  changesSince, createEvent, deleteEvent, listMembers, listOccurrences,
  listSeries, rotateMemberTopic, updateEvent, updateMember,
  NotFoundError, ValidationError,
} from '../src/store.js';

/** @type {import('node:sqlite').DatabaseSync} */
let db;

beforeEach(() => {
  db = openDatabase(':memory:');
});

/**
 * @param {{ from: string, to: string, memberIds?: string[] }} window
 * @returns {string[]} `start title` lines, which read better in a failure than
 *   a dump of objects
 */
function occurrenceLines(window) {
  return listOccurrences(db, window).map((o) => `${o.start} ${o.title}`);
}

describe('members', () => {
  it('seeds Dad, Mom and Redmond with distinct ntfy topics', () => {
    const members = listMembers(db);
    assert.deepEqual(members.map((m) => m.id), ['dad', 'mom', 'redmond']);
    assert.deepEqual(members.map((m) => m.displayName), ['Dad', 'Mom', 'Redmond']);

    const topics = new Set(members.map((m) => m.ntfyTopic));
    assert.equal(topics.size, 3, 'each member needs their own topic');
    for (const m of members) {
      assert.match(m.ntfyTopic, /^fam-[a-z]+-[0-9a-f]{16}$/);
    }
  });

  it('renames and recolours a member', () => {
    const updated = updateMember(db, 'redmond', { displayName: 'Red', color: '#123ABC' });
    assert.equal(updated.displayName, 'Red');
    assert.equal(updated.color, '#123abc');
  });

  it('rejects a colour that is not a hex value', () => {
    assert.throws(() => updateMember(db, 'dad', { color: 'blue' }), ValidationError);
  });

  it('rotates a topic to cut off a lost phone', () => {
    const before = listMembers(db).find((m) => m.id === 'mom').ntfyTopic;
    const after = rotateMemberTopic(db, 'mom').ntfyTopic;
    assert.notEqual(after, before);
  });

  it('404s on an unknown member', () => {
    assert.throws(() => updateMember(db, 'grandma', { displayName: 'Nan' }), NotFoundError);
  });
});

describe('creating events', () => {
  it('stores a one-off event and hands back what it stored', () => {
    const ev = createEvent(db, {
      title: 'Dentist', start: '2026-09-08T09:00', end: '2026-09-08T10:00',
      memberIds: ['redmond'], location: 'Dr Patel', reminders: [60, 15],
    });
    assert.equal(ev.title, 'Dentist');
    assert.equal(ev.start, '2026-09-08T09:00');
    assert.deepEqual(ev.memberIds, ['redmond']);
    assert.deepEqual(ev.reminders, [60, 15], 'reminders sort furthest-out first');
    assert.equal(ev.rev, 1);
  });

  it('gives an event with no end an hour', () => {
    const ev = createEvent(db, { title: 'Call school', start: '2026-09-08T09:00' });
    assert.equal(ev.end, '2026-09-08T10:00');
  });

  it('stores an all-day event as a full day, so nothing downstream has to ask', () => {
    const ev = createEvent(db, { title: 'Fall break', start: '2026-10-12', end: '2026-10-16', allDay: true });
    assert.equal(ev.start, '2026-10-12T00:00');
    assert.equal(ev.end, '2026-10-16T23:59');
    assert.equal(ev.allDay, true);
  });

  it('refuses an event that ends before it starts', () => {
    assert.throws(
      () => createEvent(db, { title: 'Backwards', start: '2026-09-08T10:00', end: '2026-09-08T09:00' }),
      ValidationError,
    );
  });

  it('refuses a title-less event', () => {
    assert.throws(() => createEvent(db, { start: '2026-09-08T09:00' }), ValidationError);
  });

  it('refuses an unknown family member', () => {
    assert.throws(
      () => createEvent(db, { title: 'X', start: '2026-09-08T09:00', memberIds: ['uncle-bob'] }),
      ValidationError,
    );
  });

  it('refuses a repeat rule it cannot honour', () => {
    assert.throws(
      () => createEvent(db, { title: 'X', start: '2026-09-08T09:00', rrule: 'FREQ=HOURLY' }),
      ValidationError,
    );
  });

  it('refuses a time that is an instant rather than a wall clock', () => {
    assert.throws(
      () => createEvent(db, { title: 'X', start: '2026-09-08T14:00:00Z' }),
      /wall clock/,
    );
  });
});

describe('occurrences', () => {
  it('expands a weekly series across the requested window', () => {
    createEvent(db, {
      title: 'Soccer practice', start: '2026-09-08T16:00', end: '2026-09-08T17:30',
      rrule: 'FREQ=WEEKLY;BYDAY=TU', memberIds: ['redmond'],
    });
    assert.deepEqual(occurrenceLines({ from: '2026-09-01T00:00', to: '2026-09-30T23:59' }), [
      '2026-09-08T16:00 Soccer practice',
      '2026-09-15T16:00 Soccer practice',
      '2026-09-22T16:00 Soccer practice',
      '2026-09-29T16:00 Soccer practice',
    ]);
  });

  it('gives each occurrence a stable id built from the series and its start', () => {
    const ev = createEvent(db, {
      title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU',
    });
    const [first] = listOccurrences(db, { from: '2026-09-08T00:00', to: '2026-09-08T23:59' });
    assert.equal(first.id, `${ev.id}::2026-09-08T16:00`);
    assert.equal(first.recurring, true);
    assert.equal(first.repeatText, 'Weekly on Tue');
  });

  it('includes a multi-day event on the days it merely passes through', () => {
    createEvent(db, { title: 'Grandma visits', start: '2026-09-04', end: '2026-09-07', allDay: true });
    // Sunday the 6th is neither the start nor the end, but she is still here.
    assert.deepEqual(occurrenceLines({ from: '2026-09-06T00:00', to: '2026-09-06T23:59' }), [
      '2026-09-04T00:00 Grandma visits',
    ]);
  });

  it('filters to one person', () => {
    createEvent(db, { title: 'Dad work trip', start: '2026-09-09T08:00', memberIds: ['dad'] });
    createEvent(db, { title: 'Redmond swim', start: '2026-09-09T17:00', memberIds: ['redmond'] });
    createEvent(db, { title: 'Family dinner', start: '2026-09-09T18:30', memberIds: ['dad', 'mom', 'redmond'] });

    assert.deepEqual(
      occurrenceLines({ from: '2026-09-09T00:00', to: '2026-09-09T23:59', memberIds: ['redmond'] }),
      ['2026-09-09T17:00 Redmond swim', '2026-09-09T18:30 Family dinner'],
    );
  });

  it('sorts by start time across every series', () => {
    createEvent(db, { title: 'Late', start: '2026-09-09T18:00' });
    createEvent(db, { title: 'Early', start: '2026-09-09T07:00' });
    createEvent(db, { title: 'Middle', start: '2026-09-09T12:00' });
    assert.deepEqual(
      listOccurrences(db, { from: '2026-09-09T00:00', to: '2026-09-09T23:59' }).map((o) => o.title),
      ['Early', 'Middle', 'Late'],
    );
  });
});

describe('editing one occurrence of a series', () => {
  /** @returns {string} series id */
  function weeklySoccer() {
    return createEvent(db, {
      title: 'Soccer practice', start: '2026-09-08T16:00', end: '2026-09-08T17:30',
      rrule: 'FREQ=WEEKLY;BYDAY=TU', memberIds: ['redmond'],
    }).id;
  }

  it('moves one week without touching the others', () => {
    const id = weeklySoccer();
    updateEvent(db, id, { start: '2026-09-15T18:00', end: '2026-09-15T19:30' }, {
      scope: 'this', recurrenceId: '2026-09-15T16:00',
    });

    assert.deepEqual(occurrenceLines({ from: '2026-09-01T00:00', to: '2026-09-30T23:59' }), [
      '2026-09-08T16:00 Soccer practice',
      '2026-09-15T18:00 Soccer practice',
      '2026-09-22T16:00 Soccer practice',
      '2026-09-29T16:00 Soccer practice',
    ]);
  });

  it('keeps the moved occurrence findable by its original id', () => {
    const id = weeklySoccer();
    updateEvent(db, id, { start: '2026-09-15T18:00' }, { scope: 'this', recurrenceId: '2026-09-15T16:00' });
    const moved = listOccurrences(db, { from: '2026-09-15T00:00', to: '2026-09-15T23:59' })[0];
    assert.equal(moved.recurrenceId, '2026-09-15T16:00');
    assert.equal(moved.id, `${id}::2026-09-15T16:00`);
    assert.equal(moved.overridden, true);
  });

  it('renames one week only', () => {
    const id = weeklySoccer();
    updateEvent(db, id, { title: 'Soccer — picture day' }, { scope: 'this', recurrenceId: '2026-09-22T16:00' });
    assert.deepEqual(occurrenceLines({ from: '2026-09-15T00:00', to: '2026-09-29T23:59' }), [
      '2026-09-15T16:00 Soccer practice',
      '2026-09-22T16:00 Soccer — picture day',
      '2026-09-29T16:00 Soccer practice',
    ]);
  });

  it('cancels one week only', () => {
    const id = weeklySoccer();
    deleteEvent(db, id, { scope: 'this', recurrenceId: '2026-09-15T16:00' });
    assert.deepEqual(occurrenceLines({ from: '2026-09-01T00:00', to: '2026-09-30T23:59' }), [
      '2026-09-08T16:00 Soccer practice',
      '2026-09-22T16:00 Soccer practice',
      '2026-09-29T16:00 Soccer practice',
    ]);
  });

  it('refuses a recurrenceId that is not actually an occurrence', () => {
    const id = weeklySoccer();
    assert.throws(
      () => updateEvent(db, id, { title: 'X' }, { scope: 'this', recurrenceId: '2026-09-16T16:00' }),
      /not an occurrence/,
    );
  });

  it('finds an occurrence dragged a fortnight out of the requested window', () => {
    const id = weeklySoccer();
    updateEvent(db, id, { start: '2026-10-06T16:00', end: '2026-10-06T17:30' }, {
      scope: 'this', recurrenceId: '2026-09-22T16:00',
    });
    const october = occurrenceLines({ from: '2026-10-01T00:00', to: '2026-10-07T23:59' });
    assert.ok(october.includes('2026-10-06T16:00 Soccer practice'));
    // And it is no longer sitting in September.
    assert.deepEqual(occurrenceLines({ from: '2026-09-22T00:00', to: '2026-09-22T23:59' }), []);
  });
});

describe('editing this-and-following', () => {
  it('moves practice to a new day from one week onward', () => {
    const id = createEvent(db, {
      title: 'Soccer practice', start: '2026-09-08T16:00', end: '2026-09-08T17:30',
      rrule: 'FREQ=WEEKLY;BYDAY=TU', memberIds: ['redmond'],
    }).id;

    updateEvent(db, id, { start: '2026-09-23T17:00', end: '2026-09-23T18:30', rrule: 'FREQ=WEEKLY;BYDAY=WE' }, {
      scope: 'following', recurrenceId: '2026-09-22T16:00',
    });

    assert.deepEqual(occurrenceLines({ from: '2026-09-01T00:00', to: '2026-10-14T23:59' }), [
      '2026-09-08T16:00 Soccer practice',
      '2026-09-15T16:00 Soccer practice',
      '2026-09-23T17:00 Soccer practice',
      '2026-09-30T17:00 Soccer practice',
      '2026-10-07T17:00 Soccer practice',
      '2026-10-14T17:00 Soccer practice',
    ]);
  });

  it('leaves two series behind, so history stays true', () => {
    const id = createEvent(db, {
      title: 'Piano', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU',
    }).id;
    updateEvent(db, id, { title: 'Piano (new teacher)' }, {
      scope: 'following', recurrenceId: '2026-09-22T16:00',
    });

    const series = listSeries(db);
    assert.equal(series.length, 2);
    const old = series.find((s) => s.id === id);
    assert.match(old.rrule, /UNTIL=20260921T235959/);
    assert.equal(old.title, 'Piano');
  });

  it('splits a counted series so the two halves still add up', () => {
    const id = createEvent(db, {
      title: 'Swim lessons', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=8',
    }).id;
    updateEvent(db, id, { title: 'Swim lessons (level 2)' }, {
      scope: 'following', recurrenceId: '2026-10-06T16:00',
    });

    const all = listOccurrences(db, { from: '2026-09-01T00:00', to: '2026-12-31T23:59' });
    assert.equal(all.length, 8, 'eight lessons were booked and eight remain');
    assert.equal(all.filter((o) => o.title === 'Swim lessons').length, 4);
    assert.equal(all.filter((o) => o.title === 'Swim lessons (level 2)').length, 4);
  });

  it('ends the series when following-delete is used', () => {
    const id = createEvent(db, {
      title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU',
    }).id;
    deleteEvent(db, id, { scope: 'following', recurrenceId: '2026-09-22T16:00' });

    assert.deepEqual(occurrenceLines({ from: '2026-09-01T00:00', to: '2026-10-31T23:59' }), [
      '2026-09-08T16:00 Soccer',
      '2026-09-15T16:00 Soccer',
    ]);
  });

  it('removes the whole series when the split lands on its first occurrence', () => {
    const id = createEvent(db, {
      title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU',
    }).id;
    deleteEvent(db, id, { scope: 'following', recurrenceId: '2026-09-08T16:00' });
    assert.deepEqual(occurrenceLines({ from: '2026-09-01T00:00', to: '2026-10-31T23:59' }), []);
  });
});

describe('editing the whole series', () => {
  it('changes every occurrence', () => {
    const id = createEvent(db, {
      title: 'Trash night', start: '2026-09-07T19:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', memberIds: ['dad'],
    }).id;
    updateEvent(db, id, { title: 'Trash + recycling', memberIds: ['dad', 'redmond'] }, { scope: 'all' });

    const all = listOccurrences(db, { from: '2026-09-01T00:00', to: '2026-09-30T23:59' });
    assert.ok(all.length >= 4);
    assert.ok(all.every((o) => o.title === 'Trash + recycling'));
    assert.ok(all.every((o) => o.memberIds.includes('redmond')));
  });

  it('treats every scope as "all" for a one-off event', () => {
    const id = createEvent(db, { title: 'Dentist', start: '2026-09-08T09:00' }).id;
    updateEvent(db, id, { title: 'Dentist (moved)' }, { scope: 'this', recurrenceId: '2026-09-08T09:00' });
    assert.deepEqual(occurrenceLines({ from: '2026-09-08T00:00', to: '2026-09-08T23:59' }), [
      '2026-09-08T09:00 Dentist (moved)',
    ]);
  });

  it('deletes the series and hides every occurrence', () => {
    const id = createEvent(db, {
      title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU',
    }).id;
    deleteEvent(db, id);
    assert.deepEqual(occurrenceLines({ from: '2026-09-01T00:00', to: '2026-12-31T23:59' }), []);
  });
});

describe('delta sync', () => {
  it('reports only what changed after a revision', () => {
    const a = createEvent(db, { title: 'A', start: '2026-09-08T09:00' });
    const mark = changesSince(db, 0).rev;

    const b = createEvent(db, { title: 'B', start: '2026-09-09T09:00' });
    const delta = changesSince(db, mark);

    assert.deepEqual(delta.events.map((e) => e.id), [b.id]);
    assert.ok(delta.rev > mark);
    assert.ok(!delta.events.some((e) => e.id === a.id));
  });

  it('reports a deletion as a tombstone, not as silence', () => {
    const ev = createEvent(db, { title: 'Cancelled thing', start: '2026-09-08T09:00' });
    const mark = changesSince(db, 0).rev;
    deleteEvent(db, ev.id);

    const delta = changesSince(db, mark);
    const row = delta.events.find((e) => e.id === ev.id);
    assert.ok(row, 'a phone that missed the delete needs to hear about it');
    assert.equal(row.deleted, true);
  });

  it('reports an occurrence override', () => {
    const ev = createEvent(db, {
      title: 'Soccer', start: '2026-09-08T16:00', rrule: 'FREQ=WEEKLY;BYDAY=TU',
    });
    const mark = changesSince(db, 0).rev;
    deleteEvent(db, ev.id, { scope: 'this', recurrenceId: '2026-09-15T16:00' });

    const delta = changesSince(db, mark);
    assert.equal(delta.overrides.length, 1);
    assert.equal(delta.overrides[0].recurrenceId, '2026-09-15T16:00');
    assert.equal(delta.overrides[0].cancelled, true);
  });

  it('gives every write its own revision', () => {
    const first = createEvent(db, { title: 'A', start: '2026-09-08T09:00' }).rev;
    const second = createEvent(db, { title: 'B', start: '2026-09-08T10:00' }).rev;
    assert.ok(second > first);
  });
});
